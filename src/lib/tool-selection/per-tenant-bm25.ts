/**
 * Per-tenant BM25 discovery cache (plan 05-06, COVRG-05, D-20, T-05-12).
 *
 * Background — why per-tenant:
 *   Phase 1-4 discovery shipped a single global BM25 index built once at
 *   startup from the full registered-tool universe. In a multi-tenant
 *   deployment that index leaks cross-tenant metadata through rank scores
 *   (T-05-12): a tenant whose allowlist excludes an op can still observe
 *   the op's existence by the shape of the ranking. Per-tenant indexes
 *   scoped to the tenant's `enabled_tools_set` eliminate the leak.
 *
 * Cache key: `${tenantId}:${schemaHash(enabled_tools_set)}`.
 *   - `tenantId` is the Postgres primary-key GUID (caller responsibility —
 *     we don't re-validate here; dispatch-guard is the authoritative gate).
 *   - `schemaHash` is the first 16 hex chars of sha256(JSON.stringify(sorted
 *     array of the Set)). The sort step makes the hash order-independent so
 *     a Set built in two different insertion orders still hits the same key.
 *
 * On miss the cache builds a BM25 index over the INTERSECTION of:
 *   (a) `registry` — the full tool universe as a Map<alias, ToolRegistryEntry>;
 *   (b) `enabledSet` — the tenant's enabled_tools_set.
 * An alias in `enabledSet` that is NOT in `registry` is silently skipped so a
 * stale tenant row referencing a removed tool does not blow up discovery.
 *
 * Bounds per D-20:
 *   - `max=200` entries (≥ the expected max tenant count × 2 rotations mid-
 *     TTL). Past 200 the LRU evicts the least-recently-used entry.
 *   - `ttlMs=10min` caps the longest stale-data window even when the pub/sub
 *     invalidation channel is partitioned (D-20 cap-and-trade design).
 * Both are overridable via `createTenantBm25Cache({max, ttlMs})` for tests
 * and future tuning.
 *
 * Invalidation paths:
 *   - schemaHash drift: tenant's `enabled_tools` row changes between requests
 *     → next call hashes to a new key → natural cache miss + rebuild. The
 *     previous entry sits until TTL or LRU eviction; memory cost is bounded.
 *   - Explicit `invalidate(tenantId)`: prefix-scan drops every cache key that
 *     starts with `${tenantId}:`. This is the path the Redis pub/sub
 *     subscriber (src/lib/tool-selection/tool-selection-invalidation.ts)
 *     exercises after an admin PATCH /admin/tenants/{id}/enabled-tools
 *     commit in Plan 05-07.
 *   - TTL expiry: bounded staleness fallback when both of the above fail.
 *
 * Token weighting mirrors src/graph-tools.ts `buildDiscoverySearchIndex` so
 * the per-tenant ranking behaves identically to v1 for the subset that DOES
 * intersect the tenant's enabled set:
 *   - name   × 5 (highest priority — tool-name queries should win)
 *   - path   × 2
 *   - llmTip capped at 12 tokens
 *   - description capped at 40 tokens
 * Repetition-based weighting matches the v1 technique and keeps the code
 * compatible with the shared `buildBM25Index` primitive in src/lib/bm25.ts.
 *
 * Threat refs:
 *   - T-05-12 (cross-tenant metadata leak): mitigated by per-tenant key +
 *     intersection-only doc set. Tests assert disjoint doc membership.
 *   - T-05-14b (memory blowup from large caches): bounded by `max=200` and
 *     the TTL eviction. Worst-case memory ≈ 200 × (≤1000 docs × ~2KB) ≈
 *     400MB which fits the Phase 5 operational budget.
 *
 * Module is pure: no side effects outside the returned object. The single
 * info-level log on rebuild is behind the `logger` module (pino) so
 * operators can observe cache churn without altering runtime behavior.
 */
import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { buildBM25Index, tokenize, type BM25Index } from '../bm25.js';
import logger from '../../logger.js';

/**
 * Minimal shape the cache needs from a registered-tool entry. Kept small on
 * purpose so callers (graph-tools.ts) can project their richer internal type
 * down to this interface without exposing the full `EndpointConfig` module
 * graph to test fixtures.
 */
export interface ToolRegistryEntry {
  alias: string;
  path?: string;
  description?: string;
  llmTip?: string;
}

/**
 * The registry is an O(1)-lookup Map keyed by alias. Callers build it once
 * at startup from `api.endpoints` + `endpointsData` and reuse the same
 * reference for every cache `get` call — the map itself is never mutated.
 */
export type ToolRegistry = Map<string, ToolRegistryEntry>;

export interface TenantBm25Cache {
  /**
   * Return the BM25 index for `(tenantId, enabledSet)`. Builds on miss;
   * returns the cached instance by pointer identity on hit. `registry` is
   * the full tool universe — only aliases in both `registry` and
   * `enabledSet` contribute documents.
   */
  get(tenantId: string, enabledSet: ReadonlySet<string>, registry: ToolRegistry): BM25Index;

  /**
   * Drop every cache entry whose key begins with `${tenantId}:`. Returns
   * the count of removed entries (useful for tests + info logs).
   */
  invalidate(tenantId: string): number;

  /** Current entry count (bounded by `max`). */
  size(): number;

  /** Test-only: drop all entries across tenants. Not for production use. */
  _clear(): void;
}

export interface TenantBm25CacheOptions {
  /** LRU max entries (default 200 per D-20). */
  max?: number;
  /** LRU TTL in ms (default 10 minutes per D-20). */
  ttlMs?: number;
}

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

const TIP_EXCERPT_TOKENS = 12;
const DESC_CAP_TOKENS = 40;

/**
 * Build the per-doc token vector with the v1-compatible weighting scheme.
 * Pulled out as a named helper so the weighting constants are discoverable
 * and so the buildTokens logic is exported-free (callers shouldn't reach
 * into the cache's internals — if the weighting ever changes we want ONE
 * code path to update).
 */
function buildTokens(entry: ToolRegistryEntry): string[] {
  const nameTokens = tokenize(entry.alias);
  const pathTokens = tokenize(entry.path ?? '');
  const tipTokens = tokenize(entry.llmTip ?? '').slice(0, TIP_EXCERPT_TOKENS);
  const descTokens = tokenize(entry.description ?? '').slice(0, DESC_CAP_TOKENS);

  // Repetition-based weighting matches src/graph-tools.ts buildDiscoverySearchIndex.
  // Preserve the exact counts so ranking behaviour is identical on the intersection.
  return [
    ...nameTokens,
    ...nameTokens,
    ...nameTokens,
    ...nameTokens,
    ...nameTokens,
    ...pathTokens,
    ...pathTokens,
    ...tipTokens,
    ...descTokens,
  ];
}

/**
 * Hash the sorted enabled-tools Set to a 16-hex-char schema key suffix.
 * sha256 is overkill for collision resistance here (a 16-char prefix has
 * 2^64 entropy, far above the tenant-count budget) but aligns with the
 * rest of the codebase's hashing choice and avoids bringing in another
 * primitive.
 */
function schemaHash(enabledSet: ReadonlySet<string>): string {
  const sorted = [...enabledSet].sort();
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

/**
 * Factory: construct a per-tenant BM25 cache. Call ONCE per process (the
 * cache state is per-instance) and export the returned object so the pub/
 * sub subscriber can call `invalidate` on the same reference the discovery
 * handlers read from.
 */
export function createTenantBm25Cache(opts: TenantBm25CacheOptions = {}): TenantBm25Cache {
  const cache = new LRUCache<string, BM25Index>({
    max: opts.max ?? DEFAULT_MAX_ENTRIES,
    ttl: opts.ttlMs ?? DEFAULT_TTL_MS,
    // A cache entry must expire at a bounded time from insert — do NOT bump
    // the age on read, otherwise a hot tenant never rolls over and accumulates
    // stale rank weights indefinitely.
    updateAgeOnGet: false,
    updateAgeOnHas: false,
  });

  return {
    get(tenantId, enabledSet, registry): BM25Index {
      const key = `${tenantId}:${schemaHash(enabledSet)}`;
      const cached = cache.get(key);
      if (cached) return cached;

      const docs: Array<{ id: string; tokens: string[] }> = [];
      for (const alias of enabledSet) {
        const entry = registry.get(alias);
        if (!entry) continue; // Silently skip aliases removed from the registry.
        docs.push({ id: alias, tokens: buildTokens(entry) });
      }

      const fresh = buildBM25Index(docs);
      cache.set(key, fresh);
      logger.info(
        { tenantId, docCount: docs.length, cacheSize: cache.size },
        'per-tenant-bm25: built index'
      );
      return fresh;
    },

    invalidate(tenantId): number {
      // Snapshot the keys up-front — lru-cache's iterator is live and we
      // mutate during iteration. Snapshot cost is O(n) on a bounded cache.
      const keys = [...cache.keys()];
      const prefix = `${tenantId}:`;
      let removed = 0;
      for (const k of keys) {
        if (k.startsWith(prefix)) {
          cache.delete(k);
          removed++;
        }
      }
      if (removed > 0) {
        logger.info({ tenantId, evicted: removed }, 'per-tenant-bm25: invalidated cache entries');
      }
      return removed;
    },

    size(): number {
      return cache.size;
    },

    _clear(): void {
      cache.clear();
    },
  };
}
