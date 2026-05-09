# Full Codebase Review

Date: 2026-04-26

Scope: repo-wide read-only review across source, tests, scripts, CI, Docker, examples, and docs. Generated output, `dist`, `node_modules`, and OpenAPI bulk inputs were excluded except where they affect runtime behavior.

Verification performed:

- `npm run build` passed.
- `npm run lint` passed with warnings only.
- `npm pack --dry-run --json` was spot-checked for sensitive/package contents.
- P0/P1 findings were spot-checked against source before consolidation.
- Six subsystem reviewers plus one test/coverage reviewer were dispatched in parallel.

## P0 Findings

### P0-1: Public `@claude` workflow has write-capable repo context

Files: `.github/workflows/claude.yml:6`, `.github/workflows/claude.yml:16`, `.github/workflows/claude.yml:36`

Issue: Public issue/comment/review events can trigger Claude when a body contains `@claude`. The workflow grants `contents: write`, `issues: write`, `pull-requests: write`, `id-token: write`, passes `ANTHROPIC_API_KEY`, and allows `Edit`, `Write`, and `Bash`. There is no actor association allowlist.

Impact: In a public repo, any GitHub user can prompt an agent in the base repository context. Prompt injection or crafted instructions can attempt repository writes, PR manipulation, OIDC misuse, or secret exposure through logs/tool output.

Minimal fix: Gate the job to trusted actors only, such as `OWNER`, `MEMBER`, or `COLLABORATOR`. Default public triggers to `contents: read`, remove `Bash/Edit/Write`, and require protected environment approval for any write-capable agent run.

Tests/checks: Add `actionlint` and a workflow policy check that fails if issue/comment workflows combine public triggers with write permissions and no trusted-actor guard.

### P0-2: npm package can include local secrets and planning data

Files: `.npmignore:21`, `package.json`, `src/auth.ts:35`

Issue: There is no `package.json.files` allowlist and `.npmignore` does not exclude `.env*`, `.token-cache.json`, `.selected-account.json`, or `.planning/`. `AuthManager` also defaults token cache files to the package root.

Impact: A publish from a developer workspace can ship local `.env` contents, MSAL token cache material, selected-account data, and internal planning artifacts to npm.

Minimal fix: Add a strict `files` allowlist in `package.json`. Explicitly exclude `.env*`, `.token-cache.json`, `.selected-account.json`, `.planning/`, coverage, logs, and local config. Move default token/account cache paths outside the repo/package directory, ideally under a user data directory, and encrypt token cache material at rest.

Tests/checks: Add a packaging test around `npm pack --dry-run --json` that fails if sensitive paths appear. Add an auth-path test proving defaults resolve outside the project root.

### P0-3: App-only tenants accept unauthenticated MCP requests

Files: `src/lib/auth-selector.ts:80`, `src/lib/auth-selector.ts:90`, `test/auth/app-only.test.ts:157`

Issue: If a tenant is `mode === 'app-only'` and no `Authorization` header is present, the auth selector acquires a client-credentials token from the tenant pool and calls `next()`. The tests currently assert this no-auth behavior as success.

Impact: Anyone who knows or can discover a tenant URL can use the gateway's stored app credentials to access Graph-backed and local MCP tools for that tenant. Tenant UUID secrecy is not authentication.

Minimal fix: Require a caller credential before app-only token acquisition, such as a tenant API key, signed client assertion, mTLS, or a verified gateway bearer. Treat no-auth app-only requests as `401`.

Tests/checks: Invert `test/auth/app-only.test.ts` so no-auth app-only requests fail. Add a positive test for the chosen gateway credential.

### P0-4: Bearer auth is decode-only but gates local MCP state

Files: `src/lib/microsoft-auth.ts:31`, `src/lib/microsoft-auth.ts:70`, `src/lib/microsoft-auth.ts:112`, `src/server.ts:1422`, `test/auth/bearer.test.ts:146`

Issue: Bearer middleware uses `jose.decodeJwt()` without verifying signature, issuer, audience, or expiry. A tampered token with a matching `tid` is accepted by design in tests. That token gates the full tenant MCP surface, including local tools/resources that do not call Graph and therefore are not protected by Graph's downstream token validation.

Impact: Forged tokens can access tenant-local state such as facts, recipes, bookmarks, and audit resources. The same path also compares `tid` to the route registry id rather than the tenant row's Azure AD `tenant_id`, which can break legitimate bearer tenants where those ids differ.

Minimal fix: Verify bearer JWT signatures against Entra JWKS, validate issuer/audience/expiry, and compare `tid` to `req.tenant.tenant_id`. If pass-through bearer is still needed for Graph, only forward verified tokens into request context.

Tests/checks: Replace the "tampered signature accepted" test with a rejection test. Add tenant tests where `tenants.id !== tenants.tenant_id`: `tid === tenant_id` passes, `tid === id` fails. Add integration coverage proving forged bearer cannot call local-only MCP resources/tools.

## P1 Findings

### P1-1: Entra admin membership cache bypasses token validation after warmup

Files: `src/lib/admin/auth/entra.ts:190`, `src/lib/admin/auth/entra.ts:204`, `src/lib/admin/auth/entra.ts:212`

Issue: Admin Entra auth decodes the bearer JWT, checks `aud`, then returns cached group membership by UPN before validating the presented token through Graph.

Impact: After a real admin authenticates once, a forged or expired JWT with the same UPN and expected audience can receive global admin access until the membership cache expires.

Minimal fix: Validate signature/issuer/expiry before cache lookup, or key cache entries by validated token/session identity. Prefer `oid` + `tid` over UPN.

Tests/checks: Warm the cache with a valid admin token, retry with a forged or expired same-UPN token, and assert `401`/null.

### P1-2: Discovery `execute-tool` can widen authorization beyond tenant enabled tools

Files: `src/lib/discovery-catalog/catalog.ts:18`, `src/graph-tools.ts:1363`

Issue: For discovery tenants with non-explicit `enabled_tools`, `discoveryCatalogSet` is built from every registry alias. `execute-tool` then runs with `enabledToolsSet: catalog.discoveryCatalogSet`, replacing the tenant's real allowlist.

Impact: A default discovery tenant whose visible tools are only discovery meta tools can execute any registered Graph tool by name through `execute-tool`.

Minimal fix: Keep dispatch authorization tied to the tenant's real enabled set. If broad execution is intended, require an explicit `all-catalog` or equivalent tenant preset.

Tests/checks: Add a discovery-mode test where `enabledToolsSet` contains only discovery meta tools and `execute-tool` for a generated write alias fails without a Graph call.

### P1-3: Synthetic Graph tools bypass tenant enabled-tool gates

Files: `src/graph-tools.ts:966`, `src/graph-tools.ts:971`

Issue: `graph-batch`, `graph-upload-large-file`, and async subscription helpers are registered independently of the tenant `enabledToolsSet`. Generated catalog tools pass through dispatch checks; these synthetic Graph-capable tools do not.

Impact: A tenant that cannot call a disabled generated write tool can still call `graph-batch` and submit arbitrary Graph subrequests, or call upload/subscription helpers if it knows the tool name.

Minimal fix: Gate all synthetic Graph-capable tools with the same dispatch guard, or only register them when their alias is present in the tenant enabled set.

Tests/checks: Add direct `tools/call` tests proving disabled `graph-batch`, `graph-upload-large-file`, and subscription helpers do not call Graph.

### P1-4: Product routing sends product calls to Graph instead of product APIs

Files: `src/lib/dispatch/product-routing.ts:223`, `src/graph-client.ts:333`, `src/graph-client.ts:339`

Issue: Product dispatch passes `baseUrl` into `graphRequest`, but `GraphClient.performRequest()` always builds `https://graph.microsoft.com/v1.0${endpoint}` and ignores `options.baseUrl`. It also does not route through the generated product endpoint path/method/body mapping.

Impact: Power BI, Power Platform, Exchange Online, and SharePoint Admin product tools can receive product audience tokens but send requests to Microsoft Graph, causing failures or unpredictable behavior.

Minimal fix: Make `GraphClient` honor a validated `baseUrl`, or add a product client path that uses generated product endpoint metadata for path, method, query, headers, and body.

Tests/checks: Add a real GraphClient/product-routing test proving `__powerbi__Groups_GetGroups` fetches `https://api.powerbi.com/v1.0/myorg/...`, not Graph.

### P1-5: Graph request bodies are logged verbatim

Files: `src/graph-tools.ts:470`, `src/graph-tools.ts:594`

Issue: Body parameters are logged with `JSON.stringify(body)`, and request options logging includes `options.body`.

Impact: Email bodies, calendar content, file data, or other tenant PII/secrets can appear in normal logs.

Minimal fix: Log only body presence, byte length, content type, and parameter keys. Never serialize body content.

Tests/checks: Add logger spy tests for body-bearing Graph calls and assert no body text is present in any log argument.

### P1-6: Legacy `/token` returns upstream refresh tokens

Files: `src/server.ts:308`, `src/server.ts:317`

Issue: The legacy root `/token` authorization-code path returns Microsoft's full token response directly.

Impact: If Microsoft issues a `refresh_token`, it crosses the client boundary despite the v2 design keeping refresh tokens server-side in `SessionStore`.

Minimal fix: Strip `refresh_token` from legacy `/token` responses or retire the root OAuth mount. Reject or strip `offline_access` for legacy flows if refresh cannot be stored server-side.

Tests/checks: Mock `exchangeCodeForToken()` returning a `refresh_token` and assert `/token` omits it.

### P1-7: Global 60 MB body parsing happens before auth and rate limiting

Files: `src/server.ts:1596`, `src/server.ts:1605`, `src/server.ts:1609`

Issue: Global JSON/urlencoded parsers accept up to `60mb` before CORS, tenant auth, and tenant rate limiting.

Impact: Unauthenticated clients can force large body buffering/parsing on any route before rejection.

Minimal fix: Use a small global parser limit and mount large upload parsing only on authenticated, rate-limited upload routes.

Tests/checks: Add unauthenticated oversized POST tests for `/register` and `/t/:tenantId/mcp`; verify early `413` before auth/tool execution.

### P1-8: Metrics shutdown hook replaces main HTTP shutdown hook

Files: `src/lib/shutdown.ts:126`, `src/lib/shutdown.ts:130`, `src/server.ts:2103`, `src/server.ts:2132`

Issue: `registerShutdownHooks()` removes all existing `SIGTERM`/`SIGINT` listeners. When Prometheus metrics are enabled, the second call for the metrics server replaces the main server hook.

Impact: On SIGTERM with metrics enabled, the main server can keep accepting work until process exit, risking aborted in-flight requests and shutdown data loss.

Minimal fix: Register one composite shutdown handler or make the shutdown registry manage multiple server handles without removing prior handlers.

Tests/checks: Extend graceful shutdown tests to register main and metrics servers and assert both close on SIGTERM.

### P1-9: First-use delta token locking does not serialize concurrent callers

Files: `src/lib/delta/with-delta-token.ts:81`

Issue: `SELECT ... FOR UPDATE` locks no row when the delta token row does not exist yet, so two first-use callers can both run with `deltaLink = null`.

Impact: Duplicate full sweeps and last-writer-wins token storage can regress ordering or lose the latest delta state.

Minimal fix: Use a transaction-scoped advisory lock on `(tenantId, resource)`, or insert and lock a sentinel row before reading/updating.

Tests/checks: Add a real Postgres concurrency test where two fresh calls run concurrently and only one sees `null`.

### P1-10: Tenant disable/delete does not evict API-key auth caches

Files: `src/lib/admin/tenants.ts:1069`

Issue: Tenant disable/delete revokes API keys in the database but does not evict local API-key auth cache entries or publish per-key revocation.

Impact: A previously used tenant-scoped admin key can authenticate until cache expiry after tenant disable/delete, weakening disable and cryptoshred guarantees.

Minimal fix: Return revoked key ids from the transaction, evict local cache entries after commit, and publish `mcp:api-key-revoke` for each. Reject disabled tenants before caching API-key verification results.

Tests/checks: Warm a tenant API-key cache, disable the tenant, immediately call an admin route with that key, and assert `401`.

### P1-11: Azure consent helper grants all existing app permissions

Files: `bin/azure-grant-consent-per-resource.sh:50`

Issue: The script grants tenant admin consent for every current `requiredResourceAccess` entry on the app registration, not only this project's expected resources/scopes.

Impact: Stale or malicious high-privilege permissions already present on the app can be admin-consented by this helper.

Minimal fix: Add an allowlist of expected resource app ids and permission values. Fail on unknown entries unless an explicit `--allow-extra` flag is provided.

Tests/checks: Stub `az ad app show` with one expected and one unexpected permission; assert the script exits before any grant.

### P1-12: KEK rotation exits successfully after unwrap failures

Files: `bin/rotate-kek.mjs:121`

Issue: KEK unwrap failures are counted as skipped and the command can exit successfully even when the old KEK is wrong for all rows.

Impact: An operator can rotate with a typo, switch the service to the new KEK, and make existing tenant DEKs unreadable.

Minimal fix: Fail nonzero on unwrap failures by default, or at least fail when `rewrapped === 0 && skipped > 0`. Require explicit `--allow-skipped` for known corrupt rows.

Tests/checks: Seed wrapped DEKs, run with a wrong old key, and assert nonzero exit plus no successful rotation report.

### P1-13: Generated product/beta alias prefix checks miss numeric/underscore aliases

Files: `bin/modules/beta.mjs:124`, `bin/modules/run-product-pipeline.mjs:166`

Issue: Generated aliases are only prefixed when they start with letters. Numeric or underscore aliases can remain unprefixed and evade collision/churn checks.

Impact: Product tools can fall through to Graph routing instead of product-specific audience/base URL handling, and beta tools can bypass beta usage logging.

Minimal fix: After generation, extract every emitted alias and fail unless beta/product aliases have the required prefix. Include all emitted aliases in collision checks.

Tests/checks: Add fixtures with operation ids beginning with uppercase, digits, and underscores.

### P1-14: Reverse proxy examples omit tenant-scoped v2 routes

Files: `examples/reverse-proxy/traefik.yml:47`, `examples/reverse-proxy/Caddyfile:36`, `examples/reverse-proxy/nginx.conf:46`

Issue: Examples route legacy `/mcp`, `/authorize`, `/token`, `/register`, and `/.well-known/*`, but omit `/t/:tenantId/*`.

Impact: Users following the examples get 404s for v2 tenant-scoped MCP/OAuth/webhook routes and may fall back to legacy singleton paths.

Minimal fix: Route `/t/*` to the app with streaming buffering disabled, including `/t/:tenantId/mcp`, `/authorize`, `/token`, `/sse`, `/messages`, and `/notifications`.

Tests/checks: Add proxy smoke tests for tenant well-known metadata, `/t/<tenant>/mcp`, and `/t/<tenant>/notifications`.

### P1-15: Admin isolation docs still expose `/admin` on the public MCP host

Files: `docs/observability/reverse-proxy/caddy.md:21`, `docs/observability/reverse-proxy/nginx.md:57`, `docs/observability/reverse-proxy/traefik.md:21`

Issue: Public `mcp.example.com` routes are catch-alls, so `/admin/*` can still reach the backend even though docs describe `admin.example.com` as the isolated admin surface.

Impact: Operators relying on subdomain/IP ACL separation expose admin endpoints on the public MCP hostname. Auth still applies, but the intended network boundary is bypassed.

Minimal fix: Deny `/admin*` on public MCP hosts and route only explicit public paths. Proxy `/admin*` only from the admin hostname with ACL/SSO.

Tests/checks: Assert `mcp.example.com/admin/health` returns `403` or `404`; assert `admin.example.com/admin/health` works only from allowed networks.

### P1-16: Example Compose uses known Postgres credentials

Files: `examples/docker-compose/docker-compose.yml:62`, `examples/docker-compose/.env.example:40`

Issue: The reference example defaults to `postgresql://mcp:mcp@postgres:5432/mcp` and `POSTGRES_PASSWORD=mcp`.

Impact: If copied to production or exposed to another host/network, the tenant registry/audit database has public, known credentials.

Minimal fix: Require `${POSTGRES_PASSWORD:?}` and no default password. Leave `.env.example` blank with generation instructions.

Tests/checks: `docker compose config` should fail without `POSTGRES_PASSWORD`; add a secret-policy grep blocking `:mcp@` and `POSTGRES_PASSWORD=mcp`.

### P1-17: CI quarantines security-critical tests by default

Files: `vitest.config.js:30`, `.github/workflows/integration.yml:55`

Issue: `CI_FLAKY_QUARANTINE` is enabled automatically when `CI=true`, excluding request-context isolation, auth flows, tenant-disable cascade, two-tenant dispatch, bearer `tid` mismatch, and API-key revoke propagation coverage.

Impact: CI can pass while cross-tenant token/tool leakage and auth regressions are untested.

Minimal fix: Remove the automatic `process.env.CI === 'true'` quarantine, or run quarantined files in required isolated jobs with adjusted pool/timer setup. Add a guard that fails on protected branches if the quarantine list is non-empty.

Tests/checks: Run `CI=true MS365_MCP_INTEGRATION=1 npm test` and verify quarantined files execute rather than appearing in `exclude`.

### P1-18: OAuth coverage gate is effectively 25 percent in CI

Files: `bin/check-oauth-coverage.mjs:59`, `bin/check-oauth-coverage.mjs:73`, `.github/workflows/integration.yml:103`

Issue: The workflow says it enforces 70 percent OAuth handler coverage, but the script lowers the threshold to 25 percent whenever `CI=true`.

Impact: Security-sensitive OAuth handlers can regress while the named coverage gate remains green.

Minimal fix: Enforce 70 percent in CI. Keep lower thresholds only behind explicit local developer overrides that workflows do not set.

Tests/checks: Run the coverage gate with `CI=true` against synthetic or current low coverage and assert failure below 70 percent.

## P2 Findings

### P2-1: Discovery `execute-tool` bypasses generated parameter validation

Files: `src/graph-tools.ts:445`, `src/graph-tools.ts:1727`

Issue: `execute-tool` accepts `parameters: z.record(z.any())`. Body schema validation failures fall through to `body = paramValue` instead of rejecting.

Impact: Discovery mode can send malformed or unintended write bodies to Graph instead of failing locally.

Minimal fix: Apply the target tool's generated schema before dispatch and reject on `safeParse` failure.

### P2-2: Presets are stale relative to the generated catalog

Files: `src/presets/essentials-v1.json:32`, `src/generated/client.ts`

Issue: Current generated aliases are kebab-case while preset operations still reference older aliases. Product preset aliases are also absent from `api.endpoints`.

Impact: Static tenants pinned to those presets can register zero intended generated tools, while tests that mock the catalog miss the mismatch.

Minimal fix: Regenerate presets from the current catalog and add a real-catalog CI check requiring every non-discovery preset op to exist.

### P2-3: Pagination drops nextLink query parameters

Files: `src/lib/middleware/page-iterator.ts:152`, `src/lib/middleware/page-iterator.ts:159`, `src/graph-client.ts:339`

Issue: Page iterator stores `@odata.nextLink` query parameters in `options.queryParams`, but GraphClient ignores `queryParams`.

Impact: Pagination can refetch page 1 or return duplicate/truncated results when page 2 requires `$skiptoken` or `$skip`.

Minimal fix: Preserve `url.search` in `currentPath` or teach GraphClient to merge `options.queryParams`.

### P2-4: Server-side delegated refresh tokens are not wired into Graph retry path

Files: `src/server.ts:690`, `src/server.ts:799`, `src/lib/middleware/token-refresh.ts:49`, `src/graph-client.ts:616`

Issue: The token endpoint stores refresh tokens in `SessionStore`, but the Graph retry middleware only checks `requestContext.refreshToken`. `refreshSessionAndRetry()` exists but is not used in the live Graph pipeline.

Impact: Delegated HTTP sessions cannot transparently refresh after access-token expiry, despite server-side refresh support being implied.

Minimal fix: Wire tenant-aware session refresh into the 401 path, or stop advertising refresh behavior until implemented.

### P2-5: TenantPool mutates tenant rows and caches by registry id only

Files: `src/lib/tenant/tenant-pool.ts:110`, `src/lib/tenant/tenant-pool.ts:127`

Issue: `TenantPool.acquire()` returns a cached client keyed only by registry tenant id and mutates the passed `TenantRow` with `client_secret_resolved`.

Impact: Secret/client/authority rotations can stay stale if invalidation is missed, and plaintext client secrets can bleed into tenant row objects.

Minimal fix: Rebuild clients when `updated_at`, mode, client id, authority, or secret ref changes. Resolve secrets into local variables or pool entries, not into shared tenant rows.

### P2-6: Trust proxy is globally enabled

Files: `src/server.ts:1554`, `src/lib/metrics-server/metrics-server.ts:64`

Issue: Express trusts proxy headers from all clients.

Impact: Direct clients can spoof `X-Forwarded-For` and `X-Forwarded-Proto`, corrupting audit IPs and generated OAuth metadata scheme/origin.

Minimal fix: Default to no proxy trust. Add explicit trusted proxy CIDR/hop config and prefer `MS365_MCP_PUBLIC_URL` for public metadata.

### P2-7: URL query strings and legacy OAuth PII can leak into logs

Files: `src/server.ts:1573`, `src/logger.ts:153`, `src/graph-client.ts:341`, `src/oauth-provider.ts:81`, `test/logger-redaction.test.ts:44`

Issue: Request logging and GraphClient string logs include raw URLs/query strings. Redaction tests cover an old subset and do not catch string-message leaks such as `userPrincipalName`.

Impact: OAuth `code`, `state`, `redirect_uri`, Graph `$filter`/`$search`, UPNs, PKCE values, webhook client state, KEK/DEK refs, or API keys can bypass structured redaction.

Minimal fix: Sanitize URLs before logging and test the actual logger redaction config across all secret families.

### P2-8: ETag cache is global and keyed only by resource path

Files: `src/lib/middleware/etag.ts:71`, `src/lib/middleware/etag.ts:87`, `src/lib/middleware/etag.ts:191`

Issue: The ETag cache is module-global and keyed only by resource path; regexes can match child paths.

Impact: One tenant/account can poison another tenant/account's conditional writes, causing incorrect `If-Match` headers and avoidable `412` failures.

Minimal fix: Include tenant id and account/user identity in cache keys and match exact supported resource paths.

### P2-9: Discovery/SSE sessions lack caps or TTLs

Files: `src/server.ts:1422`, `src/lib/transports/legacy-sse.ts:81`, `src/lib/transports/streamable-http.ts:116`, `src/lib/mcp-notifications/session-registry.ts:53`

Issue: Legacy SSE opens are outside rate limits, and discovery sessions have no TTL, idle expiry, or per-tenant cap.

Impact: Authenticated tenants can accumulate long-lived sockets/timers or orphaned discovery sessions, consuming file descriptors and memory.

Minimal fix: Add per-tenant active stream/session caps, TTL/idle eviction, and cleanup on close/expiry.

### P2-10: Memory admin mutations do not guard disabled/missing tenants or audit writes

Files: `src/lib/admin/memory-bookmarks.ts:56`

Issue: Memory admin mutation routes validate UUID and scoped key ownership but do not verify the tenant exists and is enabled before writes. Similar risk applies to memory facts/recipes. Mutations are unaudited.

Impact: Disabled tenants can be mutated briefly, especially with stale API-key cache. Nonexistent tenants can produce FK-driven `500`s.

Minimal fix: Add a shared active-tenant guard and audit rows for memory mutations.

### P2-11: Subscription Graph side effects happen before local durable persistence

Files: `src/lib/admin/subscriptions.ts:254`

Issue: Subscription create/renew/delete perform Graph side effects before local persistence, without compensation. Renew can rotate `clientState` remotely before DB update.

Impact: DB failures can leave orphaned subscriptions or desynced `clientState`, causing legitimate notifications to be rejected.

Minimal fix: Add compensation on create failure, avoid rotating `clientState` until persistence can commit, and audit lifecycle operations.

### P2-12: Azure permission script hides failures and misses app roles

Files: `bin/azure-grant-mcp-permissions.sh:93`, `bin/azure-grant-mcp-permissions.sh:119`

Issue: With `--with-app-only`, permissions that exist as both delegated scopes and app roles only add the delegated scope. `az ad app permission add` failures are masked by `|| true`.

Impact: Operators can believe app-only permissions were configured while app-only flows fail later or require manual portal repair.

Minimal fix: Collect both matching scopes and roles when app-only mode is enabled. Preserve nonzero Azure CLI exit codes, filtering only benign warning text.

### P2-13: Generated-client CI cache omits generator inputs

Files: `.github/workflows/build.yml:61`, `.github/workflows/integration.yml:49`, `.github/workflows/integration.yml:93`

Issue: Generated-client cache keys omit inputs such as `openapi/*.yaml` and `src/presets/*.json`.

Impact: CI, release, or Docker jobs can reuse stale `src/generated/client.ts` after spec/preset changes.

Minimal fix: Include all OpenAPI and preset inputs in the cache hash or always run generation in check mode and fail on diffs.

### P2-14: Release config may publish to npm unexpectedly

Files: `.releaserc.json:6`

Issue: Release config includes `@semantic-release/npm` without `npmPublish: false`, despite workflow comments implying no npm publishing.

Impact: Releases can fail without npm credentials or publish unexpectedly if an npm token is added later.

Minimal fix: Configure `["@semantic-release/npm", { "npmPublish": false }]` or remove the npm plugin.

### P2-15: Container migration entrypoint is not wired into image

Files: `Dockerfile:81`, `docker-entrypoint.sh:15`

Issue: `docker-entrypoint.sh` runs migrations, but the Dockerfile starts `node dist/index.js` directly and copies only `bin/check-health.cjs`, not `bin/migrate.mjs` or migrations.

Impact: Clean deployments can boot without schema initialization.

Minimal fix: Copy the entrypoint, migration script, and migrations directory into the image and use the entrypoint, or replace with an explicit migration job.

### P2-16: Azure Container Apps example is stale for v2 gateway

Files: `examples/azure-container-apps/main.bicep:221`, `examples/azure-container-apps/deploy.ps1:161`

Issue: The template uses deprecated env names, omits Postgres/Redis/KEK wiring, and documents redirect URIs that do not match tenant-scoped v2 flows.

Impact: Public Azure deployments can fail startup or get OAuth/CORS/session state misconfigured, especially multi-replica deployments without Redis.

Minimal fix: Provision or require Postgres, Redis, and KEK; use current v2 env names and tenant redirect allowlists.

### P2-17: Metrics examples expose `/metrics` by default

Files: `examples/reverse-proxy/Caddyfile:76`, `examples/reverse-proxy/nginx.conf:85`, `examples/reverse-proxy/traefik.yml:66`

Issue: Public reverse-proxy examples publish `/metrics` while auth is commented out.

Impact: Tenant/workload labels, error rates, and operational shape can leak publicly.

Minimal fix: Default-deny `/metrics` unless bearer auth or a private network/ACL is configured.

### P2-18: Production Compose has localhost public URL/CORS defaults

Files: `docker-compose.yml:74`

Issue: `MS365_MCP_PUBLIC_URL` and `MS365_MCP_CORS_ORIGINS` default to localhost.

Impact: Production containers can start with unusable OAuth metadata or overly trusted local origins instead of failing closed.

Minimal fix: Require these vars in production/reference Compose and move localhost defaults to a dev override.

### P2-19: Production Caddy example enables on-demand TLS

Files: `examples/reverse-proxy/Caddyfile:26`

Issue: The active example enables `tls on_demand` despite warning comments.

Impact: DNS pointing at the server can trigger cert issuance for unintended hostnames and exhaust ACME limits.

Minimal fix: Use explicit-host TLS by default and move on-demand TLS to a separate dev example with an `ask` allowlist.

## P3 Findings

### P3-1: Enabled-tools patch response omits tenant fields

Files: `src/lib/admin/enabled-tools.ts:418`

Issue: `PATCH /admin/tenants/:id/enabled-tools` readback omits `sharepoint_domain` and `rate_limits`, so response mapping returns them as null.

Impact: Admin clients can believe those settings were cleared.

Minimal fix: Reuse the canonical tenant select list or include the missing columns.

### P3-2: Migration CLI accepts invalid commands/counts

Files: `bin/migrate.mjs:99`, `bin/migrate.mjs:134`

Issue: Invalid commands default to `up`; `--count` accepts zero, negatives, and partial values like `1abc`.

Impact: Operator typos can apply migrations unexpectedly or run invalid rollback counts.

Minimal fix: Validate command against `up|down|status` and parse count with a strict positive-integer regex.

### P3-3: Graph budget accounting can double-charge missing resource-unit headers

Files: `src/lib/rate-limit/middleware.ts:122`, `src/lib/middleware/retry.ts:227`, `src/lib/rate-limit/sliding-window.ts:134`

Issue: Graph budget is pre-consumed with cost `1`, then post-response observation adds `parseResourceUnit(null) === 1`.

Impact: Responses without `x-ms-resource-unit` consume two points and can cause premature throttling.

Minimal fix: Observe only `max(resourceUnit - 1, 0)` after pre-consume or skip post-observe when the header is absent.

### P3-4: Global test setup masks missing tenant dispatch context

Files: `test/setup.ts:87`, `test/setup.ts:99`, `src/lib/tool-selection/dispatch-guard.ts:124`

Issue: Every test starts with a permissive stdio fallback whose `.has()` returns true for every tool.

Impact: Tests that forget to seed request context can still pass through dispatch guard checks.

Minimal fix: Remove the global fallback and require explicit opt-in helpers for legacy tests, or add an afterEach canary.

## Notes

- I did not find high-confidence live credentials tracked in public docs/examples during the review pass.
- GitHub repository secrets and Coolify secrets are not visible to the public just because the repository is public. They become risky when workflows expose them to untrusted triggers or print them.
- The immediate fix order should be: P0-1, P0-2, P0-3, P0-4, then the Phase 7 dispatch gates P1-2/P1-3, then logging leaks and CI coverage gates.
