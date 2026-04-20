/**
 * Plan 04-06 Task 2 — audit rollback + shadow-log integration tests (ADMIN-06, D-13).
 *
 * Closes the repudiation gap (T-04-14) by proving two invariants:
 *
 *   1. Transactional audit invariant. A failure on the PRIMARY mutation
 *      inside withTransaction rolls back BOTH the primary write AND the
 *      audit INSERT issued via writeAudit(client, ...). No orphan audit
 *      rows. No admin.tenant.create row for a NEVER-HAPPENED mutation.
 *
 *   2. Shadow-log invariant. A DB failure during
 *      writeAuditStandalone(pool, ...) (used for post-COMMIT cascade
 *      audits — e.g. admin.tenant.disable) is caught; the full audit_row
 *      payload is emitted via pino at error level with
 *      {audit_shadow: true, audit_row, err}. The handler's HTTP response
 *      is UNAFFECTED — the cascade audit is fire-and-forget durability.
 *
 * Technique:
 *   - The withTransaction mock routes to a per-test pg-mem pool so we
 *     control BEGIN / COMMIT / ROLLBACK boundaries.
 *   - For Test 1 (primary fails inside txn): wrap client.query to throw
 *     on the INSERT INTO tenants statement. The audit INSERT that comes
 *     before it lands inside the same BEGIN; when the mock catches the
 *     simulated error and runs ROLLBACK, the audit row is gone.
 *   - For Tests 2-4 (shadow log on writeAuditStandalone): spy on
 *     pool.query via a pool wrapper so `INSERT INTO audit_log` issued by
 *     writeAuditStandalone (NOT by client.query from inside a txn) throws
 *     a simulated DB outage. writeAudit inside withTransaction uses
 *     client.query and is unaffected.
 *   - For Test 5 (rollback consistency): same as Test 1 but verify neither
 *     tenants row nor audit row exists after the 500 response.
 *   - For Test 6 (400 path): verify that Zod failures BEFORE withTransaction
 *     produce ZERO audit rows. Audit contract is "successful mutations
 *     only" per D-13.
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
// Per-test transaction fail modes. The mock checks this before dispatching
// into the caller's fn so Test 1/5 can simulate a primary mutation failure
// after the audit row has already been written in the same BEGIN.
type TxFailMode = null | {
  kind: 'throw-on-sql';
  matcher: (sql: string) => boolean;
  errorMsg: string;
};
let txFailMode: TxFailMode = null;

vi.mock('../../postgres.js', async () => {
  return {
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
      if (!sharedPool) throw new Error('sharedPool not set in test');
      const client = await sharedPool.connect();
      try {
        await client.query('BEGIN');
        if (txFailMode && txFailMode.kind === 'throw-on-sql') {
          const origQuery = client.query.bind(client);
          const matcher = txFailMode.matcher;
          const errorMsg = txFailMode.errorMsg;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (client as any).query = async (sqlOrCfg: any, params?: any) => {
            const sqlText =
              typeof sqlOrCfg === 'string' ? sqlOrCfg : (sqlOrCfg?.text ?? String(sqlOrCfg));
            if (matcher(sqlText)) {
              throw new Error(errorMsg);
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

/**
 * Wrap pool.query with a matcher that throws on selected SQL. Unlike the
 * txFailMode mock above (which wraps client.query inside a BEGIN block),
 * this wrapper intercepts pool.query calls only — exactly the path
 * writeAuditStandalone takes. Calls issued through pool.connect() + client
 * bypass this wrapper entirely.
 */
function forceThrowOnPoolQuery(
  pool: Pool,
  matcher: (sql: string) => boolean,
  errorMsg: string
): void {
  const origQuery = pool.query.bind(pool);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (pool as any).query = async (sqlOrCfg: any, params?: any) => {
    const sqlText = typeof sqlOrCfg === 'string' ? sqlOrCfg : (sqlOrCfg?.text ?? String(sqlOrCfg));
    if (matcher(sqlText)) {
      throw new Error(errorMsg);
    }
    return origQuery(sqlOrCfg, params);
  };
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
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { admin?: AdminContext }).admin = admin;
    (req as express.Request & { id?: string }).id = `req-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    Object.defineProperty(req, 'ip', { value: '10.20.30.40', configurable: true });
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

async function countAuditRows(pool: Pool, action?: string): Promise<number> {
  const q = action
    ? `SELECT COUNT(*)::int AS c FROM audit_log WHERE action = $1`
    : `SELECT COUNT(*)::int AS c FROM audit_log`;
  const params = action ? [action] : [];
  const { rows } = await pool.query(q, params);
  return rows[0].c as number;
}

async function countTenants(pool: Pool): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM tenants`);
  return rows[0].c as number;
}

async function seedTenant(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id, wrapped_dek)
       VALUES ($1, 'delegated', 'seed-cid', '11111111-2222-4333-8444-555555555555',
               '{"v":1,"iv":"aa","tag":"bb","ct":"cc"}'::jsonb)`,
    [id]
  );
}

const VALID_TENANT_BODY = {
  mode: 'delegated' as const,
  client_id: 'rollback-cid',
  tenant_id: '11111111-2222-4333-8444-555555555555',
  cloud_type: 'global' as const,
  redirect_uri_allowlist: ['http://localhost:3000/callback'],
  cors_origins: ['http://localhost:3000'],
  allowed_scopes: ['User.Read'],
};

describe('plan 04-06 Task 2 — audit rollback + shadow log (ADMIN-06, D-13, T-04-14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txFailMode = null;
  });

  afterEach(() => {
    sharedPool = null;
    txFailMode = null;
  });

  it('Test 1: transactional rollback — INSERT INTO tenants throws → audit row NOT persisted', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    // Force the INSERT INTO tenants to fail AFTER writeAudit has run its
    // INSERT INTO audit_log inside the same BEGIN. With withTransaction's
    // try/catch/ROLLBACK path, both should revert together.
    txFailMode = {
      kind: 'throw-on-sql',
      matcher: (sql) => /INSERT INTO tenants/i.test(sql),
      errorMsg: 'simulated_primary_failure',
    };

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const res = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      expect(res.status).toBe(500);
      // Transactional invariant: NO admin.tenant.create audit row.
      const count = await countAuditRows(pool, 'admin.tenant.create');
      expect(count).toBe(0);
    } finally {
      await close();
    }
  });

  it('Test 2: DB outage on writeAuditStandalone — admin.tenant.disable cascade audit hits shadow log (response stays 200)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    // Seed a fresh tenant so the disable handler has something to target.
    const tenantId = crypto.randomUUID();
    await seedTenant(pool, tenantId);

    // Intercept pool.query for audit INSERTs only (the transactional UPDATE
    // inside withTransaction uses client.query and is unaffected). This
    // models a DB outage that strikes during the fire-and-forget post-
    // commit audit write.
    forceThrowOnPoolQuery(
      pool,
      (sql) => /INSERT INTO audit_log/i.test(sql),
      'simulated_audit_insert_failure'
    );

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const res = await doReq('PATCH', `${url}/admin/tenants/${tenantId}/disable`);
      // Handler still responds 200 — the audit failure is absorbed by the
      // shadow log; it must not surface to the caller.
      expect(res.status).toBe(200);
      // No admin.tenant.disable row in audit_log (the only writer for that
      // action is writeAuditStandalone, which the spy intercepted).
      const count = await countAuditRows(pool, 'admin.tenant.disable');
      expect(count).toBe(0);

      // Shadow log MUST have fired via logger.error with audit_shadow tag.
      const shadowCall = loggerMock.error.mock.calls.find((call) => {
        const [meta] = call;
        return meta && typeof meta === 'object' && meta.audit_shadow === true;
      });
      expect(shadowCall).toBeDefined();
      const [shadowMeta] = shadowCall!;
      expect(shadowMeta.audit_shadow).toBe(true);
      expect(shadowMeta.audit_row).toBeDefined();
      expect(shadowMeta.audit_row.action).toBe('admin.tenant.disable');
      expect(shadowMeta.audit_row.tenantId).toBe(tenantId);
      expect(shadowMeta.err).toContain('simulated_audit_insert_failure');
    } finally {
      await close();
    }
  });

  it('Test 3: shadow log payload carries the full AuditRow shape', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const tenantId = crypto.randomUUID();
    await seedTenant(pool, tenantId);
    forceThrowOnPoolQuery(pool, (sql) => /INSERT INTO audit_log/i.test(sql), 'simulated_pg_down');

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const res = await doReq('PATCH', `${url}/admin/tenants/${tenantId}/disable`);
      expect(res.status).toBe(200);

      const shadowCall = loggerMock.error.mock.calls.find((call) => {
        const [meta] = call;
        return meta && typeof meta === 'object' && meta.audit_shadow === true;
      });
      expect(shadowCall).toBeDefined();
      const [shadowMeta] = shadowCall!;
      const row = shadowMeta.audit_row as Record<string, unknown>;
      // AuditRow field shape (per src/lib/audit.ts:73-87).
      expect(typeof row.tenantId).toBe('string');
      expect(typeof row.actor).toBe('string');
      expect(typeof row.action).toBe('string');
      expect(row.action).toBe('admin.tenant.disable');
      // target is always a string or null.
      expect(row.target === null || typeof row.target === 'string').toBe(true);
      // ip: fed by req.ip (our test harness stamps 10.20.30.40).
      expect(row.ip).toBe('10.20.30.40');
      expect(typeof row.requestId).toBe('string');
      expect((row.requestId as string).length).toBeGreaterThan(0);
      expect(row.result).toBe('success');
      expect(typeof row.meta).toBe('object');
      // meta shape: cryptoshred counters populated by the disable handler.
      const meta = row.meta as Record<string, unknown>;
      expect(typeof meta.cacheKeysDeleted).toBe('number');
      expect(typeof meta.pkceKeysDeleted).toBe('number');
      expect(typeof meta.apiKeysRevoked).toBe('number');
    } finally {
      await close();
    }
  });

  it('Test 4: shadow log payload contains NO secrets (call-site redaction carries through)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    const tenantId = crypto.randomUUID();
    await seedTenant(pool, tenantId);
    forceThrowOnPoolQuery(
      pool,
      (sql) => /INSERT INTO audit_log/i.test(sql),
      'simulated_audit_failure'
    );

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const res = await doReq('PATCH', `${url}/admin/tenants/${tenantId}/disable`);
      expect(res.status).toBe(200);

      const shadowCall = loggerMock.error.mock.calls.find((call) => {
        const [meta] = call;
        return meta && typeof meta === 'object' && meta.audit_shadow === true;
      });
      expect(shadowCall).toBeDefined();
      const [shadowMeta] = shadowCall!;
      const blob = JSON.stringify(shadowMeta);
      // Same grep set as audit-writer Test 11.
      expect(blob).not.toContain('plaintext_key');
      expect(blob).not.toContain('client_secret');
      expect(blob).not.toMatch(/"wrapped_dek"\s*:/);
      expect(blob).not.toContain('key_hash');
      expect(blob).not.toContain('$argon2');
      expect(blob).not.toMatch(/msk_live_[A-Za-z0-9_-]{20,}/);
      expect(blob).not.toMatch(/refresh_token/i);
      expect(blob).not.toMatch(/Bearer ey/i);
    } finally {
      await close();
    }
  });

  it('Test 5: txn rollback preserves DB consistency — neither tenants row NOR audit row persists', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const tp = makeTenantPoolStub();

    txFailMode = {
      kind: 'throw-on-sql',
      matcher: (sql) => /INSERT INTO tenants/i.test(sql),
      errorMsg: 'simulated_rollback_driver',
    };

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'alice@example.com', source: 'entra', tenantScoped: null },
      tp
    );
    try {
      const res = await doReq('POST', `${url}/admin/tenants`, VALID_TENANT_BODY);
      expect(res.status).toBe(500);

      // DB consistency: both tables untouched.
      expect(await countTenants(pool)).toBe(0);
      expect(await countAuditRows(pool, 'admin.tenant.create')).toBe(0);
    } finally {
      await close();
    }
  });

  it('Test 6: Zod validation failure (400) writes ZERO audit rows — audit is for successful mutations only', async () => {
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
      // Missing client_id — Zod rejects BEFORE withTransaction runs, so
      // neither the primary INSERT nor the audit INSERT ever executes.
      const res = await doReq('POST', `${url}/admin/tenants`, {
        mode: 'delegated',
        tenant_id: '11111111-2222-4333-8444-555555555555',
        cloud_type: 'global',
      });
      expect(res.status).toBe(400);

      // No audit row for the failed attempt — this is the documented D-13
      // contract. Failed auth attempts (401/403) and validation failures
      // (400) do not emit admin.* audit rows.
      expect(await countAuditRows(pool)).toBe(0);
      expect(await countTenants(pool)).toBe(0);
    } finally {
      await close();
    }
  });
});
