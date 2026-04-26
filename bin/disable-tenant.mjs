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
 *   5. publish mcp:api-key-revoke for every revoked key id.
 *   6. tenantPool.evict(tenantId) (synchronous — removes pool entry;
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
 * Plan 03-10: lazy-load audit writer. Falls back to src/*.ts for tests
 * (tsx transpiles on import) and dist/*.js for production node invocation.
 */
async function loadAuditWriter() {
  try {
    const mod = await import('../dist/lib/audit.js');
    return mod.writeAuditStandalone;
  } catch {
    try {
      const mod = await import('../src/lib/audit.ts');
      return mod.writeAuditStandalone;
    } catch {
      return null;
    }
  }
}

/**
 * Canonical tenant id format. WR-04: validate the operator-supplied
 * tenantId against this regex BEFORE constructing any Redis pattern so
 * that `disable-tenant '*'` cannot expand the redis.keys glob to the
 * cross-tenant `mcp:cache:*:*` and wipe every tenant's cache. Same
 * GUID shape that loadTenant.ts:97 enforces on the HTTP path.
 */
const TENANT_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API_KEY_REVOKE_CHANNEL = 'mcp:api-key-revoke';

/**
 * WR-03 fix: SCAN-based deletion replaces the unbounded redis.keys() pattern
 * fetch. KEYS blocks the Redis single-threaded command queue for O(n) over
 * the entire keyspace; SCAN iterates in COUNT-sized batches and returns
 * control to the event loop between cursor advances. Both paths handle the
 * empty-batch case correctly (Redis SCAN can return zero matches per cursor
 * step even when more matches remain on later cursors).
 *
 * @param {{
 *   scan: (cursor: string, ...args: string[]) => Promise<[string, string[]]>,
 *   del: (...keys: string[]) => Promise<number>,
 * }} redis
 * @param {string} pattern  Redis glob pattern, e.g. 'mcp:cache:<guid>:*'
 * @returns {Promise<number>}  Total number of keys deleted across all batches.
 */
async function scanDel(redis, pattern) {
  let cursor = '0';
  let totalDeleted = 0;
  do {
    // COUNT is a hint; Redis may return more or fewer keys per cursor step.
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
    cursor = next;
    if (batch.length > 0) {
      totalDeleted += await redis.del(...batch);
    }
  } while (cursor !== '0');
  return totalDeleted;
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
 * @returns {Promise<{ disabled: string, cacheKeysDeleted: number, pkceKeysDeleted: number, apiKeysRevoked: number }>}
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const tenantId = argv[0];
  if (!tenantId) {
    throw new Error('Usage: disable-tenant <tenant-id>');
  }

  // WR-04 fix: validate the GUID shape BEFORE building any Redis pattern.
  // Without this, `disable-tenant '*'` would expand the glob to
  // mcp:cache:*:* (every tenant's cache) inside the in-memory facade.
  if (!TENANT_GUID_REGEX.test(tenantId)) {
    throw new Error(`Invalid tenant id format: ${tenantId} (expected canonical GUID)`);
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
      throw new Error(`Redis not ready (status=${redis.status}); retry disable (Pitfall 6)`);
    }
  }

  const pool = pgMod.getPool();

  // Pre-check existence so the error message is nicer than "0 rows affected".
  const { rows: pre } = await pool.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
  if (pre.length === 0) {
    throw new Error(`tenant_not_found: ${tenantId}`);
  }

  // Atomic DB write — one txn, two UPDATEs. If either fails, BOTH roll back.
  const revokedApiKeyIds = await pgMod.withTransaction(async (client) => {
    await client.query(
      'UPDATE tenants SET disabled_at = NOW(), wrapped_dek = NULL, updated_at = NOW() WHERE id = $1',
      [tenantId]
    );
    const { rows } = await client.query(
      'UPDATE api_keys SET revoked_at = NOW() WHERE tenant_id = $1 AND revoked_at IS NULL RETURNING id',
      [tenantId]
    );
    return rows.map((row) => row.id);
  });

  // WR-03 fix: SCAN-based deletion (was redis.keys() — O(n) blocking
  // single-threaded command queue over the entire keyspace). After-commit
  // cleanup is retriable because the txn is already durable. Both the
  // ioredis client and the MemoryRedisFacade implement scan with the same
  // [cursor, batch] return contract.
  const cacheKeysDeleted = await scanDel(redis, `mcp:cache:${tenantId}:*`);
  const pkceKeysDeleted = await scanDel(redis, `mcp:pkce:${tenantId}:*`);

  for (const keyId of revokedApiKeyIds) {
    await redis.publish(API_KEY_REVOKE_CHANNEL, keyId);
  }

  // Synchronous pool eviction — removes the in-memory MSAL client so the
  // next acquire sees wrapped_dek=NULL and throws.
  if (tenantPool && typeof tenantPool.evict === 'function') {
    tenantPool.evict(tenantId);
  }

  // Plan 03-10 (TENANT-06): emit tenant.disable audit row AFTER the
  // cascade completes. writeAuditStandalone catches DB errors internally
  // (pino shadow log) so operators never see a "disable succeeded but
  // audit failed" stderr message.
  const writeAuditStandalone = await loadAuditWriter();
  if (writeAuditStandalone) {
    await writeAuditStandalone(pool, {
      tenantId,
      actor: 'cli',
      action: 'tenant.disable',
      target: tenantId,
      ip: null,
      requestId: `cli-${Date.now()}`,
      result: 'success',
      meta: { cacheKeysDeleted, pkceKeysDeleted, apiKeysRevoked: revokedApiKeyIds.length },
    });
  }

  return {
    disabled: tenantId,
    cacheKeysDeleted,
    pkceKeysDeleted,
    apiKeysRevoked: revokedApiKeyIds.length,
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
