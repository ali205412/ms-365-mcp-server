/**
 * ioredis singleton (plan 03-02, TENANT-05).
 *
 * Constructed once at process init AFTER pg pool but BEFORE tenant-pool.
 * The `lazyConnect` option defers the TCP handshake until the first command,
 * so unit tests that don't touch Redis do not pay reconnect-loop cost.
 *
 * For stdio mode (no MS365_MCP_REDIS_URL), `getRedis()` returns a
 * Map-backed in-memory facade (src/lib/redis-facade.ts) so downstream code
 * paths don't fork on transport mode.
 *
 * Reconnect-during-cryptoshred race (RESEARCH.md Pitfall 6): callers in the
 * sync cryptoshred path (plan 03-05 tenant disable) MUST check
 * `getRedis().status === 'ready'` before issuing del('mcp:cache:{tenantId}:*').
 * Queued commands re-execute on reconnect AFTER the request that
 * re-populated the cache, leaking the un-shredded key.
 *
 * Key-prefix conventions (CONTEXT.md D-13):
 *   mcp:pkce:<state>            — 03-03 PKCE store (EX 600s)
 *   mcp:cache:<tenant>:<user>   — 03-05 MSAL token cache
 *   mcp:rl:<tenant>:<bucket>    — Phase 6 rate-limit counters (reserved)
 *   mcp:session:<id>            — 03-10 admin session state
 *   mcp:tenant-invalidate       — 03-08 pub/sub channel for tenant-row cache
 *
 * Threat dispositions (plan 03-02 <threat_model>):
 *   - T-03-02-01 (Redis eavesdropping): caller uses redis://:password@host or
 *     rediss:// in URL — .env.example documents. ioredis honors URL scheme.
 *   - T-03-02-05 (reconnect-cryptoshred): .status exposed on both real and
 *     facade clients so 03-05 can enforce the ready-check.
 */
import IORedis from 'ioredis';
import type { Redis } from 'ioredis';
import logger from '../logger.js';
import { MemoryRedisFacade } from './redis-facade.js';

export type RedisClient = Redis | MemoryRedisFacade;

let client: RedisClient | null = null;

/**
 * Stdio-mode detection. Used by getRedis() to decide between the in-memory
 * facade and a real ioredis client.
 *
 * Stdio-mode signals (any one is sufficient):
 *   - MS365_MCP_TRANSPORT=stdio explicit
 *   - MS365_MCP_REDIS_URL is unset AND MS365_MCP_FORCE_REDIS is not '1'
 *
 * HTTP mode with MS365_MCP_FORCE_REDIS=1 but no MS365_MCP_REDIS_URL is
 * intentionally an error — rather than silently using the facade, we fail
 * loud so operators catch misconfiguration early.
 */
function isStdioMode(): boolean {
  if (process.env.MS365_MCP_TRANSPORT === 'stdio') return true;
  if (!process.env.MS365_MCP_REDIS_URL && process.env.MS365_MCP_FORCE_REDIS !== '1') {
    return true;
  }
  return false;
}

/**
 * Returns the singleton Redis client. In HTTP mode this is a real ioredis
 * instance with lazyConnect enabled; in stdio mode it is a MemoryRedisFacade.
 *
 * Throws when MS365_MCP_REDIS_URL is unset AND we are not in stdio mode (i.e.
 * HTTP mode with force-redis=1 but no URL). Fails fast during bootstrap so
 * the operator gets a clear error before any Redis command is issued.
 */
export function getRedis(): RedisClient {
  if (client) return client;

  if (isStdioMode() && !process.env.MS365_MCP_REDIS_URL) {
    client = new MemoryRedisFacade();
    logger.info('Redis: using in-memory facade (stdio mode, no MS365_MCP_REDIS_URL set)');
    return client;
  }

  const url = process.env.MS365_MCP_REDIS_URL;
  if (!url) {
    throw new Error(
      'MS365_MCP_REDIS_URL is required in HTTP mode. ' +
        'Set it to redis://host:port (or rediss:// for TLS) or run with MS365_MCP_TRANSPORT=stdio.'
    );
  }

  const realClient: Redis = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  realClient.on('error', (err: Error) => {
    logger.error({ err: err.message }, 'redis client error');
  });
  client = realClient;
  return realClient;
}

/**
 * Graceful shutdown: awaits `client.quit()` so any queued commands are
 * drained, falls back to `disconnect()` if quit throws. Idempotent — a
 * second call after the client is null is a no-op.
 *
 * Shutdown order (CONTEXT.md / src/index.ts phase3ShutdownOrchestrator):
 *   1. tenantPool.drain   (03-05)
 *   2. redis.shutdown     (THIS)
 *   3. pg.shutdown        (03-01)
 */
export async function shutdown(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  try {
    await c.quit();
  } catch {
    // Forceful fallback — .quit() only fails when already disconnected.
    if ('disconnect' in c) {
      (c as Redis | MemoryRedisFacade).disconnect();
    }
  }
}

/**
 * Readiness probe. Pushed into the Phase 1 `readinessChecks[]` array from
 * src/index.ts so `/readyz` flips to 503 when Redis is unreachable.
 * Returns false on any error (never throws out of this function) — matches
 * the Phase 1 contract that a thrown error counts as "not ready".
 */
export async function readinessCheck(): Promise<boolean> {
  try {
    const r = getRedis();
    // ioredis lazyConnect — kick the connection if not yet established. The
    // facade has no connect() so this is a no-op on stdio.
    if (
      'status' in r &&
      r.status !== 'ready' &&
      'connect' in r &&
      typeof (r as Redis).connect === 'function'
    ) {
      await (r as Redis).connect().catch(() => {
        // Swallow — ping below will surface the real failure
      });
    }
    const pong = await r.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Test-only: replace the cached client with one supplied by the test
 * (MemoryRedisFacade or ioredis-mock). Production callers MUST use
 * getRedis() — this export exists solely so vitest tests can inject a
 * deterministic client without needing MS365_MCP_REDIS_URL set.
 */
export function __setRedisForTesting(r: RedisClient | null): void {
  client = r;
}
