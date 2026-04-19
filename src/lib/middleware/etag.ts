/**
 * ETagMiddleware — Phase 2 middleware implementing MWARE-06 per D-09
 * (OPPORTUNISTIC-AUTO-ATTACH).
 *
 * Behavior:
 *   - Explicit caller path: when the request already carries an If-Match or
 *     If-None-Match header, forward verbatim (never override from cache).
 *   - Auto-attach: on PATCH/DELETE targeting an ETag-supported resource
 *     (DriveItem / Event / Message / Contact), if the module-level cache has
 *     a prior ETag for that resource AND the caller did not explicitly opt
 *     out, set `If-Match: <cached-etag>` before forwarding.
 *   - Opt-out sentinel: an explicit `If-Match: 'null'` literal on the request
 *     strips the header AND skips auto-attach. This is the D-09 escape hatch
 *     for advanced callers that want last-writer-wins semantics on a resource
 *     that has a cached ETag.
 *   - Cache refresh: on a successful GET to a supported resource, read the
 *     ETag response header (case-insensitively) and write it to the cache.
 *
 * Chain position (locked per 02-CONTEXT.md Pattern E):
 *
 *   [ETag (this), RetryHandler (02-02), ODataErrorHandler (02-03), TokenRefresh (02-01)]
 *     outermost                                                      innermost
 *
 * This middleware sits OUTERMOST because it touches headers and the
 * response-to-cache round-trip BEFORE any retry decision. Putting it inside
 * the retry loop would cause cache to be written multiple times on retried
 * GETs and would open a race where the auto-attach header gets added AFTER
 * RetryHandler has already forwarded the first attempt.
 *
 * 412 handling: this middleware does NOT intercept 412 responses. The
 * ODataErrorHandler (02-03) parses the body and throws `GraphConcurrencyError`
 * which already carries the AI-facing "resource changed; re-fetch before
 * retrying." hint in its message. Integration-tested in
 * `test/etag-middleware.test.ts`.
 *
 * Cache implementation: module-level `Map<string, string>` with insertion-
 * order-based eviction (Map preserves insertion order per ECMAScript spec).
 * `cacheSet` touches existing keys by deleting and re-inserting so recency
 * drives eviction; once size exceeds CACHE_MAX_SIZE (1000) the oldest entry
 * is evicted. Phase 2 key is resource-path-only; Phase 3 will extend the
 * key to `(tenantId, resourceType, resourceId)` per T-02-07e disposition.
 *
 * Scope lock per D-09 (verbatim from the decision):
 *   - DriveItem:    `/drive/items/{id}` + `/drives/{id}/items/{id}`
 *   - Event:        `/me/events/{id}` + `/users/{id}/events/{id}`
 *   - Message:      `/me/messages/{id}` + `/users/{id}/messages/{id}`
 *   - Contact:      `/me/contacts/{id}` + `/users/{id}/contacts/{id}`
 *
 * Other resources pass through unchanged — no cache read, no cache write.
 * Adding a new resource type is deliberate; see ETAG_SUPPORTED_PATTERNS.
 *
 * Observability:
 *   - OTel span `graph.middleware.etag` per D-03, tagged with
 *     `graph.etag.explicit` / `graph.etag.autoAttached` / `graph.etag.optedOut`
 *     / `graph.etag.cached` boolean attributes for diagnostic-friendly traces.
 *   - No log statements on the hot path — ETag plumbing is expected to run on
 *     every Graph call and verbose logging would drown out the retry / error
 *     signal. Span attributes are sufficient for debugging.
 */

import { trace } from '@opentelemetry/api';
import type { GraphMiddleware, GraphRequest } from './types.js';

const CACHE_MAX_SIZE = 1000;

/**
 * ETag-supported resource path patterns per D-09. Auto-attach + cache-refresh
 * fire ONLY when the request URL's pathname matches one of these. Adding a
 * new resource type requires a deliberate edit here + a new test case.
 */
const ETAG_SUPPORTED_PATTERNS: RegExp[] = [
  /\/drive\/items\/[^/?]+/,
  /\/drives\/[^/]+\/items\/[^/?]+/,
  /\/me\/events\/[^/?]+/,
  /\/me\/messages\/[^/?]+/,
  /\/me\/contacts\/[^/?]+/,
  /\/users\/[^/]+\/events\/[^/?]+/,
  /\/users\/[^/]+\/messages\/[^/?]+/,
  /\/users\/[^/]+\/contacts\/[^/?]+/,
];

/**
 * Module-level ETag cache. Map preserves insertion order per ECMAScript spec
 * so eviction by "first inserted key" gives us insertion-order LRU behaviour
 * when `cacheSet` touches existing keys (delete-then-reinsert).
 */
const etagCache = new Map<string, string>();
const tracer = trace.getTracer('graph-middleware');

/**
 * Extract an ETag-cache key from a URL. Returns the matched path segment
 * (e.g. `/me/events/abc`) when the URL maps to a supported resource, or
 * `null` otherwise. The null path is the auto-attach NO-OP branch.
 *
 * Malformed URLs that `new URL(...)` cannot parse fall back to the raw string
 * input so synthetic test fixtures and edge-case Graph URLs still participate
 * in the matching logic.
 */
export function resourceKeyFromUrl(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  for (const pattern of ETAG_SUPPORTED_PATTERNS) {
    const match = path.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * Case-insensitive header lookup. The fetch spec's `Headers` class is
 * case-insensitive by contract, but the pipeline's `GraphRequest.headers` is
 * a plain `Record<string, string>` whose keys arrive in whatever case the
 * caller supplied. RFC 7230 §3.2: header field names are case-insensitive.
 */
function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/**
 * Case-insensitive header removal. Deletes every key that matches `name`
 * regardless of case so the request forwarded to the inner chain truly has
 * no If-Match header (the opt-out sentinel case).
 */
function removeHeader(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key];
  }
}

/**
 * Insert into the cache with insertion-order-based eviction. Touches existing
 * keys by delete-then-reinsert so they become the most-recently-inserted entry
 * and survive eviction. Evicts the first-inserted key once `CACHE_MAX_SIZE`
 * is exceeded.
 */
function cacheSet(key: string, etag: string): void {
  if (etagCache.has(key)) etagCache.delete(key);
  etagCache.set(key, etag);
  if (etagCache.size > CACHE_MAX_SIZE) {
    const oldestKey = etagCache.keys().next().value;
    if (oldestKey !== undefined) etagCache.delete(oldestKey);
  }
}

/**
 * Read from the cache and refresh recency on hit. The delete-then-reinsert
 * pattern makes the key the most-recently-used, protecting it from eviction
 * on the next `cacheSet` call.
 */
function cacheGet(key: string): string | undefined {
  const value = etagCache.get(key);
  if (value !== undefined) {
    etagCache.delete(key);
    etagCache.set(key, value);
  }
  return value;
}

export class ETagMiddleware implements GraphMiddleware {
  readonly name = 'etag';

  async execute(req: GraphRequest, next: () => Promise<Response>): Promise<Response> {
    return tracer.startActiveSpan('graph.middleware.etag', async (span) => {
      try {
        const resourceKey = resourceKeyFromUrl(req.url);
        const method = req.method.toUpperCase();

        // Pre-next: opt-out handling + auto-attach for writes.
        if (method === 'PATCH' || method === 'DELETE') {
          const existingIfMatch = findHeader(req.headers, 'If-Match');
          if (existingIfMatch !== undefined) {
            if (existingIfMatch === 'null') {
              // Opt-out sentinel (D-09 escape hatch): strip header AND skip
              // auto-attach. The caller is explicitly asking for last-writer-
              // wins semantics on this request.
              removeHeader(req.headers, 'If-Match');
              span.setAttribute('graph.etag.optedOut', true);
            } else {
              // Explicit caller value — forward verbatim.
              span.setAttribute('graph.etag.explicit', true);
            }
          } else if (resourceKey) {
            // Auto-attach if the cache has a prior ETag for this resource.
            const cached = cacheGet(resourceKey);
            if (cached) {
              req.headers['If-Match'] = cached;
              span.setAttribute('graph.etag.autoAttached', true);
            }
          }
        }

        // Forward through the rest of the chain.
        const response = await next();

        // Post-next: cache refresh on successful GET to supported resources.
        if (method === 'GET' && response.ok && resourceKey) {
          const etag = response.headers.get('ETag') ?? response.headers.get('etag');
          if (etag) {
            cacheSet(resourceKey, etag);
            span.setAttribute('graph.etag.cached', true);
          }
        }

        return response;
      } finally {
        span.end();
      }
    });
  }
}
