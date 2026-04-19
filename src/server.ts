import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import express, { Request, Response } from 'express';
import logger, { enableConsoleLogging } from './logger.js';
import { registerAuthTools } from './auth-tools.js';
import { registerGraphTools, registerDiscoveryTools } from './graph-tools.js';
import { buildMcpServerInstructions } from './mcp-instructions.js';
import GraphClient from './graph-client.js';
import AuthManager, { buildScopesFromEndpoints } from './auth.js';
import { MicrosoftOAuthProvider } from './oauth-provider.js';
import {
  exchangeCodeForToken,
  microsoftBearerTokenAuthMiddleware,
  refreshAccessToken,
} from './lib/microsoft-auth.js';
import type { CommandOptions } from './cli.ts';
import { getSecrets, type AppSecrets } from './secrets.js';
import { getCloudEndpoints } from './cloud-config.js';
import { requestContext, getRequestTokens } from './request-context.js';
import { mountHealth } from './lib/health.js';
import { registerShutdownHooks } from './lib/shutdown.js';
import { validateRedirectUri, type RedirectUriPolicy } from './lib/redirect-uri.js';
import { createCorsMiddleware, type CorsMode } from './lib/cors.js';
import type { CloudType } from './cloud-config.js';
import crypto from 'node:crypto';
import pinoHttp from 'pino-http';
import { nanoid } from 'nanoid';

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
 * PKCE store entry for the two-leg PKCE bridge. The HTTP setup owns the
 * Map; the factory reads and mutates it per request. Typed here (rather
 * than inlined on the class) so the token-handler factory can accept the
 * Map as a dependency-injected parameter — tests use a fresh Map per
 * spec, production uses the per-instance Map on `MicrosoftGraphServer`.
 */
export interface PkceStoreEntry {
  clientCodeChallenge: string;
  clientCodeChallengeMethod: string;
  serverCodeVerifier: string;
  createdAt: number;
}

export type PkceStore = Map<string, PkceStoreEntry>;

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

        // Two-leg PKCE: if the client sent a code_verifier, hash it and
        // look it up against each stored challenge. The matching entry
        // carries the server's code_verifier (for Microsoft).
        let serverCodeVerifier: string | undefined;
        if (body.code_verifier) {
          const clientVerifier = body.code_verifier as string;
          const clientChallengeComputed = crypto
            .createHash('sha256')
            .update(clientVerifier)
            .digest('base64url');

          for (const [state, pkceData] of pkceStore) {
            if (pkceData.clientCodeChallenge === clientChallengeComputed) {
              serverCodeVerifier = pkceData.serverCodeVerifier;
              pkceStore.delete(state);
              logger.info(
                { state: state.substring(0, 8) + '...' },
                'Two-leg PKCE: matched client verifier, using server verifier'
              );
              break;
            }
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
        const tenantId = secrets.tenantId || 'common';
        const clientId = secrets.clientId;
        const clientSecret = secrets.clientSecret;

        if (clientSecret) {
          logger.info({}, 'Refresh endpoint: Using confidential client with client_secret');
        } else {
          logger.info({}, 'Refresh endpoint: Using public client without client_secret');
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

  // Two-leg PKCE: stores client's code_challenge and server's code_verifier, keyed by OAuth state
  private pkceStore: Map<
    string,
    {
      clientCodeChallenge: string;
      clientCodeChallengeMethod: string;
      serverCodeVerifier: string;
      createdAt: number;
    }
  > = new Map();

  constructor(authManager: AuthManager, options: CommandOptions = {}) {
    this.authManager = authManager;
    this.options = options;
    this.graphClient = null; // Initialized in start() after secrets are loaded
    this.server = null;
    this.secrets = null;
  }

  private createMcpServer(): McpServer {
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

    return server;
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
      // Phase 3 will push a Postgres/Redis readinessChecks entry here;
      // Phase 6 will push "at least one tenant loaded". Phase 1 baseline has
      // no checks — default empty array is correct.
      mountHealth(app);

      // pino-http request logging — MUST be registered BEFORE express.json() so
      // that req.id is stamped on the raw request before body parsing starts.
      app.use(
        pinoHttp({
          logger,
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
      app.use(express.json({ limit: bodyParserLimit }));
      app.use(express.urlencoded({ extended: true, limit: bodyParserLimit }));

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

        // Two-leg PKCE: if the client sent a code_challenge, store it and generate
        // a separate PKCE pair for the server↔Microsoft leg
        if (clientCodeChallenge && state) {
          const serverCodeVerifier = crypto.randomBytes(32).toString('base64url');
          const serverCodeChallenge = crypto
            .createHash('sha256')
            .update(serverCodeVerifier)
            .digest('base64url');

          // Clean up expired entries before adding new ones
          const now = Date.now();
          const maxAge = 10 * 60 * 1000; // 10 minutes
          const maxEntries = 1000;
          for (const [key, value] of this.pkceStore) {
            if (now - value.createdAt > maxAge) {
              this.pkceStore.delete(key);
            }
          }

          // Reject if store is still at capacity after cleanup (prevents memory exhaustion)
          if (this.pkceStore.size >= maxEntries) {
            logger.warn(
              `PKCE store at capacity (${maxEntries} entries) — rejecting new authorization request`
            );
            res.status(503).json({
              error: 'server_busy',
              error_description: 'Too many pending authorization requests. Try again later.',
            });
            return;
          }

          this.pkceStore.set(state, {
            clientCodeChallenge,
            clientCodeChallengeMethod: clientCodeChallengeMethod || 'S256',
            serverCodeVerifier,
            createdAt: Date.now(),
          });

          // Send our server-generated code_challenge to Microsoft
          microsoftAuthUrl.searchParams.set('code_challenge', serverCodeChallenge);
          microsoftAuthUrl.searchParams.set('code_challenge_method', 'S256');

          logger.info('Two-leg PKCE: stored client challenge, generated server challenge', {
            state: state.substring(0, 8) + '...',
          });
        } else if (clientCodeChallenge) {
          // No state to key on — fall back to forwarding directly (Claude Code path)
          microsoftAuthUrl.searchParams.set('code_challenge', clientCodeChallenge);
          if (clientCodeChallengeMethod) {
            microsoftAuthUrl.searchParams.set('code_challenge_method', clientCodeChallengeMethod);
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
      // Handle both GET and POST methods as required by MCP Streamable HTTP specification
      app.get(
        '/mcp',
        microsoftBearerTokenAuthMiddleware,
        async (
          req: Request & { microsoftAuth?: { accessToken: string; refreshToken: string } },
          res: Response
        ) => {
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
              // Merge auth tokens into the existing ALS context (which already
              // carries requestId + tenantId from the pino-http middleware above).
              const existing = getRequestTokens() ?? {};
              await requestContext.run(
                {
                  ...existing,
                  accessToken: req.microsoftAuth.accessToken,
                  refreshToken: req.microsoftAuth.refreshToken,
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
        microsoftBearerTokenAuthMiddleware,
        async (
          req: Request & { microsoftAuth?: { accessToken: string; refreshToken: string } },
          res: Response
        ) => {
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
              // Merge auth tokens into the existing ALS context (which already
              // carries requestId + tenantId from the pino-http middleware above).
              const existing = getRequestTokens() ?? {};
              await requestContext.run(
                {
                  ...existing,
                  accessToken: req.microsoftAuth.accessToken,
                  refreshToken: req.microsoftAuth.refreshToken,
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
    } else {
      const transport = new StdioServerTransport();
      await this.server!.connect(transport);
      logger.info('Server connected to stdio transport');
    }
  }
}

export default MicrosoftGraphServer;
