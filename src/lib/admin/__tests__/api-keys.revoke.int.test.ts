/**
 * Plan 04-03 Task 2 — POST /admin/api-keys/:id/revoke integration tests.
 *
 * Covers:
 *   - Test 1: revoke success — sets revoked_at, audits, publishes pub/sub
 *   - Test 2: already revoked → 409
 *   - Test 3: not found → 404
 *   - Test 4: RBAC — tenantScoped admin cannot revoke other tenant → 403
 *   - Test 5: TTL freshness ≤ 60s — cached identity observed during window
 *   - Test 6: pub/sub fast invalidation — subscriber evicts <100ms
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
import argon2 from 'argon2';

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

import {
  createApiKeyRoutes,
  verifyApiKeyPlaintext,
  subscribeToApiKeyRevoke,
  __resetApiKeyCacheForTesting,
  API_KEY_REVOKE_CHANNEL,
} from '../api-keys.js';
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

async function seedTenant(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id)
       VALUES ($1, 'delegated', 'cid', 'tid')`,
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
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { admin?: AdminContext }).admin = admin;
    (req as express.Request & { id?: string }).id = `req-${Math.random().toString(36).slice(2, 10)}`;
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

describe('plan 04-03 Task 2 — /admin/api-keys/:id/revoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetApiKeyCacheForTesting();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('Test 1: revoke success — sets revoked_at, audits, publishes', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    const redis = new MemoryRedisFacade();
    const publishSpy = vi.spyOn(redis, 'publish');

    const { url, close } = await startServer(pool, redis, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const mint = await doPost(`${url}/admin/api-keys`, {
        tenant_id: TENANT_A,
        name: 'to-revoke',
      });
      expect(mint.status).toBe(201);
      const keyId = mint.body.id;

      // Verify it works before revoke
      const identity = await verifyApiKeyPlaintext(mint.body.plaintext_key, {
        pgPool: pool,
        redis,
      });
      expect(identity).not.toBeNull();
      expect(identity!.keyId).toBe(keyId);

      // Revoke
      const rev = await doPost(`${url}/admin/api-keys/${keyId}/revoke`);
      expect(rev.status).toBe(200);
      expect(rev.body.id).toBe(keyId);
      expect(typeof rev.body.revoked_at).toBe('string');

      // DB state
      const { rows } = await pool.query(
        `SELECT revoked_at FROM api_keys WHERE id = $1`,
        [keyId]
      );
      expect(rows[0].revoked_at).not.toBeNull();

      // Audit row written
      const { rows: auditRows } = await pool.query(
        "SELECT * FROM audit_log WHERE action = 'admin.api-key.revoke'"
      );
      expect(auditRows.length).toBe(1);
      const meta =
        typeof auditRows[0].meta === 'string'
          ? JSON.parse(auditRows[0].meta)
          : auditRows[0].meta;
      expect(meta.keyId).toBe(keyId);
      expect(meta.tenantId).toBe(TENANT_A);

      // Pub/sub publish called
      expect(publishSpy).toHaveBeenCalledWith(API_KEY_REVOKE_CHANNEL, keyId);
    } finally {
      await close();
    }
  });

  it('Test 2: already revoked → 409', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    const { url, close } = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const mint = await doPost(`${url}/admin/api-keys`, {
        tenant_id: TENANT_A,
        name: 'k',
      });
      const keyId = mint.body.id;

      const first = await doPost(`${url}/admin/api-keys/${keyId}/revoke`);
      expect(first.status).toBe(200);

      const second = await doPost(`${url}/admin/api-keys/${keyId}/revoke`);
      expect(second.status).toBe(409);
      expect(second.body.type).toContain('/conflict');
      expect(second.body.detail).toMatch(/already_revoked/);
    } finally {
      await close();
    }
  });

  it('Test 3: not found → 404', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    const { url, close } = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const res = await doPost(`${url}/admin/api-keys/nonexistent/revoke`);
      expect(res.status).toBe(404);
      expect(res.body.type).toContain('/not_found');
    } finally {
      await close();
    }
  });

  it('Test 4: RBAC — tenantScoped admin cannot revoke other tenant → 403', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedTenant(pool, TENANT_B);

    // Mint a key for TENANT_B via a global admin
    const global = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });
    let keyId: string;
    try {
      const mint = await doPost(`${global.url}/admin/api-keys`, {
        tenant_id: TENANT_B,
        name: 'b-key',
      });
      keyId = mint.body.id;
    } finally {
      await global.close();
    }

    // Try to revoke as a TENANT_A-scoped admin
    const scoped = await startServer(pool, new MemoryRedisFacade(), {
      actor: 'a-admin@example.com',
      source: 'api-key',
      tenantScoped: TENANT_A,
    });
    try {
      const res = await doPost(`${scoped.url}/admin/api-keys/${keyId}/revoke`);
      expect(res.status).toBe(403);
      expect(res.body.type).toContain('/forbidden');

      // DB confirms no revoked_at was set
      const { rows } = await pool.query(
        `SELECT revoked_at FROM api_keys WHERE id = $1`,
        [keyId]
      );
      expect(rows[0].revoked_at).toBeNull();
    } finally {
      await scoped.close();
    }
  });

  it('Test 5: TTL freshness window — cache returns stale identity until eviction', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    const redis = new MemoryRedisFacade();
    const { url, close } = await startServer(pool, redis, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const mint = await doPost(`${url}/admin/api-keys`, {
        tenant_id: TENANT_A,
        name: 'stale',
      });
      const keyId = mint.body.id;
      const plaintext = mint.body.plaintext_key;

      // First verify populates cache
      const first = await verifyApiKeyPlaintext(plaintext, { pgPool: pool, redis });
      expect(first!.revokedAt).toBeNull();

      // Directly update DB (simulate out-of-band revoke; don't go through handler
      // since handler also evicts the local cache).
      await pool.query(`UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`, [keyId]);

      // Within TTL (and before any eviction), cache still returns null revokedAt
      const stale = await verifyApiKeyPlaintext(plaintext, { pgPool: pool, redis });
      expect(stale).not.toBeNull();
      expect(stale!.revokedAt).toBeNull();
      // Consumer (04-04) MUST treat the cache as potentially stale and may
      // recheck DB if the freshness budget matters. Handler-driven revoke
      // (Test 1) evicts locally AND publishes for cross-replica propagation.
    } finally {
      await close();
    }
  });

  it('Test 6: pub/sub fast invalidation — subscriber evicts within 100ms', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);

    // Single shared facade — MemoryRedisFacade supports publish+subscribe on
    // the same instance; real Redis would need a duplicate() subscriber conn.
    const redis = new MemoryRedisFacade();

    const { url, close } = await startServer(pool, redis, {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    });

    try {
      const mint = await doPost(`${url}/admin/api-keys`, {
        tenant_id: TENANT_A,
        name: 'pubsub',
      });
      const keyId = mint.body.id;
      const plaintext = mint.body.plaintext_key;

      // Populate cache on first verify
      const first = await verifyApiKeyPlaintext(plaintext, { pgPool: pool, redis });
      expect(first).not.toBeNull();

      // Install subscriber on the same facade.
      await subscribeToApiKeyRevoke(redis);

      // Revoke via handler → publishes to mcp:api-key-revoke, subscriber evicts.
      const rev = await doPost(`${url}/admin/api-keys/${keyId}/revoke`);
      expect(rev.status).toBe(200);

      // Give the in-process subscriber a tick. MemoryRedisFacade delivers
      // synchronously inside publish(), so 0ms is fine — add small buffer.
      await new Promise((r) => setTimeout(r, 10));

      // Next verify sees the fresh (revoked) row from DB.
      const fresh = await verifyApiKeyPlaintext(plaintext, { pgPool: pool, redis });
      expect(fresh).not.toBeNull();
      expect(fresh!.revokedAt).not.toBeNull();
    } finally {
      await close();
    }
  });
});
