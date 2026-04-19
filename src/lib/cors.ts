/**
 * CORS middleware factory for Phase 1 single-tenant deployments (SECUR-04).
 *
 * Dev mode (NODE_ENV != 'production'): any http://localhost:* or
 * http://127.0.0.1:* origin is permitted without configuration. Intended for
 * local Claude Desktop / Cursor / Continue clients on the developer's
 * machine. https://localhost:* / https://127.0.0.1:* are also accepted so
 * self-signed HTTPS dev setups work. Anything else is denied in dev mode
 * to keep a stray browser session from CSRF-preflighting the dev server.
 *
 * Prod mode: only origins in config.allowlist are permitted (exact-string
 * match, no prefix, no wildcard). The caller is responsible for ensuring
 * the allowlist is non-empty — src/index.ts enforces fail-fast at startup
 * (exit 78) when the allowlist would be empty in prod.
 *
 * Policy guarantees:
 *   - `Vary: Origin` is always set on responses that inspect the Origin
 *     header. This prevents browser cache poisoning across differently-
 *     origined requests. https://fetch.spec.whatwg.org/#cors-protocol
 *   - Access-Control-Allow-Origin is NEVER emitted as `*`. We always echo
 *     the incoming origin (only when it is in the permitted set). This
 *     keeps `Access-Control-Allow-Credentials: true` compatible with the
 *     MCP OAuth flow.
 *   - OPTIONS preflight on a denied origin responds 403 rather than
 *     silently 200 without ACAO. A 403 is a loud operator-facing signal
 *     that the allowlist needs updating.
 *
 * Phase 3 note: per-tenant CORS (TENANT-01) replaces this module with a
 * per-request allowlist lookup. The export shape here is deliberately
 * minimal so Phase 3 can swap the middleware factory without touching
 * every call site.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { TenantRow } from './tenant/tenant-row.js';

export type CorsMode = 'dev' | 'prod';

export interface CorsConfig {
  mode: CorsMode;
  /** Prod-only allowlist of exact origin strings (e.g., 'https://app.example.com'). */
  allowlist: string[];
}

/**
 * Per-tenant CORS config (plan 03-08, TENANT-01).
 *
 * The middleware resolves the effective allowlist per request:
 *   1. When `req.tenant` is populated (by loadTenant) and
 *      `tenant.cors_origins` is non-empty → use that list.
 *   2. Otherwise (no tenant OR empty cors_origins) → fall back to
 *      `fallbackAllowlist` (the global prod allowlist from
 *      MS365_MCP_CORS_ORIGINS).
 *
 * This keeps operators in a single-tenant deployment on the existing prod
 * CORS path while letting multi-tenant deployments override per tenant.
 */
export interface PerTenantCorsConfig {
  mode: CorsMode;
  /** Global allowlist applied when the tenant did not customize CORS. */
  fallbackAllowlist: string[];
}

// Dev-mode permissive pattern: loopback on any port, http OR https. Loopback
// is always the developer's machine — we trade a narrow convenience for the
// dev inner loop (no config needed) and keep the regex tight so a stray
// external origin never matches.
const DEV_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS =
  'Origin, X-Requested-With, Content-Type, Accept, Authorization, mcp-protocol-version';

/**
 * Build a CORS middleware handler for the given mode + allowlist.
 *
 * The Set is constructed once per factory invocation so per-request
 * allowlist lookups are O(1). Phase 3 per-tenant CORS may replace the
 * closure-captured Set with a per-request lookup; the export shape
 * above deliberately does not commit to the Set being internal state.
 */
export function createCorsMiddleware(config: CorsConfig): RequestHandler {
  const allowlistSet = new Set(config.allowlist);
  const mode = config.mode;

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    // No Origin header: same-origin request, curl, or server-to-server
    // client. No ACAO to set; preflight-less OPTIONS (rare) still responds
    // 204 so a CORS-unaware client gets a predictable answer.
    if (!origin || typeof origin !== 'string') {
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
      return;
    }

    const isAllowed = mode === 'dev' ? DEV_ORIGIN_REGEX.test(origin) : allowlistSet.has(origin);

    if (isAllowed) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.header('Access-Control-Allow-Credentials', 'true');
    } else {
      // Still set Vary so browser cache differentiates allowed vs denied
      // responses for the same URL — otherwise a denied response could be
      // cached and served for a later allowed-origin request.
      res.header('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      // 403 on denied origin is a hard signal to the operator that the
      // allowlist needs updating — silent 200-without-ACAO was the v1
      // failure mode and it produced inscrutable browser errors with
      // no server-side breadcrumb.
      res.sendStatus(isAllowed ? 204 : 403);
      return;
    }

    next();
  };
}

/**
 * Per-tenant CORS middleware factory (plan 03-08, TENANT-01).
 *
 * Resolves the effective origin allowlist PER REQUEST:
 *   - If `req.tenant` is populated (loadTenant middleware ran first) AND
 *     `req.tenant.cors_origins` is non-empty, use it as the allowlist.
 *   - Otherwise, fall back to `config.fallbackAllowlist`.
 *
 * The fallback is the global MS365_MCP_CORS_ORIGINS array — operators who
 * don't customize per-tenant CORS get the same behaviour as Phase 1's
 * `createCorsMiddleware` without changing any env vars.
 *
 * MUST be mounted AFTER the loadTenant middleware on the same route prefix
 * (/t/:tenantId) so `req.tenant` is available. In dev mode the loopback
 * regex still wins (same trade-off as createCorsMiddleware).
 *
 * Per-request Set construction is intentional: per-tenant allowlists are
 * small (typically 1-3 origins) and per-request cost is dominated by the
 * DB/LRU round-trip in loadTenant, not the Set build.
 */
export function createPerTenantCorsMiddleware(config: PerTenantCorsConfig): RequestHandler {
  const fallbackSet = new Set(config.fallbackAllowlist);
  const mode = config.mode;

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;

    if (!origin || typeof origin !== 'string') {
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
      return;
    }

    const tenant = (req as Request & { tenant?: TenantRow }).tenant;
    // Tenant custom list wins when non-empty; fallback to global otherwise.
    const effectiveSet =
      tenant && tenant.cors_origins.length > 0 ? new Set(tenant.cors_origins) : fallbackSet;

    const isAllowed = mode === 'dev' ? DEV_ORIGIN_REGEX.test(origin) : effectiveSet.has(origin);

    if (isAllowed) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.header('Access-Control-Allow-Credentials', 'true');
    } else {
      res.header('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(isAllowed ? 204 : 403);
      return;
    }

    next();
  };
}
