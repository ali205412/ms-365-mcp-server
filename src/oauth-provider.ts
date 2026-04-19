/**
 * MicrosoftOAuthProvider — tenant-aware OAuth proxy (plan 03-06, AUTH-01 / AUTH-06).
 *
 * Phase 3 refactor: the provider is now parameterised per tenant rather than
 * by a global `AuthManager` + `AppSecrets` singleton. `forTenant(tenant)`
 * returns a provider configured with the tenant's:
 *   - client_id
 *   - authority URL (cloud-specific, tenant-scoped)
 *   - redirect_uris sourced from `tenant.redirect_uri_allowlist` (NO hardcoded
 *     `http://localhost:3000/callback` — CONCERNS.md closure)
 *
 * Backwards compatibility: the legacy (authManager, secrets) constructor is
 * retained so stdio mode + v1 HTTP-mode clients continue to work until 03-09
 * re-mounts the OAuth routes under `/t/:tenantId/*`. New code should use
 * `MicrosoftOAuthProvider.forTenant(tenant)`.
 *
 * verifyAccessToken: decodes the `scp` claim via jose (Pitfall 9 mitigation
 * in 03-RESEARCH.md) and falls back to an empty array only on decode failure
 * with a warning log. This fixes the v1 hardcoded `scopes: []`.
 */
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { decodeJwt } from 'jose';
import logger from './logger.js';
import AuthManager from './auth.js';
import type { AppSecrets } from './secrets.js';
import { getCloudEndpoints } from './cloud-config.js';
import type { TenantRow } from './lib/tenant/tenant-row.js';

/**
 * Extract scopes from a JWT `scp` claim. Decode-only (same Pitfall 5
 * constraint as the bearer middleware). Returns `[]` on any failure with a
 * warn log so the caller can decide whether to 401 or allow the request.
 */
function extractScopesFromToken(token: string): string[] {
  try {
    const payload = decodeJwt(token);
    const scp = payload.scp;
    if (typeof scp === 'string') {
      return scp.split(/\s+/).filter(Boolean);
    }
    if (Array.isArray(scp)) {
      return scp.filter((s): s is string => typeof s === 'string');
    }
    logger.warn({}, 'oauth-provider: no scp claim in access token');
    return [];
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'oauth-provider: JWT decode failed when extracting scopes'
    );
    return [];
  }
}

type ProxyOptions = ConstructorParameters<typeof ProxyOAuthServerProvider>[0];

/**
 * Build ProxyOptions from the legacy (authManager, secrets) pair. Shared
 * helper so both the constructor and forTenant stay small.
 */
function buildLegacyProxyOptions(authManager: AuthManager, secrets: AppSecrets): ProxyOptions {
  const tenantId = secrets.tenantId || 'common';
  const clientId = secrets.clientId;
  const cloudEndpoints = getCloudEndpoints(secrets.cloudType);

  return {
    endpoints: {
      authorizationUrl: `${cloudEndpoints.authority}/${tenantId}/oauth2/v2.0/authorize`,
      tokenUrl: `${cloudEndpoints.authority}/${tenantId}/oauth2/v2.0/token`,
      revocationUrl: `${cloudEndpoints.authority}/${tenantId}/oauth2/v2.0/logout`,
    },
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      try {
        const response = await fetch(`${cloudEndpoints.graphApi}/v1.0/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const userData = (await response.json()) as { userPrincipalName?: string };
          logger.info(`OAuth token verified for user: ${userData.userPrincipalName}`);

          await authManager.setOAuthToken(token);

          return {
            token,
            clientId,
            // Pitfall 9 fix: decode the scp claim rather than hardcoding [].
            scopes: extractScopesFromToken(token),
          };
        } else {
          throw new Error(`Token verification failed: ${response.status}`);
        }
      } catch (error) {
        logger.error(`OAuth token verification error: ${error}`);
        throw error;
      }
    },
    getClient: async (client_id: string) => {
      // Phase 3 / AUTH-06: derive the callback URI from MS365_MCP_PUBLIC_URL
      // when present. Otherwise return an empty allowlist and defer to the
      // SDK's auth router + the registered client. The v1 localhost default
      // is removed here.
      const publicUrl = process.env.MS365_MCP_PUBLIC_URL?.trim();
      const derivedUris: string[] = [];
      if (publicUrl) {
        derivedUris.push(`${publicUrl.replace(/\/$/, '')}/callback`);
      }
      return {
        client_id,
        redirect_uris: derivedUris,
      };
    },
  };
}

function buildTenantProxyOptions(tenant: TenantRow): ProxyOptions {
  const cloudEndpoints = getCloudEndpoints(tenant.cloud_type);
  const azureTenant = tenant.tenant_id || 'common';
  const authority = `${cloudEndpoints.authority}/${azureTenant}`;

  return {
    endpoints: {
      authorizationUrl: `${authority}/oauth2/v2.0/authorize`,
      tokenUrl: `${authority}/oauth2/v2.0/token`,
      revocationUrl: `${authority}/oauth2/v2.0/logout`,
    },
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      // WR-08 fix: actually be decode-only as the comment says. The previous
      // implementation called fetch /me on every verification, which (a)
      // doubled per-request latency by adding a Graph round-trip on top of
      // the actual tool call, (b) failed open on transient Graph 5xx
      // because the throw 401-ed all in-flight verifications, and (c)
      // logged the userPrincipalName at info level (PII per D-01) in the
      // legacy variant. Microsoft Graph validates the signature on the
      // ACTUAL tool call (Pitfall 5 in 03-RESEARCH.md), so the /me probe
      // added no security — only latency and PII risk. We decode the scp
      // claim (Pitfall 9 fix) and trust Graph to fail the next call if the
      // signature is invalid.
      return {
        token,
        clientId: tenant.client_id,
        scopes: extractScopesFromToken(token),
      };
    },
    getClient: async (clientId: string) => {
      // Phase 3 contract: the clientId MUST match the tenant's app reg.
      if (clientId !== tenant.client_id) {
        return undefined;
      }
      return {
        client_id: tenant.client_id,
        redirect_uris: tenant.redirect_uri_allowlist,
      };
    },
  };
}

/**
 * Type guard: does the value look like a ProxyOAuthServerProvider options
 * object (i.e., has `endpoints` + `verifyAccessToken` + `getClient`)?
 * Used by the constructor to pick between the Phase-3 direct options path
 * and the v1 (authManager, secrets) path.
 */
function isProxyOptions(value: unknown): value is ProxyOptions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    'endpoints' in v &&
    typeof v.endpoints === 'object' &&
    'verifyAccessToken' in v &&
    typeof v.verifyAccessToken === 'function' &&
    'getClient' in v &&
    typeof v.getClient === 'function'
  );
}

export class MicrosoftOAuthProvider extends ProxyOAuthServerProvider {
  private authManager?: AuthManager;

  /**
   * Legacy constructor (kept for backwards compatibility with stdio + v1 HTTP
   * bootstrap). New code should prefer `MicrosoftOAuthProvider.forTenant()`.
   *
   * Overloads:
   *   - new MicrosoftOAuthProvider(authManager, secrets)  // v1 compat
   *   - new MicrosoftOAuthProvider(proxyOptions)          // Phase 3 path
   */
  constructor(authManagerOrOptions: AuthManager | ProxyOptions, secrets?: AppSecrets) {
    if (isProxyOptions(authManagerOrOptions)) {
      super(authManagerOrOptions);
      return;
    }

    if (!secrets) {
      throw new Error('MicrosoftOAuthProvider: legacy constructor requires secrets');
    }
    const authManager = authManagerOrOptions;
    super(buildLegacyProxyOptions(authManager, secrets));
    this.authManager = authManager;
  }

  /**
   * Construct a tenant-scoped provider. Reads:
   *   - `tenant.client_id` (the Entra app registration client id)
   *   - `tenant.tenant_id` (Azure AD tenant GUID for the authority URL)
   *   - `tenant.cloud_type` (global | china endpoint selector)
   *   - `tenant.redirect_uri_allowlist` (served back as `redirect_uris` in
   *     getClient — no hardcoded localhost URI anymore)
   *
   * Callers mount the returned provider via `mcpAuthRouter` on a per-tenant
   * route. A WeakMap cache at call site is safe but not required here; the
   * caller can build on demand.
   */
  static forTenant(tenant: TenantRow): MicrosoftOAuthProvider {
    return new MicrosoftOAuthProvider(buildTenantProxyOptions(tenant));
  }
}
