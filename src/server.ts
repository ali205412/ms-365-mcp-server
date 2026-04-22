import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import express, { type Request, type Response, type RequestHandler } from 'express';
import logger, { enableConsoleLogging, rawPinoLogger } from './logger.js';
import { registerAuthTools } from './auth-tools.js';
import { registerGraphTools, registerDiscoveryTools } from './graph-tools.js';
import { buildMcpServerInstructions } from './mcp-instructions.js';
import GraphClient from './graph-client.js';
import AuthManager, { buildScopesFromEndpoints } from './auth.js';
import { MicrosoftOAuthProvider } from './oauth-provider.js';
import { exchangeCodeForToken, refreshAccessToken } from './lib/microsoft-auth.js';
import { decodeJwt } from 'jose';
import type { CommandOptions } from './cli.ts';
import { getSecrets, type AppSecrets } from './secrets.js';
import { getCloudEndpoints } from './cloud-config.js';
import { requestContext, getRequestTokens } from './request-context.js';
import { mountHealth, type ReadinessCheck } from './lib/health.js';
import { registerShutdownHooks } from './lib/shutdown.js';
import { validateRedirectUri, type RedirectUriPolicy } from './lib/redirect-uri.js';
import { createCorsMiddleware, type CorsMode } from './lib/cors.js';
import type { CloudType } from './cloud-config.js';
import type { PkceStore } from './lib/pkce-store/pkce-store.js';
import { MemoryPkceStore } from './lib/pkce-store/memory-store.js';
import type { TenantRow } from './lib/tenant/tenant-row.js';
import type { TenantPool } from './lib/tenant/tenant-pool.js';
import { createStreamableHttpHandler } from './lib/transports/streamable-http.js';
import {
  createLegacySseGetHandler,
  createLegacySsePostHandler,
} from './lib/transports/legacy-sse.js';
import { createAuthSelectorMiddleware } from './lib/auth-selector.js';
import {
  createToolsListFilterMiddleware,
  wrapToolsListHandler,
} from './lib/tool-selection/tools-list-filter.js';
import crypto from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { nanoid } from 'nanoid';

/**
 * Sentinel tenantId for the LEGACY single-tenant /authorize + /token mounts
 * that exist alongside the per-tenant /t/:tenantId/* routes (03-08).
 *
 * The legacy mounts predate URL-path routing and read tenant config from
 * `secrets.tenantId` (i.e., MS365_MCP_TENANT_ID env var). Their PKCE keys
 * still need a tenant segment to match the PkceStore contract — using a
 * single well-known sentinel gives them a stable, non-colliding key.
 *
 * This is NOT the per-tenant path — that lives in createAuthorizeHandler +
 * createTenantTokenHandler, which read `req.params.tenantId` from the
 * /t/:tenantId/* router. 03-09 consolidates the two by removing the
 * legacy mount entirely; at that point this sentinel disappears.
 */
const LEGACY_SINGLE_TENANT_KEY = '_';

/**
 * Parse HTTP option into host and port components.
 * Supports formats: "host:port", ":port", "port"
 * @param httpOption - The HTTP option value (string or boolean)
 * @returns Object with host (undefined if not specified) and port number
 */
export function parseHttpOption(httpOption: string | boolean): {
  host: string | undefined;
  port: number;
} {
  if (typeof httpOption === 'boolean') {
    return { host: undefined, port: 3000 };
  }

  const httpString = httpOption.trim();

  // Check if it contains a colon (host:port format)
  if (httpString.includes(':')) {
    const [hostPart, portPart] = httpString.split(':');
    const host = hostPart || undefined; // Empty string becomes undefined
    const port = parseInt(portPart) || 3000;
    return { host, port };
  }

  // No colon, treat as port only
  const port = parseInt(httpString) || 3000;
  return { host: undefined, port };
}

/**
 * Build the dynamic-client-registration (POST /register) handler.
 *
 * Plan 01-06 (AUTH-06 + AUTH-07 + T-01-06c) hardens three behaviours at the
 * same code site:
 *
 *   1. Every `redirect_uris` entry is validated against the D-02 allowlist
 *      (see src/lib/redirect-uri.ts). The first failure short-circuits a 400
 *      response that echoes back the rejected URI + validator reason so the
 *      caller can fix configuration.
 *   2. `client_id` is generated via `crypto.randomBytes(8).toString('hex')`
 *      (16 hex chars, 64 bits of entropy). This replaces the v1
 *      `mcp-client-${Date.now()}` pattern which collided under concurrent
 *      registrations and created a cache-pollution vector.
 *   3. The info-level log records ONLY counts and shape (`client_name`,
 *      `grant_types`, `redirect_uri_count`) — never the raw body. This
 *      prevents PII leakage (T-01-06c).
 *
 * Exported so plan 01-06 tests can wire the handler onto a minimal
 * test-harness Express app without bootstrapping MicrosoftGraphServer.
 */
export function createRegisterHandler(policy: RedirectUriPolicy) {
  return async (req: import('express').Request, res: import('express').Response): Promise<void> => {
    const body = (req.body as Record<string, unknown>) ?? {};

    // 1. Scrubbed info log — NO body contents. Pino-native arg order: (meta, message).
    logger.info(
      {
        client_name: body.client_name,
        grant_types: body.grant_types,
        redirect_uri_count: Array.isArray(body.redirect_uris) ? body.redirect_uris.length : 0,
      },
      'Client registration request'
    );

    // 2. Validate every redirect_uri in the registration request.
    const redirectUris: unknown[] = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    for (const uri of redirectUris) {
      if (typeof uri !== 'string') {
        res.status(400).json({
          error: 'invalid_redirect_uri',
          reason: 'redirect_uris must be strings',
        });
        return;
      }
      const result = validateRedirectUri(uri, policy);
      if (!result.ok) {
        res.status(400).json({
          error: 'invalid_redirect_uri',
          redirect_uri: uri,
          reason: result.reason,
        });
        return;
      }
    }

    // 3. Crypto-random client ID (replaces Date.now — no concurrent collisions).
    const clientId = `mcp-client-${crypto.randomBytes(8).toString('hex')}`;

    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      grant_types: body.grant_types || ['authorization_code', 'refresh_token'],
      response_types: body.response_types || ['code'],
      token_endpoint_auth_method: body.token_endpoint_auth_method || 'none',
      client_name: body.client_name || 'MCP Client',
    });
  };
}

/**
 * Secrets slice the /token handler needs. Decoupled from the full
 * `AppSecrets` interface so tests can inject a minimal stub without
 * bootstrapping the secrets provider.
 */
export interface TokenHandlerSecrets {
  clientId: string;
  clientSecret?: string;
  tenantId?: string;
  cloudType: CloudType;
}

/**
 * /token handler config (plan 03-03).
 *
 * The `pkceStore` dep is the PkceStore interface from
 * src/lib/pkce-store/pkce-store.ts — RedisPkceStore in HTTP mode, or
 * MemoryPkceStore in stdio / tests. The v1 in-memory lookup map was
 * removed along with its O(N) find scan at /token: we now compute
 * sha256(client_verifier) and issue a single takeByChallenge() call.
 */
export interface TokenHandlerConfig {
  secrets: TokenHandlerSecrets;
  pkceStore: PkceStore;
}

/**
 * Build the token-exchange (POST /token) handler.
 *
 * Plan 01-07 (SECUR-05 + T-01-07) scrubs three log sites that leaked
 * request body in v1:
 *
 *   Site A — entry info log at "/token called": pino-native meta-first
 *     arg order; only `method`, `url`, `contentType`, `grant_type`
 *     values appear in the record. `body` is never attached.
 *   Site B — grant_type-missing error: meta carries ONLY the non-
 *     sensitive shape (`grant_type`, `has_code`, `has_refresh_token`).
 *     The raw body is never spread. Defense-in-depth: pino's
 *     `redact.paths` (plan 01-02) would catch a regression, but the
 *     invariant is maintained at the call site first.
 *   Site C — catch-block: stringify `error.message` and optional `code`
 *     only. Never spread the raw Error into the log meta — fetch
 *     failure wrappers carry `.response.body` which would leak.
 *
 * Exported so tests can mount the handler on a minimal Express app
 * without bootstrapping MicrosoftGraphServer / MSAL / secrets.
 */
export function createTokenHandler(config: TokenHandlerConfig) {
  const { secrets, pkceStore } = config;

  return async (req: Request, res: Response): Promise<void> => {
    try {
      // Site A — pino-native order (meta, message). `body` NEVER goes in
      // the meta object; only the three request-shape fields + the
      // caller-advertised grant_type land in the log record. If the
      // request arrives without a body, grant_type is reported as
      // `undefined` — the grant_type-missing branch below then logs the
      // authoritative [MISSING] marker.
      logger.info(
        {
          method: req.method,
          url: req.url,
          contentType: req.get('Content-Type'),
          grant_type: (req.body as Record<string, unknown> | undefined)?.grant_type,
        },
        'Token endpoint called'
      );

      const body = req.body as Record<string, unknown> | undefined;

      if (!body) {
        // No body: log only the empty-body sentinel. Nothing sensitive
        // exists to log in this branch; kept as a separate site so the
        // shape stays explicit.
        logger.error({}, 'Token endpoint: Request body is undefined');
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Request body is required',
        });
        return;
      }

      if (!body.grant_type) {
        // Site B — redacted meta. Emits only shape booleans + the
        // grant_type value (which is the MISSING marker here). The raw
        // `body` reference is explicitly NEVER attached — tests enforce
        // this invariant at the logger mock call level.
        logger.error(
          {
            grant_type: '[MISSING]',
            has_code: Boolean(body.code),
            has_refresh_token: Boolean(body.refresh_token),
            has_client_secret: Boolean(body.client_secret),
          },
          'Token endpoint: grant_type is missing'
        );
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'grant_type parameter is required',
        });
        return;
      }

      if (body.grant_type === 'authorization_code') {
        const tenantId = secrets.tenantId || 'common';
        const clientId = secrets.clientId;
        const clientSecret = secrets.clientSecret;

        // Shape-only info log — `has_code` / `has_code_verifier` are
        // booleans, `redirect_uri` is advertised publicly in OAuth
        // metadata (no secret), clientId is non-secret, tenantId is
        // non-secret. We intentionally do NOT log the raw code or
        // code_verifier values.
        logger.info(
          {
            redirect_uri: body.redirect_uri,
            has_code: Boolean(body.code),
            has_code_verifier: Boolean(body.code_verifier),
            clientId,
            tenantId,
            hasClientSecret: Boolean(clientSecret),
          },
          'Token endpoint: authorization_code exchange'
        );

        // Two-leg PKCE (plan 03-03, SECUR-03):
        // Hash the client's verifier once to obtain the clientCodeChallenge,
        // then issue a single `takeByChallenge` against the PkceStore. This
        // is an O(1) lookup + atomic delete through the store's backing
        // Redis (or an in-memory Map in stdio mode). Replaces the v1 O(N)
        // scan over the old in-memory store + per-entry SHA-256 comparison.
        //
        // The atomic read-and-delete protects against T-03-03-01 (replay):
        // two concurrent /token calls with the same verifier → exactly one
        // succeeds, the other gets null.
        let serverCodeVerifier: string | undefined;
        if (body.code_verifier) {
          const clientVerifier = body.code_verifier as string;
          const clientChallengeComputed = crypto
            .createHash('sha256')
            .update(clientVerifier)
            .digest('base64url');

          const pkceEntry = await pkceStore.takeByChallenge(
            LEGACY_SINGLE_TENANT_KEY, // legacy /token mount — 03-09 retires this path
            clientChallengeComputed
          );
          if (pkceEntry) {
            serverCodeVerifier = pkceEntry.serverCodeVerifier;
            logger.info(
              { state: pkceEntry.state.substring(0, 8) + '...' },
              'Two-leg PKCE: matched client verifier, using server verifier'
            );
          }
        }

        const result = await exchangeCodeForToken(
          body.code as string,
          body.redirect_uri as string,
          clientId,
          clientSecret,
          tenantId,
          serverCodeVerifier || (body.code_verifier as string | undefined),
          secrets.cloudType
        );
        res.json(result);
      } else if (body.grant_type === 'refresh_token') {
        // WR-01 fix: the legacy /token refresh_token branch accepted a
        // refresh token from the request body, which violated the SECUR-02
        // invariant that "refresh tokens NEVER cross the client boundary
        // in v2" (the Phase 3 SessionStore wraps refresh tokens server-side
        // keyed by sha256(accessToken); the Graph 401 path consults the
        // store rather than reading any client-supplied token).
        //
        // Plan 03-09 retires the entire legacy mount; in the meantime
        // operators on a v1-style HTTP deployment that still posts to
        // /token (not /t/:tenantId/token) need a clear migration error
        // rather than a working stale-trust path. Opt-in flag preserved
        // for narrow migration windows.
        if (process.env.MS365_MCP_LEGACY_OAUTH_REFRESH === '1') {
          const tenantId = secrets.tenantId || 'common';
          const clientId = secrets.clientId;
          const clientSecret = secrets.clientSecret;

          if (clientSecret) {
            logger.warn(
              {},
              'Legacy /token refresh: confidential client with client_secret (MS365_MCP_LEGACY_OAUTH_REFRESH=1 opt-in; refresh-token-from-body crosses trust boundary)'
            );
          } else {
            logger.warn(
              {},
              'Legacy /token refresh: public client without client_secret (MS365_MCP_LEGACY_OAUTH_REFRESH=1 opt-in; refresh-token-from-body crosses trust boundary)'
            );
          }

          const result = await refreshAccessToken(
            body.refresh_token as string,
            clientId,
            clientSecret,
            tenantId,
            secrets.cloudType
          );
          res.json(result);
        } else {
          res.status(400).json({
            error: 'unsupported_grant_type',
            error_description:
              'refresh_token grant retired on the legacy /token mount in v2. ' +
              'Use /t/:tenantId/token and rely on the server-side SessionStore ' +
              '(refresh tokens never cross the client trust boundary in v2). ' +
              'For narrow migration windows, opt back in with MS365_MCP_LEGACY_OAUTH_REFRESH=1.',
          });
        }
      } else {
        res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: `Grant type '${body.grant_type}' is not supported`,
        });
      }
    } catch (error) {
      // Site C — stringify the error message only. Never spread the raw
      // Error (fetch-failure wrappers carry `.response.body` which would
      // leak refresh tokens / codes into the log record). The optional
      // `code` field is useful for filtering without being sensitive.
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          code: (error as { code?: string } | undefined)?.code,
        },
        'Token endpoint error'
      );
      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error during token exchange',
      });
    }
  };
}

// ── Phase 3 plan 03-06 + 03-08: per-tenant /authorize + /token handlers ────
//
// These handlers run under the /t/:tenantId/* router (plan 03-08). The
// `loadTenant` middleware (src/lib/tenant/load-tenant.ts) populates
// `req.tenant` from the Postgres `tenants` table via a bounded LRU cache.
// `req.params.tenantId` carries the GUID from the URL path and becomes the
// PKCE Redis key segment — cross-tenant replay is impossible because every
// PkceStore lookup is keyed on this tenant id.

/**
 * Config for the Phase 3 /authorize handler. Reads the PKCE store interface
 * from 03-03 and pins tenant state via `req.tenant` (loaded by the real
 * `loadTenant` middleware shipped in 03-08).
 *
 * Plan 03-10 (TENANT-06) addition:
 *   - `pgPool` optional — when present, every /authorize completion (success
 *     OR failure) emits an audit_log row via writeAuditStandalone.
 *     Fire-and-forget so the OAuth response is never delayed.
 */
export interface AuthorizeHandlerConfig {
  pkceStore: PkceStore;
  pgPool?: import('pg').Pool;
}

/**
 * Config for the Phase 3 /token handler. `tenantPool.acquire(tenant)` returns
 * an MSAL client (ConfidentialClientApplication for delegated+secret or
 * app-only, PublicClientApplication otherwise) — the delegated path uses
 * `acquireTokenByCode` with the server-side PKCE verifier.
 *
 * Plan 03-07 (SECUR-02) additions:
 *   - `tenantPool.getDekForTenant` unwraps the per-tenant DEK (cached after
 *     `acquire`) so the /token handler can instantiate a SessionStore without
 *     re-running the envelope unwrap.
 *   - `redis` injected separately to decouple SessionStore construction from
 *     the TenantPool's internal Redis reference (tests supply their own).
 *
 * Plan 03-10 (TENANT-06) addition:
 *   - `pgPool` optional — /token completion emits audit_log rows for success
 *     and every distinct failure mode (invalid_request, invalid_grant, etc).
 */
export interface TenantTokenHandlerConfig {
  pkceStore: PkceStore;
  tenantPool: Pick<TenantPool, 'acquire' | 'getDekForTenant'>;
  redis: import('./lib/redis.js').RedisClient;
  pgPool?: import('pg').Pool;
}

/**
 * /authorize handler (tenant-aware per plan 03-06).
 *
 * 1. Validates `redirect_uri` against `tenant.redirect_uri_allowlist`. If the
 *    URI is not present, 400 `invalid_redirect_uri`. The allowlist is also
 *    filtered through Phase 1's `validateRedirectUri` (scheme gate — rejects
 *    `javascript:`, `data:`, etc.).
 * 2. Validates the client-supplied `code_challenge` format (base64url,
 *    43-128 chars — matches RFC 7636 + mitigates T-03-03-05 Redis glob
 *    injection).
 * 3. Generates a server-side PKCE verifier and persists
 *    `{state, clientCodeChallenge, serverCodeVerifier, ...}` via
 *    `pkceStore.put(tenantId, entry)`. The server computes its own
 *    `code_challenge` (sha256 of the server verifier) and forwards that to
 *    Microsoft — two-leg PKCE.
 * 4. Redirects to the tenant's authority `/oauth2/v2.0/authorize` endpoint
 *    (selected by `tenant.cloud_type`).
 */

/**
 * WR-06 fix: canonical comparator for redirect URI allowlist membership.
 *
 * Strips trailing slashes, lowercases scheme + host (per RFC 3986 — only
 * those segments are case-insensitive), and normalises the path via the
 * URL constructor. Both sides of the includes() check go through this
 * helper so a tenant row carrying `https://app.example.com/callback`
 * matches a request bearing `https://app.example.com/callback/`,
 * `HTTPS://APP.EXAMPLE.COM/callback`, or
 * `https://APP.example.com:443/callback`.
 *
 * Falls back to the literal string when the input cannot be parsed as a
 * URL — the allowlist still rejects it via the normal includes() miss
 * (a malformed URI cannot match a well-formed allowlist entry).
 */
function normalizeRedirectUri(u: string): string {
  try {
    const parsed = new URL(u);
    // .href already lowercases scheme + host. Strip a single trailing
    // slash from the path so /callback and /callback/ collapse.
    return parsed.href.replace(/\/$/, '');
  } catch {
    return u;
  }
}

export function createAuthorizeHandler(config: AuthorizeHandlerConfig) {
  const { pkceStore, pgPool } = config;

  // Plan 03-10 helper: fire-and-forget audit write. Never delays OAuth
  // response. writeAuditStandalone internally catches DB errors and emits
  // a pino shadow log (audit_shadow:true) so the trail is never dropped.
  const emitAudit = (
    tenantId: string,
    result: 'success' | 'failure',
    redirectUri: string,
    meta: Record<string, unknown>,
    req: Request
  ): void => {
    if (!pgPool) return;
    void (async () => {
      const { writeAuditStandalone } = await import('./lib/audit.js');
      const reqId =
        (req as Request & { id?: string }).id ?? getRequestTokens()?.requestId ?? 'no-req-id';
      await writeAuditStandalone(pgPool, {
        tenantId,
        actor: 'unauthenticated',
        action: 'oauth.authorize',
        target: redirectUri || null,
        ip: req.ip ?? null,
        requestId: reqId,
        result,
        meta,
      });
    })();
  };

  return async (req: Request, res: Response): Promise<void> => {
    const tenant = (req as Request & { tenant?: TenantRow }).tenant;
    if (!tenant) {
      res.status(500).json({ error: 'loadTenant_missing' });
      return;
    }

    const redirectUri = String(req.query.redirect_uri ?? '');
    // Two-layer allowlist check (AUTH-06 layered defence):
    //   a) Phase 1 scheme validator — rejects javascript:, data:, file:, ...
    const schemeCheck = validateRedirectUri(redirectUri, { mode: 'prod', publicUrlHost: null });
    if (!schemeCheck.ok) {
      emitAudit(
        tenant.id,
        'failure',
        redirectUri,
        { error: 'invalid_redirect_uri', reason: schemeCheck.reason },
        req
      );
      res.status(400).json({ error: 'invalid_redirect_uri', reason: schemeCheck.reason });
      return;
    }
    //   b) Tenant-scoped allowlist membership — normalised exact match.
    //      WR-06 fix: normalise both sides via URL parsing + trailing-slash
    //      stripping so a tenant row carrying
    //      `https://app.example.com/callback` matches a request bearing
    //      `https://app.example.com/callback/` (or
    //      `HTTPS://APP.EXAMPLE.COM/callback`). A malformed input that
    //      cannot be parsed falls back to the literal string so the
    //      allowlist still rejects it via the includes() miss.
    const normalizedRedirect = normalizeRedirectUri(redirectUri);
    const allowlistNormalized = tenant.redirect_uri_allowlist.map(normalizeRedirectUri);
    if (!allowlistNormalized.includes(normalizedRedirect)) {
      emitAudit(tenant.id, 'failure', redirectUri, { error: 'invalid_redirect_uri' }, req);
      res.status(400).json({ error: 'invalid_redirect_uri' });
      return;
    }

    const clientCodeChallenge = String(req.query.code_challenge ?? '');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(clientCodeChallenge)) {
      emitAudit(tenant.id, 'failure', redirectUri, { error: 'invalid_code_challenge' }, req);
      res.status(400).json({ error: 'invalid_code_challenge' });
      return;
    }
    const clientCodeChallengeMethod = String(req.query.code_challenge_method ?? 'S256');
    const state = String(req.query.state ?? crypto.randomBytes(16).toString('base64url'));
    const clientId = String(req.query.client_id ?? tenant.client_id);

    // Plan 03-08: PKCE Redis key is keyed on the real tenant id from the URL
    // path (/t/:tenantId/*). `req.tenant.id` mirrors `req.params.tenantId`
    // after loadTenant; preferring the tenant row's id keeps the key stable
    // across re-canonicalizations of the URL segment.
    const tenantKey = tenant.id;

    const serverCodeVerifier = crypto.randomBytes(32).toString('base64url');
    const serverChallenge = crypto
      .createHash('sha256')
      .update(serverCodeVerifier)
      .digest('base64url');

    const ok = await pkceStore.put(tenantKey, {
      state,
      clientCodeChallenge,
      clientCodeChallengeMethod,
      serverCodeVerifier,
      clientId,
      redirectUri,
      tenantId: tenantKey,
      createdAt: Date.now(),
    });
    if (!ok) {
      emitAudit(tenant.id, 'failure', redirectUri, { error: 'pkce_challenge_collision' }, req);
      res.status(400).json({
        error: 'pkce_challenge_collision',
        error_description:
          'An outstanding authorization request already uses this code_challenge; regenerate and retry.',
      });
      return;
    }

    const cloudEndpoints = getCloudEndpoints(tenant.cloud_type);
    const azureTenant = tenant.tenant_id || 'common';
    const authorizeUrl = new URL(
      `${cloudEndpoints.authority}/${azureTenant}/oauth2/v2.0/authorize`
    );
    authorizeUrl.searchParams.set('client_id', tenant.client_id);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set(
      'scope',
      tenant.allowed_scopes.length ? tenant.allowed_scopes.join(' ') : 'User.Read'
    );
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', serverChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    logger.info(
      {
        tenantId: tenant.id,
        state: state.substring(0, 8) + '...',
        challengePrefix: clientCodeChallenge.substring(0, 8) + '...',
      },
      'Two-leg PKCE: stored client challenge, forwarding to Microsoft with server challenge'
    );

    // Plan 03-10: success audit row — meta carries clientId + scopes (no PII).
    emitAudit(
      tenant.id,
      'success',
      redirectUri,
      { clientId: tenant.client_id, scopes: tenant.allowed_scopes },
      req
    );

    res.redirect(authorizeUrl.toString());
  };
}

/**
 * Interface narrowing for MSAL's `acquireTokenByCode`. We check for it
 * rather than importing the full MSAL types so the handler stays testable
 * with a mock pool.
 */
interface DelegatedMsalClient {
  acquireTokenByCode: (config: {
    code: string;
    scopes: string[];
    redirectUri: string;
    codeVerifier: string;
  }) => Promise<{
    accessToken?: string;
    refreshToken?: string;
    expiresOn?: Date | null;
    account?: { homeAccountId?: string } | null;
  } | null>;
}

function isDelegatedMsalClient(client: unknown): client is DelegatedMsalClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    'acquireTokenByCode' in client &&
    typeof (client as { acquireTokenByCode: unknown }).acquireTokenByCode === 'function'
  );
}

/**
 * /token handler (tenant-aware per plan 03-06 + plan 03-07 SECUR-02).
 *
 * 1. Receives `grant_type=authorization_code` with `code` + `code_verifier`.
 * 2. Hashes `code_verifier` via SHA-256 to obtain the `clientCodeChallenge`.
 * 3. Calls `pkceStore.takeByChallenge(tenantId, clientChallenge)` — O(1),
 *    atomic read-and-delete. Miss → 400 `invalid_grant`.
 * 4. Calls `tenantPool.acquire(tenant)` to get the tenant's MSAL client.
 * 5. Calls `client.acquireTokenByCode({code, codeVerifier, redirectUri, scopes})`
 *    with the server-side verifier (two-leg PKCE).
 * 6. **Plan 03-07 SECUR-02**: if MSAL returned a refresh_token, envelope-
 *    encrypt it (per-tenant DEK) and persist a SessionRecord at
 *    `mcp:session:{tenantId}:{sha256(accessToken)}` via SessionStore. The
 *    Graph 401 handler (graph-client.ts refreshSessionAndRetry) consults
 *    this store instead of a custom HTTP header.
 * 7. Responds with `{access_token, token_type, expires_in}` — the response
 *    body NEVER contains `refresh_token` (SECUR-02: refresh tokens never
 *    cross the client trust boundary in v2).
 */
export function createTenantTokenHandler(config: TenantTokenHandlerConfig) {
  const { pkceStore, tenantPool, redis, pgPool } = config;

  // Plan 03-10 helper: fire-and-forget audit write for oauth.token.exchange.
  const emitTokenAudit = (
    tenantId: string,
    result: 'success' | 'failure',
    meta: Record<string, unknown>,
    req: Request
  ): void => {
    if (!pgPool) return;
    void (async () => {
      const { writeAuditStandalone } = await import('./lib/audit.js');
      const reqId =
        (req as Request & { id?: string }).id ?? getRequestTokens()?.requestId ?? 'no-req-id';
      await writeAuditStandalone(pgPool, {
        tenantId,
        actor: 'unauthenticated',
        action: 'oauth.token.exchange',
        target: null,
        ip: req.ip ?? null,
        requestId: reqId,
        result,
        meta,
      });
    })();
  };

  return async (req: Request, res: Response): Promise<void> => {
    const tenant = (req as Request & { tenant?: TenantRow }).tenant;
    if (!tenant) {
      res.status(500).json({ error: 'loadTenant_missing' });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    const clientVerifier = String(body?.code_verifier ?? '');
    if (!clientVerifier) {
      emitTokenAudit(
        tenant.id,
        'failure',
        { error: 'invalid_request', reason: 'code_verifier required' },
        req
      );
      res
        .status(400)
        .json({ error: 'invalid_request', error_description: 'code_verifier required' });
      return;
    }
    const clientCodeChallenge = crypto
      .createHash('sha256')
      .update(clientVerifier)
      .digest('base64url');
    // Plan 03-08: key the PKCE lookup on the real tenant id (from the
    // /t/:tenantId/* path via loadTenant). `req.tenant.id` is populated by
    // the loadTenant middleware and matches the id under which the
    // /authorize handler persisted the PKCE entry.
    const tenantKey = tenant.id;

    const entry = await pkceStore.takeByChallenge(tenantKey, clientCodeChallenge);
    if (!entry) {
      emitTokenAudit(
        tenant.id,
        'failure',
        { error: 'invalid_grant', reason: 'PKCE mismatch' },
        req
      );
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE mismatch' });
      return;
    }

    try {
      const msal = await tenantPool.acquire(tenant);
      if (!isDelegatedMsalClient(msal)) {
        emitTokenAudit(tenant.id, 'failure', { error: 'delegated_requires_client_with_code' }, req);
        res.status(500).json({ error: 'delegated_requires_client_with_code' });
        return;
      }

      const scopes = tenant.allowed_scopes.length ? tenant.allowed_scopes : ['User.Read'];
      const result = await msal.acquireTokenByCode({
        code: String(body?.code ?? ''),
        scopes,
        redirectUri: entry.redirectUri,
        codeVerifier: entry.serverCodeVerifier,
      });

      if (!result?.accessToken) {
        emitTokenAudit(tenant.id, 'failure', { error: 'token_exchange_failed' }, req);
        res.status(502).json({ error: 'token_exchange_failed' });
        return;
      }

      // Plan 03-07 SECUR-02: persist the refresh token server-side, wrapped
      // with the per-tenant DEK. The response body below carries ONLY the
      // access token + token_type + expires_in — never refresh_token.
      // MSAL's AuthenticationResult type doesn't expose refreshToken (by
      // design — refresh tokens live in MSAL's cache). At runtime the
      // authority echoes it back on the acquire call; we narrow via a
      // local cast rather than pollute the callsite with `as any`.
      const refreshTokenFromAuthority = (result as { refreshToken?: string }).refreshToken;
      if (refreshTokenFromAuthority) {
        try {
          const dek = tenantPool.getDekForTenant(tenant.id);
          const { SessionStore } = await import('./lib/session-store.js');
          const sessionStore = new SessionStore(redis, dek);
          await sessionStore.put(tenant.id, result.accessToken, {
            tenantId: tenant.id,
            refreshToken: refreshTokenFromAuthority,
            accountHomeId: result.account?.homeAccountId,
            clientId: tenant.client_id,
            scopes,
            createdAt: Date.now(),
          });
        } catch (sessionErr) {
          // Session-store failure must NOT break the OAuth flow — the client
          // still gets a valid access token; the 401-refresh path will fall
          // back to a fresh OAuth round-trip if the session entry isn't
          // present. Log the failure so operators can investigate.
          logger.warn(
            { tenantId: tenant.id, err: (sessionErr as Error).message },
            'SessionStore put failed; proceeding without server-side refresh token'
          );
        }
      }

      const expiresMs = result.expiresOn ? Math.max(0, result.expiresOn.getTime() - Date.now()) : 0;
      const expiresIn = Math.max(60, Math.floor(expiresMs / 1000));

      // Plan 03-10: success audit row — meta carries clientId + scopes (no PII).
      emitTokenAudit(tenant.id, 'success', { clientId: tenant.client_id, scopes }, req);

      res.json({
        access_token: result.accessToken,
        token_type: 'Bearer',
        expires_in: expiresIn,
      });
    } catch (err) {
      logger.error({ err: (err as Error).message, tenantId: tenant.id }, '/token exchange failed');
      emitTokenAudit(tenant.id, 'failure', { error: 'token_exchange_failed' }, req);
      res.status(400).json({ error: 'token_exchange_failed' });
    }
  };
}

/**
 * Resolve the prod-mode CORS allowlist from environment variables.
 *
 * Precedence:
 *   1. MS365_MCP_CORS_ORIGINS (plural, comma-separated) — canonical.
 *   2. MS365_MCP_CORS_ORIGIN  (singular, v1 compat) — honored with a
 *      warn log so operators know to migrate. Removal target is v2.1
 *      (tracked in CHANGELOG by plan 01-08).
 *   3. Empty array — src/index.ts fails-fast with exit(78) in prod
 *      HTTP mode before this function is consulted by the middleware.
 *
 * Computed once per HTTP setup and closure-captured by
 * createCorsMiddleware so the split+trim cost is not paid per request.
 */
function computeCorsAllowlist(): string[] {
  const plural = process.env.MS365_MCP_CORS_ORIGINS;
  if (plural && plural.trim()) {
    return plural
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const singular = process.env.MS365_MCP_CORS_ORIGIN;
  if (singular && singular.trim()) {
    logger.warn(
      'MS365_MCP_CORS_ORIGIN (singular) is deprecated — use MS365_MCP_CORS_ORIGINS (plural, comma-separated)'
    );
    return [singular.trim()];
  }

  return [];
}

class MicrosoftGraphServer {
  private authManager: AuthManager;
  private options: CommandOptions;
  private graphClient: GraphClient | null;
  private server: McpServer | null;
  private secrets: AppSecrets | null;
  private version: string = '0.0.0';
  private multiAccount: boolean = false;
  private accountNames: string[] = [];

  // Two-leg PKCE (plan 03-03): PkceStore abstracts over RedisPkceStore (HTTP
  // mode) and MemoryPkceStore (stdio / tests). Keyed by
  // (tenantId, clientCodeChallenge) — the v1 Map<state, entry> + O(N) find
  // has been fully removed along with its opportunistic cleanup timer
  // (Redis TTL = 600s handles eviction; MemoryPkceStore uses Date.now()
  // comparison on read).
  private pkceStore: PkceStore;

  // Phase 3 (plan 03-01): pushed by src/index.ts before server.start() so
  // /readyz composition reflects every subsystem (Postgres in 03-01; Redis
  // in 03-02; tenantPool in 03-05; etc). Default empty array preserves the
  // Phase 1 baseline contract.
  private readinessChecks: ReadinessCheck[];

  /**
   * @param authManager - MSAL + scope owner.
   * @param options - CLI/runtime flags (CommandOptions).
   * @param readinessChecks - Pushed by src/index.ts before start() — /readyz composes these.
   * @param deps - Phase 3+ dependency-injection bag. `pkceStore` defaults to
   *   MemoryPkceStore when omitted so tests and stdio callers don't need to
   *   construct the Redis substrate. HTTP-mode bootstraps inject
   *   RedisPkceStore(getRedis()) via src/index.ts region:phase3-pkce-store.
   */
  constructor(
    authManager: AuthManager,
    options: CommandOptions = {},
    readinessChecks: ReadinessCheck[] = [],
    deps: { pkceStore?: PkceStore } = {}
  ) {
    this.authManager = authManager;
    this.options = options;
    this.graphClient = null; // Initialized in start() after secrets are loaded
    this.server = null;
    this.secrets = null;
    this.readinessChecks = readinessChecks;
    this.pkceStore = deps.pkceStore ?? new MemoryPkceStore();
  }

  /**
   * Build a fresh MCP server instance. Plan 03-09 (TRANS-05): this is the
   * single factory that produces an `McpServer` for every transport — stdio,
   * Streamable HTTP, AND the legacy SSE shim all call this method so the
   * tool surface is identical across transports.
   *
   * The optional `tenant` parameter is forwarded for per-tenant tool-surface
   * scoping introduced in Phase 5 (`tenant.enabled_tools` filter). Phase 3
   * registers all tools regardless of tenant; the parameter is threaded
   * through so callers can pass it today without changing the signature
   * later. Passing `undefined` preserves the legacy single-tenant behaviour
   * (stdio mode + HTTP mode's legacy /mcp path which 03-09 retires).
   */
  createMcpServer(tenant?: TenantRow): McpServer {
    // `tenant` is currently consumed by Plan 05-05's tools/list filter wrap
    // below — the filter reads from AsyncLocalStorage at request time, so
    // the tenant row here is informational only (future plans may capture
    // it for per-tenant metrics / audit wiring). Keep the param to preserve
    // the factory signature that 03-09's buildMcpServer closure depends on.
    void tenant;

    const server = new McpServer(
      {
        name: 'Microsoft365MCP',
        version: this.version,
      },
      {
        instructions: buildMcpServerInstructions({
          discovery: Boolean(this.options.discovery),
          orgMode: Boolean(this.options.orgMode),
          readOnly: Boolean(this.options.readOnly),
          multiAccount: this.multiAccount,
        }),
      }
    );

    const shouldRegisterAuthTools = !this.options.http || this.options.enableAuthTools;
    if (shouldRegisterAuthTools) {
      registerAuthTools(server, this.authManager);
    }

    if (this.options.discovery) {
      registerDiscoveryTools(
        server,
        this.graphClient!,
        this.options.readOnly,
        this.options.orgMode,
        this.authManager,
        this.multiAccount
      );
    } else {
      registerGraphTools(
        server,
        this.graphClient!,
        this.options.readOnly,
        this.options.enabledTools,
        this.options.orgMode,
        this.authManager,
        this.multiAccount,
        this.accountNames
      );
    }

    // Plan 05-05 (COVRG-04, TENANT-08): wrap the SDK's default tools/list
    // handler AFTER all tool registrations so the filter sees the populated
    // `_registeredTools` map. Safe to call in stdio mode — `wrapToolsListHandler`
    // reads `getRequestTenant()` from AsyncLocalStorage which falls back to
    // the stdio bootstrap triple (Pitfall 8). Idempotent on repeat calls.
    wrapToolsListHandler(server);

    return server;
  }

  /**
   * Plan 03-08: mount the /t/:tenantId/* router on the Express app.
   *
   * Wires:
   *   1. `loadTenant` middleware — resolves the tenant row from Postgres
   *      (via LRU cache) and populates `req.tenant`.
   *   2. Tenant-scoped `/t/:tenantId/.well-known/oauth-authorization-server`
   *      and `oauth-protected-resource` — issuer URLs include the tenant
   *      segment so downstream clients use tenant-scoped endpoints.
   *   3. `/t/:tenantId/authorize` + `/t/:tenantId/token` — per-tenant OAuth
   *      handlers from 03-06.
   *   4. Redis pub/sub subscriber on `mcp:tenant-invalidate` — admin
   *      mutations in Phase 4 publish here; we evict the cached entry.
   *
   * The mount is best-effort: if Postgres, Redis, or the TenantPool are
   * unavailable we log at warn level and skip the mount so the legacy
   * single-tenant /authorize + /token path remains functional for v1
   * compatibility. This keeps Phase 3 deployments on the happy path while
   * leaving v1 HTTP deployments unaffected.
   */
  private async mountTenantRoutes(
    app: import('express').Express,
    publicBase: string | null
  ): Promise<void> {
    let pg: import('pg').Pool;
    try {
      const postgres = await import('./lib/postgres.js');
      pg = postgres.getPool();
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'Phase 3 tenant routes: postgres unavailable, skipping /t/:tenantId/* mount'
      );
      return;
    }

    let redis: import('./lib/redis.js').RedisClient;
    let tenantPool: TenantPool;
    try {
      const redisLib = await import('./lib/redis.js');
      redis = redisLib.getRedis();
      const poolLib = await import('./lib/tenant/tenant-pool.js');
      const existingPool = poolLib.getTenantPool();
      if (!existingPool) {
        logger.warn(
          'Phase 3 tenant routes: TenantPool not initialized, skipping /t/:tenantId/* mount'
        );
        return;
      }
      tenantPool = existingPool;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'Phase 3 tenant routes: Redis/TenantPool unavailable, skipping /t/:tenantId/* mount'
      );
      return;
    }

    const { createLoadTenantMiddleware } = await import('./lib/tenant/load-tenant.js');
    const { subscribeToTenantInvalidation } = await import('./lib/tenant/tenant-invalidation.js');
    const { subscribeToToolSelectionInvalidation } =
      await import('./lib/tool-selection/tool-selection-invalidation.js');
    const { discoveryCache } = await import('./graph-tools.js');
    const { createPerTenantCorsMiddleware } = await import('./lib/cors.js');

    const loadTenant = createLoadTenantMiddleware({ pool: pg });

    // Subscribe to the pub/sub channel so admin mutations in Phase 4 propagate
    // to our LRU. Failure to subscribe (Redis partition) logs + continues —
    // the 60s TTL still bounds staleness.
    try {
      await subscribeToTenantInvalidation(redis, {
        evict: (tenantId: string) => {
          loadTenant.evict(tenantId);
          tenantPool.evict(tenantId);
        },
      });
      logger.info('Phase 3 tenant routes: subscribed to mcp:tenant-invalidate');
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'Phase 3 tenant routes: tenant-invalidate subscription failed (falling back to 60s TTL)'
      );
    }

    // Plan 05-06 (COVRG-05, D-20/D-21): subscribe to the tool-selection
    // invalidation channel. Admin PATCH /admin/tenants/{id}/enabled-tools
    // (Plan 05-07) publishes a tenantId here after COMMIT; we evict every
    // cached BM25 index for that tenant so the next discovery call picks
    // up the new enabled_tools_set. Failure to subscribe is non-fatal —
    // the 10-minute TTL still bounds staleness.
    //
    // Real ioredis clients support `.duplicate()` (Pitfall 6 — dedicated
    // subscriber connection with auto-resubscribe on reconnect). The
    // MemoryRedisFacade lacks duplicate() — fall back to the shared
    // client. Both facades route subscribe/publish through an in-memory
    // channel map so the shared-client path is safe for tests and stdio.
    try {
      const subscriberClient =
        'duplicate' in redis && typeof (redis as { duplicate: unknown }).duplicate === 'function'
          ? (redis as { duplicate: () => typeof redis }).duplicate()
          : redis;
      await subscribeToToolSelectionInvalidation(subscriberClient, {
        invalidate: (tenantId: string) => discoveryCache.invalidate(tenantId),
      });
      logger.info('Plan 05-06 tool-selection routes: subscribed to mcp:tool-selection-invalidate');
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'Plan 05-06 tool-selection routes: invalidation subscription failed (falling back to 10-minute TTL)'
      );
    }

    // region:phase4-admin-router
    // Plan 04-01: Admin REST API skeleton. Mount BEFORE /t/:tenantId so
    // /admin/* paths never accidentally route through loadTenant (which
    // would 404 on the literal segment 'admin' failing the GUID regex —
    // T-04-03c). Gated on Entra admin env so deployments without the admin
    // app registration expose zero /admin/* surface (T-04-03b).
    //
    // NOTE: Plan 04-01 originally described mounting OUTSIDE mountTenantRoutes
    // (just before the call at ~line 1326). pg/redis/tenantPool are resolved
    // INSIDE this method, however, so mounting here keeps deps in scope
    // without duplicating the resolution block. Mount order vs. /t/:tenantId
    // is preserved — admin declaration precedes the first app.use('/t/…').
    if (process.env.MS365_MCP_ADMIN_APP_CLIENT_ID && process.env.MS365_MCP_ADMIN_GROUP_ID) {
      const { createAdminRouter, parseAdminOrigins } = await import('./lib/admin/router.js');
      const { createCursorSecret } = await import('./lib/admin/cursor.js');
      const { loadKek } = await import('./lib/crypto/kek.js');
      const adminOrigins = parseAdminOrigins(process.env.MS365_MCP_ADMIN_ORIGINS);
      const adminRouter = createAdminRouter({
        pgPool: pg,
        redis,
        tenantPool,
        kek: await loadKek(),
        adminOrigins,
        entraConfig: {
          appClientId: process.env.MS365_MCP_ADMIN_APP_CLIENT_ID,
          groupId: process.env.MS365_MCP_ADMIN_GROUP_ID,
        },
        cursorSecret: createCursorSecret(),
      });
      app.use('/admin', adminRouter);
      // Log origin COUNT only — never the actual allowlist contents (PII-
      // adjacent: reveals which operator domains use this deployment).
      logger.info({ adminOriginCount: adminOrigins.length }, 'Phase 4: /admin/* router mounted');
    } else {
      logger.warn(
        {},
        'Phase 4: MS365_MCP_ADMIN_APP_CLIENT_ID or MS365_MCP_ADMIN_GROUP_ID unset; /admin/* not mounted'
      );
    }
    // endregion:phase4-admin-router

    // Per-tenant CORS — falls back to the global allowlist when the tenant
    // did not customize CORS. loadTenant runs first so req.tenant is set.
    const isProdMode = process.env.NODE_ENV === 'production';
    const fallbackAllowlist = computeCorsAllowlist();
    app.use('/t/:tenantId', loadTenant);
    app.use(
      '/t/:tenantId',
      createPerTenantCorsMiddleware({
        mode: isProdMode ? 'prod' : 'dev',
        fallbackAllowlist,
      })
    );

    // Per-tenant OAuth discovery — /.well-known/* URLs scoped to a tenant
    // segment so downstream clients bind the right issuer. publicBase
    // (MS365_MCP_PUBLIC_URL) is the browser-facing origin for the authorize
    // endpoint; token endpoint stays on the request origin for s2s clients.
    app.get('/t/:tenantId/.well-known/oauth-authorization-server', async (req, res) => {
      const tenant = (req as Request & { tenant?: TenantRow }).tenant;
      if (!tenant) {
        res.status(404).json({ error: 'tenant_not_found' });
        return;
      }
      const protocol = req.secure ? 'https' : 'http';
      const requestOrigin = `${protocol}://${req.get('host')}`;
      const browserBase = publicBase ?? requestOrigin;
      const tenantBase = `${browserBase}/t/${tenant.id}`;
      const tokenBase = `${requestOrigin}/t/${tenant.id}`;
      const scopes = tenant.allowed_scopes.length
        ? tenant.allowed_scopes
        : buildScopesFromEndpoints(this.options.orgMode, this.options.enabledTools);
      res.json({
        issuer: tenantBase,
        authorization_endpoint: `${tenantBase}/authorize`,
        token_endpoint: `${tokenBase}/token`,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: scopes,
      });
    });

    app.get('/t/:tenantId/.well-known/oauth-protected-resource', async (req, res) => {
      const tenant = (req as Request & { tenant?: TenantRow }).tenant;
      if (!tenant) {
        res.status(404).json({ error: 'tenant_not_found' });
        return;
      }
      const protocol = req.secure ? 'https' : 'http';
      const requestOrigin = `${protocol}://${req.get('host')}`;
      const browserBase = publicBase ?? requestOrigin;
      const tenantBase = `${browserBase}/t/${tenant.id}`;
      const scopes = tenant.allowed_scopes.length
        ? tenant.allowed_scopes
        : buildScopesFromEndpoints(this.options.orgMode, this.options.enabledTools);
      res.json({
        resource: `${requestOrigin}/t/${tenant.id}/mcp`,
        authorization_servers: [tenantBase],
        scopes_supported: scopes,
        bearer_methods_supported: ['header'],
        resource_documentation: tenantBase,
      });
    });

    // /t/:tenantId/authorize + /t/:tenantId/token — tenant-scoped OAuth from 03-06.
    // Plan 03-10: pgPool wired so both handlers emit oauth.authorize +
    // oauth.token.exchange audit rows via writeAuditStandalone.
    app.get(
      '/t/:tenantId/authorize',
      createAuthorizeHandler({ pkceStore: this.pkceStore, pgPool: pg })
    );
    app.post(
      '/t/:tenantId/token',
      createTenantTokenHandler({
        pkceStore: this.pkceStore,
        tenantPool,
        redis,
        pgPool: pg,
      })
    );

    // ── Plan 03-09: three-transport mounting on /t/:tenantId/* ───────────
    //
    // Mount order (most-specific first per RESEARCH.md Pattern 4 +
    // Pitfall 3):
    //   /t/:tenantId/sse          — legacy SSE GET stream (2024-11-05 spec)
    //   /t/:tenantId/messages     — legacy SSE POST channel (shim: initialize only)
    //   /t/:tenantId/mcp          — Streamable HTTP (current MCP spec; GET+POST)
    //
    // All three share the SAME createMcpServer(tenant) factory (TRANS-05)
    // so tool registration is identical across transports. The closure
    // captures `this` + tenantPool + redis from the bootstrap scope.
    const authSelector = createAuthSelectorMiddleware({ tenantPool });
    const buildMcpServer = (tenant: TenantRow): McpServer => this.createMcpServer(tenant);

    // Plan 05-04 TENANT-08: seed AsyncLocalStorage with tenantId +
    // enabled_tools_set + preset_version BEFORE authSelector runs. The auth
    // middlewares own their own requestContext.run() calls that spread the
    // existing frame; by seeding tenant fields first, dispatch-guard can
    // resolve the tenant triple inside executeGraphTool via getRequestTenant().
    const { createSeedTenantContextMiddleware } =
      await import('./lib/tool-selection/tenant-context-middleware.js');
    const seedTenantContext = createSeedTenantContextMiddleware();

    const streamableHttp = createStreamableHttpHandler({ buildMcpServer });
    const legacySseGet = createLegacySseGetHandler({ buildMcpServer });
    const legacySsePost = createLegacySsePostHandler({ buildMcpServer });

    // Plan 05-05 (COVRG-04, TENANT-08): Express-level tools/list filter.
    // Authoritative filtering happens inside createMcpServer via
    // wrapToolsListHandler — Streamable HTTP (@hono/node-server) bypasses
    // res.json/res.send. This middleware is defense in depth for any
    // transport (including future web-standard replacements) that DOES
    // route JSON-RPC responses through Express's response methods.
    const toolsListFilter = createToolsListFilterMiddleware();

    app.get('/t/:tenantId/sse', seedTenantContext, authSelector, legacySseGet);
    app.post(
      '/t/:tenantId/messages',
      seedTenantContext,
      authSelector,
      toolsListFilter,
      legacySsePost
    );
    app.post('/t/:tenantId/mcp', seedTenantContext, authSelector, toolsListFilter, streamableHttp);
    app.get('/t/:tenantId/mcp', seedTenantContext, authSelector, streamableHttp);

    // region:phase4-webhook-receiver
    // Plan 04-07: Microsoft Graph change-notification receiver (WEBHK-01 +
    // WEBHK-02). Mounted AFTER the /mcp routes but BEFORE the implicit 404.
    // Body-parser limit 1 MiB per D-16 (rich-notification spec caps at 200 KB,
    // 5x buffer). loadTenant already applies at the /t/:tenantId level
    // (line 1096 above) — we re-list it here for explicitness and to match
    // the plan-04-07 middleware chain exactly. The `app.use('/t/:tenantId',
    // loadTenant)` pass runs first and short-circuits on a 404 or bad GUID,
    // so the route-specific pass is a no-op on the happy path.
    //
    // DEK sourcing: getDekForTenant is the warm path; handler falls back to
    // unwrapTenantDek(wrapped_dek, kek) on cold pool so webhook delivery
    // does NOT force an MSAL acquire (the webhook is a distinct code path
    // from outbound Graph calls).
    try {
      const { createWebhookHandler } = await import('./lib/admin/webhooks.js');
      const { loadKek: loadKekForWebhook } = await import('./lib/crypto/kek.js');
      const webhookHandler = createWebhookHandler({
        pgPool: pg,
        redis,
        tenantPool,
        kek: await loadKekForWebhook(),
      });
      app.post(
        '/t/:tenantId/notifications',
        // body-parser's NextHandleFunction signature predates Express 5's
        // RequestHandler (IncomingMessage vs. Request). At runtime both
        // accept the same req/res so the cast is safe; the type mismatch
        // is a known @types/body-parser gap against @types/express 5.x.
        express.json({ limit: '1mb' }) as unknown as RequestHandler,
        loadTenant,
        webhookHandler
      );
      logger.info('Phase 4: /t/:tenantId/notifications webhook receiver mounted');
    } catch (err) {
      // Fall through — webhook receiver is optional (no tenant can create a
      // subscription without the plan-04-08 MCP tools landing). A KEK-load
      // failure or a webhooks.js import failure logs warn and skips the
      // mount so the rest of the tenant surface keeps serving.
      logger.warn(
        { err: (err as Error).message },
        'Phase 4: webhook receiver mount failed (webhook deliveries will 404)'
      );
    }
    // endregion:phase4-webhook-receiver

    logger.info('Phase 3 tenant routes mounted under /t/:tenantId/*');
  }

  async initialize(version: string): Promise<void> {
    this.secrets = await getSecrets();
    this.version = version;

    // Detect multi-account mode and cache account names for schema enum
    try {
      this.multiAccount = await this.authManager.isMultiAccount();
      if (this.multiAccount) {
        const accounts = await this.authManager.listAccounts();
        this.accountNames = accounts.map((a) => a.username).filter((u): u is string => !!u);
        logger.info(
          `Multi-account mode detected (${this.accountNames.length} accounts): "account" parameter will be injected into all tool schemas`
        );
      }
    } catch (err) {
      logger.warn(`Failed to detect multi-account mode: ${(err as Error).message}`);
    }

    const outputFormat = this.options.toon ? 'toon' : 'json';
    this.graphClient = new GraphClient(this.authManager, this.secrets, outputFormat);

    if (!this.options.http) {
      this.server = this.createMcpServer();
    }

    if (this.options.discovery) {
      logger.info('Discovery mode enabled (experimental) - registering discovery tool only');
    }
  }

  async start(): Promise<void> {
    if (this.options.v) {
      enableConsoleLogging();
    }

    logger.info('Microsoft 365 MCP Server starting...');

    // Debug: Check if secrets are loaded
    logger.info('Secrets Check:', {
      CLIENT_ID: this.secrets?.clientId ? `${this.secrets.clientId.substring(0, 8)}...` : 'NOT SET',
      CLIENT_SECRET: this.secrets?.clientSecret ? 'SET' : 'NOT SET',
      TENANT_ID: this.secrets?.tenantId || 'NOT SET',
      NODE_ENV: process.env.NODE_ENV || 'NOT SET',
    });

    if (this.options.readOnly) {
      logger.info('Server running in READ-ONLY mode. Write operations are disabled.');
    }

    if (this.options.http) {
      const { host, port } = parseHttpOption(this.options.http);

      const app = express();
      app.set('trust proxy', true);

      // Health endpoints (OPS-03 / OPS-04) — MUST be mounted BEFORE pino-http,
      // CORS, body parsers, and ANY auth middleware so that:
      //   1. Health probes never exercise auth (T-01-04b: broken auth config
      //      must not fail the liveness probe).
      //   2. pino-http autoLogging.ignore is a belt-and-braces guard; mounting
      //      first means even a regression in the ignore predicate cannot spam
      //      2880 health-probe log lines/day (T-01-04a).
      //   3. OPTIONS preflight on /healthz does not hit CORS origin validation
      //      that might 403 in prod.
      // Phase 3 (plan 03-01) pushes Postgres readiness via src/index.ts before
      // server.start(); sibling Phase 3 plans (03-02 Redis, 03-05 tenant
      // pool) push their own. Phase 6 will push "at least one tenant loaded".
      // Phase 1 baseline has no checks — default empty array is correct.
      mountHealth(app, this.readinessChecks);

      // pino-http request logging — MUST be registered BEFORE express.json() so
      // that req.id is stamped on the raw request before body parsing starts.
      app.use(
        pinoHttp({
          logger: rawPinoLogger,
          genReqId: () => nanoid(),
          autoLogging: {
            ignore: (req) => {
              const url = req.url ?? '';
              // Skip access logs for health-check endpoints (plan 01-04 mounts these).
              return url.startsWith('/healthz') || url.startsWith('/readyz');
            },
          },
          customProps: (req) => ({ requestId: req.id, tenantId: null }),
        })
      );

      // Populate the shared AsyncLocalStorage so any downstream handler can
      // retrieve the correlation IDs without receiving them as function arguments.
      app.use((req, _res, next) => {
        // pino-http stamps req.id as string|number; we assert string here because
        // genReqId always returns nanoid() which is a string.
        requestContext.run({ requestId: req.id as string, tenantId: null }, next);
      });

      // Body-parser limit raised for MWARE-05 large uploads (plan 02-06). MCP
      // tool payloads (e.g., base64-encoded file content routed through the
      // graph-upload-large-file tool) can approach the chunk ceiling (60 MiB
      // per D-08). Default '60mb' is safe for single-tenant; Phase 3 may add
      // per-tenant overrides.
      //
      // express default is 100 KB for JSON and 100 KB for urlencoded — far
      // below the 60 MiB upload ceiling, so without this raise large-file
      // uploads over HTTP transport would 413 before reaching the tool.
      const bodyParserLimit = process.env.MS365_MCP_BODY_PARSER_LIMIT || '60mb';
      // body-parser's NextHandleFunction predates Express 5's RequestHandler;
      // the cast bridges the @types gap. See the webhook-receiver mount for
      // the matching discussion.
      app.use(express.json({ limit: bodyParserLimit }) as unknown as RequestHandler);
      app.use(
        express.urlencoded({ extended: true, limit: bodyParserLimit }) as unknown as RequestHandler
      );

      // Public URL resolution for browser-facing OAuth endpoints.
      //
      // When running behind a reverse proxy, the request's Host header only
      // reflects the public origin if the client reached the server through
      // the proxy. If a client (e.g. Open WebUI) talks to the server over
      // an internal Docker hostname, Host is that internal name, so the
      // authorize URL we hand back to the user's browser would be
      // unresolvable from outside. Setting MS365_MCP_PUBLIC_URL pins the
      // browser-facing origin while the server-to-server endpoints
      // (token, register, resource) stay on the request origin so clients
      // that reach us internally don't need NAT loopback through the proxy.
      //
      // DEPRECATED: --base-url / MS365_MCP_BASE_URL. Use --public-url /
      // MS365_MCP_PUBLIC_URL instead. The deprecated names are still read
      // here so existing configurations don't crash at startup, but they
      // will be removed in a future release. Note that the original
      // --base-url was effectively a no-op in practice: it was plumbed
      // through the SDK's mcpAuthRouter, whose metadata endpoint is
      // shadowed by the custom handler below, so no deployment relied
      // on its actual semantics.
      const publicUrlRaw =
        this.options.publicUrl ||
        process.env.MS365_MCP_PUBLIC_URL ||
        this.options.baseUrl ||
        process.env.MS365_MCP_BASE_URL ||
        null;
      const publicBase = publicUrlRaw ? new URL(publicUrlRaw).href.replace(/\/$/, '') : null;

      // Redirect-URI allowlist policy (plan 01-06 / D-02) and CORS mode gate
      // (plan 01-07 / SECUR-04). Both read the same `isProdMode` flag and
      // `publicUrlHost`; computing them ONCE here keeps the hot path free of
      // per-request env parsing. Phase 3 will extend this to a per-tenant
      // allowlist without touching createRegisterHandler / createCorsMiddleware.
      const publicUrlHost = publicBase ? new URL(publicBase).hostname : null;
      const isProdMode = process.env.NODE_ENV === 'production';

      // CORS policy (plan 01-07 / D-02 / SECUR-04). Dev mode echoes ACAO to
      // any http(s)://localhost:* / http(s)://127.0.0.1:* origin; prod mode
      // requires an exact allowlist match against MS365_MCP_CORS_ORIGINS
      // (comma-separated). The deprecated singular MS365_MCP_CORS_ORIGIN
      // is honored with a warn log. src/index.ts fails-fast with exit(78)
      // in prod HTTP mode when the resolved allowlist is empty.
      const corsMode: CorsMode = isProdMode ? 'prod' : 'dev';
      const corsAllowlist = computeCorsAllowlist();
      app.use(createCorsMiddleware({ mode: corsMode, allowlist: corsAllowlist }));

      // ── Phase 3 plan 03-08: per-tenant /t/:tenantId/* router ─────────────
      //
      // Mounting order is strict — these routes MUST be declared BEFORE the
      // /.well-known/* discovery endpoints so "most specific path" wins:
      // /t/:tenantId/.well-known/oauth-authorization-server returns the
      // tenant-scoped metadata; /.well-known/oauth-authorization-server
      // keeps the legacy singleton behaviour for v1 compatibility.
      //
      // Wiring requires the Phase 3 substrate (Postgres, Redis, TenantPool)
      // — stdio / dev deployments without those can skip the mount entirely.
      // isHttpMode is already guaranteed here (we are inside `if
      // (this.options.http)`), so dependency resolution below is safe.
      await this.mountTenantRoutes(app, publicBase);

      const oauthProvider = new MicrosoftOAuthProvider(this.authManager, this.secrets!);

      // OAuth Authorization Server Discovery
      app.get('/.well-known/oauth-authorization-server', async (req, res) => {
        const protocol = req.secure ? 'https' : 'http';
        const requestOrigin = `${protocol}://${req.get('host')}`;
        const browserBase = publicBase ?? requestOrigin;

        const scopes = buildScopesFromEndpoints(this.options.orgMode, this.options.enabledTools);

        const metadata: Record<string, unknown> = {
          issuer: browserBase,
          authorization_endpoint: `${browserBase}/authorize`,
          token_endpoint: `${requestOrigin}/token`,
          response_types_supported: ['code'],
          response_modes_supported: ['query'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          token_endpoint_auth_methods_supported: ['none'],
          code_challenge_methods_supported: ['S256'],
          scopes_supported: scopes,
        };

        if (this.options.enableDynamicRegistration) {
          metadata.registration_endpoint = `${requestOrigin}/register`;
        }

        res.json(metadata);
      });

      // OAuth Protected Resource Discovery
      app.get('/.well-known/oauth-protected-resource', async (req, res) => {
        const protocol = req.secure ? 'https' : 'http';
        const requestOrigin = `${protocol}://${req.get('host')}`;
        const browserBase = publicBase ?? requestOrigin;

        const scopes = buildScopesFromEndpoints(this.options.orgMode, this.options.enabledTools);

        res.json({
          resource: `${requestOrigin}/mcp`,
          authorization_servers: [browserBase],
          scopes_supported: scopes,
          bearer_methods_supported: ['header'],
          resource_documentation: browserBase,
        });
      });

      if (this.options.enableDynamicRegistration) {
        // Plan 01-06: validate redirect_uris against the D-02 allowlist, use
        // crypto.randomBytes for client IDs, and scrub the info log body.
        // Factory documentation lives at src/server.ts createRegisterHandler.
        app.post(
          '/register',
          createRegisterHandler({
            mode: isProdMode ? 'prod' : 'dev',
            publicUrlHost,
          })
        );
      }

      // Authorization endpoint - redirects to Microsoft
      // Implements two-leg PKCE: client↔server and server↔Microsoft are independent
      app.get('/authorize', async (req, res) => {
        const url = new URL(req.url!, `${req.protocol}://${req.get('host')}`);
        const tenantId = this.secrets?.tenantId || 'common';
        const clientId = this.secrets!.clientId;
        const cloudEndpoints = getCloudEndpoints(this.secrets!.cloudType);
        const microsoftAuthUrl = new URL(
          `${cloudEndpoints.authority}/${tenantId}/oauth2/v2.0/authorize`
        );

        // Extract client's PKCE parameters (from claude.ai or other MCP client)
        const clientCodeChallenge = url.searchParams.get('code_challenge');
        const clientCodeChallengeMethod = url.searchParams.get('code_challenge_method');
        const state = url.searchParams.get('state');

        // Forward parameters that Microsoft OAuth 2.0 v2.0 supports,
        // but NOT code_challenge/code_challenge_method — we generate our own for Microsoft
        const allowedParams = [
          'response_type',
          'redirect_uri',
          'scope',
          'state',
          'response_mode',
          'prompt',
          'login_hint',
          'domain_hint',
        ];

        allowedParams.forEach((param) => {
          const value = url.searchParams.get(param);
          if (value) {
            microsoftAuthUrl.searchParams.set(param, value);
          }
        });

        // Two-leg PKCE (plan 03-03, SECUR-03):
        // Persist {state, clientCodeChallenge, serverCodeVerifier, ...} via
        // `pkceStore.put` keyed by (tenantId, clientCodeChallenge). Redis SET
        // NX EX 600 enforces TTL (no opportunistic cleanup loop required —
        // Redis auto-evicts stale entries) and rejects duplicate challenges
        // rather than silently overwriting. /token later computes
        // sha256(client_verifier) and does a single O(1) takeByChallenge.
        if (clientCodeChallenge && state) {
          const serverCodeVerifier = crypto.randomBytes(32).toString('base64url');
          const serverCodeChallenge = crypto
            .createHash('sha256')
            .update(serverCodeVerifier)
            .digest('base64url');

          const redirectUri = url.searchParams.get('redirect_uri') ?? '';
          const ok = await this.pkceStore.put(LEGACY_SINGLE_TENANT_KEY, {
            state,
            clientCodeChallenge,
            clientCodeChallengeMethod: clientCodeChallengeMethod || 'S256',
            serverCodeVerifier,
            clientId,
            redirectUri,
            tenantId: LEGACY_SINGLE_TENANT_KEY,
            createdAt: Date.now(),
          });

          if (!ok) {
            // NX rejected the write — another /authorize already staked
            // this exact challenge. Rare but possible; surface 400 so the
            // client regenerates its verifier/challenge and retries.
            logger.warn(
              { challengePrefix: clientCodeChallenge.substring(0, 8) + '...' },
              'PKCE challenge collision on put'
            );
            res.status(400).json({
              error: 'pkce_challenge_collision',
              error_description:
                'An outstanding authorization request already uses this code_challenge; regenerate and retry.',
            });
            return;
          }

          // Send our server-generated code_challenge to Microsoft
          microsoftAuthUrl.searchParams.set('code_challenge', serverCodeChallenge);
          microsoftAuthUrl.searchParams.set('code_challenge_method', 'S256');

          logger.info('Two-leg PKCE: stored client challenge, generated server challenge', {
            state: state.substring(0, 8) + '...',
          });
        } else if (clientCodeChallenge) {
          // CR-02 fix: refuse the legacy single-tenant /authorize when state
          // is missing. The old behaviour silently forwarded the client's
          // code_challenge directly to Microsoft, disabling server-side
          // two-leg PKCE persistence (no PkceStore entry was written, so
          // /token had nothing to look up via takeByChallenge — it fell
          // through to using the client verifier).
          //
          // Two-leg PKCE is a defence-in-depth invariant: even when
          // Microsoft validates PKCE end-to-end, the server-rotated verifier
          // ensures a leaked client verifier alone cannot complete the
          // exchange. Requiring `state` makes the contract explicit.
          //
          // Plan 03-09 retires this entire mount; until then, opt back in
          // via MS365_MCP_LEGACY_OAUTH_NO_STATE=1 only for narrow v1
          // migration windows where the upstream client cannot supply state.
          if (process.env.MS365_MCP_LEGACY_OAUTH_NO_STATE === '1') {
            logger.warn(
              { challengePrefix: clientCodeChallenge.substring(0, 8) + '...' },
              'Legacy /authorize: state missing, forwarding client code_challenge directly (MS365_MCP_LEGACY_OAUTH_NO_STATE=1 opt-in; two-leg PKCE disabled)'
            );
            microsoftAuthUrl.searchParams.set('code_challenge', clientCodeChallenge);
            if (clientCodeChallengeMethod) {
              microsoftAuthUrl.searchParams.set('code_challenge_method', clientCodeChallengeMethod);
            }
          } else {
            res.status(400).json({
              error: 'invalid_request',
              error_description:
                'state is required for two-leg PKCE on the legacy /authorize mount. ' +
                'Use /t/:tenantId/authorize (Phase 3) or set MS365_MCP_LEGACY_OAUTH_NO_STATE=1 ' +
                'to opt back into v1 stateless forwarding during migration.',
            });
            return;
          }
        }

        // Use our Microsoft app's client_id
        microsoftAuthUrl.searchParams.set('client_id', clientId);

        // Ensure we have the minimal required scopes if none provided
        if (!microsoftAuthUrl.searchParams.get('scope')) {
          microsoftAuthUrl.searchParams.set('scope', 'User.Read Files.Read Mail.Read');
        }

        // Redirect to Microsoft's authorization page
        res.redirect(microsoftAuthUrl.toString());
      });

      // Token exchange endpoint — plan 01-07 factory-ized handler. All three
      // v1 log-site body leaks (info entry, grant_type missing, catch-block)
      // are scrubbed inside createTokenHandler; tests mount the same factory
      // on a minimal Express app to assert the invariant at the logger mock
      // call level. The factory is dependency-injected with secrets and the
      // per-instance PKCE store so the two-leg PKCE handshake continues to
      // work unchanged.
      app.post(
        '/token',
        createTokenHandler({
          secrets: this.secrets!,
          pkceStore: this.pkceStore,
        })
      );

      app.use(
        mcpAuthRouter({
          provider: oauthProvider,
          issuerUrl: new URL(publicBase ?? `http://localhost:${port}`),
        })
      );

      // Microsoft Graph MCP endpoints with bearer token auth
      //
      // Plan 03-07 (SECUR-02): the v1 legacy bearer middleware that read the
      // refresh-token custom header is gone. This inline middleware performs
      // ONLY the access-token extraction that the /mcp streamable-HTTP handler
      // needs. The refresh-token custom header is NOT read — refresh tokens
      // live in the SessionStore keyed by sha256(accessToken); the Graph 401
      // refresh path (graph-client.ts refreshSessionAndRetry) consults the
      // store rather than any header.
      //
      // 03-09 replaces this legacy /mcp mount with the full per-tenant
      // /t/:tenantId/mcp route + authSelector (createBearerMiddleware +
      // createAuthSelectorMiddleware). Until then, this keeps the v1 HTTP
      // route behaviorally compatible WITHOUT the header-read security hole.
      // CR-03 fix: enforce decode-only tid check on the legacy /mcp mount
      // (same Pitfall 5 discipline as createBearerMiddleware in
      // src/lib/microsoft-auth.ts). Without this, an operator who forgets to
      // configure tenants in Postgres but still starts the server in HTTP
      // mode gets a working /mcp endpoint that routes to whatever single
      // tenant the env vars point at — the opposite of the multi-tenant
      // isolation promise. When MS365_MCP_TENANT_ID is set to a real tenant
      // GUID (not 'common'), reject any inbound bearer whose JWT tid does
      // not match. Plan 03-09 retires this entire legacy mount; until then,
      // this is the inline guard.
      const legacySecrets = this.secrets;
      const legacyMcpAccessTokenExtractor = (
        req: Request & { microsoftAuth?: { accessToken: string } },
        res: Response,
        next: express.NextFunction
      ): void => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.status(401).json({ error: 'Missing or invalid access token' });
          return;
        }
        const token = authHeader.substring(7);

        // Decode-only tid check — Microsoft Graph validates the signature on
        // the actual tool call. We only need the tid claim to enforce that
        // the bearer matches the configured single tenant (when one is set).
        const expectedTid = legacySecrets?.tenantId;
        if (expectedTid && expectedTid !== 'common') {
          try {
            const payload = decodeJwt(token);
            if (typeof payload.tid !== 'string') {
              res.status(401).json({ error: 'invalid_token', detail: 'missing_tid_claim' });
              return;
            }
            if (payload.tid.toLowerCase() !== expectedTid.toLowerCase()) {
              res.status(401).json({
                error: 'tenant_mismatch',
                detail: 'JWT tid does not match configured MS365_MCP_TENANT_ID',
              });
              return;
            }
          } catch (err) {
            logger.info({ err: (err as Error).message }, 'legacy /mcp: JWT decode failed');
            res.status(401).json({ error: 'invalid_token' });
            return;
          }
        }

        req.microsoftAuth = { accessToken: token };
        next();
      };

      // Handle both GET and POST methods as required by MCP Streamable HTTP specification
      app.get(
        '/mcp',
        legacyMcpAccessTokenExtractor,
        async (req: Request & { microsoftAuth?: { accessToken: string } }, res: Response) => {
          const handler = async () => {
            const server = this.createMcpServer();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined, // Stateless mode
            });

            res.on('close', () => {
              transport.close();
              server.close();
            });

            await server.connect(transport);
            await transport.handleRequest(req as any, res as any, undefined);
          };

          try {
            if (req.microsoftAuth) {
              // Merge access token into the existing ALS context (which already
              // carries requestId + tenantId from the pino-http middleware
              // above). Refresh token is NOT populated — the Graph 401 handler
              // consults SessionStore keyed by sha256(accessToken) instead of
              // reading a custom request header (plan 03-07, SECUR-02).
              const existing = getRequestTokens() ?? {};
              await requestContext.run(
                {
                  ...existing,
                  accessToken: req.microsoftAuth.accessToken,
                },
                handler
              );
            } else {
              await handler();
            }
          } catch (error) {
            logger.error('Error handling MCP GET request:', error);
            if (!res.headersSent) {
              res.status(500).json({
                jsonrpc: '2.0',
                error: {
                  code: -32603,
                  message: 'Internal server error',
                },
                id: null,
              });
            }
          }
        }
      );

      app.post(
        '/mcp',
        legacyMcpAccessTokenExtractor,
        async (req: Request & { microsoftAuth?: { accessToken: string } }, res: Response) => {
          const handler = async () => {
            const server = this.createMcpServer();
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined, // Stateless mode
            });

            res.on('close', () => {
              transport.close();
              server.close();
            });

            await server.connect(transport);
            await transport.handleRequest(req as any, res as any, req.body);
          };

          try {
            if (req.microsoftAuth) {
              // Merge access token into the existing ALS context (requestId +
              // tenantId from pino-http). Refresh token NOT populated — the
              // Graph 401 path consults SessionStore instead (plan 03-07).
              const existing = getRequestTokens() ?? {};
              await requestContext.run(
                {
                  ...existing,
                  accessToken: req.microsoftAuth.accessToken,
                },
                handler
              );
            } else {
              await handler();
            }
          } catch (error) {
            logger.error('Error handling MCP POST request:', error);
            if (!res.headersSent) {
              res.status(500).json({
                jsonrpc: '2.0',
                error: {
                  code: -32603,
                  message: 'Internal server error',
                },
                id: null,
              });
            }
          }
        }
      );

      // Health check endpoint
      app.get('/', (req, res) => {
        res.send('Microsoft 365 MCP Server is running');
      });

      // Bind the http.Server return value so we can register graceful-shutdown
      // hooks against it (plan 01-05). registerShutdownHooks internally calls
      // process.removeAllListeners('SIGTERM'|'SIGINT') first, so this
      // HTTP-mode registration supersedes any earlier stdio-mode registration
      // from src/index.ts.
      let httpServer: import('node:http').Server;
      if (host) {
        httpServer = app.listen(port, host, () => {
          logger.info(`Server listening on ${host}:${port}`);
          logger.info(`  - MCP endpoint: http://${host}:${port}/mcp`);
          logger.info(`  - OAuth endpoints: http://${host}:${port}/auth/*`);
          logger.info(
            `  - OAuth discovery: http://${host}:${port}/.well-known/oauth-authorization-server`
          );
        });
      } else {
        httpServer = app.listen(port, () => {
          logger.info(`Server listening on all interfaces (0.0.0.0:${port})`);
          logger.info(`  - MCP endpoint: http://localhost:${port}/mcp`);
          logger.info(`  - OAuth endpoints: http://localhost:${port}/auth/*`);
          logger.info(
            `  - OAuth discovery: http://localhost:${port}/.well-known/oauth-authorization-server`
          );
        });
      }
      registerShutdownHooks(httpServer, logger);

      // region:phase6-metrics-server (filled by 06-03 — OPS-07)
      // Host the PrometheusExporter's getMetricsRequestHandler behind an
      // optional Bearer gate on a dedicated port (default 9464 per D-08),
      // and wire the mcp_oauth_pkce_store_size observable gauge to the active
      // PkceStore instance. Dynamic imports so the module-load cost is only
      // paid when operators actually enable Prometheus.
      if (
        process.env.MS365_MCP_PROMETHEUS_ENABLED === '1' ||
        process.env.MS365_MCP_PROMETHEUS_ENABLED === 'true'
      ) {
        try {
          const { prometheusExporter } = await import('./lib/otel.js');
          if (prometheusExporter) {
            const { createMetricsServer } = await import('./lib/metrics-server/metrics-server.js');
            const { wirePkceStoreGauge } = await import('./lib/otel-metrics.js');
            const metricsPortEnv = process.env.MS365_MCP_METRICS_PORT;
            const metricsPort =
              metricsPortEnv !== undefined && metricsPortEnv !== '' ? Number(metricsPortEnv) : 9464;
            const metricsServer = createMetricsServer(prometheusExporter, {
              port: metricsPort,
              bearerToken: process.env.MS365_MCP_METRICS_BEARER ?? null,
            });
            // Attach mcp_oauth_pkce_store_size — observable gauge polls
            // pkceStore.size() on each collection interval.
            wirePkceStoreGauge(this.pkceStore);
            // Register shutdown hook so graceful-shutdown (plan 01-05) closes
            // the metrics listener alongside the main HTTP server.
            registerShutdownHooks(metricsServer, logger);
          } else {
            logger.warn(
              'plan 06-03: MS365_MCP_PROMETHEUS_ENABLED is truthy but prometheusExporter is undefined — check OTel bootstrap (src/lib/otel.ts)'
            );
          }
        } catch (err) {
          logger.error(
            { err: (err as Error).message },
            'plan 06-03: failed to start metrics server'
          );
        }
      }
      // endregion:phase6-metrics-server
    } else {
      const transport = new StdioServerTransport();
      await this.server!.connect(transport);
      logger.info('Server connected to stdio transport');
    }
  }
}

export default MicrosoftGraphServer;
