/**
 * Admin X-Admin-Api-Key middleware + helper (plan 04-04, ADMIN-05).
 *
 * Two exports:
 *   - verifyApiKeyHeader(headerValue, deps) — delegates to 04-03's
 *     verifyApiKeyPlaintext, checks revokedAt, returns an ApiKeyAdminIdentity
 *     in the dual-stack shape (actor, source, tenantScoped).
 *   - createAdminApiKeyMiddleware(deps) — Express middleware that reads
 *     req.headers['x-admin-api-key']; on miss → next() (chain to Entra);
 *     on invalid/revoked → 401 problem+json; on valid → req.admin populated.
 *
 * Design constraints (D-15 + RESEARCH.md Open Question 3):
 *   - Revoked keys return null (→ 401 unauthorized, NOT 403 forbidden):
 *     per OAuth 2 semantics a revoked credential is no longer a valid
 *     identity. Clients should retry with a fresh key.
 *   - verifyApiKeyPlaintext from 04-03 is the single source of truth for
 *     plaintext-to-identity resolution. This middleware adds:
 *       (a) the X-Admin-Api-Key header protocol
 *       (b) the revokedAt check (04-03's helper returns the row including
 *           the revokedAt timestamp so the caller can enforce freshness)
 *       (c) the shape adaptation (api_key.tenant_id → AdminIdentity.tenantScoped)
 *
 * Header handling — express normalises header names to lowercase, so we
 * always read 'x-admin-api-key'. If the header appears twice (an attacker
 * attempting to confuse the middleware), we take the first value only.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { RedisClient } from '../../redis.js';
import { verifyApiKeyPlaintext } from '../api-keys.js';
import { problemUnauthorized } from '../problem-json.js';
import logger from '../../../logger.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * API-key admin identity. `tenantScoped` is ALWAYS the api_key.tenant_id —
 * API-key admins are per-tenant, never global. Per D-15 + the admin RBAC
 * contract (only the Entra group grants global admin access).
 */
export interface ApiKeyAdminIdentity {
  actor: string; // `api-key:${keyId}`
  source: 'api-key';
  tenantScoped: string; // api_key.tenant_id
}

/**
 * Middleware dependency bag. Shared with dual-stack + entra.
 */
export interface ApiKeyMiddlewareDeps {
  pgPool: Pool;
  redis: RedisClient;
}

// ── verifyApiKeyHeader ──────────────────────────────────────────────────────

/**
 * Verify an X-Admin-Api-Key header value. Delegates to verifyApiKeyPlaintext
 * (04-03) and converts the row into an ApiKeyAdminIdentity with the
 * dual-stack shape.
 *
 * Contract:
 *   - Malformed plaintext → null (verifyApiKeyPlaintext regex-rejects)
 *   - No matching row → null
 *   - Row matched but revoked (revokedAt non-null) → null (middleware returns 401)
 *   - Row matched, active → ApiKeyAdminIdentity
 *
 * Never throws — all DB errors propagate from verifyApiKeyPlaintext, which
 * already handles them (logs + returns null).
 */
export async function verifyApiKeyHeader(
  headerValue: string,
  deps: ApiKeyMiddlewareDeps
): Promise<ApiKeyAdminIdentity | null> {
  const identity = await verifyApiKeyPlaintext(headerValue, deps);
  if (!identity) return null;

  if (identity.revokedAt) {
    // Per RESEARCH.md Open Question 3: revoked = 401 (unauthenticated), NOT 403
    // (authenticated-but-forbidden). A revoked credential simply isn't valid.
    logger.info({ keyId: identity.keyId }, 'admin-api-key: revoked key rejected');
    return null;
  }

  return {
    actor: `api-key:${identity.keyId}`,
    source: 'api-key',
    tenantScoped: identity.tenantId,
  };
}

// ── createAdminApiKeyMiddleware ─────────────────────────────────────────────

/**
 * Express middleware that reads the X-Admin-Api-Key header and populates
 * req.admin on success. On missing header → next() (chain to Entra). On
 * invalid/revoked key → 401 problem+json (identity not valid).
 *
 * Header precedence within this middleware:
 *   - Missing → next() (pass-through)
 *   - Present + malformed/revoked/unknown → 401 (short-circuit)
 *   - Present + valid → req.admin + next()
 *
 * If the header appears twice (attacker-driven), the first occurrence wins —
 * Node's http parser surfaces repeated non-comma-separable headers as an
 * array, so we defensively extract arr[0].
 */
export function createAdminApiKeyMiddleware(deps: ApiKeyMiddlewareDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const raw = req.headers['x-admin-api-key'];
    const headerValue =
      typeof raw === 'string'
        ? raw
        : Array.isArray(raw) && typeof raw[0] === 'string'
          ? raw[0]
          : undefined;

    if (!headerValue) {
      // No api-key header; chain to the next strategy.
      next();
      return;
    }

    const identity = await verifyApiKeyHeader(headerValue, deps);
    if (!identity) {
      problemUnauthorized(res, (req as unknown as { id?: string }).id);
      return;
    }

    (req as Request & { admin?: ApiKeyAdminIdentity }).admin = identity;
    next();
  };
}
