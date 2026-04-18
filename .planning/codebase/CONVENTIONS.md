# Coding Conventions

**Analysis Date:** 2026-04-18

## Naming Patterns

**Files:**
- Source files: kebab-case `.ts` (e.g., `graph-client.ts`, `auth-tools.ts`, `cloud-config.ts`, `microsoft-auth.ts`, `request-context.ts`)
- Test files: kebab-case with `.test.ts` suffix (e.g., `auth-paths.test.ts`, `multi-account.test.ts`, `path-encoding.test.ts`)
- One legacy `.test.js` test exists at `test/calendar-fix.test.js`
- Setup file: `test/setup.ts`
- Generated code lives under `src/generated/` (`client.ts`, `endpoint-types.ts`, `hack.ts`) and is excluded from lint via `eslint.config.js`
- Library/utility modules grouped under `src/lib/` (e.g., `src/lib/bm25.ts`, `src/lib/teams-url-parser.ts`, `src/lib/microsoft-auth.ts`, `src/lib/tool-schema.ts`)

**Functions:**
- camelCase for all functions: `parseArgs`, `buildScopesFromEndpoints`, `getCloudEndpoints`, `parseCloudType`, `isBinaryContentType`, `clampTopQueryParam`, `wrapCache`, `unwrapCache`, `pickNewest`
- Async functions use the `async` keyword: `async function exchangeCodeForToken(...)`, `async function refreshAccessToken(...)`
- Internal helpers can be unexported in the same file (e.g., `createMsalConfig`, `ensureParentDir` in `src/auth.ts`)
- React-style hook naming is not used (this is a Node CLI/server)

**Variables:**
- camelCase for locals and parameters: `accessToken`, `refreshToken`, `clientCodeChallenge`, `serverCodeVerifier`, `tenantId`
- SCREAMING_SNAKE_CASE for module-level constants: `SERVICE_NAME`, `TOKEN_CACHE_ACCOUNT`, `SELECTED_ACCOUNT_KEY`, `FALLBACK_DIR`, `DEFAULT_TOKEN_CACHE_PATH`, `CLOUD_ENDPOINTS`, `DEFAULT_CLIENT_IDS`, `TOOL_CATEGORIES`, `SCOPE_HIERARCHY`, `DISCOVERY_MODE_INSTRUCTIONS_ADDON`
- Underscore-prefixed names for intentionally unused destructured / lint-ignored values: `const { accessToken: _redacted, ...safeOptions } = options;` and `const { $schema: _s, ...schema } = jsonSchema`. Lint rule allows `argsIgnorePattern: '^_'`.

**Types:**
- PascalCase for `interface` and `type`: `AppSecrets`, `CloudEndpoints`, `CommandOptions`, `EndpointConfig`, `ScopeHierarchy`, `LoginTestResult`, `RequestContext`, `BM25Index`, `BM25Doc`, `McpInstructionsContext`, `GraphRequestOptions`, `McpResponse`, `CallToolResult`, `DiscoverySearchIndex`
- String-literal union types for closed enums: `export type CloudType = 'global' | 'china';`, `outputFormat: 'json' | 'toon'`
- Class names PascalCase: `AuthManager`, `MicrosoftGraphServer`, `GraphClient`, `MicrosoftOAuthProvider`, `EnvironmentSecretsProvider`, `KeyVaultSecretsProvider`
- Type-only imports are used where appropriate: `import type { AccountInfo, Configuration } from '@azure/msal-node';`, `import type { AppSecrets } from './secrets.js';`, `import type { CommandOptions } from './cli.ts';`

## Code Style

**Formatting:**
- Tool: Prettier 3.x (`prettier@^3.5.3`), config at `.prettierrc`
- Settings (verbatim from `.prettierrc`):
  - `semi: true`
  - `singleQuote: true`
  - `trailingComma: 'es5'`
  - `printWidth: 100`
  - `tabWidth: 2`
- Format scripts in `package.json`:
  - `npm run format` → `prettier --write "**/*.{ts,mts,js,mjs,json,md}"`
  - `npm run format:check` → `prettier --check "**/*.{ts,mts,js,mjs,json,md}"`
- CI runs `format:check` (see `.github/workflows/build.yml`)

**Linting:**
- Tool: ESLint 9.x with flat config at `eslint.config.js`
- Bases: `@eslint/js` recommended + `@typescript-eslint/eslint-plugin` recommended
- Parser: `@typescript-eslint/parser`, `ecmaVersion: 2022`, `sourceType: 'module'`
- Globals: `globals.node`, `globals.vitest`, `globals.jest`, plus a custom `fs: 'readonly'` global
- Custom rules:
  - `@typescript-eslint/no-unused-vars: ['warn', { argsIgnorePattern: '^_' }]`
  - `@typescript-eslint/no-explicit-any: 'warn'` (warn, not error — see "Comments" for inline disables)
  - `'no-console': 'off'` (console is used heavily in CLI bin output, not for logging)
- Ignored paths: `node_modules/**`, `dist/**`, `coverage/**`, `bin/**`, `src/generated/**`, `.venv/**`
- Lint scripts: `npm run lint` (eslint .), `npm run lint:fix` (eslint . --fix)

**TypeScript:**
- Config at `tsconfig.json`:
  - `target: ES2020`
  - `module: NodeNext`
  - `outDir: dist`, `rootDir: src`
  - `strict: true`
  - `resolveJsonModule: true`
- `include: ['src/**/*']`, `exclude: ['test/**/*']` — tests are not type-checked by `tsc` build (vitest handles them via tsx)
- Build via `tsup` (`tsup.config.ts`): emits ESM, target `es2020`, no bundling, no `dts`, `noExternal: []`, externals listed explicitly
- ESM throughout (`"type": "module"` in `package.json`); imports must include `.js` extensions even for `.ts` source: `import { parseArgs } from './cli.js';` — required by `module: NodeNext`

## Import Organization

**Order:**
Imports are grouped roughly in this order across the codebase:
1. Node built-ins: `import path from 'path';`, `import fs from 'fs';`, `import os from 'os';`, `import crypto from 'node:crypto';`, `import { fileURLToPath } from 'url';`, `import { AsyncLocalStorage } from 'node:async_hooks';`
2. External packages: `import winston from 'winston';`, `import { z } from 'zod';`, `import { Command, Option } from 'commander';`, `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';`, `import express, { Request, Response } from 'express';`
3. Local modules with `.js` extension (per ESM/NodeNext): `import logger from './logger.js';`, `import AuthManager from './auth.js';`, `import { getSecrets, type AppSecrets } from './secrets.js';`
4. Type-only imports use `import type` or inline `type` keyword on named bindings (e.g., `import { getCloudEndpoints, type CloudType } from './cloud-config.js'`)

**Side-effect imports come first** when present: `src/index.ts` starts with `import 'dotenv/config';` before any other import.

**Path Aliases:**
- None. All imports use relative paths (`./`, `../`).
- `__dirname` polyfilled in ESM via `path.dirname(fileURLToPath(import.meta.url))` (see `src/cli.ts`, `src/auth.ts`, `src/logger.ts`, `src/version.ts`, `src/graph-tools.ts`)

## Error Handling

**Patterns:**

The codebase uses async/await with try/catch consistently. Errors are thrown as `Error` instances with descriptive messages and either re-thrown after logging or returned as part of an MCP response payload depending on layer.

1. **Throw + log at boundary** — Service-layer functions throw `Error` after logging; callers catch and translate. Example from `src/lib/microsoft-auth.ts:82-85`:
   ```typescript
   if (!response.ok) {
     const error = await response.text();
     logger.error(`Failed to exchange code for token: ${error}`);
     throw new Error(`Failed to exchange code for token: ${error}`);
   }
   ```

2. **Catch and re-throw with context** — `src/graph-client.ts:174-177`:
   ```typescript
   } catch (error) {
     logger.error('Microsoft Graph API request failed:', error);
     throw error;
   }
   ```

3. **Catch and convert to MCP error response** — Tool handlers never throw to the MCP runtime; they catch and return `{ content: [...], isError: true }`. Example from `src/auth-tools.ts:62-71`:
   ```typescript
   } catch (error) {
     return {
       content: [
         { type: 'text', text: JSON.stringify({ error: `Authentication failed: ${(error as Error).message}` }) },
       ],
     };
   }
   ```

4. **Log-and-continue for non-fatal failures** — `src/auth.ts:276-278`:
   ```typescript
   } catch (error) {
     logger.error(`Error loading token cache: ${(error as Error).message}`);
   }
   ```

5. **Specific 401/403 handling in HTTP client** — `src/graph-client.ts:101-120` checks status codes and either retries with refresh or throws a more descriptive scope-error message.

**Error type narrowing:**
- Standard pattern: `(error as Error).message` after catching `unknown`. Used throughout `src/auth.ts`, `src/auth-tools.ts`, `src/index.ts`, `src/server.ts`.
- Fallback for non-Error throwables in entry point — `src/index.ts:102`:
  ```typescript
  const message = error instanceof Error ? error.message : String(error);
  ```

**Empty catch blocks:** Used intentionally when a fallback path is well-defined (e.g., `src/graph-client.ts:153-156` falling back from JSON.parse to raw text). Comment `// not our envelope format` documents intent in `src/auth.ts:92-94`.

## Logging

**Framework:** Winston (`winston@^3.17.0`) — singleton instance exported from `src/logger.ts`.

**Configuration:**
- Two file transports written to `MS365_MCP_LOG_DIR` (default `~/.ms-365-mcp-server/logs/`):
  - `error.log` (level: error)
  - `mcp-server.log` (all levels at or above `LOG_LEVEL`, default `info`)
- Log directory created with mode `0o700` (owner-only)
- Optional console transport added by `enableConsoleLogging()` from `src/logger.ts:36-43` — invoked from `src/server.ts:157` when `args.v` (verbose) is set
- Format: `${timestamp} ${LEVEL}: ${message}` with timestamps formatted as `YYYY-MM-DD HH:mm:ss`

**Patterns:**
- Import: `import logger from './logger.js';`
- Levels in use: `logger.info(...)`, `logger.warn(...)`, `logger.error(...)` — `debug` exists but is rarely used in production code (only in `vi.mock` shims)
- Backtick template literals are the standard format: `logger.info(\`Selected account: ${this.selectedAccountId}\`)`
- Errors logged with both message and the error object: `logger.error('Microsoft Graph API request failed:', error);`
- **Secret redaction is mandatory before logging** — see `src/graph-tools.ts:382-385` for the established pattern:
  ```typescript
  const { accessToken: _redacted, ...safeOptions } = options;
  logger.info(`Making graph request to ${path} with options: ${JSON.stringify(safeOptions)}${_redacted ? ' [accessToken=REDACTED]' : ''}`);
  ```
- Logging at request boundaries — token endpoint, OAuth flows, and Graph API calls all log entry/exit (see `src/server.ts:399-404` for `Token endpoint called` log with redacted body summary)

**console.* usage:**
- `console.log` / `console.error` are reserved for CLI bin output meant to be machine-readable (e.g., `JSON.stringify` results in `src/index.ts` and `src/cli.ts`)
- The lint rule `'no-console': 'off'` permits this; do not use `console.*` for application logging — use `logger.*`

## Comments

**When to Comment:**
- Module-level JSDoc blocks describe purpose and design rationale (e.g., `src/secrets.ts:1-6`, `src/cloud-config.ts:1-9`, `src/lib/bm25.ts:1-6`)
- Function-level JSDoc for non-trivial public/exported functions documents purpose and parameters (e.g., `src/cloud-config.ts:55-60` `getDefaultClientId`, `src/lib/bm25.ts:30-37` `buildBM25Index`)
- Inline `//` comments explain the **why** of subtle decisions, not the **what**:
  - `src/auth.ts:10-12` — explains why `keytar` is lazily imported
  - `src/server.ts:60` — `// Two-leg PKCE: stores client's code_challenge and server's code_verifier, keyed by OAuth state`
  - `src/server.ts:202-228` — extended block comment explaining `--public-url` behind reverse proxies and the deprecated `--base-url` migration
  - `src/graph-tools.ts:172-174` — `// Ok, so, MCP clients (such as claude code) doesn't support $ in parameter names...`
  - `src/graph-client.ts:134-137` — explains why binary payloads must not be `response.text()`'d
- Reference issue/URL pointers when fixing tricky bugs: `src/graph-tools.ts:211` references `https://github.com/Softeria/ms-365-mcp-server/issues/245`

**JSDoc/TSDoc:**
- Used for exported helpers and provider interfaces; `@param`, `@returns`, `@throws`, `@deprecated`, `@see` tags appear (see `src/cloud-config.ts:60-65`)
- `@deprecated` tag used for soft-deprecation in `CommandOptions` interface (`src/cli.ts:101-102`):
  ```typescript
  /** @deprecated use publicUrl */
  baseUrl?: string;
  ```

**TODO/FIXME:**
- Convention is to use `DEPRECATED:` prefix in block comments for migration notes rather than `TODO`/`FIXME` (see `src/server.ts:215-222`, `src/cli.ts:71-73`)

**Lint suppressions:**
- Inline `// eslint-disable-next-line` comments must include a justification on the same line. From `test/multi-account.test.ts:32`:
  ```typescript
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- McpServer.tool() has ~6 overloads; spying it requires any
  ```
- No `// @ts-ignore` or `// @ts-expect-error` directives in `src/`. Maintain that — prefer narrowing over silencing the type checker.

## Function Design

**Size:**
- Most functions are ≤ 50 lines. The notable outlier is `MicrosoftGraphServer.start()` in `src/server.ts:155-651` which composes the entire HTTP/Express setup inline. Prefer extracting new HTTP handlers into helpers when adding routes.
- Pure helpers in `src/lib/` are short and single-purpose (e.g., `tokenize`, `parseTeamsUrl`, `unwrapOptional`).

**Parameters:**
- Plain positional parameters dominate (e.g., `executeGraphTool(tool, config, graphClient, params, authManager?)`)
- Default values supplied at the parameter list when reasonable: `tenantId: string = 'common'`, `cloudType: CloudType = 'global'`, `outputFormat: 'json' | 'toon' = 'json'`
- Options objects used when the parameter set is open-ended (e.g., `GraphRequestOptions` in `src/graph-client.ts:45-56`)
- Optional parameters use `?:` rather than `| undefined`

**Return Values:**
- Async functions explicitly return `Promise<T>`; `void` is annotated when there is no return value (e.g., `async function main(): Promise<void>` in `src/index.ts:10`)
- Tool handlers return a uniform `CallToolResult` (or `McpResponse`) object — always with a `content: [{ type: 'text', text: ... }]` array; failures add `isError: true`
- Pure functions return new objects rather than mutating inputs (immutability followed except in deliberately-mutating helpers like `removeODataProps` in `src/graph-client.ts:303-313` and `clampTopQueryParam` in `src/graph-tools.ts:57-64`, both of which document the mutation by name)

## Module Design

**Exports:**
- Default exports for the primary class/instance of a module: `AuthManager` (`src/auth.ts`), `MicrosoftGraphServer` (`src/server.ts`), `GraphClient` (`src/graph-client.ts`), `logger` (`src/logger.ts`)
- Named exports for utilities, helpers, and types: `parseArgs`, `buildScopesFromEndpoints`, `registerAuthTools`, `registerGraphTools`, `registerDiscoveryTools`, `getCloudEndpoints`, `parseCloudType`, `getSecrets`, `clearSecretsCache`, `requestContext`, `getRequestTokens`, `tokenize`, `buildBM25Index`, `scoreQuery`, `parseTeamsUrl`, `describeToolSchema`
- Re-export type aliases inline: `export type { AppSecrets }` style is preferred to namespace pollution

**Barrel Files:**
- None. Each module is imported directly. Adding new code: keep a 1:1 file-to-feature relationship; do not introduce `index.ts` re-export barrels in `src/`.

## Validation

**Schema-based validation** uses Zod throughout — both for tool input parameters and for parsing/validating Graph response shapes via the generated client (`src/generated/client.ts`).

- Tool parameters: `z.boolean().default(false).describe('...')` (see `src/auth-tools.ts:10`), `z.string().describe('...')`
- Body parameter validation with `safeParse` and a graceful auto-wrap fallback for AI clients that pass nested fields raw (`src/graph-tools.ts:233-251`)
- Cloud type input validated through `parseCloudType` (`src/cloud-config.ts:94-103`) which throws on invalid input rather than silently defaulting

**Boundary validation in `parseArgs`:**
- `--enabled-tools` regex validated at startup (`src/cli.ts:144-154`) — invalid pattern fails fast rather than silently exposing all tools (security).
- Cloud type validated before storage (`src/cli.ts:186-188`).

**Configuration / env vars:**
- Environment variables read with explicit defaults: `process.env.MS365_MCP_TENANT_ID || 'common'`, `process.env.LOG_LEVEL || 'info'`, `process.env.MS365_MCP_BODY_FORMAT || 'text'`
- Boolean envs check both `'true'` and `'1'`: `process.env.READ_ONLY === 'true' || process.env.READ_ONLY === '1'` (used consistently across `src/cli.ts`, `src/logger.ts`)
- Numeric envs validated with `Number.parseInt` + `Number.isFinite` and an `info`/`warn` log on invalid input (`src/graph-tools.ts:43-55`)

## Async Patterns

- Always `async`/`await`; no raw `.then()` chains in `src/`
- `Promise.all` used for independent operations: `src/secrets.ts:70-77` parallel Key Vault fetches
- `AsyncLocalStorage` used for per-request token isolation: `src/request-context.ts:8` — call `requestContext.run(ctx, handler)` to scope, `getRequestTokens()` to read. Test coverage in `test/request-context.test.ts` proves no token leakage across overlapping requests.
- Lazy `await import(...)` for optional dependencies that may not be installed: `keytar` (`src/auth.ts:13-28`), `@azure/identity` and `@azure/keyvault-secrets` (`src/secrets.ts:62-63`)

## Verification Pipeline

`npm run verify` runs the full sequence used in CI (see `package.json:21`):
```
npm run generate && npm run lint && npm run format:check && npm run build && npm run test
```
Run this before commits when touching `src/`. Generated client must be regenerated (`npm run generate`) when `endpoints.json` or the OpenAPI spec changes.

---

*Convention analysis: 2026-04-18*
