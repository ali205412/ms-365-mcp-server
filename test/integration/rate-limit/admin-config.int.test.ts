/**
 * Plan 06-04 Task 2 — Admin PATCH /admin/tenants rate_limits integration tests (D-11).
 *
 * Covers the behaviours in the plan:
 *   - POST /admin/tenants with rate_limits → 201 + JSONB persisted
 *   - POST without rate_limits → 201 + column is NULL
 *   - PATCH /admin/tenants/:id with rate_limits update → 200 + GET returns new values
 *   - PATCH with rate_limits: null → 200 + field cleared
 *   - PATCH invalid shapes → 400 (negative / missing / extra / over-cap)
 *
 * Harness mirrors src/lib/admin/__tests__/tenants.int.test.ts — pg-mem under
 * all migrations, Express test server, stubbed admin identity + tenantPool.
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

vi.mock('../../../src/logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

let sharedPool: Pool | null = null;
vi.mock('../../../src/lib/postgres.js', async () => {
  return {
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

import { createTenantsRoutes } from '../../../src/lib/admin/tenants.js';
import { MemoryRedisFacade } from '../../../src/lib/redis-facade.js';
import { createCursorSecret } from '../../../src/lib/admin/cursor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'migrations');

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

interface AdminContextStub {
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
  admin: AdminContextStub,
  tenantPool: TenantPoolStub
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json() as unknown as express.RequestHandler);
  app.use((req, _res, next) => {
    (req as unknown as { admin?: AdminContextStub }).admin = admin;
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
      tenantPool:
        tenantPool as unknown as import('../../../src/lib/admin/router.js').AdminRouterDeps['tenantPool'],
      kek: KEK,
      cursorSecret: createCursorSecret(),
      adminOrigins: [],
      entraConfig: { appClientId: 'x', groupId: 'g' },
    } as unknown as import('../../../src/lib/admin/router.js').AdminRouterDeps)
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

interface HttpResult {
  status: number;
  body: unknown;
}

async function doPost(url: string, body?: unknown): Promise<HttpResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function doGet(url: string): Promise<HttpResult> {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

async function doPatch(url: string, body?: unknown): Promise<HttpResult> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const BASE_BODY = {
  mode: 'delegated' as const,
  client_id: 'app-uuid',
  tenant_id: '11111111-2222-4333-8444-555555555555',
  cloud_type: 'global' as const,
  redirect_uri_allowlist: ['http://localhost:3000/callback'],
  cors_origins: ['http://localhost:3000'],
  allowed_scopes: ['User.Read'],
};

describe('plan 06-04 Task 2 — admin PATCH /admin/tenants rate_limits (D-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('POST /admin/tenants with rate_limits → 201, row has JSONB populated', async () => {
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
      const res = await doPost(`${url}/admin/tenants`, {
        ...BASE_BODY,
        rate_limits: { request_per_min: 100, graph_points_per_min: 5000 },
      });
      expect(res.status).toBe(201);
      const body = res.body as { id: string; rate_limits: unknown };
      expect(body.rate_limits).toEqual({ request_per_min: 100, graph_points_per_min: 5000 });
    } finally {
      await close();
    }
  });

  it('POST /admin/tenants WITHOUT rate_limits → 201; field defaults to null', async () => {
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
      const res = await doPost(`${url}/admin/tenants`, BASE_BODY);
      expect(res.status).toBe(201);
      const body = res.body as { id: string; rate_limits: unknown };
      expect(body.rate_limits).toBeNull();
    } finally {
      await close();
    }
  });

  it('PATCH /admin/tenants/:id with rate_limits update → 200; GET returns updated', async () => {
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
      const createRes = await doPost(`${url}/admin/tenants`, BASE_BODY);
      expect(createRes.status).toBe(201);
      const created = createRes.body as { id: string };

      const patchRes = await doPatch(`${url}/admin/tenants/${created.id}`, {
        rate_limits: { request_per_min: 200, graph_points_per_min: 10000 },
      });
      expect(patchRes.status).toBe(200);

      const getRes = await doGet(`${url}/admin/tenants/${created.id}`);
      expect(getRes.status).toBe(200);
      const got = getRes.body as { rate_limits: unknown };
      expect(got.rate_limits).toEqual({ request_per_min: 200, graph_points_per_min: 10000 });
    } finally {
      await close();
    }
  });

  it('PATCH /admin/tenants/:id with rate_limits: null → 200; clears override', async () => {
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
      const createRes = await doPost(`${url}/admin/tenants`, {
        ...BASE_BODY,
        rate_limits: { request_per_min: 100, graph_points_per_min: 5000 },
      });
      expect(createRes.status).toBe(201);
      const created = createRes.body as { id: string; rate_limits: unknown };
      expect(created.rate_limits).toEqual({ request_per_min: 100, graph_points_per_min: 5000 });

      const patchRes = await doPatch(`${url}/admin/tenants/${created.id}`, {
        rate_limits: null,
      });
      expect(patchRes.status).toBe(200);

      const getRes = await doGet(`${url}/admin/tenants/${created.id}`);
      const got = getRes.body as { rate_limits: unknown };
      expect(got.rate_limits).toBeNull();
    } finally {
      await close();
    }
  });

  it('PATCH with negative request_per_min → 400 (Zod positive check)', async () => {
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
      const createRes = await doPost(`${url}/admin/tenants`, BASE_BODY);
      const { id } = createRes.body as { id: string };
      const res = await doPatch(`${url}/admin/tenants/${id}`, {
        rate_limits: { request_per_min: -1, graph_points_per_min: 5000 },
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('PATCH missing graph_points_per_min → 400 (Zod strict())', async () => {
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
      const createRes = await doPost(`${url}/admin/tenants`, BASE_BODY);
      const { id } = createRes.body as { id: string };
      const res = await doPatch(`${url}/admin/tenants/${id}`, {
        rate_limits: { request_per_min: 100 },
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('PATCH with unknown extra field inside rate_limits → 400 (Zod strict())', async () => {
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
      const createRes = await doPost(`${url}/admin/tenants`, BASE_BODY);
      const { id } = createRes.body as { id: string };
      const res = await doPatch(`${url}/admin/tenants/${id}`, {
        rate_limits: {
          request_per_min: 100,
          graph_points_per_min: 5000,
          extra_field: 'bogus',
        },
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('PATCH with request_per_min exceeding cap (1_000_001) → 400', async () => {
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
      const createRes = await doPost(`${url}/admin/tenants`, BASE_BODY);
      const { id } = createRes.body as { id: string };
      const res = await doPatch(`${url}/admin/tenants/${id}`, {
        rate_limits: { request_per_min: 1_000_001, graph_points_per_min: 5000 },
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });
});
