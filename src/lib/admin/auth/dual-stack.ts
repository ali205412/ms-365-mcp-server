/**
 * Dual-stack admin auth middleware (plan 04-04, ADMIN-04+05).
 *
 * Composes the X-Admin-Api-Key middleware and the Entra middleware into a
 * single Express handler that fronts every /admin/* route (except /health,
 * which is declared before this middleware in router.ts).
 *
 * Strategy chain (D-15 + D-14):
 *   1. X-Admin-Api-Key header present → api-key middleware:
 *        - valid → req.admin populated, next()
 *        - invalid/revoked → 401 (short-circuit)
 *   2. No api-key header, Authorization: Bearer present → Entra middleware:
 *        - member of group → req.admin populated, next()
 *        - malformed/aud-mismatch/missing-upn → 401
 *        - valid but non-member → 403
 *   3. Neither header → 401 problem+json unauthorized.
 *
 * Header precedence (T-04-10 mitigation — deterministic by construction):
 *   api-key wins over Bearer. When BOTH headers are present, the api-key
 *   middleware runs first; if it successfully populates req.admin, the Entra
 *   middleware is never invoked — the second-strategy branch below checks
 *   req.admin and short-circuits. This avoids the "header-precedence
 *   confusion" attack where a caller hopes the fall-through grants access.
 *
 * Declaration-merging for Request.admin: the AdminIdentity shape is attached
 * to the Request type so every downstream handler gets type-narrowed
 * `req.admin` without manual casting at each consumption site. Matches
 * PATTERNS.md line ~400.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { decodeJwt, type JWTPayload } from 'jose';
import type { Pool } from 'pg';
import type { RedisClient } from '../../redis.js';
import { problemUnauthorized, problemForbidden } from '../problem-json.js';
import { verifyApiKeyHeader, type ApiKeyAdminIdentity } from './api-key.js';
import { verifyEntraAdmin, type EntraAdminIdentity, type EntraConfig } from './entra.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Union of the two admin-identity shapes. Downstream handlers can discriminate
 * on `source` to decide RBAC (tenantScoped === null = global; non-null =
 * tenant-scoped).
 */
export type AdminIdentity = EntraAdminIdentity | ApiKeyAdminIdentity;

/**
 * Declaration-merge the Request type so every Express handler sees `req.admin`
 * with the correct TS type. Consumer sites do not need to cast when reading
 * req.admin — the property is optional so the type still narrows at runtime.
 */
declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminIdentity;
    /**
     * Request correlation id, set by a fronting middleware (pino-http or a
     * request-id middleware). Admin audit rows include it for cross-service
     * trace correlation. Optional so handlers fall back to `'unknown'` when
     * the fronting middleware is absent (stdio mode, test harnesses).
     */
    id?: string;
  }
}

/**
 * Dependency bag for the dual-stack middleware. Shared with api-key + entra
 * middleware factories so callers can pass a single object.
 */
export interface AdminAuthDeps {
  pgPool: Pool;
  redis: RedisClient;
  entraConfig: EntraConfig;
  /** Optional fetch impl for testing the Entra /me/memberOf probe. */
  fetchImpl?: typeof fetch;
}

// ── createAdminAuthMiddleware ───────────────────────────────────────────────

/**
 * Extract header value — tolerates the array form Node emits for duplicated
 * non-comma-separable headers (attacker-driven or upstream-proxy-driven).
 */
function readHeader(req: Request, name: string): string | undefined {
  const raw = req.headers[name];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return undefined;
}

/**
 * Compose the api-key + Entra verify helpers into a single Express handler.
 *
 * Implementation note — why helpers, not sub-middlewares: Express middlewares
 * express short-circuits by calling `res.status(...).json(...)` directly,
 * never invoking `next()`. Composing two middlewares into one via a
 * synthetic callback deadlocks whenever the inner middleware short-circuits
 * (the callback is never called, a wrapping Promise never resolves).
 * Calling the underlying `verifyApiKeyHeader` / `verifyEntraAdmin` helpers
 * directly sidesteps that trap: they return an identity-or-null and the
 * outer handler owns every `res.status(...)` call.
 *
 * Strategy chain:
 *   1. X-Admin-Api-Key header present?
 *        - Yes, valid → populate req.admin + next()
 *        - Yes, invalid/revoked → 401 (short-circuit; do NOT fall through to
 *          Entra — the caller's stated intent was api-key auth)
 *   2. Authorization: Bearer header present?
 *        - Yes, malformed/aud-mismatch/missing-upn → 401 unauthorized
 *        - Yes, valid Entra JWT + group member → populate req.admin + next()
 *        - Yes, valid Entra JWT + not member / Graph failure → 403 forbidden
 *   3. Neither header → 401 problem+json unauthorized.
 */
export function createAdminAuthMiddleware(deps: AdminAuthDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const instance = (req as unknown as { id?: string }).id;

    // Strategy 1: X-Admin-Api-Key (preferred — lower latency, no Graph round-trip).
    const apiKeyHeader = readHeader(req, 'x-admin-api-key');
    if (apiKeyHeader) {
      const identity = await verifyApiKeyHeader(apiKeyHeader, deps);
      if (!identity) {
        // Malformed / revoked / unknown — short-circuit. Do NOT fall through
        // to Entra (T-04-10 mitigation: a caller who sent an api-key header
        // intended api-key auth; falling through would confuse semantics).
        problemUnauthorized(res, instance);
        return;
      }
      (req as Request & { admin?: AdminIdentity }).admin = identity;
      next();
      return;
    }

    // Strategy 2: Authorization: Bearer (Entra OAuth).
    const authz = readHeader(req, 'authorization');
    if (authz?.startsWith('Bearer ')) {
      const token = authz.substring(7);
      // Pre-flight decode to discriminate 401 (malformed / missing upn / aud
      // mismatch) from 403 (valid identity, not a group member).
      let payload: JWTPayload;
      try {
        payload = decodeJwt(token);
      } catch {
        problemUnauthorized(res, instance);
        return;
      }
      const upn =
        typeof payload.upn === 'string' && payload.upn.length > 0
          ? payload.upn
          : typeof payload.preferred_username === 'string' &&
              (payload.preferred_username as string).length > 0
            ? (payload.preferred_username as string)
            : undefined;
      if (!upn || payload.aud !== deps.entraConfig.appClientId) {
        problemUnauthorized(res, instance);
        return;
      }

      const identity = await verifyEntraAdmin(token, deps);
      if (!identity) {
        // Structurally valid identity, but not a group member (or Graph
        // failure) → 403 forbidden (not 401).
        problemForbidden(res, instance);
        return;
      }
      (req as Request & { admin?: AdminIdentity }).admin = identity;
      next();
      return;
    }

    // Strategy 3: neither header → 401 (no credential at all).
    problemUnauthorized(res, instance);
  };
}
