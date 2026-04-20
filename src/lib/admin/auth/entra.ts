/**
 * Entra admin auth middleware + helper (plan 04-04, ADMIN-04).
 *
 * Two exports:
 *   - verifyEntraAdmin(token, deps) — decode-only JWT validation → Graph
 *     /me/memberOf check → cached EntraAdminIdentity|null.
 *   - createAdminEntraMiddleware(deps) — Express middleware wrapping
 *     verifyEntraAdmin with header extraction and 401/403 status mapping.
 *
 * Design constraints (D-14 + WR-08 invariant from src/oauth-provider.ts):
 *   1. Decode-only — jose.decodeJwt parses the JWT payload WITHOUT verifying
 *      the signature. Microsoft Graph validates the signature on the actual
 *      /me/memberOf call (which uses the token as a Bearer), so the /me/memberOf
 *      probe IS the authoritative signature check. Any forged JWT that reaches
 *      us with a valid `aud` claim will fail the Graph call.
 *   2. Fail-closed on Graph outage — a 5xx response returns null (→ 403 by the
 *      middleware) rather than fail-open. This is the correct posture for an
 *      auth gate: we never grant access without a live group-membership probe.
 *   3. 5m LRU of memberOf — bounds Graph round-trips at 1 per UPN per 5
 *      minutes. Cache keys are UPNs (human-readable strings, not tokens), so
 *      the cache never holds bearer credentials in memory.
 *   4. No PII at info level — WR-08 forbids logging the full token or UPN. We
 *      log at warn with HTTP status only on Graph failure; info messages are
 *      structural and contain no user identifier.
 *
 * Cache key choice: UPN (userPrincipalName). Stable per-user, human-readable
 * for operator debugging, and the natural identity in every admin audit row.
 * Using UPN also means a token refresh for the same user hits the cache —
 * memberOf does not change on token refresh.
 *
 * Security invariant (T-04-09a): full token never appears in any logger call.
 * Test 11 in auth-entra.test.ts asserts this by grepping the captured log
 * frames for the token substring.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { decodeJwt, type JWTPayload } from 'jose';
import { LRUCache } from 'lru-cache';
import { problemUnauthorized, problemForbidden } from '../problem-json.js';
import logger from '../../../logger.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Entra configuration — admin app registration + security group.
 */
export interface EntraConfig {
  /** Admin app registration client ID — the `aud` claim we require in the JWT. */
  appClientId: string;
  /** Entra security group object ID — the group /me/memberOf must include. */
  groupId: string;
  /** Override Graph base URL (default 'https://graph.microsoft.com/v1.0') — for cloud routing + tests. */
  graphBase?: string;
}

/**
 * Identity returned by verifyEntraAdmin on a successful group check.
 *
 * `tenantScoped` is ALWAYS null for Entra admins in v2.0 — Entra group
 * membership grants global admin access. Per-tenant admin scoping is an
 * API-key-only surface (admin/api-key-ts populates tenantScoped with the
 * api_key.tenant_id).
 */
export interface EntraAdminIdentity {
  actor: string; // UPN
  source: 'entra';
  tenantScoped: null;
}

/**
 * Middleware dependency bag. Mirrors the AdminAuthDeps shape used by dual-stack
 * so the same object can be passed to all three admin auth middlewares.
 */
export interface EntraMiddlewareDeps {
  entraConfig: EntraConfig;
  fetchImpl?: typeof fetch;
}

// ── Module constants ────────────────────────────────────────────────────────

const MEMBER_OF_CACHE_MAX = 200;
const MEMBER_OF_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per CONTEXT.md D-14 recommendation
const DEFAULT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ── Cache ────────────────────────────────────────────────────────────────────

/**
 * Shared across middleware instances — scoped per-process. Keyed by UPN (NOT
 * by token, so token refresh for the same user still hits the cache).
 *
 * `let` (not `const`) so __resetEntraCacheForTesting can swap in a fresh cache
 * between tests — LRUCache does not expose a way to forcibly reset an in-flight
 * cached entry from within a test that uses vi.useFakeTimers.
 */
let memberOfCache: LRUCache<string, { memberOf: string[] }> = new LRUCache<
  string,
  { memberOf: string[] }
>({
  max: MEMBER_OF_CACHE_MAX,
  ttl: MEMBER_OF_CACHE_TTL_MS,
  updateAgeOnGet: false,
  updateAgeOnHas: false,
});

/**
 * Test-only: clear + rebuild the member-of cache. Required between tests
 * because the module is imported ONCE and Vitest reuses the instance.
 */
export function __resetEntraCacheForTesting(): void {
  memberOfCache.clear();
  memberOfCache = new LRUCache<string, { memberOf: string[] }>({
    max: MEMBER_OF_CACHE_MAX,
    ttl: MEMBER_OF_CACHE_TTL_MS,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
  });
}

/**
 * Test-only: replace the module-level cache with one using a custom TTL.
 * LRUCache captures ttl at construction and reads time via `performance.now()`
 * with 1s debouncing, which is not reliably mocked by vi.useFakeTimers. Tests
 * that need to assert TTL-expiry behaviour swap the cache with a short-TTL
 * variant and use real-time sleeps at 1/600th scale. Pass null to reset to
 * production defaults.
 */
export function __setEntraCacheTtlForTesting(ttlMs: number | null): void {
  memberOfCache.clear();
  memberOfCache = new LRUCache<string, { memberOf: string[] }>({
    max: MEMBER_OF_CACHE_MAX,
    ttl: ttlMs ?? MEMBER_OF_CACHE_TTL_MS,
    updateAgeOnGet: false,
    updateAgeOnHas: false,
  });
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Extract a UPN from the decoded JWT payload. Falls back to preferred_username
 * (Entra emits this when `upn` is unavailable, e.g., personal MSA accounts).
 */
function extractUpn(payload: JWTPayload): string | undefined {
  if (typeof payload.upn === 'string' && payload.upn.length > 0) return payload.upn;
  if (
    typeof payload.preferred_username === 'string' &&
    (payload.preferred_username as string).length > 0
  ) {
    return payload.preferred_username as string;
  }
  return undefined;
}

/**
 * Truncate a UPN for logging. `alice@contoso.com` → `ali***`. Leaks first-3
 * chars only for forensic triage (WR-08 invariant: never log full UPN at info).
 */
function truncateUpnForLog(upn: string): string {
  return `${upn.slice(0, 3)}***`;
}

// ── verifyEntraAdmin ────────────────────────────────────────────────────────

/**
 * Verify an Entra admin token and return the admin identity, or null if the
 * token is invalid / the user is not a member of the admin group.
 *
 * Flow:
 *   1. Decode-only JWT parse (jose.decodeJwt throws on malformed → null).
 *   2. UPN extraction (upn || preferred_username; absent → null).
 *   3. aud fast-fail (payload.aud !== config.appClientId → null, no Graph call).
 *   4. LRU cache lookup by UPN. Hit → check groupId presence, return identity.
 *   5. Miss → Graph /me/memberOf fetch (Bearer = the token itself; this is
 *      the authoritative signature check per WR-08).
 *   6. On fetch failure (network, 401, 5xx) → null (fail-closed), logger.warn.
 *   7. On success → cache the group ID array, return identity if member.
 *
 * Never throws — all errors log at info/warn and return null so the caller
 * (the middleware) can translate to 401/403 uniformly.
 */
export async function verifyEntraAdmin(
  token: string,
  deps: EntraMiddlewareDeps
): Promise<EntraAdminIdentity | null> {
  // 1. Decode-only JWT parse
  let payload: JWTPayload;
  try {
    payload = decodeJwt(token);
  } catch (err) {
    logger.info({ err: (err as Error).message }, 'admin-entra: jwt decode failed');
    return null;
  }

  // 2. UPN extraction
  const upn = extractUpn(payload);
  if (!upn) {
    logger.info({}, 'admin-entra: token missing upn/preferred_username');
    return null;
  }

  // 3. aud fast-fail. Forged tokens with attacker-crafted `aud` bail here
  // without a Graph round-trip, shedding load and denying side-channel info.
  if (payload.aud !== deps.entraConfig.appClientId) {
    logger.info({ adminActor: truncateUpnForLog(upn) }, 'admin-entra: aud mismatch');
    return null;
  }

  // 4. LRU cache lookup
  const cached = memberOfCache.get(upn);
  if (cached) {
    if (!cached.memberOf.includes(deps.entraConfig.groupId)) {
      return null;
    }
    return { actor: upn, source: 'entra', tenantScoped: null };
  }

  // 5. Graph /me/memberOf fetch
  const graphBase = deps.entraConfig.graphBase ?? DEFAULT_GRAPH_BASE;
  const fetchImpl = deps.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = (await fetchImpl(`${graphBase}/me/memberOf`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })) as unknown as Response;
  } catch (err) {
    // Network failure — fail-closed.
    logger.warn(
      { err: (err as Error).message, adminActor: truncateUpnForLog(upn) },
      'admin-entra: graph_memberOf_network_failure'
    );
    return null;
  }

  if (!response.ok) {
    logger.warn(
      { status: response.status, adminActor: truncateUpnForLog(upn) },
      'admin-entra: graph_memberOf_failed'
    );
    return null;
  }

  // 6. Parse response + cache
  let body: { value?: Array<{ id?: string }> };
  try {
    body = (await response.json()) as { value?: Array<{ id?: string }> };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, adminActor: truncateUpnForLog(upn) },
      'admin-entra: graph_memberOf_parse_failure'
    );
    return null;
  }

  const memberOf = (body.value ?? [])
    .map((g) => g.id)
    .filter((s): s is string => typeof s === 'string');

  memberOfCache.set(upn, { memberOf });

  // 7. Group-membership check
  if (!memberOf.includes(deps.entraConfig.groupId)) {
    return null;
  }

  return { actor: upn, source: 'entra', tenantScoped: null };
}

// ── createAdminEntraMiddleware ──────────────────────────────────────────────

/**
 * Express middleware wrapping verifyEntraAdmin.
 *
 * Behaviour matrix:
 *   - No `Authorization: Bearer` header → next() (chain to api-key middleware)
 *   - Bearer with malformed JWT → 401 problem+json (identity invalid)
 *   - Bearer with missing upn → 401 problem+json
 *   - Bearer with wrong aud → 401 problem+json (token is not for US)
 *   - Bearer, token OK, group-member → req.admin populated + next()
 *   - Bearer, token OK, NOT group-member → 403 problem+json (identity valid,
 *     authorization missing)
 *   - Graph fetch failure → 403 problem+json (fail-closed on infrastructure)
 *
 * The 401 vs 403 distinction matters: 401 means "retry with different creds"
 * and 403 means "this identity simply isn't authorised". Matches RFC 7235 +
 * RFC 7231 semantics and the dual-stack plan's D-14 specification.
 */
export function createAdminEntraMiddleware(deps: EntraMiddlewareDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authz = req.headers.authorization;
    if (!authz?.startsWith('Bearer ')) {
      // No Bearer — not our strategy. Chain to the next middleware (api-key).
      next();
      return;
    }

    const token = authz.substring(7);
    const instance = (req as unknown as { id?: string }).id;

    // Pre-flight validation (decode + upn + aud) so we can distinguish 401
    // (invalid identity) from 403 (valid identity but not a group member).
    let payload: JWTPayload;
    try {
      payload = decodeJwt(token);
    } catch {
      problemUnauthorized(res, instance);
      return;
    }

    const upn = extractUpn(payload);
    const audOk = payload.aud === deps.entraConfig.appClientId;
    if (!upn || !audOk) {
      problemUnauthorized(res, instance);
      return;
    }

    // Identity is structurally valid; now check group membership.
    const identity = await verifyEntraAdmin(token, deps);
    if (!identity) {
      // Either the user is not a group member OR the Graph probe failed.
      // Both map to 403 — identity is valid, authorisation is missing.
      problemForbidden(res, instance);
      return;
    }

    (req as Request & { admin?: EntraAdminIdentity }).admin = identity;
    next();
  };
}
