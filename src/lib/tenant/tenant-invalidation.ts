/**
 * Tenant-invalidation pub/sub subscriber (plan 03-08, TENANT-01, D-13).
 *
 * Purpose: propagate tenant-row mutations (disable, CORS change, scope edit,
 * etc.) across every process that caches the row. The admin mutation path
 * (Phase 4) publishes a message to `mcp:tenant-invalidate` after COMMIT; every
 * subscribed process evicts its local LRU entry so the next request fetches
 * fresh state.
 *
 * Message format:
 *   channel: 'mcp:tenant-invalidate'
 *   payload: <tenantId GUID>  (plain text — no JSON, no versioning)
 *
 * Why plain text: the payload is a single token that never needs to carry
 * additional fields. Adopting JSON here would invite schema drift without
 * closing any real ambiguity (the GUID IS the message).
 *
 * Threat refs:
 *   - T-03-08-03: malicious publisher spoofs invalidation → worst case is an
 *     extra DB query on the next request (cache miss). No confidentiality
 *     impact because the subscriber only evicts, never fetches.
 *   - T-03-08-06: non-GUID payloads are rejected to prevent log-injection
 *     style attacks via a malformed channel message.
 *
 * Chain: admin-API PATCH /tenants/{id} (Phase 4) → Postgres UPDATE → Redis
 * PUBLISH → this subscriber → loadTenant.evict(id) → TenantPool.evict(id).
 */
import logger from '../../logger.js';
import type { RedisClient } from '../redis.js';

/** Match the regex in load-tenant.ts — guard against log injection / spoofs. */
const TENANT_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TENANT_INVALIDATE_CHANNEL = 'mcp:tenant-invalidate';

/**
 * Surface the subscriber needs from the loadTenant middleware — kept as an
 * interface so tests can pass a { evict: vi.fn() } stub.
 */
export interface TenantInvalidator {
  evict(tenantId: string): void;
}

/**
 * Subscribe to the tenant-invalidate channel and wire incoming messages to
 * `invalidator.evict`. Idempotent on the Redis side — subscribing twice is
 * harmless, the subscriber re-uses the existing subscription.
 *
 * This function does NOT construct a dedicated Redis connection. Callers
 * SHOULD pass a dedicated subscriber client (ioredis duplicate()) in
 * production so subscribing does not block the main command connection.
 * The MemoryRedisFacade supports subscribe/publish on the same instance for
 * tests, so this indirection only matters in HTTP mode with real Redis.
 */
export async function subscribeToTenantInvalidation(
  redis: RedisClient,
  invalidator: TenantInvalidator
): Promise<void> {
  await redis.subscribe(TENANT_INVALIDATE_CHANNEL);

  redis.on('message', (channel: string, message: string) => {
    if (channel !== TENANT_INVALIDATE_CHANNEL) return;

    // Guard against log-injection + malformed publishers: only evict GUID
    // payloads. Anything else is logged at warn level for ops visibility.
    if (!TENANT_GUID_REGEX.test(message)) {
      logger.warn(
        { channel, messageLength: message.length },
        'tenant-invalidation: received non-GUID payload; ignoring'
      );
      return;
    }

    try {
      invalidator.evict(message);
      logger.info({ tenantId: message }, 'tenant-invalidation: evicted cache entry');
    } catch (err) {
      logger.error(
        { tenantId: message, err: (err as Error).message },
        'tenant-invalidation: evict failed (continuing)'
      );
    }
  });
}

/**
 * Publish a tenant-invalidate message. Used by admin API + the disable
 * cascade in Phase 4; exposed here so tests can drive the subscriber.
 *
 * Idempotent — publishing the same tenantId twice is harmless (second evict
 * is a no-op when the cache already dropped the entry on the first message).
 */
export async function publishTenantInvalidation(
  redis: RedisClient,
  tenantId: string
): Promise<number> {
  if (!TENANT_GUID_REGEX.test(tenantId)) {
    throw new Error(`publishTenantInvalidation: invalid GUID "${tenantId}"`);
  }
  return redis.publish(TENANT_INVALIDATE_CHANNEL, tenantId);
}
