# Codebase Structure

**Analysis Date:** 2026-04-18

## Directory Layout

```
ms-365-mcp-server/
├── bin/                              # Build-time codegen pipeline (Node ESM, .mjs)
│   ├── generate-graph-client.mjs     # Top-level orchestrator: download → trim → generate
│   └── modules/
│       ├── download-openapi.mjs      # Fetches Microsoft Graph OpenAPI YAML
│       ├── extract-descriptions.mjs  # Pulls operation descriptions out of the spec
│       ├── generate-mcp-tools.mjs    # Invokes openapi-zod-client + post-processing
│       └── simplified-openapi.mjs    # Trims spec to endpoints listed in endpoints.json
├── src/                              # Runtime TypeScript (compiled by tsup)
│   ├── index.ts                      # CLI entry; routes admin commands or starts server
│   ├── cli.ts                        # Commander definitions, env-var fallbacks, presets
│   ├── server.ts                     # MicrosoftGraphServer: transports, OAuth Express app
│   ├── auth.ts                       # AuthManager (MSAL), scope builder, token cache
│   ├── auth-tools.ts                 # MCP tools: login, logout, verify-login, list/select/remove-account
│   ├── graph-tools.ts                # registerGraphTools, executeGraphTool, discovery tools, BM25
│   ├── graph-client.ts               # GraphClient: outbound fetch, refresh, response shaping
│   ├── oauth-provider.ts             # MicrosoftOAuthProvider for SDK auth router
│   ├── secrets.ts                    # Env / Key Vault secrets provider with caching
│   ├── cloud-config.ts               # Global vs. China cloud endpoint table
│   ├── request-context.ts            # AsyncLocalStorage for per-HTTP-request tokens
│   ├── tool-categories.ts            # Regex presets (mail, calendar, files, etc.)
│   ├── mcp-instructions.ts           # Builder for MCP initialize.instructions string
│   ├── logger.ts                     # Winston logger (file transports, opt-in console)
│   ├── version.ts                    # Reads version from package.json
│   ├── endpoints.json                # Curated endpoint metadata (scopes, llmTip, flags)
│   ├── generated/                    # Build artifacts from openapi-zod-client
│   │   ├── client.ts                 # GENERATED + gitignored — Zod endpoint catalog
│   │   ├── endpoint-types.ts         # Hand-written type definitions for the catalog
│   │   ├── hack.ts                   # Zodios shim that normalizes parameter names
│   │   └── README.md                 # Codegen evolution / regeneration instructions
│   ├── lib/                          # Stateless helper modules
│   │   ├── bm25.ts                   # BM25 tokenizer + index + scorer for discovery
│   │   ├── microsoft-auth.ts         # OAuth code/refresh exchange + bearer middleware
│   │   ├── teams-url-parser.ts       # Normalizes Teams meeting URL formats
│   │   └── tool-schema.ts            # Zod → JSON Schema describer for get-tool-schema
│   └── __tests__/                    # In-tree co-located tests
│       └── graph-tools.test.ts       # Tool registration / execution unit tests
├── test/                             # Out-of-tree integration & unit tests
│   ├── setup.ts                      # Polyfills (Node 18 File global) — see vitest.config.js
│   ├── test-hack.ts                  # Manual test of the Zodios hack shim
│   ├── auth-paths.test.ts
│   ├── auth-tools.test.ts
│   ├── binary-response.test.ts
│   ├── bm25.test.ts
│   ├── cache-stamp.test.ts
│   ├── calendar-fix.test.js
│   ├── calendar-view.test.ts
│   ├── cli.test.ts
│   ├── discovery-search.test.ts
│   ├── endpoints-validation.test.ts
│   ├── graph-api.test.ts
│   ├── http-oauth-fix.test.ts
│   ├── mail-folders.test.ts
│   ├── mcp-instructions.test.ts
│   ├── multi-account.test.ts
│   ├── odata-nextlink.test.ts
│   ├── onedrive-folders.test.ts
│   ├── path-encoding.test.ts
│   ├── read-only.test.ts
│   ├── request-context.test.ts
│   ├── secrets.test.ts
│   ├── teams-url-parser.test.ts
│   ├── tool-filtering.test.ts
│   └── tool-schema.test.ts
├── docs/
│   └── deployment.md                 # Deployment guide
├── examples/
│   └── azure-container-apps/         # Bicep template + deploy.ps1 example
│       ├── deploy.ps1
│       ├── main.bicep
│       └── README.md
├── .github/
│   └── workflows/
│       ├── build.yml                 # Lint + format + build + test on Node 18/20/22
│       └── release.yml               # semantic-release pipeline
├── .planning/                        # GSD planning workspace (this folder)
│   └── codebase/                     # Codebase mapping documents
├── dist/                             # tsup build output (gitignored, npm-published)
├── openapi/                          # Downloaded + trimmed OpenAPI YAML (gitignored)
├── Dockerfile                        # Multi-stage Node 24/20 alpine image
├── package.json                      # Manifest, scripts, deps
├── package-lock.json
├── tsup.config.ts                    # Build config (ESM, ES2020, per-file, copy JSON)
├── tsconfig.json                     # TS config (strict, ES2020, NodeNext)
├── vitest.config.js                  # Vitest config (node env, ./test/setup.ts)
├── eslint.config.js                  # Flat ESLint config (TS recommended, ignores generated/)
├── .prettierrc                       # 100-col, 2-space, single quotes, semi, ES5 commas
├── .env.example                      # Documents MS365_MCP_* env vars
├── .gitignore                        # Excludes dist/, openapi/, src/generated/client.ts, .token-cache.json, .selected-account.json
├── .npmignore                        # Excludes test/, openapi/, .github/, configs from npm package
├── .releaserc.json                   # semantic-release configuration
├── glama.json                        # Glama.ai catalog metadata
├── remove-recursive-refs.js          # Standalone helper for OpenAPI $ref flattening
├── test-calendar-fix.js              # Ad-hoc script that spawns dist/ + sends a tools/call
├── test-real-calendar.js             # Ad-hoc script that imports dist/ directly
├── README.md                         # User-facing documentation
├── SECURITY.md                       # Security policy
└── LICENSE                           # MIT license
```

## Directory Purposes

**`bin/`:**
- Purpose: Build-time codegen scripts that produce `src/generated/client.ts` from the upstream Microsoft Graph OpenAPI spec.
- Contains: `.mjs` ESM modules — orchestrator and individual pipeline stages.
- Key files: `bin/generate-graph-client.mjs` (orchestrator), `bin/modules/simplified-openapi.mjs` (the heavy-lifter that prunes the 45 MB spec).

**`src/`:**
- Purpose: All runtime TypeScript shipped to npm (compiled to `dist/`).
- Contains: One module per top-level concern; subfolders for generated artifacts (`generated/`), pure-helper modules (`lib/`), and co-located tests (`__tests__/`).
- Key files: `src/index.ts` (entry), `src/server.ts` (transport+OAuth), `src/auth.ts` (MSAL), `src/graph-tools.ts` (tool registration), `src/graph-client.ts` (HTTP).

**`src/generated/`:**
- Purpose: Codegen output and the hand-written shim/types it depends on.
- Contains: `client.ts` is gitignored and regenerated via `npm run generate`; `hack.ts` and `endpoint-types.ts` are committed.
- Key files: `src/generated/client.ts` (generated), `src/generated/hack.ts` (Zodios stand-in), `src/generated/endpoint-types.ts` (hand-written types).

**`src/lib/`:**
- Purpose: Stateless utility modules with no dependencies on `AuthManager`, `GraphClient`, or the MCP server class.
- Contains: BM25 search, OAuth helpers, URL parsers, schema describers.
- Key files: `src/lib/bm25.ts`, `src/lib/microsoft-auth.ts`, `src/lib/teams-url-parser.ts`, `src/lib/tool-schema.ts`.

**`src/__tests__/`:**
- Purpose: Tests that need access to `src/`-internal mocks of generated client (cleaner than reaching across the `test/` boundary).
- Contains: Currently only `graph-tools.test.ts`.
- Key files: `src/__tests__/graph-tools.test.ts`.

**`test/`:**
- Purpose: Most unit and integration tests live here, alongside the Vitest setup file.
- Contains: ~25 `.test.ts`/`.test.js` files exercising auth flows, tool registration, OData behaviour, multi-account, OAuth, etc.
- Key files: `test/setup.ts` (Node 18 `File` polyfill), `test/multi-account.test.ts`, `test/http-oauth-fix.test.ts`, `test/path-encoding.test.ts`.

**`docs/` and `examples/`:**
- Purpose: User-facing deployment documentation.
- Contains: `docs/deployment.md`; `examples/azure-container-apps/` with Bicep template, PowerShell deploy script, and README.
- Key files: `examples/azure-container-apps/main.bicep`, `examples/azure-container-apps/README.md`.

**`.github/workflows/`:**
- Purpose: CI definitions.
- Contains: `build.yml` (PR check matrix on Node 18/20/22 — generate, lint, format:check, build, test), `release.yml` (semantic-release).
- Key files: `.github/workflows/build.yml`.

**`.planning/`:**
- Purpose: GSD planning workspace and codebase maps (this folder).
- Generated: Yes (by `/gsd-*` commands).
- Committed: Yes (typically).

**`dist/`:**
- Purpose: tsup build output, the artifact published to npm.
- Generated: Yes (`npm run build`).
- Committed: No (gitignored), but published in the npm package — `package.json` `main` and `bin` both point inside it.

**`openapi/`:**
- Purpose: Downloaded upstream Microsoft Graph spec + trimmed version.
- Generated: Yes (`npm run generate`).
- Committed: No (gitignored).

## Key File Locations

**Entry Points:**
- `src/index.ts`: Process entry, invoked via the `bin` mapping in `package.json` (`dist/index.js`).
- `src/server.ts`: HTTP server entry inside `MicrosoftGraphServer.start()`.
- `bin/generate-graph-client.mjs`: Codegen entry, invoked by `npm run generate`.

**Configuration:**
- `package.json`: Scripts, dependencies, `bin` mapping, `engines.node >=18`.
- `tsconfig.json`: Strict TS, ES2020, NodeNext modules, `rootDir: src`, `outDir: dist`, excludes `test/`.
- `tsup.config.ts`: Per-file ESM build, copies `endpoints.json` as-is, `external` list keeps runtime deps un-bundled.
- `vitest.config.js`: Node env, globals enabled, loads `test/setup.ts`.
- `eslint.config.js`: Flat config, TS-eslint recommended, ignores `dist/`, `bin/`, `src/generated/`.
- `.prettierrc`: 100-col print width, 2-space tab, single quotes, ES5 trailing commas, semi.
- `.releaserc.json`: semantic-release plugin order.
- `.env.example`: Documents `MS365_MCP_*` env vars (client id/secret/tenant, cloud type, Key Vault URL).
- `Dockerfile`: Two-stage build — Node 24-alpine builder runs `npm run generate && npm run build`; Node 20-alpine release runs `npm i --omit=dev` and `node dist/index.js`.

**Core Logic:**
- `src/server.ts`: Transport selection, Express OAuth handlers, two-leg PKCE store, per-request `McpServer` construction.
- `src/graph-tools.ts`: `registerGraphTools` (default mode), `registerDiscoveryTools` (search-tools/get-tool-schema/execute-tool), `executeGraphTool` (the dispatch core).
- `src/auth.ts`: `AuthManager` class, dual keytar/file token cache with envelope-stamped newest-wins merge, scope hierarchy collapsing, multi-account selection.
- `src/graph-client.ts`: `GraphClient`, `isBinaryContentType`, `formatJsonResponse`, OData property scrubber.
- `src/endpoints.json`: Curated metadata (scopes, work/personal split, `llmTip`, `readOnly`, `returnDownloadUrl`, `supportsTimezone`, `skipEncoding`, `contentType`, `acceptType`).

**Testing:**
- `test/setup.ts`: Vitest setup file (Node 18 `File` polyfill).
- `test/`: Most test files.
- `src/__tests__/graph-tools.test.ts`: Co-located test that mocks the generated client.

## Naming Conventions

**Files:**
- Runtime TypeScript: kebab-case `.ts` (`graph-client.ts`, `oauth-provider.ts`, `request-context.ts`).
- Build scripts: kebab-case `.mjs` (`generate-graph-client.mjs`, `download-openapi.mjs`).
- Tests: `<subject>.test.ts` (or `.test.js` for legacy), located either in `test/` or `src/__tests__/`.
- Generated: lives under `src/generated/`; the gitignored output is named `client.ts`.
- Helpers: pure stateless modules go in `src/lib/<name>.ts`.

**Directories:**
- Singular for top-level concerns (`bin/`, `src/`, `test/`, `dist/`, `docs/`).
- Plural for collections (`examples/`, `workflows/`).
- Underscore-prefixed for test conventions (`__tests__/`).
- Dot-prefixed for tooling/config (`.github/`, `.planning/`).

**Code identifiers:**
- Classes: `PascalCase` (`MicrosoftGraphServer`, `AuthManager`, `GraphClient`, `MicrosoftOAuthProvider`).
- Functions: `camelCase` (`buildScopesFromEndpoints`, `executeGraphTool`, `parseTeamsUrl`, `getCloudEndpoints`).
- Constants: `SCREAMING_SNAKE_CASE` (`SERVICE_NAME`, `TOKEN_CACHE_ACCOUNT`, `CLOUD_ENDPOINTS`, `DEFAULT_CLIENT_IDS`, `TOOL_CATEGORIES`, `SCOPE_HIERARCHY`).
- Types/interfaces: `PascalCase` (`AppSecrets`, `CommandOptions`, `EndpointConfig`, `LoginTestResult`, `RequestContext`).
- Tool aliases (MCP tool names): kebab-case (`list-mail-messages`, `parse-teams-url`, `search-tools`, `get-tool-schema`, `execute-tool`, `select-account`).
- Env vars: `MS365_MCP_<UPPER_SNAKE>` (`MS365_MCP_CLIENT_ID`, `MS365_MCP_KEYVAULT_URL`, `MS365_MCP_CLOUD_TYPE`, `MS365_MCP_PUBLIC_URL`, `MS365_MCP_BODY_FORMAT`, `MS365_MCP_MAX_TOP`, `MS365_MCP_TOKEN_CACHE_PATH`, `MS365_MCP_SELECTED_ACCOUNT_PATH`, `MS365_MCP_LOG_DIR`, `MS365_MCP_OAUTH_TOKEN`, `MS365_MCP_ORG_MODE`, `MS365_MCP_FORCE_WORK_SCOPES`, `MS365_MCP_OUTPUT_FORMAT`, `MS365_MCP_CORS_ORIGIN`).

## Where to Add New Code

**New Microsoft Graph endpoint (most common change):**
- Add an entry to `src/endpoints.json` with `pathPattern`, `method`, `toolName`, `scopes` (and/or `workScopes`), and any optional flags (`llmTip`, `readOnly`, `returnDownloadUrl`, `supportsTimezone`, `skipEncoding`, `contentType`, `acceptType`).
- Run `npm run generate` to regenerate `src/generated/client.ts`.
- Tool registration in `src/graph-tools.ts` picks it up automatically — no further code change required for a vanilla endpoint.
- Tests: add fixture-based coverage in `test/` (or `src/__tests__/` if you need the generated-client mock pattern). Existing examples: `test/path-encoding.test.ts`, `test/calendar-view.test.ts`, `test/onedrive-folders.test.ts`.

**New non-Graph utility tool (e.g., `parse-teams-url` style):**
- Implementation: a pure helper in `src/lib/<name>.ts` (e.g., `src/lib/teams-url-parser.ts`).
- Registration: add a `server.tool(...)` block at the bottom of `registerGraphTools` in `src/graph-tools.ts` (model after the `parse-teams-url` registration around `src/graph-tools.ts:715`). Respect the `enabledToolsRegex` filter.
- Tests: `test/<name>.test.ts` (e.g., `test/teams-url-parser.test.ts`).

**New CLI flag:**
- Definition: extend the Commander chain in `src/cli.ts` and add the field to `CommandOptions`.
- Env-var fallback: append to the env-handling block in `parseArgs()` (`src/cli.ts:134+`).
- Wiring: thread the flag through `MicrosoftGraphServer` (`src/server.ts`) — usually via `this.options`.

**New endpoint feature flag:**
- Type: extend `EndpointConfig` in `src/graph-tools.ts` (and `src/auth.ts` if scope construction is affected).
- Wiring: handle the flag inside `executeGraphTool` (`src/graph-tools.ts:120`) or scope filtering in `buildScopesFromEndpoints` (`src/auth.ts:141`).
- Document: add an example in `src/endpoints.json` so future maintainers see the pattern.

**New tool category preset:**
- Add to `TOOL_CATEGORIES` in `src/tool-categories.ts` with a `pattern` regex; set `requiresOrgMode` if relevant.

**New cloud environment (e.g., gov):**
- Extend `CloudType` and `CLOUD_ENDPOINTS` in `src/cloud-config.ts`; add a default client ID to `DEFAULT_CLIENT_IDS`. All consumers (`src/auth.ts`, `src/oauth-provider.ts`, `src/lib/microsoft-auth.ts`, `src/graph-client.ts`) read endpoints exclusively through `getCloudEndpoints`.

**New auth provider:**
- Implement the `SecretsProvider` interface in `src/secrets.ts` and wire it in `createSecretsProvider()`. Existing examples: `EnvironmentSecretsProvider`, `KeyVaultSecretsProvider`.

**New OAuth endpoint (HTTP mode only):**
- Add an `app.get`/`app.post` handler inside the `if (this.options.http)` block of `src/server.ts:174+`. Use `publicBase` for browser-facing URLs and `requestOrigin` for server-to-server.

**Shared helpers (no auth/server dependency):**
- Drop into `src/lib/<name>.ts`. Keep these stateless and importable by both runtime code and tests.

## Special Directories

**`src/generated/`:**
- Purpose: Output of `openapi-zod-client` plus the hand-written shim/types it imports.
- Generated: Partially. `client.ts` is regenerated; `hack.ts`, `endpoint-types.ts`, and `README.md` are committed.
- Committed: `client.ts` is gitignored. The other three files are committed.
- Note: `.npmignore` whitelists `endpoint-types.ts`, `hack.ts`, and `README.md` despite the broad `src/**/*.ts` exclusion.

**`dist/`:**
- Purpose: tsup output published to npm.
- Generated: Yes (`npm run build`).
- Committed: No.
- Note: `package.json` `bin.ms-365-mcp-server` and `main` both point at `dist/index.js`. The `tsup` `onSuccess` hook chmods `dist/index.js` executable on non-Windows.

**`openapi/`:**
- Purpose: Caches the downloaded Microsoft Graph OpenAPI YAML (`openapi.yaml`) and the trimmed version (`openapi-trimmed.yaml`).
- Generated: Yes (`npm run generate`).
- Committed: No.

**`logs/` and `~/.ms-365-mcp-server/logs/`:**
- Purpose: Winston log destination — `MS365_MCP_LOG_DIR` overrides; default is `~/.ms-365-mcp-server/logs/`.
- Generated: Yes (created on demand at mode `0o700`).
- Committed: No.

**Token-cache files (root-adjacent):**
- `.token-cache.json` and `.selected-account.json` are written next to the `dist/` output by default (one directory above `__dirname`). Both are gitignored. Override paths with `MS365_MCP_TOKEN_CACHE_PATH` and `MS365_MCP_SELECTED_ACCOUNT_PATH`. Files are written at mode `0o600`.

**Root-level ad-hoc test scripts:**
- `test-calendar-fix.js`, `test-real-calendar.js`, `remove-recursive-refs.js` are standalone runnable scripts (not part of the Vitest suite). They live at the repo root for historical reasons. Treat them as scratch / manual verification helpers, not as part of the test suite.

---

*Structure analysis: 2026-04-18*
