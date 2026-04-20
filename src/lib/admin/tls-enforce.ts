/**
 * Admin TLS enforcement middleware (plan 04-01, ADMIN-01, T-04-01).
 *
 * Blocks plain-HTTP requests to `/admin/*` with RFC 7807 426 Upgrade Required
 * when MS365_MCP_REQUIRE_TLS=1. Optionally honors `X-Forwarded-Proto: https`
 * from a trusted reverse proxy when MS365_MCP_TRUST_PROXY=1.
 *
 * Design notes:
 *   - Env defaults are resolved at FACTORY-CALL time (not request time) so
 *     hot-path cost is one closure read, not a `process.env` lookup per req.
 *   - `req.headers['x-forwarded-proto']` is NEVER honored unless trustProxy
 *     is explicitly enabled. Pitfall: a middlebox outside the trusted LAN can
 *     inject this header; the env gate makes the trust boundary explicit.
 *   - Returns RFC 7807 `application/problem+json` on rejection so the admin
 *     API's error shape stays uniform (D-14).
 *
 * Tested in src/lib/admin/__tests__/router.test.ts (Tests 1-6 + env default).
 *
 * Threat refs:
 *   - T-04-01 (info disclosure via plaintext bearer/api-key): blocking plain
 *     HTTP at the router level is the mitigation.
 *   - ASVS V13 (API and Web Service Verification): session identifiers and
 *     access tokens never transmitted over plain HTTP.
 */
import type { Request, RequestHandler } from 'express';
import { problemJson } from './problem-json.js';

/**
 * Factory. `opts` overrides env defaults; omit for production bootstrap.
 *
 * @param opts.requireTls   If true (or MS365_MCP_REQUIRE_TLS=1), reject plain
 *                          HTTP with 426. Default: env-driven.
 * @param opts.trustProxy   If true (or MS365_MCP_TRUST_PROXY=1), honor
 *                          X-Forwarded-Proto: https. Default: env-driven.
 */
export function createAdminTlsEnforceMiddleware(opts?: {
  requireTls?: boolean;
  trustProxy?: boolean;
}): RequestHandler {
  // Resolve defaults at factory-call time; both are explicit opt-in.
  const requireTls = opts?.requireTls ?? process.env.MS365_MCP_REQUIRE_TLS === '1';
  const trustProxy = opts?.trustProxy ?? process.env.MS365_MCP_TRUST_PROXY === '1';

  return (req, res, next) => {
    if (!requireTls) {
      next();
      return;
    }

    const forwardedProto = (req as Request).headers['x-forwarded-proto'];
    const isHttps = req.secure || (trustProxy && forwardedProto === 'https');

    if (isHttps) {
      next();
      return;
    }

    // Express pino-http assigns req.id when logger-correlation middleware is
    // mounted; shape of req.id depends on the pino-http config. Use a defensive
    // cast so this module does not take a hard dep on the correlation type.
    const instance = (req as Request & { id?: string }).id;
    problemJson(res, 426, 'upgrade_required', {
      title: 'Upgrade Required',
      detail: 'admin API requires HTTPS',
      instance,
    });
  };
}
