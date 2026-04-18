# External Integrations

**Analysis Date:** 2026-04-18

## APIs & External Services

**Microsoft Graph API (primary integration):**
- Service — `https://graph.microsoft.com/v1.0` (global cloud) or `https://microsoftgraph.chinacloudapi.cn/v1.0` (China 21Vianet cloud).
- Endpoint base resolved at request time via `getCloudEndpoints(cloudType).graphApi` — `src/cloud-config.ts`.
- HTTP client: native `fetch` with `Authorization: Bearer <token>` header — `src/graph-client.ts` `performRequest()`.
- Tool catalog: 212 declarative endpoint mappings in `src/endpoints.json`, surfaced as MCP tools in `src/graph-tools.ts`.
- Tool metadata source: regenerated from the upstream Microsoft Graph OpenAPI spec at `https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/refs/heads/master/openapi/v1.0/openapi.yaml` — `bin/modules/download-openapi.mjs`. The spec is downloaded, trimmed (`bin/modules/simplified-openapi.mjs`), then converted to a Zod-validated TypeScript client via `npx -y openapi-zod-client` — `bin/modules/generate-mcp-tools.mjs`.
- Typing: generated client lives at `src/generated/client.ts` (gitignored) with shared types in `src/generated/endpoint-types.ts` and runtime helper in `src/generated/hack.ts`.
- Endpoint tip metadata for the LLM: each endpoint may carry `llmTip`, `scopes`, `workScopes`, `returnDownloadUrl`, `supportsTimezone`, `supportsExpandExtendedProperties`, `skipEncoding`, `contentType`, `acceptType`, `readOnly` flags — schema documented inline in `src/graph-tools.ts` (`EndpointConfig` interface).

**Surface area covered (by tool category — `src/tool-categories.ts`):**
- mail — Outlook mail messages, folders, drafts, attachments
- calendar — events, calendar groups
- files — OneDrive drives, items, upload/download
- excel — workbooks, worksheets, ranges, charts
- contacts — Outlook contacts
- tasks — Microsoft To Do and Planner
- onenote — notebooks, sections, pages
- search — Microsoft Search
- users — directory user lookup (work/school)
- work (org-mode only) — Teams chats/channels/messages, SharePoint sites/lists, shared mailboxes, online meetings, presence, virtual events, places, groups

**Microsoft Identity Platform (Azure AD / Entra ID):**
- OAuth 2.0 v2.0 endpoints used for both delegated user auth and HTTP-mode token brokering:
  - Authorize: `${authority}/${tenantId}/oauth2/v2.0/authorize`
  - Token: `${authority}/${tenantId}/oauth2/v2.0/token`
  - Logout/revoke: `${authority}/${tenantId}/oauth2/v2.0/logout`
- Authority hostnames per cloud — `src/cloud-config.ts` `CLOUD_ENDPOINTS`:
  - Global: `https://login.microsoftonline.com`
  - China: `https://login.chinacloudapi.cn`
- Direct fetch implementations (no SDK) for HTTP-mode code exchange and refresh — `src/lib/microsoft-auth.ts` `exchangeCodeForToken()`, `refreshAccessToken()`.
- MSAL-driven flows for stdio mode — `src/auth.ts`:
  - Device code flow: `acquireTokenByDeviceCode()` (default `--login`)
  - Interactive browser flow: `acquireTokenInteractive()` (`--auth-browser`); opens system browser via `open` package
  - Silent refresh: `acquireTokenSilent()` (`getToken()`, `getTokenForAccount()`)
- Scopes are computed at startup from `endpoints.json` (`buildScopesFromEndpoints()` in `src/auth.ts`):
  - 100+ distinct delegated permission scopes total across personal + work modes
  - Personal-mode scope families: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `MailboxSettings.Read`/`ReadWrite`, `Calendars.Read`/`ReadWrite`, `Files.Read`/`ReadWrite`, `Notes.Read`/`Create`/`ReadWrite`, `Tasks.Read`/`ReadWrite`, `Contacts.Read`/`ReadWrite`, `User.Read`
  - Work/org-mode scopes (gated by `--org-mode`): `Mail.Read.Shared`, `Mail.Send.Shared`, `Calendars.Read.Shared`, `User.Read.All`, `People.Read`, `Directory.Read.All`, `Group.Read.All`/`ReadWrite.All`, `GroupMember.Read.All`, `Chat.Read`/`ReadWrite`, `ChatMember.Read`, `ChatMessage.Read`/`Send`, `Team.ReadBasic.All`, `TeamMember.Read.All`/`ReadWrite.All`, `Channel.ReadBasic.All`/`Create`/`Delete.All`, `ChannelSettings.Read.All`/`ReadWrite.All`, `ChannelMessage.Read.All`/`Send`, `TeamsTab.Read.All`, `Sites.Read.All`/`ReadWrite.All`, `OnlineMeetings.Read`/`ReadWrite`, `OnlineMeetingTranscript.Read.All`, `OnlineMeetingRecording.Read.All`, `OnlineMeetingArtifact.Read.All`, `Presence.Read`/`Read.All`, `VirtualEvent.Read`, `Place.Read.All`/`ReadWrite.All`
- Scope hierarchy collapse: when both `*.Read` and `*.ReadWrite` are requested, `*.Read` is dropped — `SCOPE_HIERARCHY` constant in `src/auth.ts`.
- Default fallback client IDs (pre-registered public clients) per cloud — `src/cloud-config.ts` `DEFAULT_CLIENT_IDS`:
  - Global: `084a3e9f-a9f4-43f7-89f9-d229cf97853e`
  - China: `f3e61a6e-bc26-4281-8588-2c7359a02141`
  These are not secrets; they are the default app registrations consumed when `MS365_MCP_CLIENT_ID` is unset.

**Microsoft Teams URL parsing (utility, not an integration):**
- `parseTeamsUrl()` in `src/lib/teams-url-parser.ts` converts short `/meet/` and `/v2/#/meetingrecap` Teams URLs into a `joinWebUrl` form usable by Graph `list-online-meetings`.

## Data Storage

**Databases:**
- None. The server is stateless — `docs/deployment.md` and `examples/azure-container-apps/README.md` explicitly call out the no-token-store design.

**File Storage:**
- Local filesystem only, for token caches and selected-account markers (no user content storage):
  - Token cache: `.token-cache.json` (default location: `dist/../.token-cache.json` relative to `import.meta.url` — `src/auth.ts` `DEFAULT_TOKEN_CACHE_PATH`). Override with `MS365_MCP_TOKEN_CACHE_PATH`.
  - Selected account: `.selected-account.json` (parallel default location). Override with `MS365_MCP_SELECTED_ACCOUNT_PATH`.
  - Both are written with mode `0600` and parent directories with mode `0700` — `src/auth.ts` `ensureParentDir()`, `saveTokenCache()`.
  - Both are wrapped with a timestamped envelope (`wrapCache`/`unwrapCache`) so the newer of file vs keychain wins on load — `pickNewest()`.
- Logs: `~/.ms-365-mcp-server/logs/error.log` and `~/.ms-365-mcp-server/logs/mcp-server.log` (via Winston file transports — `src/logger.ts`). Override directory with `MS365_MCP_LOG_DIR`.

**Caching:**
- In-memory MSAL token cache (deserialized from disk at startup, serialized after every successful acquisition).
- In-memory PKCE store with 10-minute TTL and 1000-entry cap for the two-leg PKCE flow — `src/server.ts` `pkceStore`.
- In-memory secrets cache after first `getSecrets()` call — `src/secrets.ts` `cachedSecrets` (cleared via `clearSecretsCache()` for tests).
- In-memory BM25 index for `--discovery` mode tool search — built once at startup in `src/graph-tools.ts` (`buildBM25Index` from `src/lib/bm25.ts`).

## Authentication & Identity

**Auth Provider:**
- Microsoft Identity Platform (Azure AD / Entra ID) — delegated user auth only. The server never uses application permissions or client-credentials grant.

**Implementation by transport:**

*Stdio transport (default, single-user):*
- Auth flow chosen at runtime in `src/index.ts` `main()`:
  - `--login` + `--auth-browser` → MSAL `acquireTokenInteractive` → opens system browser via `open` package, listens on a localhost callback (handled by MSAL).
  - `--login` (default) → MSAL `acquireTokenByDeviceCode` → prints device code, user completes at `https://microsoft.com/devicelogin`.
- Tokens persisted in the MSAL serialized cache, stored by preference in OS keychain (`keytar`); falls back to file storage on Linux/Alpine where keytar is unavailable — `src/auth.ts` `saveTokenCache()`.
- Multi-account: cache may hold multiple accounts; `select-account`/`list-accounts` MCP tools and `--select-account` CLI flag pick which account a tool call targets. `account` parameter is auto-injected into every tool schema when `>1` account is cached — `src/server.ts` `initialize()`, `src/auth.ts` `getTokenForAccount()`.

*HTTP transport (`--http`, multi-user, stateless):*
- Server acts as an OAuth 2.0 proxy in front of Microsoft. MCP clients (Claude Desktop, claude.ai, Open WebUI, etc.) authenticate against the server; the server forwards the user to Microsoft.
- Express routes wired in `src/server.ts`:
  - `GET /.well-known/oauth-authorization-server` — OAuth Authorization Server metadata (RFC 8414). Issuer/authorize use `publicBase` (proxy-facing); token uses `requestOrigin` (server-to-server). Includes `code_challenge_methods_supported: ['S256']` and `scopes_supported` derived from `endpoints.json`.
  - `GET /.well-known/oauth-protected-resource` — Protected Resource metadata (RFC 9728). Resource = `${requestOrigin}/mcp`.
  - `POST /register` — Dynamic Client Registration (RFC 7591) endpoint, enabled by default in HTTP mode (toggle with `--no-dynamic-registration`).
  - `GET /authorize` — Redirects to `${authority}/${tenantId}/oauth2/v2.0/authorize` with the configured `MS365_MCP_CLIENT_ID`. Implements **two-leg PKCE**: the server stores the client's `code_challenge`, generates an independent `code_verifier`/`code_challenge` pair for the server↔Microsoft leg, sends the server's challenge to Microsoft, and matches them up at `/token`. State-keyed in `pkceStore`.
  - `POST /token` — Handles `authorization_code` and `refresh_token` grants. Looks up the matching server PKCE verifier and forwards to Microsoft via `exchangeCodeForToken()` / `refreshAccessToken()`.
  - `app.use(mcpAuthRouter({ provider: oauthProvider, issuerUrl }))` — Mounts MCP SDK's auth router using `MicrosoftOAuthProvider` (`src/oauth-provider.ts`), which extends `ProxyOAuthServerProvider` and verifies access tokens by calling `${graphApi}/v1.0/me`.
  - `GET /mcp`, `POST /mcp` — Streamable HTTP MCP endpoints, gated by `microsoftBearerTokenAuthMiddleware` from `src/lib/microsoft-auth.ts`. The middleware extracts `Authorization: Bearer …` and the optional `x-microsoft-refresh-token` header and stores them on `req.microsoftAuth`. Tokens are then propagated to the request handler via an `AsyncLocalStorage` request context — `src/request-context.ts` — so `GraphClient.makeRequest()` can pick them up per request without thread-locals.
- Stateless mode: `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`; a fresh `McpServer` is created per request — `src/server.ts`.
- 401 response handling: when Graph returns 401 and a refresh token is available, `GraphClient.makeRequest()` calls `refreshAccessToken()` and retries once.

*OAuth/HTTP environment-token shortcut:*
- If `MS365_MCP_OAUTH_TOKEN` is set at process start, `AuthManager` enters `isOAuthMode` and returns that token from `getToken()` without invoking MSAL — `src/auth.ts` constructor.

**Token storage layers (stdio mode):**
1. OS keychain (`keytar`) — service `ms-365-mcp-server`, accounts `msal-token-cache` and `selected-account`. Lazy-imported.
2. File fallback — `.token-cache.json`, `.selected-account.json` with restrictive permissions.
3. `pickNewest()` reconciles the two on load using saved timestamps from the envelope.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry/Datadog/Application Insights SDK imports detected.

**Logs:**
- Winston (`src/logger.ts`):
  - File transport (always on): `${MS365_MCP_LOG_DIR or ~/.ms-365-mcp-server/logs}/error.log` (level `error`) and `mcp-server.log` (level `info`+).
  - Console transport: opt-in via `enableConsoleLogging()`, called only when `-v` is passed (`src/server.ts` `start()`). Suppressible via `SILENT=1`. **Critical**: must remain off by default in stdio mode — stdout is reserved for MCP JSON-RPC framing.
- Log directory created at startup with mode `0700`.
- Tokens are explicitly redacted before logging — `src/graph-tools.ts` strips `accessToken` from logged options; `src/server.ts` substring-truncates state values.
- Server startup logs a redacted secrets summary — `src/server.ts` `start()` (`Secrets Check:` log).

## CI/CD & Deployment

**Hosting:**
- npm package: `@softeria/ms-365-mcp-server` (`package.json` `name`, `publishConfig.access: public`).
- Container image: `ghcr.io/softeria/ms-365-mcp-server` (referenced in `examples/azure-container-apps/README.md`).
- Reference deployment target: Azure Container Apps with Key Vault + UAMI — `examples/azure-container-apps/main.bicep`, `examples/azure-container-apps/deploy.ps1`.
- General deployment guidance: `docs/deployment.md` (Docker, Azure, behind reverse proxy with `MS365_MCP_PUBLIC_URL`).

**CI Pipeline (GitHub Actions):**
- `.github/workflows/build.yml` — runs on PRs to `main` and `workflow_dispatch`. Matrix `node-version: [18.x, 20.x, 22.x]`. Steps: `npm ci` → `npm run generate` (regenerates Graph client) → `npm run lint` → `npm run format:check` → `npm run build` → `npm test`.
- `.github/workflows/release.yml` — runs on push to `main`. Same build steps, then `npx semantic-release` with `GITHUB_TOKEN` and `NPM_TOKEN` secrets. Publishes to npm and creates GitHub release. Permissions: `contents: write`, `issues: write`, `pull-requests: write`.

**Release tooling:**
- `semantic-release` with plugins `@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`, `@semantic-release/npm`, `@semantic-release/github` — `.releaserc.json`. Version is set to `0.0.0-development` in source and rewritten by semantic-release based on conventional commits.

**Inspector / dev tooling:**
- `npm run inspector` → `npx @modelcontextprotocol/inspector tsx src/index.ts` — launches the MCP Inspector UI for local tool exploration.

## Environment Configuration

**Required env vars (HTTP / production):**
- `MS365_MCP_CLIENT_ID` — Required when not using the built-in default public client (effectively required for production).
- `MS365_MCP_TENANT_ID` — Required for single-tenant apps; defaults to `common`.
- `MS365_MCP_CLIENT_SECRET` — Required only for confidential client mode.

**Required env vars (Key Vault mode):**
- `MS365_MCP_KEYVAULT_URL` — Triggers `KeyVaultSecretsProvider`. Authentication uses `DefaultAzureCredential` (managed identity, Azure CLI, or `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`AZURE_TENANT_ID` env vars).
- Required Key Vault secret names — `src/secrets.ts` `KeyVaultSecretsProvider.getSecrets()`:
  - `ms365-mcp-client-id` (required)
  - `ms365-mcp-tenant-id` (optional, defaults to `common`)
  - `ms365-mcp-client-secret` (optional)
  - `ms365-mcp-cloud-type` (optional, defaults to `global`)

**Optional env vars (full list):**
- `MS365_MCP_CLOUD_TYPE`, `MS365_MCP_OAUTH_TOKEN`, `MS365_MCP_TOKEN_CACHE_PATH`, `MS365_MCP_SELECTED_ACCOUNT_PATH`, `MS365_MCP_LOG_DIR`, `MS365_MCP_CORS_ORIGIN`, `MS365_MCP_PUBLIC_URL` (and deprecated `MS365_MCP_BASE_URL`), `MS365_MCP_ORG_MODE`, `MS365_MCP_FORCE_WORK_SCOPES`, `MS365_MCP_OUTPUT_FORMAT`, `MS365_MCP_MAX_TOP`, `MS365_MCP_BODY_FORMAT`, `READ_ONLY`, `ENABLED_TOOLS`, `LOG_LEVEL`, `SILENT`, `NODE_ENV`.
- See `STACK.md` for descriptions of each.

**Secrets location:**
- Local development: `.env` file at project root (loaded by `dotenv`). Template at `.env.example`. `.env*` is gitignored.
- Production: Azure Key Vault when `MS365_MCP_KEYVAULT_URL` is set, accessed via `DefaultAzureCredential` (recommended: user-assigned managed identity per the Bicep example).
- Token caches: OS keychain via `keytar` if installable, otherwise `.token-cache.json` (file mode `0600`). Both `.token-cache.json` and `.selected-account.json` are gitignored.

## Webhooks & Callbacks

**Incoming:**
- `GET /authorize` — OAuth 2.0 authorization endpoint (browser entry).
- `POST /token` — OAuth 2.0 token endpoint (token exchange + refresh).
- `POST /register` — RFC 7591 dynamic client registration (default-on in HTTP mode; toggle with `--no-dynamic-registration`).
- `GET /.well-known/oauth-authorization-server` — RFC 8414 discovery.
- `GET /.well-known/oauth-protected-resource` — RFC 9728 discovery.
- `GET /mcp`, `POST /mcp` — MCP Streamable HTTP endpoints (require `Authorization: Bearer …`, optional `x-microsoft-refresh-token`).
- `GET /` — Health check ("Microsoft 365 MCP Server is running").
- OAuth callback URLs registered with Microsoft (configured in the Azure AD app registration, not implemented as routes here):
  - `http://localhost:6274/oauth/callback` (MCP Inspector default)
  - `http://localhost:6274/oauth/callback/debug`
  - `http://localhost:3000/callback` (server callback shape returned by `MicrosoftOAuthProvider.getClient()`)
- All routes serve CORS headers controlled by `MS365_MCP_CORS_ORIGIN` (default `http://localhost:3000`); preflight `OPTIONS` returns 200.

**Outgoing:**
- HTTPS calls to Microsoft Graph (`fetch` from `src/graph-client.ts`).
- HTTPS calls to Microsoft Identity Platform OAuth endpoints (`fetch` from `src/lib/microsoft-auth.ts` and MSAL internals).
- HTTPS call to Azure Key Vault when `MS365_MCP_KEYVAULT_URL` is set (Azure SDK retry logic).
- HTTPS GET to GitHub raw to download the Microsoft Graph OpenAPI spec at codegen time only (`bin/modules/download-openapi.mjs`); not at runtime.
- No outgoing webhooks to user-supplied URLs.

---

*Integration audit: 2026-04-18*
