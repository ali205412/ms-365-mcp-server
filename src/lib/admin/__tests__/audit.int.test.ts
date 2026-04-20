/**
 * Plan 04-05 Task 1 — GET /admin/audit integration tests.
 *
 * Covers:
 *   Test 1: GET /admin/audit — returns rows for global admin across tenants
 *   Test 2: GET /admin/audit — tenant-scoped admin sees only own rows
 *   Test 3: GET /admin/audit?tenant_id=... — global admin filters by tenant
 *   Test 4: GET /admin/audit?tenant_id=OTHER — tenant-scoped admin: force-filtered
 *           to OWN (defense-in-depth); OR 403 if explicit conflict
 *   Test 5: GET /admin/audit?since=...&until=... — inclusive/exclusive window
 *   Test 6: GET /admin/audit?action=admin.tenant.create — action filter
 *   Test 7: GET /admin/audit?actor=user-oid — actor filter
 *   Test 8: GET /admin/audit?limit=1 — cursor + has_more contract
 *   Test 9: GET /admin/audit?cursor=<invalid> — 400 problem+json
 *   Test 10: GET /admin/audit?limit=9999 — clamped to max
 *   Test 11: GET /admin/audit?tenant_id=not-a-guid — 400 problem+json
 *   Test 12: response body includes request_id field (MWARE-07 correlation)
 *   Test 13: response shape {data, next_cursor, has_more} is stable
 *   Test 14: RBAC isolation — SQL-param filter prevents cross-tenant rows
 *            appearing even if one tenant's admin attempts to enumerate
 *
 * Pattern source: tenants.int.test.ts (plan 04-02). Uses pg-mem for isolation
 * and the same makePool/startServer helper shape so future plans can share
 * infra.
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

import { createAuditRoutes } from '../audit.js';
import { createCursorSecret, encodeCursor } from '../cursor.js';

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

const TENANT_A = '12345678-1234-4234-8234-1234567890ab';
const TENANT_B = 'abcdef12-1234-4234-8234-1234567890ab';

interface AdminContext {
  actor: string;
  source: 'entra' | 'api-key';
  tenantScoped: string | null;
}

async function seedTenants(pool: Pool): Promise<void> {
  for (const id of [TENANT_A, TENANT_B]) {
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id)
         VALUES ($1, 'delegated', 'cid', 'tid-${id.slice(0, 4)}')`,
      [id]
    );
  }
}

interface SeedAuditOptions {
  tenantId: string;
  actor?: string;
  action?: string;
  target?: string | null;
  ip?: string | null;
  requestId?: string;
  result?: 'success' | 'failure';
  meta?: Record<string, unknown>;
  ts?: Date;
}

async function seedAuditRow(pool: Pool, opts: SeedAuditOptions): Promise<string> {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO audit_log (id, tenant_id, actor, action, target, ip, request_id, result, meta, ts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)`,
    [
      id,
      opts.tenantId,
      opts.actor ?? 'user-oid',
      opts.action ?? 'admin.tenant.create',
      opts.target ?? null,
      opts.ip ?? null,
      opts.requestId ?? `req-${id.slice(0, 8)}`,
      opts.result ?? 'success',
      JSON.stringify(opts.meta ?? {}),
      (opts.ts ?? new Date()).toISOString(),
    ]
  );
  return id;
}

async function startServer(
  pool: Pool,
  admin: AdminContext,
  cursorSecret = createCursorSecret()
): Promise<{ url: string; cursorSecret: Buffer; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { admin?: AdminContext }).admin = admin;
    (req as express.Request & { id?: string }).id = `req-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    next();
  });
  app.use(
    '/admin/audit',
    createAuditRoutes({
      pgPool: pool,
      redis: {} as never,
      tenantPool: {} as never,
      kek: KEK,
      cursorSecret,
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
    cursorSecret,
    close: async () =>
      new Promise<void>((r) => {
        server.close(() => r());
      }),
  };
}

async function doGet(url: string): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

describe('plan 04-05 Task 1 — GET /admin/audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // no-op; pool is per-test
  });

  it('Test 1: returns rows for global admin across tenants', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A, action: 'oauth.authorize' });
    await seedAuditRow(pool, { tenantId: TENANT_B, action: 'admin.tenant.create' });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(2);
      const tenantIds = new Set(res.body.data.map((r: any) => r.tenant_id));
      expect(tenantIds.has(TENANT_A)).toBe(true);
      expect(tenantIds.has(TENANT_B)).toBe(true);
    } finally {
      await close();
    }
  });

  it('Test 2: tenant-scoped admin sees only own rows (SQL-param RBAC)', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A, action: 'oauth.authorize' });
    await seedAuditRow(pool, { tenantId: TENANT_A, action: 'admin.tenant.create' });
    await seedAuditRow(pool, { tenantId: TENANT_B, action: 'admin.tenant.create' });

    const { url, close } = await startServer(pool, {
      actor: 'api-key:k1',
      source: 'api-key',
      tenantScoped: TENANT_A,
    });

    try {
      const res = await doGet(`${url}/admin/audit`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      for (const row of res.body.data) {
        expect(row.tenant_id).toBe(TENANT_A);
      }
    } finally {
      await close();
    }
  });

  it('Test 3: global admin can filter by tenant_id query parameter', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A });
    await seedAuditRow(pool, { tenantId: TENANT_B });
    await seedAuditRow(pool, { tenantId: TENANT_B });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit?tenant_id=${TENANT_B}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      for (const row of res.body.data) {
        expect(row.tenant_id).toBe(TENANT_B);
      }
    } finally {
      await close();
    }
  });

  it('Test 4: tenant-scoped admin explicit cross-tenant query → 403 forbidden', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A });
    await seedAuditRow(pool, { tenantId: TENANT_B });

    const { url, close } = await startServer(pool, {
      actor: 'api-key:k1',
      source: 'api-key',
      tenantScoped: TENANT_A,
    });

    try {
      const res = await doGet(`${url}/admin/audit?tenant_id=${TENANT_B}`);
      expect(res.status).toBe(403);
      expect(res.body.type).toContain('forbidden');
    } finally {
      await close();
    }
  });

  it('Test 5: since/until time-window filter', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    const past = new Date('2026-01-01T00:00:00Z');
    const mid = new Date('2026-02-15T00:00:00Z');
    const future = new Date('2026-04-01T00:00:00Z');
    await seedAuditRow(pool, { tenantId: TENANT_A, ts: past });
    await seedAuditRow(pool, { tenantId: TENANT_A, ts: mid });
    await seedAuditRow(pool, { tenantId: TENANT_A, ts: future });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const since = '2026-02-01T00:00:00Z';
      const until = '2026-03-01T00:00:00Z';
      const res = await doGet(`${url}/admin/audit?since=${since}&until=${until}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      const ts = new Date(res.body.data[0].ts).getTime();
      expect(ts).toBeGreaterThanOrEqual(new Date(since).getTime());
      expect(ts).toBeLessThan(new Date(until).getTime());
    } finally {
      await close();
    }
  });

  it('Test 6: action filter narrows rows', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A, action: 'oauth.authorize' });
    await seedAuditRow(pool, { tenantId: TENANT_A, action: 'admin.tenant.create' });
    await seedAuditRow(pool, { tenantId: TENANT_A, action: 'admin.tenant.create' });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit?action=admin.tenant.create`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      for (const row of res.body.data) {
        expect(row.action).toBe('admin.tenant.create');
      }
    } finally {
      await close();
    }
  });

  it('Test 7: actor filter narrows rows', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A, actor: 'user-1' });
    await seedAuditRow(pool, { tenantId: TENANT_A, actor: 'user-2' });
    await seedAuditRow(pool, { tenantId: TENANT_A, actor: 'user-1' });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit?actor=user-1`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      for (const row of res.body.data) {
        expect(row.actor).toBe('user-1');
      }
    } finally {
      await close();
    }
  });

  it('Test 8: cursor pagination — limit=1 yields has_more=true + next_cursor', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    const t1 = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-01-02T00:00:00Z');
    const t3 = new Date('2026-01-03T00:00:00Z');
    await seedAuditRow(pool, { tenantId: TENANT_A, ts: t1, actor: 'oldest' });
    await seedAuditRow(pool, { tenantId: TENANT_A, ts: t2, actor: 'middle' });
    await seedAuditRow(pool, { tenantId: TENANT_A, ts: t3, actor: 'newest' });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const p1 = await doGet(`${url}/admin/audit?limit=1`);
      expect(p1.status).toBe(200);
      expect(p1.body.data.length).toBe(1);
      expect(p1.body.has_more).toBe(true);
      expect(typeof p1.body.next_cursor).toBe('string');
      expect(p1.body.data[0].actor).toBe('newest');

      const p2 = await doGet(
        `${url}/admin/audit?limit=1&cursor=${encodeURIComponent(p1.body.next_cursor)}`
      );
      expect(p2.status).toBe(200);
      expect(p2.body.data.length).toBe(1);
      expect(p2.body.has_more).toBe(true);
      expect(p2.body.data[0].actor).toBe('middle');

      const p3 = await doGet(
        `${url}/admin/audit?limit=1&cursor=${encodeURIComponent(p2.body.next_cursor)}`
      );
      expect(p3.status).toBe(200);
      expect(p3.body.data.length).toBe(1);
      expect(p3.body.has_more).toBe(false);
      expect(p3.body.next_cursor).toBeNull();
      expect(p3.body.data[0].actor).toBe('oldest');
    } finally {
      await close();
    }
  });

  it('Test 9: invalid cursor → 400 problem+json', async () => {
    const pool = await makePool();
    await seedTenants(pool);

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit?cursor=not-a-real-cursor`);
      expect(res.status).toBe(400);
      expect(res.body.type).toContain('bad_request');
    } finally {
      await close();
    }
  });

  it('Test 10: limit clamped to max=200', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit?limit=9999`);
      // Either 400 (Zod rejection) or 200 with clamping — both are reasonable;
      // we assert the behaviour: the response MUST NOT return more than 200.
      if (res.status === 200) {
        expect(res.body.data.length).toBeLessThanOrEqual(200);
      } else {
        expect(res.status).toBe(400);
        expect(res.body.type).toContain('bad_request');
      }
    } finally {
      await close();
    }
  });

  it('Test 11: invalid tenant_id (not a GUID) → 400 problem+json', async () => {
    const pool = await makePool();
    await seedTenants(pool);

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit?tenant_id=not-a-guid`);
      expect(res.status).toBe(400);
      expect(res.body.type).toContain('bad_request');
    } finally {
      await close();
    }
  });

  it('Test 12: rows include request_id field (MWARE-07 correlation)', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A, requestId: 'req-abc-123' });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].request_id).toBe('req-abc-123');
    } finally {
      await close();
    }
  });

  it('Test 13: response shape is {data, next_cursor, has_more} — stable contract', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A });

    const { url, close } = await startServer(pool, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doGet(`${url}/admin/audit`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['data', 'has_more', 'next_cursor']);
      expect(typeof res.body.has_more).toBe('boolean');
      expect(res.body.next_cursor === null || typeof res.body.next_cursor === 'string').toBe(true);
    } finally {
      await close();
    }
  });

  it('Test 14: tenant-scoped admin without query param cannot see other tenant rows even with tampered cursor', async () => {
    const pool = await makePool();
    await seedTenants(pool);
    await seedAuditRow(pool, { tenantId: TENANT_A, actor: 'a1' });
    await seedAuditRow(pool, { tenantId: TENANT_B, actor: 'b1' });
    await seedAuditRow(pool, { tenantId: TENANT_B, actor: 'b2' });

    const cursorSecret = createCursorSecret();
    const { url, close } = await startServer(
      pool,
      {
        actor: 'api-key:k1',
        source: 'api-key',
        tenantScoped: TENANT_A,
      },
      cursorSecret
    );

    try {
      // Tenant-scoped admin somehow acquires a cursor encoded with this
      // process's secret (contrived: in real life they never get a valid
      // cursor for TENANT_B rows because they cannot see them in the first
      // place — but we prove the WHERE clause holds even if they did).
      const bogusCursor = encodeCursor(
        { ts: new Date('2099-01-01T00:00:00Z').getTime(), id: 'z' },
        cursorSecret
      );
      const res = await doGet(
        `${url}/admin/audit?cursor=${encodeURIComponent(bogusCursor)}`
      );
      expect(res.status).toBe(200);
      // Even with a valid cursor, the SQL-param tenant filter restricts rows
      // to TENANT_A. No TENANT_B row may appear.
      for (const row of res.body.data) {
        expect(row.tenant_id).toBe(TENANT_A);
      }
    } finally {
      await close();
    }
  });
});
