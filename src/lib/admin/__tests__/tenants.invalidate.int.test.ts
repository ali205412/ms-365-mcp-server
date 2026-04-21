/**
 * Plan 04-02 Task 3 — Cross-replica tenant-invalidation integration tests.
 *
 * Simulates two replicas sharing the SAME Redis backing (via a single
 * MemoryRedisFacade instance that both replicas subscribe/publish against —
 * which is semantically identical to "one real Redis, two ioredis clients").
 * We use MemoryRedisFacade instead of ioredis-mock/RedisMock because
 * MemoryRedisFacade is the project's established Phase 3 pattern (also
 * implements SCAN/DEL/publish/subscribe with the same wire contract) AND
 * avoids a two-instance shared-backing config that ioredis-mock would need
 * for cross-replica tests. Semantics are identical — pub/sub messages reach
 * the subscriber, which is all the invalidation contract exercises.
 *
 * Replica-A runs the /admin/tenants router — PATCH/disable/rotate-secret/delete
 * here triggers publishTenantInvalidation after commit.
 * Replica-B runs only the subscriber side — its loadTenant LRU cache + its
 * tenantPool stub both receive invalidation messages from the shared Redis.
 *
 * Covers (5 tests):
 *   - Test 1: PATCH on A → replica-B's loadTenant LRU evicted within 100ms
 *   - Test 2: PATCH disable on A → replica-B's next loadTenant lookup = 404
 *   - Test 3: DELETE on A → replica-B's next loadTenant lookup = 404
 *   - Test 4: rotate-secret on A → replica-B's tenantPool.evict called
 *   - Test 5: Redis downtime graceful — publish failure doesn't block primary
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

import { createTenantsRoutes } from '../tenants.js';
import { MemoryRedisFacade } from '../../redis-facade.js';
import { createCursorSecret } from '../cursor.js';
import {
  subscribeToTenantInvalidation,
  publishTenantInvalidation,
  TENANT_INVALIDATE_CHANNEL,
} from '../../tenant/tenant-invalidation.js';

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

async function startReplicaA(
  pool: Pool,
  redis: MemoryRedisFacade,
  tenantPool: TenantPoolStub
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json() as unknown as express.RequestHandler);
  app.use((req, _res, next) => {
    (req as unknown as { admin?: AdminContext }).admin = {
      actor: 'admin@example.com',
      source: 'entra',
      tenantScoped: null,
    };
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

/**
 * Replica-B: an LRU-cache consumer + tenantPool receiver that subscribes to
 * the shared Redis. In production replica-B would be a second process running
 * loadTenant middleware; here we spawn a minimal simulation with the same
 * subscribe/evict wiring.
 */
interface ReplicaB {
  lruCache: Map<string, { id: string }>;
  tenantPool: TenantPoolStub;
  /** Count of messages received on the shared channel. */
  messages: string[];
}

async function startReplicaB(redis: MemoryRedisFacade): Promise<ReplicaB> {
  const lruCache = new Map<string, { id: string }>();
  const tenantPool = makeTenantPoolStub();
  const messages: string[] = [];

  // subscribeToTenantInvalidation drives the evict side of the two caches.
  await subscribeToTenantInvalidation(redis, {
    evict: (tid: string) => {
      lruCache.delete(tid);
      tenantPool.evict(tid);
    },
  });

  // Also collect raw messages for assertions on publish count.
  redis.on('message', (channel, msg) => {
    if (channel === TENANT_INVALIDATE_CHANNEL) messages.push(msg as string);
  });

  return { lruCache, tenantPool, messages };
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

async function doPatch(url: string, body?: unknown): Promise<{ status: number; body: any }> {
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
  return { status: res.status, body: parsed };
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
  allowed_scopes: ['User.Read'],
};

describe('plan 04-02 Task 3 — cross-replica tenant invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('Test 1: PATCH on replica-A evicts replica-B LRU within 100ms', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const sharedRedis = new MemoryRedisFacade();
    const replicaATenantPool = makeTenantPoolStub();
    const replicaB = await startReplicaB(sharedRedis);
    const a = await startReplicaA(pool, sharedRedis, replicaATenantPool);
    try {
      const created = await doPost(`${a.url}/admin/tenants`, VALID_BODY);
      expect(created.status).toBe(201);
      const id = created.body.id;

      // Prime replica-B's LRU with a fake cached entry for this tenant.
      replicaB.lruCache.set(id, { id });
      expect(replicaB.lruCache.has(id)).toBe(true);

      // PATCH on replica-A
      const patch = await doPatch(`${a.url}/admin/tenants/${id}`, {
        cors_origins: ['http://localhost:3000', 'http://localhost:4000'],
      });
      expect(patch.status).toBe(200);

      // Wait for pub/sub propagation (MemoryRedisFacade invokes listeners
      // synchronously during publish, but the handler is in a .then() chain;
      // a macro-tick setTimeout covers the worst case).
      await new Promise((r) => setTimeout(r, 100));

      // Replica-B's LRU must have evicted the entry
      expect(replicaB.lruCache.has(id)).toBe(false);
      expect(replicaB.tenantPool.evict).toHaveBeenCalledWith(id);
      expect(replicaB.messages).toContain(id);
    } finally {
      await a.close();
    }
  });

  it('Test 2: PATCH disable on A — replica-B sees evicted cache; loadTenant lookup finds disabled tenant invisible', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const sharedRedis = new MemoryRedisFacade();
    const replicaATenantPool = makeTenantPoolStub();
    const replicaB = await startReplicaB(sharedRedis);
    const a = await startReplicaA(pool, sharedRedis, replicaATenantPool);
    try {
      const created = await doPost(`${a.url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;

      // Prime replica-B's LRU
      replicaB.lruCache.set(id, { id });

      const disable = await doPatch(`${a.url}/admin/tenants/${id}/disable`);
      expect(disable.status).toBe(200);
      await new Promise((r) => setTimeout(r, 100));

      // Replica-B's LRU evicted
      expect(replicaB.lruCache.has(id)).toBe(false);
      expect(replicaB.tenantPool.evict).toHaveBeenCalledWith(id);

      // Replica-B's next loadTenant query (simulated with direct DB lookup
      // using the same WHERE clause loadTenant uses) finds no row — the
      // tenant is disabled, so disabled_at IS NULL filter excludes it.
      const { rows } = await pool.query(
        `SELECT id FROM tenants WHERE id = $1 AND disabled_at IS NULL`,
        [id]
      );
      expect(rows.length).toBe(0);
    } finally {
      await a.close();
    }
  });

  it('Test 3: DELETE on A — replica-B sees eviction; loadTenant lookup 404s', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const sharedRedis = new MemoryRedisFacade();
    const replicaATenantPool = makeTenantPoolStub();
    const replicaB = await startReplicaB(sharedRedis);
    const a = await startReplicaA(pool, sharedRedis, replicaATenantPool);
    try {
      const created = await doPost(`${a.url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;

      replicaB.lruCache.set(id, { id });

      const del = await doDelete(`${a.url}/admin/tenants/${id}`);
      expect(del.status).toBe(200);
      await new Promise((r) => setTimeout(r, 100));

      expect(replicaB.lruCache.has(id)).toBe(false);
      expect(replicaB.tenantPool.evict).toHaveBeenCalledWith(id);

      // Row is gone via FK CASCADE
      const { rows } = await pool.query('SELECT id FROM tenants WHERE id = $1', [id]);
      expect(rows.length).toBe(0);
    } finally {
      await a.close();
    }
  });

  it('Test 4: rotate-secret on A — replica-B tenantPool.evict called within 100ms', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const sharedRedis = new MemoryRedisFacade();
    const replicaATenantPool = makeTenantPoolStub();
    const replicaB = await startReplicaB(sharedRedis);
    const a = await startReplicaA(pool, sharedRedis, replicaATenantPool);
    try {
      const created = await doPost(`${a.url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;

      replicaB.lruCache.set(id, { id });

      const start = Date.now();
      const rotate = await doPatch(`${a.url}/admin/tenants/${id}/rotate-secret`);
      expect(rotate.status).toBe(200);
      await new Promise((r) => setTimeout(r, 100));
      const elapsed = Date.now() - start;

      // Replica-B's tenantPool must have received the evict call
      expect(replicaB.tenantPool.evict).toHaveBeenCalledWith(id);
      expect(replicaB.lruCache.has(id)).toBe(false);

      // Propagation well under 1s (≤100ms target in practice)
      expect(elapsed).toBeLessThan(1000);
    } finally {
      await a.close();
    }
  });

  it("Test 5: Redis publish failure doesn't block primary operation; warn logged", async () => {
    const pool = await makePool();
    sharedPool = pool;
    const sharedRedis = new MemoryRedisFacade();
    const replicaATenantPool = makeTenantPoolStub();
    const a = await startReplicaA(pool, sharedRedis, replicaATenantPool);
    try {
      const created = await doPost(`${a.url}/admin/tenants`, VALID_BODY);
      const id = created.body.id;

      // Force publish to fail: override the publish method on the shared redis
      const origPublish = sharedRedis.publish.bind(sharedRedis);
      sharedRedis.publish = async () => {
        throw new Error('simulated redis publish failure');
      };

      const patch = await doPatch(`${a.url}/admin/tenants/${id}`, {
        cors_origins: ['http://localhost:4000'],
      });
      // Primary op still 200 — publish failure must not block the response
      expect(patch.status).toBe(200);

      // Warn log carries the failure reason
      const warnCall = loggerMock.warn.mock.calls.find((call) => {
        const obj = call[0];
        return (
          typeof obj === 'object' &&
          obj &&
          String((obj as { err?: string }).err ?? '').includes('simulated redis publish failure')
        );
      });
      expect(warnCall).toBeDefined();

      // Restore
      sharedRedis.publish = origPublish;
    } finally {
      await a.close();
    }
  });
});

// Keep imports live so TS doesn't complain about tree-shaking.
void publishTenantInvalidation;
