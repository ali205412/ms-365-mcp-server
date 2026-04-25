/**
 * Auth selector middleware (plan 03-06, AUTH-05).
 *
 * Picks the correct identity flow per request, based on:
 *   1. Authorization: Bearer header → bearer flow (delegated to createBearerMiddleware)
 *   2. tenants.mode === 'app-only' → app-only flow (client credentials)
 *   3. /authorize or /token path → delegated OAuth flow (orchestrated by
 *      oauth-provider.ts handlers mounted at those routes — authSelector
 *      only runs on MCP-tool-dispatch paths, NOT on /authorize or /token)
 *   4. stdio transport → device-code (handled in the stdio bootstrap path,
 *      NOT this middleware)
 *
 * Chain position (after loadTenant from 03-08, before transport handler):
 *   /t/:tenantId → loadTenant → authSelector → transport (Streamable / SSE / messages)
 *
 * Why this middleware exists: keeps flow selection in one testable place.
 * OAuth endpoints (/authorize, /token) have their own handlers — authSelector
 * only runs on MCP-tool-dispatch paths (e.g., POST /t/:tenantId/mcp).
 *
 * Flow-selection matrix (D-10, PATTERNS.md Pattern 5):
 *   | Authorization: Bearer? | tenant.mode | selected flow    |
 *   | yes                    | any         | bearer           |
 *   | no                     | app-only    | app-only         |
 *   | no                     | delegated   | 401 (no prior auth) |
 *   | no                     | bearer      | 401 (bearer req'd)  |
 */
import type { Request, Response, NextFunction } from 'express';
import type { TenantRow } from './tenant/tenant-row.js';
import type { TenantPool } from './tenant/tenant-pool.js';
import { createBearerMiddleware } from './microsoft-auth.js';
import { requestContext, getRequestTokens } from '../request-context.js';
import { buildWwwAuthenticate } from './www-authenticate.js';
import logger from '../logger.js';

export interface AuthSelectorDeps {
  tenantPool: Pick<TenantPool, 'acquire' | 'buildCachePlugin'>;
}

/**
 * Shape returned by MSAL's `acquireTokenByClientCredential`. We type-assert
 * at the call site instead of importing the full MSAL types so the
 * middleware stays testable without instantiating real MSAL clients.
 */
interface AcquireByCredentialResult {
  accessToken?: string;
  expiresOn?: Date | null;
}

interface AppOnlyClient {
  acquireTokenByClientCredential: (config: {
    scopes: string[];
    skipCache?: boolean;
  }) => Promise<AcquireByCredentialResult | null>;
}

function isAppOnlyClient(client: unknown): client is AppOnlyClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    'acquireTokenByClientCredential' in client &&
    typeof (client as { acquireTokenByClientCredential: unknown })
      .acquireTokenByClientCredential === 'function'
  );
}

const DEFAULT_APP_ONLY_SCOPE = 'https://graph.microsoft.com/.default';

export function createAuthSelectorMiddleware(
  deps: AuthSelectorDeps
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const bearer = createBearerMiddleware();

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenant = (req as Request & { tenant?: TenantRow }).tenant;
    if (!tenant) {
      res.status(500).json({ error: 'loadTenant_middleware_missing' });
      return;
    }

    // 1. Bearer header wins over any tenant.mode — the bearer middleware
    //    owns its own requestContext.run and delegates to next() on match.
    const hasAuthHeader = req.headers.authorization?.startsWith('Bearer ');
    if (hasAuthHeader) {
      bearer(req, res, next);
      return;
    }

    // 2. App-only mode: acquire a client-credentials token via TenantPool +
    //    MSAL ConfidentialClientApplication.
    if (tenant.mode === 'app-only') {
      try {
        const client = await deps.tenantPool.acquire(tenant);
        if (!isAppOnlyClient(client)) {
          res.status(500).json({ error: 'app_only_requires_confidential_client' });
          return;
        }
        const scopes = tenant.allowed_scopes.length
          ? tenant.allowed_scopes
          : [DEFAULT_APP_ONLY_SCOPE];

        // Pitfall 2 mitigation (Phase 3): construct a FRESH cache plugin per
        // request tuple (tenantId, userOid='appOnly', scopes). The plugin
        // itself is not attached to the MSAL client's config at this layer
        // — TenantPool hands back a client that was built with its own
        // in-memory cache; the plugin wiring for Redis-backed partitioned
        // caches is refined in 03-07 session-store work.
        deps.tenantPool.buildCachePlugin(tenant.id, 'appOnly', scopes);

        const resp = await client.acquireTokenByClientCredential({
          scopes,
          skipCache: false,
        });
        if (!resp?.accessToken) {
          res.status(502).json({ error: 'app_only_acquire_failed' });
          return;
        }

        const existing = getRequestTokens() ?? {};
        requestContext.run(
          {
            ...existing,
            accessToken: resp.accessToken,
            flow: 'app-only',
            authClientId: tenant.client_id,
          },
          () => next()
        );
      } catch (err) {
        logger.error(
          { err: (err as Error).message, tenantId: tenant.id },
          'app-only acquire failed'
        );
        res.status(502).json({ error: 'auth_acquire_failed' });
      }
      return;
    }

    // 3. Delegated without a prior authorize+token round-trip: no token
    //    available, the MCP request is unauthenticated. The client MUST
    //    navigate /authorize + POST /token first.
    if (tenant.mode === 'delegated') {
      res
        .status(401)
        .set(
          'WWW-Authenticate',
          buildWwwAuthenticate({
            req,
            tenantId: tenant.id,
            error: 'invalid_token',
            errorDescription: 'delegated flow requires prior authorize',
          })
        )
        .json({ error: 'delegated_flow_requires_prior_authorize' });
      return;
    }

    // 4. Bearer-mode tenant without an Authorization header — refuse rather
    //    than fall through to delegated behaviour.
    res
      .status(401)
      .set(
        'WWW-Authenticate',
        buildWwwAuthenticate({
          req,
          tenantId: tenant.id,
          error: 'invalid_token',
          errorDescription: 'bearer token required',
        })
      )
      .json({ error: 'bearer_token_required' });
  };
}
