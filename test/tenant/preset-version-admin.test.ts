/**
 * Plan 05-03 Task 2 — admin /tenants preset_version plumbing tests.
 *
 * These tests assert the admin tenants CRUD path carries preset_version
 * end-to-end:
 *
 *   - POST /admin/tenants without preset_version in body returns a wire row
 *     whose preset_version === 'essentials-v1' (DB default flows through).
 *   - POST /admin/tenants with preset_version in body is honored.
 *   - GET /admin/tenants/:id returns preset_version in the wire shape.
 *   - PATCH /admin/tenants/:id { preset_version: 'essentials-v2' } updates
 *     the column and echoes the new value in the wire response.
 *
 * Pattern mirrors src/lib/admin/__tests__/tenants.int.test.ts (pg-mem + real
 * Express router). The KEK + audit plumbing is inherited so we exercise the
 * real tenantRowToWire path.
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

vi.mock('../../src/logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

let sharedPool: Pool | null = null;
vi.mock('../../src/lib/postgres.js', async () => {
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

import { createTenantsRoutes } from '../../src/lib/admin/tenants.js';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { createCursorSecret } from '../../src/lib/admin/cursor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

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
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { admin?: AdminContext }).admin = admin;
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
        tenantPool as unknown as import('../../src/lib/admin/router.js').AdminRouterDeps['tenantPool'],
      kek: KEK,
      cursorSecret: createCursorSecret(),
      adminOrigins: [],
      entraConfig: { appClientId: 'x', groupId: 'g' },
    } as unknown as import('../../src/lib/admin/router.js').AdminRouterDeps)
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

async function doJson(
  method: 'POST' | 'GET' | 'PATCH',
  url: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
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

const VALID_BODY = {
  mode: 'delegated' as const,
  client_id: 'app-uuid',
  tenant_id: '11111111-2222-4333-8444-555555555555',
  cloud_type: 'global' as const,
  redirect_uri_allowlist: ['http://localhost:3000/callback'],
  cors_origins: ['http://localhost:3000'],
  allowed_scopes: ['User.Read', 'Mail.Read'],
};

describe('plan 05-03 task 2 — /admin/tenants preset_version plumbing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('POST /admin/tenants without preset_version returns essentials-v1 as the default', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      makeTenantPoolStub()
    );

    try {
      const res = await doJson('POST', `${url}/admin/tenants`, VALID_BODY);
      expect(res.status).toBe(201);
      expect(res.body.preset_version).toBe('essentials-v1');

      // DB row too.
      const { rows } = await pool.query<{ preset_version: string }>(
        'SELECT preset_version FROM tenants WHERE id = $1',
        [res.body.id]
      );
      expect(rows[0]!.preset_version).toBe('essentials-v1');
    } finally {
      await close();
    }
  });

  it('POST /admin/tenants with explicit preset_version persists it', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      makeTenantPoolStub()
    );

    try {
      const res = await doJson('POST', `${url}/admin/tenants`, {
        ...VALID_BODY,
        preset_version: 'essentials-v2',
      });
      expect(res.status).toBe(201);
      expect(res.body.preset_version).toBe('essentials-v2');
    } finally {
      await close();
    }
  });

  it('GET /admin/tenants/:id returns preset_version in the wire row', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      makeTenantPoolStub()
    );

    try {
      const created = await doJson('POST', `${url}/admin/tenants`, VALID_BODY);
      expect(created.status).toBe(201);

      const got = await doJson('GET', `${url}/admin/tenants/${created.body.id}`);
      expect(got.status).toBe(200);
      expect(got.body.preset_version).toBe('essentials-v1');
    } finally {
      await close();
    }
  });

  it('PATCH /admin/tenants/:id updates preset_version', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      makeTenantPoolStub()
    );

    try {
      const created = await doJson('POST', `${url}/admin/tenants`, VALID_BODY);
      expect(created.status).toBe(201);
      expect(created.body.preset_version).toBe('essentials-v1');

      const patched = await doJson('PATCH', `${url}/admin/tenants/${created.body.id}`, {
        preset_version: 'essentials-v2',
      });
      expect(patched.status).toBe(200);
      expect(patched.body.preset_version).toBe('essentials-v2');

      const { rows } = await pool.query<{ preset_version: string }>(
        'SELECT preset_version FROM tenants WHERE id = $1',
        [created.body.id]
      );
      expect(rows[0]!.preset_version).toBe('essentials-v2');
    } finally {
      await close();
    }
  });

  it('POST /admin/tenants with an invalid preset_version (wrong charset) returns 400', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const { url, close } = await startServer(
      pool,
      new MemoryRedisFacade(),
      { actor: 'admin@example.com', source: 'entra', tenantScoped: null },
      makeTenantPoolStub()
    );

    try {
      const res = await doJson('POST', `${url}/admin/tenants`, {
        ...VALID_BODY,
        preset_version: 'ESSENTIALS/V1!',
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });
});
