/**
 * Microsoft auth middleware + helpers (plan 03-06 + 03-07, AUTH-03, SECUR-02).
 *
 * Plan 03-07 DELETED the v1 refresh-token custom header read path entirely.
 * Refresh tokens now live in src/lib/session-store.ts (opaque server-side,
 * envelope-encrypted in Redis per-tenant). The deprecated legacy bearer
 * middleware that read the refresh-token from a custom HTTP header is gone.
 *
 * Graph 401 refresh path (src/graph-client.ts) consults SessionStore using
 * sha256(accessToken) to look up the refresh token — no custom header ever
 * reaches a middleware or handler.
 *
 * Breaking change for v1 HTTP-mode users: see docs/migration-v1-to-v2.md.
 *
 * Remaining surface:
 *   - createBearerMiddleware (03-06): decode-only JWT tid-routing middleware
 *   - exchangeCodeForToken: POST to Microsoft's /token endpoint (used by the
 *     stdio-mode OAuth callback and legacy /auth/callback handler)
 *   - refreshAccessToken: POST grant_type=refresh_token (kept for stdio-mode
 *     AuthManager fallback; HTTP-mode uses MSAL.acquireTokenByRefreshToken
 *     via the pool + session store)
 */
import { Request, Response, NextFunction } from 'express';
import { decodeJwt } from 'jose';
import logger from '../logger.js';
import { getCloudEndpoints, type CloudType } from '../cloud-config.js';
import { requestContext, getRequestTokens } from '../request-context.js';

/**
 * Decode-only bearer middleware (plan 03-06, AUTH-03, D-13).
 *
 * DECODE ONLY. The middleware calls `jose.decodeJwt` which parses the JWT
 * payload WITHOUT verifying the signature. Do NOT derive authorization
 * decisions from the decoded claims beyond routing on `tid` (Pitfall 5 in
 * 03-RESEARCH.md). Microsoft Graph validates the signature on every call —
 * we only need the `tid` claim to route the request to the correct tenant.
 * Anything beyond tid routing (reading scp, roles, sub, etc.) opens a
 * forgery-vulnerability door because the signature is not checked here.
 *
 * On match (tid === URL tenantId): sets requestContext.accessToken = raw token,
 * flow = 'bearer'. Graph-calling code reads accessToken from requestContext
 * and forwards it to Graph as-is (no MSAL acquire; bearer is pass-through).
 *
 * On mismatch: 401 tenant_mismatch.
 * On missing tid: 401 invalid_token / missing_tid_claim.
 * On malformed JWT: 401 invalid_token.
 * On missing Authorization header: calls next() without populating anything
 *   (pass-through to the next auth strategy, e.g., app-only selector).
 * On bearer without URL tenantId: 400 bearer_requires_tenant_context.
 */
export function createBearerMiddleware(): (
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      next();
      return;
    }
    const token = authHeader.substring(7);

    let tid: string;
    try {
      const payload = decodeJwt(token);
      if (typeof payload.tid !== 'string') {
        res.status(401).json({ error: 'invalid_token', detail: 'missing_tid_claim' });
        return;
      }
      tid = payload.tid;
    } catch (err) {
      logger.info({ err: (err as Error).message }, 'bearer: JWT decode failed');
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    const urlTenantId = req.params?.tenantId;
    if (!urlTenantId) {
      // Bearer flows in Phase 3 are always per-tenant — refuse a bearer
      // request that arrived outside a tenant-scoped route.
      res.status(400).json({ error: 'bearer_requires_tenant_context' });
      return;
    }
    if (tid.toLowerCase() !== urlTenantId.toLowerCase()) {
      res.status(401).json({
        error: 'tenant_mismatch',
        detail: 'JWT tid does not match URL tenantId',
      });
      return;
    }

    const existing = getRequestTokens() ?? {};
    requestContext.run(
      {
        ...existing,
        accessToken: token,
        flow: 'bearer',
        authClientId: undefined,
      },
      () => next()
    );
  };
}

/**
 * Exchange authorization code for access token.
 *
 * Kept for the stdio-mode OAuth callback + legacy /auth/callback handler
 * (v1 compatibility). HTTP-mode /token now goes through
 * createTenantTokenHandler → tenantPool.acquire → MSAL.acquireTokenByCode
 * (two-leg PKCE), not this helper.
 */
export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string | undefined,
  tenantId: string = 'common',
  codeVerifier?: string,
  cloudType: CloudType = 'global'
): Promise<{
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token: string;
}> {
  const cloudEndpoints = getCloudEndpoints(cloudType);
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
  });

  // Add client_secret for confidential clients
  if (clientSecret) {
    params.append('client_secret', clientSecret);
  }

  // Add code_verifier for PKCE flow
  if (codeVerifier) {
    params.append('code_verifier', codeVerifier);
  }

  const response = await fetch(`${cloudEndpoints.authority}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error(`Failed to exchange code for token: ${error}`);
    throw new Error(`Failed to exchange code for token: ${error}`);
  }

  return response.json();
}

/**
 * Refresh an access token via the Microsoft /token endpoint. Retained for
 * stdio-mode compatibility only. HTTP-mode refreshes flow through
 * MSAL.acquireTokenByRefreshToken via the TenantPool + SessionStore (see
 * src/graph-client.ts refreshSessionAndRetry).
 */
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string | undefined,
  tenantId: string = 'common',
  cloudType: CloudType = 'global'
): Promise<{
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const cloudEndpoints = getCloudEndpoints(cloudType);
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });

  if (clientSecret) {
    params.append('client_secret', clientSecret);
  }

  const response = await fetch(`${cloudEndpoints.authority}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error(`Failed to refresh token: ${error}`);
    throw new Error(`Failed to refresh token: ${error}`);
  }

  return response.json();
}
