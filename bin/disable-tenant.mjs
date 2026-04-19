#!/usr/bin/env node
/**
 * Operator CLI for tenant disable cascade (plan 03-05, TENANT-07, SC#4).
 *
 * Procedure (atomic — Pitfall 6 aware):
 *   1. Check redis.status === 'ready' (else refuse — reconnect race risk).
 *      Queued Redis commands re-execute AFTER reconnect — AFTER a request
 *      that re-populates the cache. The ready-check keeps the sync cascade
 *      contract honest.
 *   2. Pre-check tenant exists (outside the txn — friendly error).
 *   3. BEGIN Postgres transaction:
 *        - UPDATE tenants SET disabled_at=NOW(), wrapped_dek=NULL
 *          (cryptoshred — no ciphertext recoverable once wrapped_dek drops)
 *        - UPDATE api_keys SET revoked_at=NOW() WHERE tenant_id=$1 AND
 *          revoked_at IS NULL.
 *      COMMIT.
 *   4. redis.del('mcp:cache:{tenantId}:*') + redis.del('mcp:pkce:{tenantId}:*')
 *      (after COMMIT — retriable if a step fails; txn is already durable).
 *   5. tenantPool.evict(tenantId) (synchronous — removes pool entry;
 *      subsequent acquires will see wrapped_dek=NULL and throw).
 *
 * Phase 4 replaces this CLI with POST /admin/tenants/{id}/disable.
 *
 * Module design: exported `main(argv, deps?)` for programmatic test
 * invocation — tests inject pg-mem pool + MemoryRedisFacade + a real
 * TenantPool so the full SC#4 cascade is verifiable without testcontainers.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Lazy-load the production pg pool module. Tests inject the pool + the
 * withTransaction helper via `deps.postgres` so pg-mem harnesses don't need
 * to write dist/ first.
 */
async function loadProdPostgres() {
  try {
    return await import('../dist/lib/postgres.js');
  } catch {
    throw new Error(
      'dist/lib/postgres.js not found — run `npm run build` before invoking bin/disable-tenant.mjs'
    );
  }
}

async function loadProdRedis() {
  try {
    return await import('../dist/lib/redis.js');
  } catch {
    throw new Error(
      'dist/lib/redis.js not found — run `npm run build` before invoking bin/disable-tenant.mjs'
    );
  }
}

/**
 * Programmatic entry point. Accepts injected deps for tests.
 *
 * @param {string[]} argv
 * @param {{
 *   postgres?: { getPool: () => any, withTransaction: (fn: (c: any) => Promise<any>) => Promise<any> },
 *   redis?: { getRedis: () => any },
 *   tenantPool?: { evict: (id: string) => void, has: (id: string) => boolean },
 * }} [deps]
 * @returns {Promise<{ disabled: string, cacheKeysDeleted: number, pkceKeysDeleted: number }>}
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const tenantId = argv[0];
  if (!tenantId) {
    throw new Error('Usage: disable-tenant <tenant-id>');
  }

  const pgMod = deps.postgres ?? (await loadProdPostgres());
  const redisMod = deps.redis ?? (await loadProdRedis());
  const tenantPool = deps.tenantPool ?? null;

  const redis = redisMod.getRedis();

  // Pitfall 6: refuse if Redis isn't ready. Queued commands would re-execute
  // after reconnect, AFTER a request that re-populates the cache — which
  // breaks cryptoshred. ioredis-compatible facades + the MemoryRedisFacade
  // both expose `.status`; only real ioredis can transition to 'reconnecting'.
  if ('status' in redis && redis.status !== 'ready' && redis.status !== 'wait') {
    // `wait` is the lazyConnect pre-connect state — calling a command from
    // the pre-check below will transition to 'ready'. Only 'reconnecting' /
    // 'end' / 'connecting' actively indicate a non-healthy client.
    if ('connect' in redis && typeof redis.connect === 'function') {
      await redis.connect().catch(() => {});
    }
    if (redis.status !== 'ready' && redis.status !== 'wait') {
      throw new Error(
        `Redis not ready (status=${redis.status}); retry disable (Pitfall 6)`
      );
    }
  }

  const pool = pgMod.getPool();

  // Pre-check existence so the error message is nicer than "0 rows affected".
  const { rows: pre } = await pool.query('SELECT id FROM tenants WHERE id = $1', [
    tenantId,
  ]);
  if (pre.length === 0) {
    throw new Error(`tenant_not_found: ${tenantId}`);
  }

  // Atomic DB write — one txn, two UPDATEs. If either fails, BOTH roll back.
  await pgMod.withTransaction(async (client) => {
    await client.query(
      'UPDATE tenants SET disabled_at = NOW(), wrapped_dek = NULL, updated_at = NOW() WHERE id = $1',
      [tenantId]
    );
    await client.query(
      'UPDATE api_keys SET revoked_at = NOW() WHERE tenant_id = $1 AND revoked_at IS NULL',
      [tenantId]
    );
  });

  // After-commit cleanup — retriable because the txn is already durable.
  const cacheKeys = await redis.keys(`mcp:cache:${tenantId}:*`);
  let cacheKeysDeleted = 0;
  if (cacheKeys.length > 0) {
    cacheKeysDeleted = await redis.del(...cacheKeys);
  }
  const pkceKeys = await redis.keys(`mcp:pkce:${tenantId}:*`);
  let pkceKeysDeleted = 0;
  if (pkceKeys.length > 0) {
    pkceKeysDeleted = await redis.del(...pkceKeys);
  }

  // Synchronous pool eviction — removes the in-memory MSAL client so the
  // next acquire sees wrapped_dek=NULL and throws.
  if (tenantPool && typeof tenantPool.evict === 'function') {
    tenantPool.evict(tenantId);
  }

  return {
    disabled: tenantId,
    cacheKeysDeleted,
    pkceKeysDeleted,
  };
}

const invokedAsScript = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return import.meta.url === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}

void fileURLToPath; // avoid "unused" lint if reordering imports later
