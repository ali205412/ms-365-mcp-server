/**
 * Bearer auth middleware for the Prometheus /metrics endpoint
 * (plan 06-03, D-02 — OPS-07).
 *
 * Per CONTEXT.md §D-02:
 *   - `MS365_MCP_METRICS_BEARER` env var drives the gate.
 *   - When `bearerToken` is `null`, `undefined`, or `''` (empty string), the
 *     endpoint is OPEN — localhost / reverse-proxy trust is assumed.
 *   - When set, callers must send `Authorization: Bearer {token}`.
 *   - Comparison is constant-time via `crypto.timingSafeEqual` to prevent
 *     timing-oracle attacks (T-06-03-a).
 *   - 401 responses carry `WWW-Authenticate: Bearer` per RFC 6750 §3.
 *
 * Threat dispositions (from 06-03-PLAN.md <threat_model>):
 *   - T-06-03-a (timing-oracle on token compare): mitigate — timingSafeEqual
 *     with length short-circuit. The length check itself leaks token LENGTH
 *     but not the token BYTES — operators deploying a 32-byte token accept
 *     that tradeoff.
 *   - T-06-03-b (open endpoint by default): accept — operator decision,
 *     documented in `.env.example` and `docs/observability/env-vars.md`
 *     (landed in plan 06-01).
 */
import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Create the Bearer-auth middleware.
 *
 * @param bearerToken - When `null`, `undefined`, or empty string the endpoint
 *   is OPEN (dev / localhost / reverse-proxy-trust deployments). When a
 *   non-empty string, every request must send `Authorization: Bearer {token}`.
 * @returns Express RequestHandler that either short-circuits with 401 or
 *   invokes `next()`.
 */
export function createBearerAuthMiddleware(
  bearerToken: string | null | undefined
): RequestHandler {
  const gateActive = typeof bearerToken === 'string' && bearerToken.length > 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!gateActive) {
      next();
      return;
    }
    // Node http normalizes header names to lowercase before Express sees them,
    // so this check covers both `Authorization` and `authorization` header casings.
    const hdr = req.headers.authorization;
    if (!hdr || !hdr.startsWith('Bearer ')) {
      res.set('WWW-Authenticate', 'Bearer').status(401).end();
      return;
    }
    const supplied = hdr.slice('Bearer '.length).trim();
    if (!timingSafeCompare(supplied, bearerToken as string)) {
      res.set('WWW-Authenticate', 'Bearer').status(401).end();
      return;
    }
    next();
  };
}

/**
 * Constant-time string compare. Prevents length-oracle timing leaks by
 * short-circuiting on length mismatch BEFORE calling `timingSafeEqual`
 * (which throws on unequal buffer lengths — `RangeError [ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH]`).
 *
 * The length short-circuit itself leaks the token LENGTH via early return,
 * but not the token BYTES. Operators deploying a 32-byte token accept this
 * tradeoff because the alternative (crashing on every wrong-length attempt)
 * is strictly worse UX and still leaks the length through 500-vs-401 stats.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
