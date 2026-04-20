/**
 * Tool-selection invalidation pub/sub subscriber (plan 05-06, COVRG-05, D-20/D-21).
 *
 * Purpose: cross-replica invalidation of per-tenant BM25 discovery caches
 * after an admin mutates a tenant's `enabled_tools` column. Plan 05-07
 * publishes on `mcp:tool-selection-invalidate` after the PATCH /admin/
 * tenants/{id}/enabled-tools handler COMMITs; every subscribed process
 * evicts its local per-tenant-bm25.ts LRU entry so the next discovery
 * request rebuilds the index with the fresh enabled set.
 *
 * This module is an exact structural clone of
 * `src/lib/tenant/tenant-invalidation.ts` (Phase 3 plan 03-08) with the
 * channel renamed and the invalidator interface pointing at the per-tenant
 * BM25 cache. The two subscribers coexist on independent channels and
 * evict independent LRUs.
 *
 * Message format — identical to Phase 3 tenant-invalidate:
 *   channel: 'mcp:tool-selection-invalidate'
 *   payload: <tenantId GUID>  (plain text — no JSON, no versioning)
 *
 * Why plain-text GUID (05-PATTERNS.md line 300 option A):
 *   - The payload is a single token that never needs additional fields.
 *   - Keeps the subscriber code identical to Phase 3's audited pattern.
 *   - Reason strings live in the audit row (Plan 05-07), not pub/sub.
 *
 * Chain:
 *   admin PATCH → pg UPDATE (in txn) → writeAudit → COMMIT →
 *   publishToolSelectionInvalidation(redis, tenantId) →
 *   subscriber (here) → tenantBm25Cache.invalidate(tenantId).
 *
 * Threat refs:
 *   - T-05-13 (tampering / spoofed invalidation): TENANT_GUID_REGEX guard
 *     on received payloads; non-GUID → log warn + drop (no evict call).
 *     Worst case for an attacker WITH valid-GUID knowledge is forcing a
 *     cache miss on the next discovery request — no confidentiality or
 *     integrity impact because the subscriber only evicts, never fetches.
 *   - T-05-14 (invalidation storm / DoS): subscriber action is O(n) over
 *     the bounded LRU (≤200 entries). Flooding the channel causes
 *     repeated prefix scans but cannot exhaust memory or CPU.
 *   - T-05-14 (log injection via malformed payload): we log
 *     `messageLength` rather than the raw message on the non-GUID branch
 *     to prevent newline / control-char injection into operator logs.
 */
import logger from '../../logger.js';
import type { RedisClient } from '../redis.js';

/** Identical to the regex in src/lib/tenant/load-tenant.ts + tenant-invalidation.ts. */
const TENANT_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Channel name for per-tenant BM25 cache invalidation. Distinct from the
 * Phase 3 `mcp:tenant-invalidate` channel so publishers can target the
 * precise cache they want to flush (the full tenant row vs. the BM25
 * discovery surface) without incidental cross-eviction.
 */
export const TOOL_SELECTION_INVALIDATE_CHANNEL = 'mcp:tool-selection-invalidate';

/**
 * Surface the subscriber needs from the per-tenant BM25 cache. Kept as an
 * interface so tests can pass a `{ invalidate: vi.fn() }` stub without
 * wiring the full cache module — mirrors the Phase 3 `TenantInvalidator`
 * pattern.
 */
export interface ToolSelectionInvalidator {
  invalidate(tenantId: string): void;
}

/**
 * Subscribe to the tool-selection-invalidate channel and wire incoming
 * messages to `invalidator.invalidate`. Idempotent on the Redis side —
 * subscribing twice is harmless; the subscriber re-uses the existing
 * subscription.
 *
 * Callers SHOULD pass a dedicated subscriber client (`ioredis.duplicate()`)
 * in production so subscribing does not block the main command connection.
 * The MemoryRedisFacade supports subscribe/publish on the same instance
 * for tests, so this indirection only matters in HTTP mode with real
 * Redis (Pitfall 6 — reconnect is auto-handled by ioredis on the
 * duplicated connection).
 */
export async function subscribeToToolSelectionInvalidation(
  redis: RedisClient,
  invalidator: ToolSelectionInvalidator
): Promise<void> {
  await redis.subscribe(TOOL_SELECTION_INVALIDATE_CHANNEL);

  redis.on('message', (channel: string, message: string) => {
    if (channel !== TOOL_SELECTION_INVALIDATE_CHANNEL) return;

    // Guard: only evict on GUID-shaped payloads. Anything else goes to warn.
    // Log only the LENGTH of the message to block log-injection via newlines
    // or control chars in a malicious publisher's payload.
    if (!TENANT_GUID_REGEX.test(message)) {
      logger.warn(
        { channel, messageLength: message.length },
        'tool-selection-invalidation: received non-GUID payload; ignoring'
      );
      return;
    }

    try {
      invalidator.invalidate(message);
      logger.info({ tenantId: message }, 'tool-selection-invalidation: evicted cache entries');
    } catch (err) {
      logger.error(
        { tenantId: message, err: (err as Error).message },
        'tool-selection-invalidation: invalidate failed (continuing)'
      );
    }
  });
}

/**
 * Publish a tool-selection invalidation. Used by Plan 05-07's admin PATCH
 * handler after COMMIT; exposed here so tests can drive the subscriber.
 *
 * GUID validation happens BEFORE the publish call so a malformed sender
 * payload is rejected at the origin rather than propagating through the
 * pub/sub fabric. The subscriber also validates — defense in depth.
 *
 * Idempotent — publishing the same tenantId twice is harmless (second
 * evict is a no-op when the cache already dropped the entries).
 */
export async function publishToolSelectionInvalidation(
  redis: RedisClient,
  tenantId: string,
  _reason?: string // reason goes to audit row, not pub/sub payload
): Promise<number> {
  if (!TENANT_GUID_REGEX.test(tenantId)) {
    throw new Error(`publishToolSelectionInvalidation: invalid GUID "${tenantId}"`);
  }
  return redis.publish(TOOL_SELECTION_INVALIDATE_CHANNEL, tenantId);
}
