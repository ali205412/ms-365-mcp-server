/**
 * loadTenant middleware (plan 03-08, TENANT-01, D-13).
 *
 * Responsibilities (request path):
 *   1. Validate `req.params.tenantId` against the GUID regex per D-13 — the
 *      URL-path tenant identifier is the Postgres primary key and must be
 *      GUID-shaped. Non-GUID returns 404 `tenant_not_found` WITHOUT hitting
 *      the DB (cheap DOS protection + safe default for routing typos).
 *   2. Look up the row in the bounded LRU cache (max 1000 / TTL 60s). Hit →
 *      populate `req.tenant`, call `next()`.
 *   3. Miss → `SELECT * FROM tenants WHERE id=$1 AND disabled_at IS NULL`.
 *      Found → cache + populate `req.tenant` + next().
 *      Missing (unknown or disabled) → 404 `tenant_not_found`.
 *      Query error → 503 `database_unavailable` (no error message leaked).
 *
 * The LRU bounds (1000 / 60s) come from CONTEXT.md D-13 and balance:
 *   - Memory: 1000 tenants × ~1KB row ≈ 1MB — negligible.
 *   - Freshness: 60s means an admin mutation (disable, CORS change) propagates
 *     within one minute even without explicit invalidation. Combined with the
 *     pub/sub subscriber (tenant-invalidation.ts), propagation is near-instant
 *     on a healthy Redis and bounded at 60s if Redis is partitioned.
 *
 * The returned middleware function has an `evict(tenantId)` method attached
 * for the pub/sub subscriber — it allows the tenant-invalidation module to
 * drop a specific entry without needing a reference to the internal LRU.
 *
 * Threat refs:
 *   - T-03-08-01 (cache-key collision across tenants): cache key IS the
 *     tenant id, and the GUID regex guard makes collision statistically
 *     impossible.
 *   - T-03-08-02 (cached-row drift vs. DB): 60s TTL is the longest any stale
 *     row survives; pub/sub invalidation shortens it to "within Redis RTT".
 *   - T-03-08-04 (disabled tenant continues to serve): WHERE disabled_at IS
 *     NULL filter in the SELECT is load-bearing.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { LRUCache } from 'lru-cache';
import logger from '../../logger.js';
import type { TenantRow } from './tenant-row.js';

/**
 * RFC 4122 GUID regex (case-insensitive, hex-only). Matches v1 through v5
 * GUIDs — all tenant-registry primary keys are v4 but admin inserts could
 * carry v7 in the future, so the regex is intentionally permissive on the
 * version/variant nibbles.
 *
 * Rejects: non-hex chars, wrong segment lengths, missing hyphens, extra
 * whitespace, surrounding braces.
 */
const TENANT_GUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LoadTenantDeps {
  pool: Pool;
  /** LRU max entries (default 1000 per D-13). Overridable for tests. */
  maxEntries?: number;
  /** LRU TTL in ms (default 60_000 per D-13). */
  ttlMs?: number;
}

/**
 * Express RequestHandler augmented with an `evict(tenantId)` method that
 * the tenant-invalidation pub/sub subscriber calls to drop a cached entry.
 */
export interface LoadTenantMiddleware extends RequestHandler {
  evict(tenantId: string): void;
  /** Test helper — drops every cache entry. Do not call from production. */
  _clear(): void;
}

/**
 * Factory: returns an Express middleware that resolves and caches the tenant
 * row for the current request. Construct ONCE at bootstrap and pass the same
 * instance to every tenant-scoped route so cache hits accumulate.
 */
export function createLoadTenantMiddleware(deps: LoadTenantDeps): LoadTenantMiddleware {
  const { pool } = deps;
  const max = deps.maxEntries ?? 1000;
  const ttl = deps.ttlMs ?? 60_000;

  const cache = new LRUCache<string, TenantRow>({
    max,
    ttl,
    updateAgeOnGet: false, // A cached row should expire at a bounded time.
    updateAgeOnHas: false,
  });

  const middleware: RequestHandler = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const raw = (req.params as Record<string, string | undefined>).tenantId;

    // Guard 1: presence + format. Non-GUID inputs NEVER touch the DB.
    if (!raw || !TENANT_GUID_REGEX.test(raw)) {
      res.status(404).json({ error: 'tenant_not_found', tenantId: raw ?? null });
      return;
    }

    // Guard 2: cache hit (happy path).
    const cached = cache.get(raw);
    if (cached) {
      (req as Request & { tenant?: TenantRow }).tenant = cached;
      next();
      return;
    }

    // Guard 3: DB lookup on miss. WHERE disabled_at IS NULL filters disabled
    // tenants — they return 404 the same as unknown ids so admin-disabled
    // tenants can't continue to serve after the disable cascade (plan 03-05).
    try {
      const result = await pool.query<TenantRow>(
        `SELECT
           id, mode, client_id, client_secret_ref, tenant_id, cloud_type,
           redirect_uri_allowlist, cors_origins, allowed_scopes, enabled_tools,
           preset_version,
           wrapped_dek, slug, disabled_at, created_at, updated_at
         FROM tenants
         WHERE id = $1 AND disabled_at IS NULL`,
        [raw]
      );
      const row = result.rows[0];
      if (!row) {
        res.status(404).json({ error: 'tenant_not_found', tenantId: raw });
        return;
      }

      cache.set(raw, row);
      (req as Request & { tenant?: TenantRow }).tenant = row;
      next();
    } catch (err) {
      // T-03-08-05: never leak DB-driver error text to the client. Log
      // redacted warn for ops; return a generic 503 so callers retry.
      logger.warn(
        { tenantId: raw, err: (err as Error).message },
        'loadTenant: database query failed'
      );
      res.status(503).json({ error: 'database_unavailable' });
    }
  };

  // Augment the middleware function with the eviction helper. Using assign()
  // keeps the middleware Express-compatible AND lets the invalidation
  // subscriber drop a specific entry without leaking the internal LRU ref.
  const augmented = middleware as LoadTenantMiddleware;
  augmented.evict = (tenantId: string): void => {
    cache.delete(tenantId);
  };
  augmented._clear = (): void => {
    cache.clear();
  };
  return augmented;
}
