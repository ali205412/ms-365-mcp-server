# Technology Stack

**Analysis Date:** 2026-04-18

## Languages

**Primary:**
- TypeScript ^5.8.3 — All server source code under `src/` (compiled to ES2020 ESM)
- JavaScript (ESM, Node) — Build/codegen scripts under `bin/` and config files (`vitest.config.js`, `eslint.config.js`)

**Secondary:**
- JSON — Declarative endpoint catalog at `src/endpoints.json` (1453 lines, 212 Microsoft Graph tool definitions) and configuration files
- Bicep — Infrastructure-as-code example at `examples/azure-container-apps/main.bicep`
- PowerShell — Deployment orchestrator at `examples/azure-container-apps/deploy.ps1`
- Dockerfile — Multi-stage container build at `Dockerfile`

## Runtime

**Environment:**
- Node.js >= 18 (declared in `package.json` `engines.node`); README recommends >= 20
- Module system: ESM (`"type": "module"` in `package.json`)
- Distribution target: ES2020 modules (`tsconfig.json` and `tsup.config.ts`)
- Container base images: `node:24-alpine` (build stage), `node:20-alpine` (release stage) — `Dockerfile`
- CI matrix: Node.js 18.x, 20.x, 22.x — `.github/workflows/build.yml`

**Package Manager:**
- npm (no other lockfiles present)
- Lockfile: `package-lock.json` (471KB, present)
- Install in production: `npm i --ignore-scripts --omit=dev` — `Dockerfile`

## Frameworks

**Core:**
- `@modelcontextprotocol/sdk` ^1.29.0 — MCP server framework. Used for `McpServer`, `StdioServerTransport`, `StreamableHTTPServerTransport`, `mcpAuthRouter`, and `ProxyOAuthServerProvider`. Imported in `src/server.ts`, `src/auth-tools.ts`, `src/graph-tools.ts`, `src/oauth-provider.ts`.
- `express` ^5.2.1 — HTTP server for `--http` Streamable HTTP mode. Used in `src/server.ts` for OAuth endpoints (`/authorize`, `/token`, `/.well-known/*`, `/mcp`) and CORS middleware.
- `@azure/msal-node` ^3.8.0 — Microsoft Authentication Library; powers `PublicClientApplication`, device-code, and interactive auth flows in `src/auth.ts`.
- `commander` ^11.1.0 — CLI argument parsing in `src/cli.ts` (defines `--http`, `--login`, `--org-mode`, `--read-only`, `--cloud`, `--enabled-tools`, `--preset`, `--public-url`, `--auth-browser`, etc.).
- `zod` ^3.24.2 — Runtime schema validation for tool parameters and generated OpenAPI client (`src/generated/client.ts`).
- `zod-to-json-schema` ^3.25.1 — Converts Zod schemas to JSON Schema for the discovery `get-tool-schema` tool — `src/lib/tool-schema.ts`.

**Testing:**
- `vitest` ^3.1.1 — Test runner with globals enabled (`vitest.config.js`); environment `node`; setup file `test/setup.ts`.
- `@vitest/coverage-v8` ^3.2.4 — V8-based coverage provider.

**Build/Dev:**
- `tsup` ^8.5.0 — TypeScript bundler. Configured in `tsup.config.ts` to emit per-file ESM, copy `endpoints.json`, mark MSAL/MCP/express/keytar/zod/winston/etc. as external, and `chmod +x dist/index.js`.
- `tsx` ^4.19.4 — TypeScript executor for dev (`npm run dev`, `npm run dev:http`).
- `typescript` ^5.8.3 — Type checker; `tsconfig.json` uses `target: ES2020`, `module: NodeNext`, `strict: true`, `rootDir: src`.
- `eslint` ^9.31.0 with `@typescript-eslint/eslint-plugin` ^8.38.0 and `@typescript-eslint/parser` ^8.38.0 — Flat config in `eslint.config.js`. Enables `no-unused-vars` (warn, ignore `_`-prefixed args) and `no-explicit-any` (warn). Ignores `dist/`, `coverage/`, `bin/`, `src/generated/`.
- `prettier` ^3.5.3 — `.prettierrc`: semi, single-quote, ES5 trailing comma, print width 100, tab width 2.

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk` — Defines server contract; if upgraded, transports and the OAuth router shape change.
- `@azure/msal-node` — Token cache serialization format and PublicClientApplication API are load-bearing in `src/auth.ts`.
- `winston` ^3.17.0 — Logging only; never `console.log` in stdio mode (would corrupt MCP JSON-RPC). See `src/logger.ts`.
- `dotenv` ^17.0.1 — `.env` loaded at process start via `import 'dotenv/config'` in `src/index.ts`.
- `js-yaml` ^4.1.0 — Used by codegen pipeline (`bin/modules/simplified-openapi.mjs`) to read/trim Microsoft Graph OpenAPI YAML.
- `open` ^11.0.0 — Lazy-imported in `src/auth.ts` to launch the system browser for `--auth-browser` interactive OAuth.
- `@toon-format/toon` ^0.8.0 — Optional output encoding (TOON format) selected via `--toon` flag — `src/graph-client.ts` `serializeData()`.

**Optional (not installed by default):**
- `@azure/identity` ^4.5.0 — Lazy-imported in `src/secrets.ts` `KeyVaultSecretsProvider.getSecrets()` only when `MS365_MCP_KEYVAULT_URL` is set.
- `@azure/keyvault-secrets` ^4.9.0 — Lazy-imported alongside `@azure/identity` for Key Vault secret retrieval.
- `keytar` ^7.9.0 — Lazy-imported in `src/auth.ts` (`getKeytar()`) for OS keychain token storage. Falls back silently to file storage on alpine/Docker where keytar fails to install.

**Codegen (devDependencies, used at build time):**
- `@redocly/cli` ^2.11.1 — OpenAPI processing CLI (referenced by codegen pipeline).
- `openapi-zod-client` — Invoked via `npx -y` in `bin/modules/generate-mcp-tools.mjs` to regenerate `src/generated/client.ts` from a trimmed Microsoft Graph OpenAPI spec.

**Release:**
- `semantic-release` ^25.0.2 with `@semantic-release/exec`, `@semantic-release/git`, `@semantic-release/github`, `@semantic-release/npm` — Driven by `.releaserc.json`, runs from `.github/workflows/release.yml` on push to `main`.

## Configuration

**Environment variables (read by source code):**
- `MS365_MCP_CLIENT_ID` — Azure AD app client ID (`src/secrets.ts`); falls back to a built-in default per cloud (`src/cloud-config.ts` `DEFAULT_CLIENT_IDS`).
- `MS365_MCP_TENANT_ID` — Tenant or `common` (default).
- `MS365_MCP_CLIENT_SECRET` — Optional; enables confidential-client flow.
- `MS365_MCP_CLOUD_TYPE` — `global` (default) or `china`.
- `MS365_MCP_KEYVAULT_URL` — When set, switches secrets provider to Azure Key Vault.
- `MS365_MCP_OAUTH_TOKEN` — Pre-supplied bearer token; activates OAuth/HTTP mode in `AuthManager` constructor.
- `MS365_MCP_TOKEN_CACHE_PATH`, `MS365_MCP_SELECTED_ACCOUNT_PATH` — Override default `.token-cache.json` and `.selected-account.json` locations.
- `MS365_MCP_LOG_DIR` — Override `~/.ms-365-mcp-server/logs` log directory (`src/logger.ts`).
- `MS365_MCP_CORS_ORIGIN` — Override `Access-Control-Allow-Origin` (default `http://localhost:3000`).
- `MS365_MCP_PUBLIC_URL` (and deprecated `MS365_MCP_BASE_URL`) — Public base URL for browser-facing OAuth redirects when behind a proxy.
- `MS365_MCP_ORG_MODE`, `MS365_MCP_FORCE_WORK_SCOPES` — Boolean toggles for organization/work scopes.
- `MS365_MCP_OUTPUT_FORMAT=toon` — Switch global output to TOON.
- `MS365_MCP_MAX_TOP` — Caps Microsoft Graph `$top` query parameter (`src/graph-tools.ts`).
- `MS365_MCP_BODY_FORMAT` — `text` (default) or `html` for Outlook body content type.
- `READ_ONLY`, `ENABLED_TOOLS` — CLI overrides (`src/cli.ts`).
- `LOG_LEVEL` — Winston log level; default `info`.
- `SILENT` — Suppress console transport output even when enabled.
- `NODE_ENV` — Logged at startup; `production` in `Dockerfile` release stage.

**Config files:**
- `tsconfig.json` — TypeScript compiler config.
- `tsup.config.ts` — Build config; explicit `external` list for runtime deps so they stay in `node_modules`.
- `vitest.config.js` — Test config.
- `eslint.config.js` — Flat ESLint config.
- `.prettierrc` — Formatting rules.
- `.releaserc.json` — semantic-release config.
- `.npmignore` — Excludes source TS, tests, `openapi/`, IDE files from published package.
- `.env.example` — Template for local OAuth configuration; renamed to `.env` and consumed by `dotenv`.
- `glama.json` — Glama.ai MCP registry maintainer manifest.

**Build:**
- `npm run build` → `tsup` (emits to `dist/`)
- `npm run generate` → `node bin/generate-graph-client.mjs` (regenerates `src/generated/client.ts` from Microsoft Graph OpenAPI spec — required before build in CI per `.github/workflows/build.yml`).
- `npm run verify` → generate + lint + format:check + build + test.

## Platform Requirements

**Development:**
- Node.js 18+ (CI tests 18, 20, 22).
- npm.
- Optional: `keytar` build toolchain (Python, C++ compiler) for OS keychain support; not required.

**Production:**
- Container deployment recommended. Reference deployments documented for:
  - Docker (`Dockerfile`)
  - Azure Container Apps with Bicep (`examples/azure-container-apps/main.bicep`, `examples/azure-container-apps/deploy.ps1`, `examples/azure-container-apps/README.md`)
  - General hosting guidance in `docs/deployment.md`
- Distribution: published to npm as `@softeria/ms-365-mcp-server` and Docker image `ghcr.io/softeria/ms-365-mcp-server`.
- Binary entrypoint: `dist/index.js` (declared as `bin.ms-365-mcp-server` in `package.json`); shebang `#!/usr/bin/env node` set in `src/index.ts` and `chmod +x` applied by tsup `onSuccess`.

---

*Stack analysis: 2026-04-18*
