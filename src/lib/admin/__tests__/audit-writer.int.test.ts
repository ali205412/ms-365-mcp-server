/**
 * Plan 04-06 Task 1 — admin-action audit writer integration tests (ADMIN-06).
 *
 * Verifies every /admin/* mutation emits an audit_log row with the correct
 * {tenantId, actor, action, target, ip, requestId, result, meta} shape.
 * Guardrails the call-site discipline established in 04-02 (tenants) +
 * 04-03 (api-keys) + 04-05 (audit query) so regressions are caught early.
 *
 * Harness:
 *   - pg-mem Postgres with full migration replay (tenants, audit_log, api_keys).
 *   - postgres.js mock routes withTransaction + getPool to the per-test pool.
 *   - Express server mounts /admin/tenants, /admin/api-keys, /admin/audit
 *     with a stub admin-auth middleware that pins actor/source/tenantScoped.
 *   - Stub middleware also stamps req.id + req.ip so audit rows carry them.
 *
 * Test matrix:
 *   1  admin.tenant.create        — meta {tenantId, mode, cloudType, clientId}
 *   2  admin.tenant.update        — meta {tenantId, fieldsChanged:[...]}
 *   3  admin.tenant.disable       — meta {tenantId, cacheKeysDeleted, pkceKeysDeleted, apiKeysRevoked}
 *   4  admin.tenant.delete        — audit row written inside txn, CASCADE-
 *                                   deletes with tenant; pino info log
 *                                   carries the durable record (see 04-02
 *                                   T-04-05f trade-off)
 *   5  admin.tenant.rotate-secret — meta {tenantId, oldWrappedDekHash, newWrappedDekHash}
 *   6  admin.api-key.mint         — meta {keyId, displaySuffix, tenantId}
 *   7  admin.api-key.revoke       — meta {keyId, tenantId}
 *   8  admin.api-key.rotate       — meta {oldKeyId, newKeyId, displaySuffixes:{old,new}, tenantId}
 *   9  admin.audit.query          — meta {tenantIdFilter, sinceFilter, untilFilter, actionFilter, actorFilter, rowsReturned}
 *  10  source tracking            — entra → actor=UPN, api-key → actor='api-key:<id>'
 *  11  no secrets in meta         — scan for plaintext_key, client_secret, wrapped_dek field, refresh_token, msk_live_, Bearer ey
 *  12  request_id correlation     — every row carries a non-empty request_id
 *  13  IP correlation             — every row has ip populated
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

let sharedPool: Pool | null = null;
vi.mock('../../postgres.js', async () => {
  return {
    scheduleAfterCommit: vi.fn(),
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
      if (!sharedPool) throw new Error('sharedPool not set in test');
      const client = await sharedPool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // best-effort rollback
        }
        throw err;
      } finally {
        client.release();
      }
    },
    getPool: () => sharedPool,
  };
});

import { createTenantsRoutes } from '../tenants.js';
import { createApiKeyRoutes } from '../api-keys.js';
import { createAuditRoutes } from '../audit.js';
import { MemoryRedisFacade } from '../../redis-facade.js';
import { createCursorSecret } from '../cursor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

const KEK = crypto.randomBytes(32);

function stripPgcryptoExtensionStmts(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/\bextension\b.*\bpgcrypto\b/i.test(line))
    .join('\n');
}

async function makePool(): Promise<Pool> {
  const db = newDb();
  db.registerExtension('pgcrypto', () => {});
  const { Pool: PgMemPool } = db.adapters.createPg();
  const pool = new PgMemPool() as Pool;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const up = stripPgcryptoExtensionStmts(
      (sql.split(/^--\s*Down Migration\s*$/m)[0] ?? '').replace(/^--\s*Up Migration\s*$/m, '')
    );
    await pool.query(up);
  }
  return pool;
}

interface AdminContext {
  actor: string;
  source: 'entra' | 'api-key';
  tenantScoped: string | null;
}

interface TenantPoolStub {
  evict: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
}

function makeTenantPoolStub(): TenantPoolStub {
  return {
    evict: vi.fn(),
    invalidate: vi.fn(),
  };
}

interface Harness {
  url: string;
  close: () => Promise<void>;
}

async function startServer(
  pool: Pool,
  redis: MemoryRedisFacade,
  admin: AdminContext,
  tenantPool: TenantPoolStub,
  reqId = 'req-fixed',
  reqIp = '10.11.12.13'
): Promise<Harness> {
  const app = express();
  app.use(express.json() as unknown as express.RequestHandler);
  app.use((req, _res, next) => {
    (req as unknown as { admin?: AdminContext }).admin = admin;
    (req as express.Request & { id?: string }).id = reqId;
    // Override the read-only `ip` getter for deterministic test coverage
    // without relying on loopback resolution.
    Object.defineProperty(req, 'ip', { value: reqIp, configurable: true });
    next();
  });
  const deps = {
    pgPool: pool,
    redis,
    tenantPool: tenantPool as unknown as import('../router.js').AdminRouterDeps['tenantPool'],
    kek: KEK,
    cursorSecret: createCursorSecret(),
    adminOrigins: [],
    entraConfig: { appClientId: 'x', groupId: 'g' },
  } as unknown as import('../router.js').AdminRouterDeps;
  app.use('/admin/tenants', createTenantsRoutes(deps));
  app.use('/admin/api-keys', createApiKeyRoutes({ pgPool: pool, redis }));
  app.use('/admin/audit', createAuditRoutes(deps));
  const server = await new Promise<http.Server>((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () =>
      new Promise<void>((r) => {
        server.close(() => r());
      }),
  };
}

async function doReq(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function selectAuditRows(
  pool: Pool,
  action?: string
): Promise<
  Array<{
    id: string;
    tenant_id: string;
    actor: string;
    action: string;
    target: string | null;
    ip: string | null;
    request_id: string;
    result: string;
    meta: unknown;
  }>
> {
  const query = action
    ? `SELECT * FROM audit_log WHERE action = $1 ORDER BY ts ASC`
    : `SELECT * FROM audit_log ORDER BY ts ASC`;
  const params = action ? [action] : [];
  const { rows } = await pool.query(query, params);
  return rows;
}

function parseMeta(row: { meta: unknown }): Record<string, unknown> {
  if (typeof row.meta === 'string') return JSON.parse(row.meta);
  if (row.meta && typeof row.meta === 'object') return row.meta as Record<string, unknown>;
  return {};
}

const VALID_TENANT_BODY = {
  mode: 'delegated' as const,
  client_id: 'ci-client-id',
  tenant_id: '11111111-2222-4333-8444-555555555555',
  cloud_type: 'global' as const,
  redirect_uri_allowlist: ['http://localhost:3000/callback'],
  cors_origins: ['http://localhost:3000'],
  allowed_scopes: ['User.Read'],
};

describe('plan 04-06 Task 1 — admin-action audit writer (ADMIN-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('Test 1: admin.tenant.create writes audit row with full shape + meta', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const res = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      expect(res.status).toBe(201);
      const tenantId = res.body.id;

      const rows = await selectAuditRows(pool, 'admin.tenant.create');
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.tenant_id).toBe(tenantId);
      expect(row.actor).toBe('alice@example.com');
      expect(row.action).toBe('admin.tenant.create');
      expect(row.target).toBe(tenantId);
      expect(row.ip).toBe('10.11.12.13');
      expect(row.request_id).toBe('req-fixed');
      expect(row.result).toBe('success');
      const meta = parseMeta(row);
      expect(meta.tenantId).toBe(tenantId);
      expect(meta.mode).toBe('delegated');
      expect(meta.cloudType).toBe('global');
      expect(meta.clientId).toBe('ci-client-id');
    } finally {
      await close();
    }
  });

  it('Test 2: admin.tenant.update writes audit row with fieldsChanged meta', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      expect(created.status).toBe(201);
      const tenantId = created.body.id;

      const patch = await doReq('PATCH', `${url}/admin/tenants/${tenantId}`, {
        cors_origins: ['http://localhost:4000'],
      });
      expect(patch.status).toBe(200);

      const rows = await selectAuditRows(pool, 'admin.tenant.update');
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.tenant_id).toBe(tenantId);
      expect(row.action).toBe('admin.tenant.update');
      expect(row.target).toBe(tenantId);
      expect(row.result).toBe('success');
      const meta = parseMeta(row);
      expect(meta.tenantId).toBe(tenantId);
      expect(Array.isArray(meta.fieldsChanged)).toBe(true);
      expect(meta.fieldsChanged).toContain('cors_origins');
    } finally {
      await close();
    }
  });

  it('Test 3: admin.tenant.disable writes audit row with cryptoshred counters', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      expect(created.status).toBe(201);
      const tenantId = created.body.id;

      const disable = await doReq('PATCH', `${url}/admin/tenants/${tenantId}/disable`);
      expect(disable.status).toBe(200);

      const rows = await selectAuditRows(pool, 'admin.tenant.disable');
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.tenant_id).toBe(tenantId);
      expect(row.action).toBe('admin.tenant.disable');
      expect(row.target).toBe(tenantId);
      expect(row.result).toBe('success');
      const meta = parseMeta(row);
      expect(meta.tenantId).toBe(tenantId);
      expect(typeof meta.cacheKeysDeleted).toBe('number');
      expect(typeof meta.pkceKeysDeleted).toBe('number');
      expect(typeof meta.apiKeysRevoked).toBe('number');
      // Fresh tenant with no cache / pkce / api_keys — all counters 0.
      expect(meta.cacheKeysDeleted).toBe(0);
      expect(meta.pkceKeysDeleted).toBe(0);
      expect(meta.apiKeysRevoked).toBe(0);
    } finally {
      await close();
    }
  });

  it('Test 4: admin.tenant.delete — audit row written inside txn, CASCADE-deletes with tenant (pino info log is the durable record)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      expect(created.status).toBe(201);
      const tenantId = created.body.id;

      const del = await doReq('DELETE', `${url}/admin/tenants/${tenantId}`);
      expect(del.status).toBe(200);

      // Per 04-02 T-04-05f trade-off: the admin.tenant.delete audit row was
      // written BEFORE DELETE FROM tenants inside the same txn, so it
      // CASCADE-deletes with the tenant (FK ON DELETE CASCADE). The durable
      // record is the pino info log after COMMIT — we assert its shape here.
      const postDelRows = await selectAuditRows(pool, 'admin.tenant.delete');
      expect(postDelRows.length).toBe(0);

      const deleteLogCall = loggerMock.info.mock.calls.find((call) => {
        const [meta] = call;
        return meta && typeof meta === 'object' && meta.event === 'admin.tenant.delete';
      });
      expect(deleteLogCall).toBeDefined();
      const [meta] = deleteLogCall!;
      expect(meta.tenantId).toBe(tenantId);
      expect(meta.actor).toBe('alice@example.com');
      expect(typeof meta.apiKeysRevoked).toBe('number');
      expect(typeof meta.cacheKeysDeleted).toBe('number');
      expect(typeof meta.pkceKeysDeleted).toBe('number');
    } finally {
      await close();
    }
  });

  it('Test 5: admin.tenant.rotate-secret writes audit row with old/new wrapped DEK hashes', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      expect(created.status).toBe(201);
      const tenantId = created.body.id;

      const rotate = await doReq('PATCH', `${url}/admin/tenants/${tenantId}/rotate-secret`);
      expect(rotate.status).toBe(200);

      const rows = await selectAuditRows(pool, 'admin.tenant.rotate-secret');
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.tenant_id).toBe(tenantId);
      expect(row.action).toBe('admin.tenant.rotate-secret');
      const meta = parseMeta(row);
      expect(meta.tenantId).toBe(tenantId);
      expect(typeof meta.oldWrappedDekHash).toBe('string');
      expect(typeof meta.newWrappedDekHash).toBe('string');
      // Hashes are 16-char sha256 slices. They must differ (new IV + tag
      // → different envelope → different hash).
      expect((meta.oldWrappedDekHash as string).length).toBe(16);
      expect((meta.newWrappedDekHash as string).length).toBe(16);
      expect(meta.oldWrappedDekHash).not.toBe(meta.newWrappedDekHash);
      // The actual wrapped_dek JSON must NOT be in the meta.
      expect(JSON.stringify(meta)).not.toContain('"ct":');
      expect(JSON.stringify(meta)).not.toContain('"iv":');
      expect(JSON.stringify(meta)).not.toContain('"tag":');
    } finally {
      await close();
    }
  });

  it('Test 6: admin.api-key.mint writes audit row; meta has NO plaintext_key or key_hash', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      expect(created.status).toBe(201);
      const tenantId = created.body.id;

      const mint = await doReq('POST', `${url}/admin/api-keys`, {
        tenant_id: tenantId,
        name: 'ci-bot',
      });
      expect(mint.status).toBe(201);
      const plaintextKey = mint.body.plaintext_key as string;
      const keyId = mint.body.id as string;
      const displaySuffix = mint.body.display_suffix as string;

      const rows = await selectAuditRows(pool, 'admin.api-key.mint');
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.tenant_id).toBe(tenantId);
      expect(row.action).toBe('admin.api-key.mint');
      expect(row.target).toBe(keyId);
      const meta = parseMeta(row);
      expect(meta.keyId).toBe(keyId);
      expect(meta.displaySuffix).toBe(displaySuffix);
      expect(meta.tenantId).toBe(tenantId);
      // The plaintext and the hash MUST NOT appear in meta.
      const metaBlob = JSON.stringify(meta);
      expect(metaBlob).not.toContain(plaintextKey);
      expect(metaBlob).not.toContain('plaintext_key');
      expect(metaBlob).not.toContain('key_hash');
      expect(metaBlob).not.toContain('$argon2');
    } finally {
      await close();
    }
  });

  it('Test 7: admin.api-key.revoke writes audit row with {keyId, tenantId}', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      const tenantId = created.body.id;
      const mint = await doReq('POST', `${url}/admin/api-keys`, {
        tenant_id: tenantId,
        name: 'ci-bot',
      });
      const keyId = mint.body.id as string;

      const revoke = await doReq('POST', `${url}/admin/api-keys/${keyId}/revoke`);
      expect(revoke.status).toBe(200);

      const rows = await selectAuditRows(pool, 'admin.api-key.revoke');
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.tenant_id).toBe(tenantId);
      expect(row.action).toBe('admin.api-key.revoke');
      expect(row.target).toBe(keyId);
      const meta = parseMeta(row);
      expect(meta.keyId).toBe(keyId);
      expect(meta.tenantId).toBe(tenantId);
    } finally {
      await close();
    }
  });

  it('Test 8: admin.api-key.rotate writes audit row with {oldKeyId, newKeyId, displaySuffixes}', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      const tenantId = created.body.id;
      const mint = await doReq('POST', `${url}/admin/api-keys`, {
        tenant_id: tenantId,
        name: 'ci-bot',
      });
      const oldKeyId = mint.body.id as string;
      const oldSuffix = mint.body.display_suffix as string;

      const rotate = await doReq('POST', `${url}/admin/api-keys/${oldKeyId}/rotate`);
      expect(rotate.status).toBe(200);
      const newKeyId = rotate.body.new.id as string;
      const newSuffix = rotate.body.new.display_suffix as string;
      const newPlaintext = rotate.body.new.plaintext_key as string;

      const rows = await selectAuditRows(pool, 'admin.api-key.rotate');
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.tenant_id).toBe(tenantId);
      expect(row.action).toBe('admin.api-key.rotate');
      expect(row.target).toBe(oldKeyId);
      const meta = parseMeta(row);
      expect(meta.oldKeyId).toBe(oldKeyId);
      expect(meta.newKeyId).toBe(newKeyId);
      expect(meta.tenantId).toBe(tenantId);
      const suffixes = meta.displaySuffixes as { old: string; new: string };
      expect(suffixes.old).toBe(oldSuffix);
      expect(suffixes.new).toBe(newSuffix);
      // The new plaintext MUST NOT appear in the audit meta.
      expect(JSON.stringify(meta)).not.toContain(newPlaintext);
    } finally {
      await close();
    }
  });

  it('Test 9: admin.audit.query emits self-audit row when scoped to a tenant', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      const tenantId = created.body.id;

      // Query with a tenant_id filter so we persist the self-audit row.
      const query = await doReq(
        'GET',
        `${url}/admin/audit?tenant_id=${tenantId}&action=admin.tenant.create`
      );
      expect(query.status).toBe(200);

      const rows = await selectAuditRows(pool, 'admin.audit.query');
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.tenant_id).toBe(tenantId);
      expect(row.action).toBe('admin.audit.query');
      expect(row.result).toBe('success');
      const meta = parseMeta(row);
      expect(meta.tenantIdFilter).toBe(tenantId);
      expect(meta.actionFilter).toBe('admin.tenant.create');
      expect(meta.actorFilter ?? null).toBeNull();
      expect(meta.sinceFilter ?? null).toBeNull();
      expect(meta.untilFilter ?? null).toBeNull();
      expect(typeof meta.rowsReturned).toBe('number');
      expect(meta.rowsReturned).toBeGreaterThanOrEqual(1);
    } finally {
      await close();
    }
  });

  it('Test 10: source tracking — entra → UPN actor, api-key → api-key:<id> actor', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    // Step 1: global entra admin creates the tenant so the api-key source
    // in Step 2 has a target to mutate.
    {
      const { url, close } = await startServer(
        pool,
        new MemoryRedisFacade(),
        { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
        tp
      );
      try {
        const res = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
        expect(res.status).toBe(201);
      } finally {
        await close();
      }
    }
    const entraCreateRows = await selectAuditRows(pool, 'admin.tenant.create');
    expect(entraCreateRows.length).toBe(1);
    expect(entraCreateRows[0].actor).toBe('alice@example.com');
    const tenantId = entraCreateRows[0].tenant_id;

    // Step 2: api-key scoped admin patches the same tenant.
    {
      const { url, close } = await startServer(
        pool,
        new MemoryRedisFacade(),
        {
          actor: 'api-key:550e8400-e29b-41d4-a716-446655440000',
          source: 'api-key',
          tenantScoped: tenantId,
        },
        tp
      );
      try {
        const res = await doReq('PATCH', `${url}/admin/tenants/${tenantId}`, {
          cors_origins: ['http://localhost:5000'],
        });
        expect(res.status).toBe(200);
      } finally {
        await close();
      }
    }
    const updateRows = await selectAuditRows(pool, 'admin.tenant.update');
    expect(updateRows.length).toBe(1);
    expect(updateRows[0].actor).toMatch(/^api-key:/);
  });

  it('Test 11: no secrets in meta across ANY admin.* audit row', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      // Exercise every mutation shape that writes an audit row so the scan
      // covers the full surface.
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      const tenantId = created.body.id;
      await doReq('PATCH', `${url}/admin/tenants/${tenantId}`, {
        cors_origins: ['http://localhost:4000'],
      });
      await doReq('PATCH', `${url}/admin/tenants/${tenantId}/rotate-secret`);
      const mint = await doReq('POST', `${url}/admin/api-keys`, {
        tenant_id: tenantId,
        name: 'secret-scan-bot',
      });
      const keyId = mint.body.id as string;
      await doReq('POST', `${url}/admin/api-keys/${keyId}/rotate`);
      // Finally disable
      await doReq('PATCH', `${url}/admin/tenants/${tenantId}/disable`);

      const rows = await selectAuditRows(pool);
      expect(rows.length).toBeGreaterThanOrEqual(5);
      for (const row of rows) {
        const blob = JSON.stringify(parseMeta(row));
        // No plaintext_key field
        expect(blob).not.toContain('plaintext_key');
        // No client_secret field
        expect(blob).not.toContain('client_secret');
        // No raw wrapped_dek envelope (only *Hash / *Suffix variants are safe)
        expect(blob).not.toMatch(/"wrapped_dek"\s*:/);
        // No key_hash field
        expect(blob).not.toContain('key_hash');
        expect(blob).not.toContain('$argon2');
        // No plaintext API key material
        expect(blob).not.toMatch(/msk_live_[A-Za-z0-9_-]{20,}/);
        // No refresh_token or bearer token material
        expect(blob).not.toMatch(/refresh_token/i);
        expect(blob).not.toMatch(/Bearer ey/i);
      }
    } finally {
      await close();
    }
  });

  it('Test 12: request_id populated on every admin.* audit row (MWARE-07 correlation)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp,
      'req-unique-12345'
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      const tenantId = created.body.id;
      await doReq('PATCH', `${url}/admin/tenants/${tenantId}`, {
        cors_origins: ['http://localhost:4000'],
      });
      await doReq('POST', `${url}/admin/api-keys`, { tenant_id: tenantId, name: 'rq-id-bot' });

      const rows = await selectAuditRows(pool);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for (const row of rows) {
        expect(typeof row.request_id).toBe('string');
        expect(row.request_id.length).toBeGreaterThan(0);
        expect(row.request_id).toBe('req-unique-12345');
      }
    } finally {
      await close();
    }
  });

  it('Test 13: ip populated on every admin.* audit row', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp,
      'req-ip-test',
      '203.0.113.42'
    );
    try {
      const created = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      const tenantId = created.body.id;
      await doReq('POST', `${url}/admin/api-keys`, { tenant_id: tenantId, name: 'ip-test-bot' });

      const rows = await selectAuditRows(pool);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const row of rows) {
        expect(row.ip).toBe('203.0.113.42');
      }
    } finally {
      await close();
    }
  });
});
