/**
 * Plan 04-03 Task 1 — /admin/api-keys mint/list/get integration tests.
 *
 * Covers (per behaviour block):
 *   - Test 1: POST mint success (plaintext-once, argon2id hash, audit)
 *   - Test 2: POST mint validation (uuid, name length)
 *   - Test 3: POST mint tenant not found / disabled → 409
 *   - Test 4: GET list — plaintext_key EXCLUDED from every row
 *   - Test 5: GET list RBAC — tenantScoped filters cross-tenant
 *   - Test 6: GET /:id — 404 on missing
 *
 * Uses pg-mem + MemoryRedisFacade; mounts createApiKeyRoutes via http.createServer.
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

// Force postgres.withTransaction to use the pg-mem pool we build below.
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
          // best-effort
        }
        throw err;
      } finally {
        client.release();
      }
    },
    getPool: () => sharedPool,
  };
});

import { createApiKeyRoutes, API_KEY_PREFIX } from '../api-keys.js';
import { MemoryRedisFacade } from '../../redis-facade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

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

async function seedTenant(pool: Pool, id: string, disabled = false): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id, disabled_at)
       VALUES ($1, 'delegated', 'cid', 'tid', ${disabled ? 'NOW()' : 'NULL'})`,
    [id]
  );
}

interface AdminContext {
  actor: string;
  source: 'entra' | 'api-key';
  tenantScoped: string | null;
}

async function startServer(
  pool: Pool,
  redis: MemoryRedisFacade,
  admin: AdminContext
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json() as unknown as express.RequestHandler);
  app.use((req, _res, next) => {
    (req as unknown as { admin?: AdminContext }).admin = admin;
    (req as express.Request & { id?: string }).id =
      `req-${Math.random().toString(36).slice(2, 10)}`;
    next();
  });
  app.use('/admin/api-keys', createApiKeyRoutes({ pgPool: pool, redis }));

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

async function doPost(url: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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

async function doGet(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

describe('plan 04-03 Task 1 — /admin/api-keys mint/list/get', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('Test 1: POST mint returns plaintext_key once; persists argon2id hash; audits', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    const { url, close } = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doPost(`${url}/admin/api-keys`, {
        tenant_id: TENANT_A,
        name: 'ci-bot',
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ tenant_id: TENANT_A, name: 'ci-bot' });
      expect(typeof res.body.id).toBe('string');
      expect(typeof res.body.plaintext_key).toBe('string');
      expect(res.body.plaintext_key).toMatch(/^msk_live_[A-Za-z0-9_-]{43}$/);
      expect(res.body.display_suffix).toBe(res.body.plaintext_key.slice(-8));
      expect(typeof res.body.created_at).toBe('string');

      // DB row exists with argon2id hash
      const { rows } = await pool.query(
        'SELECT id, tenant_id, name, key_hash, display_suffix FROM api_keys WHERE id = $1',
        [res.body.id]
      );
      expect(rows.length).toBe(1);
      expect(rows[0].key_hash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
      expect(rows[0].display_suffix).toBe(res.body.display_suffix);
      expect(rows[0].key_hash).not.toContain(res.body.plaintext_key);

      // Audit log written
      const { rows: auditRows } = await pool.query(
        "SELECT * FROM audit_log WHERE action = 'admin.api-key.mint'"
      );
      expect(auditRows.length).toBe(1);
      const meta =
        typeof auditRows[0].meta === 'string' ? JSON.parse(auditRows[0].meta) : auditRows[0].meta;
      expect(meta.keyId).toBe(res.body.id);
      expect(meta.displaySuffix).toBe(res.body.display_suffix);
      expect(meta.tenantId).toBe(TENANT_A);
      // plaintext must NEVER be in audit meta
      expect(JSON.stringify(meta)).not.toContain(res.body.plaintext_key);

      // Logger MUST never have the plaintext
      const allLogCalls = JSON.stringify([
        loggerMock.info.mock.calls,
        loggerMock.warn.mock.calls,
        loggerMock.error.mock.calls,
        loggerMock.debug.mock.calls,
      ]);
      expect(allLogCalls).not.toContain(res.body.plaintext_key);
      expect(allLogCalls.match(/msk_live_/g) ?? []).toHaveLength(0);
    } finally {
      await close();
    }
  });

  it('Test 2: POST mint validation — tenant_id not uuid, missing/long name', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    const { url, close } = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      let res = await doPost(`${url}/admin/api-keys`, { tenant_id: 'abc', name: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.type).toContain('/bad_request');

      res = await doPost(`${url}/admin/api-keys`, { tenant_id: TENANT_A });
      expect(res.status).toBe(400);

      res = await doPost(`${url}/admin/api-keys`, {
        tenant_id: TENANT_A,
        name: 'x'.repeat(200),
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('Test 3: POST mint tenant not found / disabled → 409', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_B, true);

    const { url, close } = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const missingTenant = '99999999-9999-4999-8999-999999999999';
      let res = await doPost(`${url}/admin/api-keys`, {
        tenant_id: missingTenant,
        name: 'bot',
      });
      expect(res.status).toBe(409);
      expect(res.body.type).toContain('/conflict');
      expect(res.body.detail).toMatch(/tenant_not_found_or_disabled/);

      res = await doPost(`${url}/admin/api-keys`, { tenant_id: TENANT_B, name: 'bot' });
      expect(res.status).toBe(409);
    } finally {
      await close();
    }
  });

  it('Test 4: GET list — excludes plaintext_key and key_hash from every row', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    const { url, close } = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const m1 = await doPost(`${url}/admin/api-keys`, { tenant_id: TENANT_A, name: 'k1' });
      const m2 = await doPost(`${url}/admin/api-keys`, { tenant_id: TENANT_A, name: 'k2' });
      const m3 = await doPost(`${url}/admin/api-keys`, { tenant_id: TENANT_A, name: 'k3' });
      expect(m1.status).toBe(201);
      expect(m2.status).toBe(201);
      expect(m3.status).toBe(201);

      // Revoke one via direct SQL
      await pool.query(`UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`, [m1.body.id]);

      const list = await doGet(`${url}/admin/api-keys?tenant_id=${TENANT_A}&limit=10`);
      expect(list.status).toBe(200);
      expect(Array.isArray(list.body.data)).toBe(true);
      expect(list.body.data.length).toBe(3);

      for (const row of list.body.data) {
        expect(Object.keys(row)).toEqual(
          expect.arrayContaining(['id', 'tenant_id', 'name', 'display_suffix', 'created_at'])
        );
        expect(Object.keys(row).includes('plaintext_key')).toBe(false);
        expect(Object.keys(row).includes('key_hash')).toBe(false);
        expect(row).toHaveProperty('revoked_at');
        expect(row).toHaveProperty('last_used_at');
      }
    } finally {
      await close();
    }
  });

  it('Test 5: GET list RBAC — tenantScoped forces filter; cross-tenant = 403', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedTenant(pool, TENANT_B);

    const global = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });
    try {
      await doPost(`${global.url}/admin/api-keys`, { tenant_id: TENANT_A, name: 'a' });
      await doPost(`${global.url}/admin/api-keys`, { tenant_id: TENANT_B, name: 'b' });
    } finally {
      await global.close();
    }

    const scoped = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'tenant-admin@example.com',
      source: 'api-key',
      tenantScoped: TENANT_A,
    });
    try {
      const listAll = await doGet(`${scoped.url}/admin/api-keys?limit=10`);
      expect(listAll.status).toBe(200);
      for (const row of listAll.body.data) {
        expect(row.tenant_id).toBe(TENANT_A);
      }

      const cross = await doGet(`${scoped.url}/admin/api-keys?tenant_id=${TENANT_B}`);
      expect(cross.status).toBe(403);
      expect(cross.body.type).toContain('/forbidden');
    } finally {
      await scoped.close();
    }
  });

  it('Test 6: GET /:id — returns row; 404 on missing', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    const { url, close } = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const mint = await doPost(`${url}/admin/api-keys`, { tenant_id: TENANT_A, name: 'k' });
      expect(mint.status).toBe(201);

      const get = await doGet(`${url}/admin/api-keys/${mint.body.id}`);
      expect(get.status).toBe(200);
      expect(Object.keys(get.body).includes('plaintext_key')).toBe(false);
      expect(Object.keys(get.body).includes('key_hash')).toBe(false);
      expect(get.body.id).toBe(mint.body.id);

      const missing = await doGet(`${url}/admin/api-keys/nonexistent-id-abc`);
      expect(missing.status).toBe(404);
      expect(missing.body.type).toContain('/not_found');
    } finally {
      await close();
    }
  });
});

// Anchor the import so TypeScript does not complain about unused symbol.
void API_KEY_PREFIX;
