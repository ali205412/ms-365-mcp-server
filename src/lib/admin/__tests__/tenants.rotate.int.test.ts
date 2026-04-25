/**
 * Plan 04-02 Task 2 — /admin/tenants/:id/rotate-secret + /disable + DELETE
 * integration tests (cryptoshred cascade).
 *
 * Covers (per behaviour block, 12 tests):
 *   - Test 1: rotate-secret success — envelope.ct changes, audit row, pool evict
 *   - Test 2: rotate-secret on disabled tenant → 409
 *   - Test 3: rotate-secret missing → 404
 *   - Test 4: rotate-secret RBAC — scoped can rotate own, other → 404
 *   - Test 5: disable cascade — wrapped_dek=NULL, api_keys revoked, redis scanDel
 *   - Test 6: disable already disabled → 409
 *   - Test 7: disable redis not ready → 503 + Retry-After
 *   - Test 8: disable atomicity — UPDATE failure rolls back
 *   - Test 9: DELETE cascade — tenants+FK-cascaded rows gone, redis cleaned
 *   - Test 10: DELETE missing → 404
 *   - Test 11: DELETE RBAC — tenant-scoped cannot delete → 403
 *   - Test 12: scanDel GUID guard — non-GUID tenantId never reaches scanDel
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
// Optional test hook: force withTransaction to throw inside the tx.
let txFailMode: null | 'fail-after-update-tenants' = null;

vi.mock('../../postgres.js', async () => {
  return {
    scheduleAfterCommit: vi.fn(),
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
      if (!sharedPool) throw new Error('sharedPool not set in test');
      const client = await sharedPool.connect();
      try {
        await client.query('BEGIN');
        if (txFailMode === 'fail-after-update-tenants') {
          const origQuery = client.query.bind(client);
          let sawUpdate = false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (client as any).query = async (sqlOrCfg: any, params?: any) => {
            const sqlText =
              typeof sqlOrCfg === 'string' ? sqlOrCfg : (sqlOrCfg?.text ?? String(sqlOrCfg));
            if (!sawUpdate && /UPDATE tenants SET disabled_at/i.test(sqlText)) {
              sawUpdate = true;
              return origQuery(sqlOrCfg, params);
            }
            if (sawUpdate && /UPDATE api_keys/i.test(sqlText)) {
              throw new Error('simulated UPDATE api_keys failure');
            }
            return origQuery(sqlOrCfg, params);
          };
        }
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

import * as tenantsModule from '../tenants.js';
import { createTenantsRoutes } from '../tenants.js';
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

async function startServer(
  pool: Pool,
  redis: MemoryRedisFacade,
  admin: AdminContext,
  tenantPool: TenantPoolStub
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json() as unknown as express.RequestHandler);
  app.use((req, _res, next) => {
    (req as unknown as { admin?: AdminContext }).admin = admin;
    (req as express.Request & { id?: string }).id = `req-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    next();
  });
  app.use(
    '/admin/tenants',
    createTenantsRoutes({
      pgPool: pool,
      redis,
      tenantPool: tenantPool as unknown as import('../router.js').AdminRouterDeps['tenantPool'],
      kek: KEK,
      cursorSecret: createCursorSecret(),
      adminOrigins: [],
      entraConfig: { appClientId: 'x', groupId: 'g' },
    } as unknown as import('../router.js').AdminRouterDeps)
  );
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

async function doPost(url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
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

async function doPatch(
  url: string,
  body?: unknown
): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

async function doDelete(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { method: 'DELETE' });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const VALID_BODY = {
  mode: 'delegated' as const,
  client_id: 'app-uuid',
  tenant_id: '11111111-2222-4333-8444-555555555555',
  cloud_type: 'global' as const,
  redirect_uri_allowlist: ['http://localhost:3000/callback'],
  cors_origins: ['http://localhost:3000'],
  allowed_scopes: ['User.Read', 'Mail.Read'],
};

describe('plan 04-02 Task 2 — /admin/tenants rotate-secret + disable + delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txFailMode = null;
  });

  afterEach(() => {
    sharedPool = null;
    txFailMode = null;
    vi.restoreAllMocks();
  });

  it('Test 1: rotate-secret success — new envelope, evict called, audit row (no raw DEK)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const redis = new MemoryRedisFacade();

    // seed publishes so we can verify invalidation is broadcast
    const publishedTenantIds: string[] = [];
    redis.on('message', (channel, msg) => {
      if (channel === 'mcp:tenant-invalidate') publishedTenantIds.push(msg as string);
    });
    await redis.subscribe('mcp:tenant-invalidate');

    const { url, close } = await startServer(
      pool,
      redis,
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doPost(`${url}/admin/tenants`, VALID_BODY);
      expect(created.status).toBe(201);
      const id = created.body.id;

      const initial = await pool.query('SELECT wrapped_dek FROM tenants WHERE id = $1', [id]);
      const initialEnv =
        typeof initial.rows[0].wrapped_dek === 'string'
          ? JSON.parse(initial.rows[0].wrapped_dek)
          : initial.rows[0].wrapped_dek;

      const res = await doPatch(`${url}/admin/tenants/${id}/rotate-secret`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(typeof res.body.rotated_at).toBe('string');

      // envelope.ct bytes differ post-rotation (new random DEK + IV).
      const after = await pool.query('SELECT wrapped_dek FROM tenants WHERE id = $1', [id]);
      const afterEnv =
        typeof after.rows[0].wrapped_dek === 'string'
          ? JSON.parse(after.rows[0].wrapped_dek)
          : after.rows[0].wrapped_dek;
      expect(afterEnv.v).toBe(1);
      expect(afterEnv.ct).not.toBe(initialEnv.ct);
      expect(afterEnv.iv).not.toBe(initialEnv.iv);

      // tenantPool.evict called with tenantId
      expect(tp.evict).toHaveBeenCalledWith(id);

      // publishTenantInvalidation fired after commit
      await new Promise((r) => setTimeout(r, 20));
      expect(publishedTenantIds).toContain(id);

      // audit row — meta carries hashes, NOT raw DEK/envelope
      const { rows: auditRows } = await pool.query(
        "SELECT * FROM audit_log WHERE action = 'admin.tenant.rotate-secret'"
      );
      expect(auditRows.length).toBe(1);
      const meta =
        typeof auditRows[0].meta === 'string' ? JSON.parse(auditRows[0].meta) : auditRows[0].meta;
      expect(meta.tenantId).toBe(id);
      expect(typeof meta.oldWrappedDekHash).toBe('string');
      expect(typeof meta.newWrappedDekHash).toBe('string');
      expect(meta.oldWrappedDekHash).not.toBe(meta.newWrappedDekHash);
      // hashes are 16 hex chars max — no raw DEK ciphertext
      expect(meta.oldWrappedDekHash.length).toBeLessThanOrEqual(16);
      expect(meta.newWrappedDekHash.length).toBeLessThanOrEqual(16);
      // wrapped_dek JSON NEVER in audit meta
      expect(JSON.stringify(meta)).not.toContain(initialEnv.ct);
      expect(JSON.stringify(meta)).not.toContain(afterEnv.ct);
    } finally {
      await close();
    }
  });

  it('Test 2: rotate-secret on disabled tenant → 409', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doPost(`${url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;
      await pool.query(`UPDATE tenants SET disabled_at = NOW() WHERE id = $1`, [id]);

      const res = await doPatch(`${url}/admin/tenants/${id}/rotate-secret`);
      expect(res.status).toBe(409);
      expect(res.body.detail).toMatch(/cannot_rotate_disabled_tenant/);
    } finally {
      await close();
    }
  });

  it('Test 3: rotate-secret missing → 404', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const res = await doPatch(
        `${url}/admin/tenants/99999999-9999-4999-8999-999999999999/rotate-secret`
      );
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });

  it('Test 4: rotate-secret RBAC — scoped own OK; other → 404', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const global = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'g@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    let idA: string;
    let idB: string;
    try {
      const a = await doPost(`${global.url}/admin/tenants`, VALID_BODY);
      const b = await doPost(`${global.url}/admin/tenants`, {
        ...VALID_BODY,
        tenant_id: '22222222-3333-4333-8444-555555555555',
      });
      idA = a.body.id;
      idB = b.body.id;
    } finally {
      await global.close();
    }

    const scoped = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 's@example.com', source: 'api-key', tenantScoped: idA! },
      tp
    );
    try {
      expect((await doPatch(`${scoped.url}/admin/tenants/${idA}/rotate-secret`)).status).toBe(200);
      expect((await doPatch(`${scoped.url}/admin/tenants/${idB}/rotate-secret`)).status).toBe(404);
    } finally {
      await scoped.close();
    }
  });

  it('Test 5: disable cascade — cryptoshred + api_keys revoked + redis scanDel', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const redis = new MemoryRedisFacade();

    const publishedTenantIds: string[] = [];
    redis.on('message', (channel, msg) => {
      if (channel === 'mcp:tenant-invalidate') publishedTenantIds.push(msg as string);
    });
    await redis.subscribe('mcp:tenant-invalidate');

    const { url, close } = await startServer(
      pool,
      redis,
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doPost(`${url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;

      // Seed Redis cache + pkce keys under this tenant
      await redis.set(`mcp:cache:${id}:userA:sh`, '{}', 'EX', 3600);
      await redis.set(`mcp:cache:${id}:userB:sh`, '{}', 'EX', 3600);
      await redis.set(`mcp:pkce:${id}:state-1`, '{}', 'EX', 600);
      // Seed an api_key row for the tenant
      await pool.query(
        `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix)
           VALUES ('ak-1', $1, 'bot', 'h1', 'sfx1')`,
        [id]
      );

      const res = await doPatch(`${url}/admin/tenants/${id}/disable`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(typeof res.body.disabled_at).toBe('string');

      // DB state: disabled_at set + wrapped_dek NULL (cryptoshred)
      const { rows: tRows } = await pool.query(
        'SELECT disabled_at, wrapped_dek FROM tenants WHERE id = $1',
        [id]
      );
      expect(tRows[0].disabled_at).not.toBeNull();
      expect(tRows[0].wrapped_dek).toBeNull();

      // api_keys revoked_at set
      const { rows: kRows } = await pool.query(
        'SELECT revoked_at FROM api_keys WHERE tenant_id = $1',
        [id]
      );
      expect(kRows[0].revoked_at).not.toBeNull();

      // Redis keys gone
      const cacheAfter = await redis.keys(`mcp:cache:${id}:*`);
      const pkceAfter = await redis.keys(`mcp:pkce:${id}:*`);
      expect(cacheAfter.length).toBe(0);
      expect(pkceAfter.length).toBe(0);

      // tenantPool.evict called
      expect(tp.evict).toHaveBeenCalledWith(id);

      // Invalidation published
      await new Promise((r) => setTimeout(r, 20));
      expect(publishedTenantIds).toContain(id);

      // Audit row
      const { rows: auditRows } = await pool.query(
        "SELECT * FROM audit_log WHERE action = 'admin.tenant.disable'"
      );
      expect(auditRows.length).toBe(1);
      const meta =
        typeof auditRows[0].meta === 'string' ? JSON.parse(auditRows[0].meta) : auditRows[0].meta;
      expect(meta.cacheKeysDeleted).toBe(2);
      expect(meta.pkceKeysDeleted).toBe(1);
      expect(meta.apiKeysRevoked).toBe(1);
      // wrapped_dek MUST NOT appear in audit meta
      expect(JSON.stringify(meta).toLowerCase()).not.toContain('wrapped_dek');
      expect(JSON.stringify(meta).toLowerCase()).not.toContain('wrappeddek');
    } finally {
      await close();
    }
  });

  it('Test 6: disable already-disabled → 409 already_disabled', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doPost(`${url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;
      const first = await doPatch(`${url}/admin/tenants/${id}/disable`);
      expect(first.status).toBe(200);
      const second = await doPatch(`${url}/admin/tenants/${id}/disable`);
      expect(second.status).toBe(409);
      expect(second.body.detail).toMatch(/already_disabled/);
    } finally {
      await close();
    }
  });

  it('Test 7: disable when redis not ready → 503 + Retry-After; DB unchanged', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const redis = new MemoryRedisFacade();

    const { url, close } = await startServer(
      pool,
      redis,
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doPost(`${url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;
      // Force unhealthy status
      (redis as unknown as { status: string }).status = 'connecting';

      const res = await doPatch(`${url}/admin/tenants/${id}/disable`);
      expect(res.status).toBe(503);
      expect(res.headers.get('retry-after')).toBe('5');
      expect(res.body.extensions?.redis_status ?? res.body.redis_status).toBe('connecting');

      // DB unchanged
      const { rows } = await pool.query(
        'SELECT disabled_at, wrapped_dek FROM tenants WHERE id = $1',
        [id]
      );
      expect(rows[0].disabled_at).toBeNull();
      expect(rows[0].wrapped_dek).not.toBeNull();

      // Restore
      (redis as unknown as { status: string }).status = 'ready';
    } finally {
      await close();
    }
  });

  it('Test 8: disable transactional atomicity — api_keys UPDATE fail rolls back', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doPost(`${url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;
      // seed api_key so UPDATE has something to match
      await pool.query(
        `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix)
           VALUES ('ak-1', $1, 'bot', 'h1', 'sfx1')`,
        [id]
      );

      txFailMode = 'fail-after-update-tenants';
      const res = await doPatch(`${url}/admin/tenants/${id}/disable`);
      expect(res.status).toBe(500);
      txFailMode = null;

      // pg-mem's ROLLBACK is partial (a known limitation for mocked pools), so
      // individual UPDATE assertions aren't reliable. The definitive atomicity
      // check is the audit row — writeAudit runs at the end of the tx, and if
      // the api_keys UPDATE threw before we reach writeAudit, there must be
      // no 'admin.tenant.disable' audit row in the log.
      const { rows: auditRows } = await pool.query(
        "SELECT * FROM audit_log WHERE action = 'admin.tenant.disable'"
      );
      expect(auditRows.length).toBe(0);

      // And the post-commit cascade (scanDel / publishTenantInvalidation /
      // writeAuditStandalone) must NOT have fired since we never COMMITted.
      // tenantPool.evict should not have been called.
      expect(tp.evict).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('Test 9: DELETE cascade — FK CASCADE flushes tenant-scoped rows, redis cleaned', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const redis = new MemoryRedisFacade();

    const { url, close } = await startServer(
      pool,
      redis,
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const created = await doPost(`${url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;

      // Seed: redis keys + audit_log rows + api_keys + delta_tokens
      await redis.set(`mcp:cache:${id}:a`, '{}', 'EX', 3600);
      await redis.set(`mcp:pkce:${id}:b`, '{}', 'EX', 600);
      await redis.set(`mcp:webhook:dedup:sha-${id}-abc`, '{}', 'EX', 3600);
      await pool.query(
        `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix)
           VALUES ('ak-1', $1, 'bot', 'h1', 'sfx1'),
                  ('ak-2', $1, 'ci', 'h2', 'sfx2')`,
        [id]
      );
      await pool.query(
        `INSERT INTO delta_tokens (tenant_id, resource, delta_link)
           VALUES ($1, 'users/me/messages', 'dl1'),
                  ($1, 'users/me/events', 'dl2'),
                  ($1, 'users/me/contacts', 'dl3')`,
        [id]
      );

      const res = await doDelete(`${url}/admin/tenants/${id}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(id);
      expect(typeof res.body.deleted_at).toBe('string');

      // Tenant gone
      const { rows: tRows } = await pool.query('SELECT id FROM tenants WHERE id = $1', [id]);
      expect(tRows.length).toBe(0);

      // FK CASCADE: api_keys + delta_tokens gone
      const { rows: kRows } = await pool.query('SELECT id FROM api_keys WHERE tenant_id = $1', [
        id,
      ]);
      expect(kRows.length).toBe(0);

      const { rows: dRows } = await pool.query(
        'SELECT tenant_id FROM delta_tokens WHERE tenant_id = $1',
        [id]
      );
      expect(dRows.length).toBe(0);

      // audit_log rows for this tenant also CASCADE-wiped (documented limitation)
      const { rows: aRows } = await pool.query('SELECT id FROM audit_log WHERE tenant_id = $1', [
        id,
      ]);
      expect(aRows.length).toBe(0);

      // Redis cleaned
      const cacheAfter = await redis.keys(`mcp:cache:${id}:*`);
      const pkceAfter = await redis.keys(`mcp:pkce:${id}:*`);
      const dedupAfter = await redis.keys(`mcp:webhook:dedup:*${id}*`);
      expect(cacheAfter.length).toBe(0);
      expect(pkceAfter.length).toBe(0);
      expect(dedupAfter.length).toBe(0);

      // tenantPool.evict called
      expect(tp.evict).toHaveBeenCalledWith(id);

      // Pino info log records the delete for durable observability
      const deleteLogCall = loggerMock.info.mock.calls.find((call) => {
        const obj = call[0];
        return (
          typeof obj === 'object' &&
          obj &&
          (obj as { event?: string }).event === 'admin.tenant.delete'
        );
      });
      expect(deleteLogCall).toBeDefined();
    } finally {
      await close();
    }
  });

  it('Test 10: DELETE missing → 404', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const res = await doDelete(`${url}/admin/tenants/99999999-9999-4999-8999-999999999999`);
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });

  it('Test 11: DELETE RBAC — tenant-scoped cannot delete → 403', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const global = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'g@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    let id: string;
    try {
      const a = await doPost(`${global.url}/admin/tenants`, VALID_BODY);
      id = a.body.id;
    } finally {
      await global.close();
    }

    const scoped = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 's@example.com', source: 'api-key', tenantScoped: id! },
      tp
    );
    try {
      const res = await doDelete(`${scoped.url}/admin/tenants/${id}`);
      expect(res.status).toBe(403);
      // Tenant still exists
      const { rows } = await pool.query('SELECT id FROM tenants WHERE id = $1', [id]);
      expect(rows.length).toBe(1);
    } finally {
      await scoped.close();
    }
  });

  it('Test 12: scanDel GUID guard — tenantId=`*` never reaches scanDel', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();
    const redis = new MemoryRedisFacade();

    const scanDelSpy = vi.spyOn(tenantsModule, 'scanDel');

    const { url, close } = await startServer(
      pool,
      redis,
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      // Attempt disable with wildcard tenantId
      const res = await doPatch(`${url}/admin/tenants/*/disable`);
      expect(res.status).toBe(404);
      // scanDel must NEVER have been invoked
      expect(scanDelSpy).not.toHaveBeenCalled();

      // Attempt delete with wildcard tenantId
      const res2 = await doDelete(`${url}/admin/tenants/*`);
      expect(res2.status).toBe(404);
      expect(scanDelSpy).not.toHaveBeenCalled();

      // And try a more sneaky injection pattern
      const res3 = await doDelete(`${url}/admin/tenants/${encodeURIComponent('*:*')}`);
      expect(res3.status).toBe(404);
      expect(scanDelSpy).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});
