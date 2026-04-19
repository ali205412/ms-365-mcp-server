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
 * @deprecated — replaced by `createBearerMiddleware` (AUTH-03, plan 03-06).
 * This export is retained temporarily so 03-07 can delete it in one commit
 * along with the refresh-token-header migration (SECUR-02). Use
 * `createBearerMiddleware()` in new code.
 *
 * Microsoft Bearer Token Auth Middleware validates that the request has a
 * valid Microsoft access token. The token is passed in the Authorization
 * header as a Bearer token.
 */
export const microsoftBearerTokenAuthMiddleware = (
  req: Request & { microsoftAuth?: { accessToken: string; refreshToken: string } },
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid access token' });
    return;
  }

  const accessToken = authHeader.substring(7);

  // For Microsoft Graph, we don't validate the token here - we'll let the API calls fail if it's invalid
  // and handle token refresh in the GraphClient

  // Extract refresh token from a custom header (if provided)
  const refreshToken = (req.headers['x-microsoft-refresh-token'] as string) || '';

  // Store tokens in request for later use
  req.microsoftAuth = {
    accessToken,
    refreshToken,
  };

  next();
};

/**
 * Exchange authorization code for access token
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
 * Refresh an access token
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
