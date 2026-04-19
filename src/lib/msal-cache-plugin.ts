/**
 * MSAL ICachePlugin backed by Redis + envelope encryption (plan 03-05).
 *
 * One plugin instance per (tenantId, clientId, userOid, scopeHash) tuple.
 * Pitfall 2 mitigation: NEVER share a plugin across users — the partition
 * key is fixed at plugin construction time. Callers build one plugin per
 * request in TenantPool.buildCachePlugin() and feed it into a scoped MSAL
 * acquireToken call.
 *
 * Lifecycle:
 *   - beforeCacheAccess: GET key from Redis -> unwrap with DEK -> deserialize
 *     into MSAL's in-memory cache. Decrypt failure = drop the key (cache
 *     corruption or KEK rotation mismatch); MSAL re-acquires via network.
 *   - afterCacheAccess: serialize -> wrap with DEK -> SET with 1h TTL.
 *
 * 1h TTL is a conservative upper bound — MSAL access tokens expire within
 * the hour anyway; refresh tokens persist across the TTL boundary via Redis
 * re-write on the next acquire.
 *
 * Cache key composition (TENANT-04 isolation — see threat T-03-05-01):
 *   mcp:cache:{tenantId}:{clientId}:{userOid|appOnly}:{scopeHash}
 *
 * Every segment is load-bearing:
 *   - tenantId  — cross-tenant isolation (no user of tenant A sees tenant B's blob)
 *   - clientId  — app-registration separation (one tenant, two app regs = two partitions)
 *   - userOid   — cross-user isolation within one tenant/app; 'appOnly' literal for
 *                 client-credentials flow (Pitfall 2 mitigation)
 *   - scopeHash — scope set differentiator (same user, different scopes = different cache)
 */
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import type { RedisClient } from './redis.js';
import { wrapWithDek, unwrapWithDek, type Envelope } from './crypto/envelope.js';
import logger from '../logger.js';

const CACHE_TTL_SECONDS = 3600;

export interface CachePluginConfig {
  redis: RedisClient;
  tenantId: string;
  clientId: string;
  userOid: string;
  scopeHash: string;
  dek: Buffer;
}

export function createRedisCachePlugin(config: CachePluginConfig): ICachePlugin {
  const { redis, tenantId, clientId, userOid, scopeHash, dek } = config;
  const key = `mcp:cache:${tenantId}:${clientId}:${userOid}:${scopeHash}`;

  return {
    async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
      const stored = await redis.get(key);
      if (!stored) return;
      try {
        const envelope = JSON.parse(stored) as Envelope;
        const plaintext = unwrapWithDek(envelope, dek);
        ctx.tokenCache.deserialize(plaintext.toString('utf8'));
      } catch (err) {
        logger.warn(
          { tenantId, err: (err as Error).message },
          'MSAL cache decrypt failed; dropping'
        );
        await redis.del(key);
      }
    },

    async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
      if (!ctx.cacheHasChanged) return;
      const plaintext = Buffer.from(ctx.tokenCache.serialize(), 'utf8');
      const envelope = wrapWithDek(plaintext, dek);
      await redis.set(key, JSON.stringify(envelope), 'EX', CACHE_TTL_SECONDS);
    },
  };
}
