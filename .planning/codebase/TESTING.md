# Testing Patterns

**Analysis Date:** 2026-04-18

## Test Framework

**Runner:**
- Vitest 3.x (`vitest@^3.1.1`)
- Config: `vitest.config.js` (root)
- Coverage provider: `@vitest/coverage-v8@^3.2.4` (declared in `devDependencies`, no script wired up in `package.json`)
- TypeScript executed directly via Vitest's tsx-based loader; `tsconfig.json` excludes `test/**/*` from the `tsc` build

**Configuration (`vitest.config.js`):**
```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
  },
});
```

- `globals: true` allows `describe`/`it`/`expect` without imports, but the codebase consistently imports them explicitly anyway (e.g., `import { describe, it, expect, vi } from 'vitest';`)
- `environment: 'node'` (no jsdom)
- Single setup file: `test/setup.ts`

**Assertion Library:**
- Vitest's built-in `expect` (Chai-compatible API). No external assertion libraries.

**Mocking Library:**
- Vitest's built-in `vi` namespace (`vi.fn`, `vi.mock`, `vi.spyOn`, `vi.stubEnv`, `vi.unstubAllEnvs`, `vi.clearAllMocks`, `vi.resetAllMocks`, `vi.restoreAllMocks`, `vi.resetModules`)

**Run Commands:**
```bash
npm test              # vitest run — single pass, used by CI
npm run test:watch    # vitest — interactive watch mode
npm run verify        # full pipeline: generate + lint + format:check + build + test
```

**CI:**
- `.github/workflows/build.yml` matrix-tests on Node 18, 20, 22 — runs lint, format:check, build, then `npm test`

## Test File Organization

**Location:**
- Primary location: `test/` at project root (24 test files, ~2,900 lines)
- One co-located test directory: `src/__tests__/graph-tools.test.ts` — used when the test needs to mock files imported via `path.dirname(fileURLToPath(import.meta.url))` and the relative paths matter (e.g., the `endpoints.json` fs mock at `src/__tests__/graph-tools.test.ts:31-42`)

**Naming:**
- `*.test.ts` for all new tests (one legacy `test/calendar-fix.test.js` predates the TS migration)
- Test name matches the module under test where possible: `secrets.test.ts` ↔ `secrets.ts`, `bm25.test.ts` ↔ `lib/bm25.ts`, `cli.test.ts` ↔ `cli.ts`, `graph-tools.test.ts` ↔ `graph-tools.ts`
- Behavior/regression-focused tests use feature names rather than module names: `binary-response.test.ts`, `path-encoding.test.ts`, `multi-account.test.ts`, `read-only.test.ts`, `tool-filtering.test.ts`, `discovery-search.test.ts`, `http-oauth-fix.test.ts`
- Test fixtures and helpers live alongside in `test/` (e.g., `test/test-hack.ts` is a hand-written executable scratch script, not a Vitest test)

**Structure:**
```
test/
├── setup.ts                         # Polyfills `globalThis.File` for Node 18 compatibility
├── test-hack.ts                     # Manual scratch script (not a Vitest test)
├── auth-paths.test.ts
├── auth-tools.test.ts
├── binary-response.test.ts
├── bm25.test.ts
├── cache-stamp.test.ts
├── calendar-fix.test.js             # Legacy JS test
├── calendar-view.test.ts
├── cli.test.ts
├── discovery-search.test.ts         # Golden-query eval (uses LIVE registry, no mocks)
├── endpoints-validation.test.ts
├── graph-api.test.ts
├── http-oauth-fix.test.ts           # Regression test for issue #258
├── mail-folders.test.ts
├── mcp-instructions.test.ts
├── multi-account.test.ts
├── odata-nextlink.test.ts
├── onedrive-folders.test.ts
├── path-encoding.test.ts            # Regression test for issue #245
├── read-only.test.ts
├── request-context.test.ts          # AsyncLocalStorage isolation tests
├── secrets.test.ts
├── teams-url-parser.test.ts
├── tool-filtering.test.ts
└── tool-schema.test.ts

src/__tests__/
└── graph-tools.test.ts              # Co-located: uses fs mock for endpoints.json
```

## Test Structure

**Suite Organization:**

The dominant pattern is one or more top-level `describe` blocks per file, with nested `describe` for sub-features and `it` for individual cases. Setup uses `beforeEach` (and `afterEach` when teardown is needed). Real example from `test/auth-paths.test.ts:4-86`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';

describe('token cache path configuration', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('getTokenCachePath', () => {
    it('should return default path when env var is not set', async () => {
      vi.stubEnv('MS365_MCP_TOKEN_CACHE_PATH', '');
      const { getTokenCachePath } = await importHelpers();
      const result = getTokenCachePath();
      expect(result).toContain('.token-cache.json');
      expect(path.isAbsolute(result)).toBe(true);
    });
    // ... more `it` blocks
  });
});
```

**Patterns:**

- **Setup** — `beforeEach` is used for resetting mocks (`vi.clearAllMocks()`), recreating `McpServer` instances, swapping `global.fetch`, and reseeding mock data arrays. Example from `test/multi-account.test.ts:35-39`:
  ```typescript
  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '1.0.0' });
    graphClient = {} as GraphClient;
    toolSpy = vi.spyOn(server, 'tool').mockImplementation((() => {}) as any);
  });
  ```
- **Teardown** — `afterEach` restores environment stubs (`vi.unstubAllEnvs()`), resets all mocks (`vi.resetAllMocks()`), restores spies (`vi.restoreAllMocks()`), or restores `global.fetch` to its original reference
- **Assertion style** — `expect(value).toBe(...)`, `.toEqual(...)`, `.toContain(...)`, `.toHaveBeenCalledWith(...)`, `.toHaveBeenCalledTimes(n)`, `.toBeDefined()`, `.toBeUndefined()`, `.toBeNull()`, `.rejects.toThrow(/regex/)`, `expect.objectContaining(...)`, `expect.any(String)`, `expect.stringContaining(...)`
- **Test naming** — `it('should <behavior> when <condition>', ...)` format dominates; some files use shorter `it('does X', ...)` style for pure-function tests (e.g., `test/binary-response.test.ts:5-58`)
- **Regression tests** — Begin with a multi-line block comment citing the issue number and root cause. Example header from `test/http-oauth-fix.test.ts:1-12`:
  ```typescript
  /**
   * Regression test for GitHub issue #258:
   * "No accounts found. Please login first." after update to 0.44
   * ...
   */
  ```

## Mocking

**Framework:** Vitest's `vi` namespace (no `jest.mock` despite `globals.jest` being declared in eslint).

**Module mocking patterns:**

1. **Mock the logger** — almost every test that imports a `src/` module that pulls in `logger.js` mocks it to silence output. Standard form:
   ```typescript
   vi.mock('../src/logger.js', () => ({
     default: {
       info: vi.fn(),
       error: vi.fn(),
       warn: vi.fn(),
     },
   }));
   ```
   Some tests also stub `debug: vi.fn()` (see `src/__tests__/graph-tools.test.ts:10-17`).

2. **Mock the generated Graph client** — Tests that exercise `registerGraphTools` provide a minimal endpoint list rather than loading the full generated client (which is large and slow to init). From `test/calendar-view.test.ts:14-64`:
   ```typescript
   vi.mock('../src/generated/client.js', () => ({
     api: {
       endpoints: [
         {
           alias: 'get-calendar-view',
           method: 'get',
           path: '/me/calendarView',
           description: '...',
           parameters: [
             { name: 'startDateTime', type: 'Query', schema: z.string() },
             // ...
           ],
         },
       ],
     },
   }));
   ```

3. **Mock `fs.readFileSync` selectively** — `src/__tests__/graph-tools.test.ts:31-42` shows the pattern for partially mocking the `fs` module so only `endpoints.json` is intercepted:
   ```typescript
   vi.mock('fs', async (importOriginal) => {
     const actual = await importOriginal<typeof import('fs')>();
     return {
       ...actual,
       readFileSync: (filePath: string, encoding?: string) => {
         if (typeof filePath === 'string' && filePath.includes('endpoints.json')) {
           return JSON.stringify(mockEndpointsJson);
         }
         return actual.readFileSync(filePath, encoding as any);
       },
     };
   });
   ```
   Combine with `vi.resetModules()` + dynamic `await import(...)` so the fresh mock is picked up between tests.

4. **Mock `commander`** — `test/cli.test.ts:4-29` mocks `commander` with a chainable stub object. Process exit/stderr are also spied (`vi.spyOn(process, 'exit').mockImplementation(() => {})`).

5. **Mock factories with `vi.mock` + `vi.fn` defaults** — `test/auth-tools.test.ts:4-19` shows mocking `zod` itself when only the schema-builder API surface needs to exist.

**`global.fetch` mocking:**

The Graph client uses native `fetch`. Tests swap `global.fetch` either with `vi.fn()` set at module top-level (`test/graph-api.test.ts:3`, `test/onedrive-folders.test.ts:3`, `test/mail-folders.test.ts:3`) or per-test via `vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(...))` (`test/odata-nextlink.test.ts:49-59`).

When swapping `global.fetch`, save the original and restore in `afterEach`:
```typescript
let originalFetch: typeof global.fetch;
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });
```
See `test/binary-response.test.ts:74-105` and `test/request-context.test.ts:87-94`.

**Spies:**

- `vi.spyOn(server, 'tool').mockImplementation((...) => {...})` is the dominant pattern for inspecting which tools `registerGraphTools` / `registerAuthTools` register, what schemas they receive, and capturing the handler function for direct invocation. Examples in `test/multi-account.test.ts:38`, `test/tool-filtering.test.ts:48`, `test/http-oauth-fix.test.ts:54-60`.
- `vi.spyOn(process, 'exit')` and `vi.spyOn(process.stderr, 'write')` used in CLI tests.

**Capturing handlers for direct invocation:**

The standard idiom for testing tool handlers extracts the registered function from the mock's call list:
```typescript
function getToolHandler(toolName: string) {
  registerGraphTools(mockServer, mockGraphClient, false);
  const call = mockServer.tool.mock.calls.find((c: unknown[]) => c[0] === toolName);
  expect(call).toBeDefined();
  return call![call!.length - 1] as (params: Record<string, unknown>) => Promise<unknown>;
}
```
See `test/calendar-view.test.ts:80-85` and `test/path-encoding.test.ts:52-57`.

**Environment variable stubbing:**

```typescript
beforeEach(() => { vi.unstubAllEnvs(); });
afterEach(() => { vi.unstubAllEnvs(); });

it('reads MS365_MCP_CLIENT_ID', async () => {
  vi.stubEnv('MS365_MCP_CLIENT_ID', 'test-client-id');
  vi.stubEnv('MS365_MCP_KEYVAULT_URL', '');  // Always clear to force env path
  const secrets = await getSecrets();
  expect(secrets.clientId).toBe('test-client-id');
});
```
See `test/secrets.test.ts:5-63` and `test/auth-paths.test.ts:5-13`. **Always pair `vi.stubEnv` with `vi.unstubAllEnvs()` in `beforeEach` AND `afterEach`** to prevent cross-test contamination, and clear cached state by also calling the module's reset (e.g., `clearSecretsCache()`, `vi.resetModules()`).

**What to Mock:**
- All HTTP calls — `global.fetch` is mocked in every test that exercises code calling out to Graph or Microsoft auth endpoints
- The logger — silenced in tests that exercise modules importing it
- The generated Graph client — replaced with minimal endpoint stubs to keep tests fast and focused
- `commander`, `keytar`, `@azure/identity` (via dynamic import) — mocked when running CLI / secrets tests
- File reads when bytes-on-disk would couple tests to project layout (selective `fs.readFileSync` mock)

**What NOT to Mock:**
- The unit under test itself (test the real `parseTeamsUrl`, `tokenize`, `buildBM25Index`, `isBinaryContentType`, `wrapCache`/`unwrapCache`/`pickNewest`, `parseCloudType`, etc.)
- `AsyncLocalStorage` and `requestContext` — `test/request-context.test.ts` exercises the real `node:async_hooks` storage to prove isolation
- `discovery-search.test.ts:14-15` deliberately uses the **live tool registry** and BM25 index so changes to endpoint descriptions, llmTips, or weight tuning surface as test failures — a "golden query" eval pattern. Do not mock around it.
- `Zod` schemas in tests that exercise schema-driven behavior (only mock `zod` when the test does not care about validation, like `test/auth-tools.test.ts`)

## Fixtures and Factories

**Fixture pattern — inline constants per test file:**
```typescript
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const MOCK_TOKEN = 'mock-access-token';
const DRIVE_ID = 'drive-abc123';
const ITEM_ID = 'item-xyz789';
```
See `test/onedrive-folders.test.ts:5-8` and `test/mail-folders.test.ts:5-6`.

**Factory functions for repeated objects:**
```typescript
function makeEndpoint(overrides: Partial<any> = {}) {
  return {
    method: 'get',
    path: '/me/messages',
    alias: 'test-tool',
    description: 'Test tool',
    requestFormat: 'json' as const,
    parameters: [ /* defaults */ ],
    response: z.any(),
    ...overrides,
  };
}

function makeConfig(overrides: Partial<any> = {}) {
  return {
    pathPattern: '/me/messages',
    method: 'get',
    toolName: 'test-tool',
    scopes: ['Mail.Read'],
    ...overrides,
  };
}
```
See `src/__tests__/graph-tools.test.ts:51-80`. Spread `...overrides` last so any test can customize a single field.

**Helper functions for repeated assertions:**
```typescript
function makeHeaders() {
  return expect.objectContaining({
    Authorization: `Bearer ${MOCK_TOKEN}`,
    'Content-Type': 'application/json',
  });
}
```
See `test/onedrive-folders.test.ts:10-15` and `test/mail-folders.test.ts:8-13`.

**Mock auth manager / mock secrets** — Plain object literals matching only the surface area the test needs, cast to the concrete type:
```typescript
const mockAuthManager = {
  isOAuthModeEnabled: vi.fn().mockReturnValue(false),
  getTokenForAccount: vi.fn(),
  listAccounts: vi.fn().mockResolvedValue([]),
  getSelectedAccountId: vi.fn().mockReturnValue(null),
};

const mockSecrets = {
  clientId: 'test-client',
  tenantId: 'common',
  cloudType: 'global' as const,
};
```
See `test/multi-account.test.ts:80-86`, `test/http-oauth-fix.test.ts:82-95`. Cast at the call site (`mockAuthManager as any` or `mockAuthManager as unknown as AuthManager`) — eslint-disable with justification comment if needed.

**Location:**
- Fixtures live inline in their test file. There is no `test/fixtures/` directory and no shared factory module.
- The `test/setup.ts` file is intentionally minimal — only Node 18 `File` polyfill (see comment in source).

## Coverage

**Requirements:** None enforced. No coverage thresholds in `vitest.config.js`, no coverage script in `package.json`.

**View Coverage:**
The `@vitest/coverage-v8` provider is installed but no script exists. To run coverage manually:
```bash
npx vitest run --coverage
```
This will emit reports to `./coverage/` (already in `eslint.config.js` ignores).

**Recommendation when adding tests:** Aim for behavior coverage of new public APIs and regression coverage for any bug being fixed (file pattern: `<feature>.test.ts` with a top-of-file comment citing the issue).

## Test Types

**Unit Tests:**
- Pure helper functions tested in isolation — `bm25.test.ts` (tokenize + scoring), `teams-url-parser.test.ts`, `binary-response.test.ts` (`isBinaryContentType`), `cache-stamp.test.ts` (`wrapCache`/`unwrapCache`/`pickNewest`), `cli.test.ts`
- These are the tightest, fastest tests — no `fetch`, no logger, no MCP server

**Integration Tests:**
- Tool registration + handler invocation — `graph-tools.test.ts` (in `src/__tests__/`), `calendar-view.test.ts`, `path-encoding.test.ts`, `read-only.test.ts`, `tool-filtering.test.ts`, `multi-account.test.ts`, `auth-tools.test.ts`. Use a mock or stubbed `McpServer` and a minimal mock `GraphClient`/`AuthManager`.
- Request-context isolation — `request-context.test.ts` exercises the real `AsyncLocalStorage` with concurrent `Promise.all` calls and a mocked `global.fetch` to prove no token leaks across overlapping HTTP requests.
- HTTP/OAuth flow regression — `http-oauth-fix.test.ts`, `odata-nextlink.test.ts`, `binary-response.test.ts` (the second `describe` block exercises a real `GraphClient` with a fake `Response`).

**E2E Tests:**
- None. There is no Playwright setup, no MCP-protocol end-to-end harness in CI. Manual smoke testing uses `npm run inspector` (`@modelcontextprotocol/inspector tsx src/index.ts`) and the standalone scripts at the repo root: `test-calendar-fix.js`, `test-real-calendar.js` (these hit live Graph and require credentials — not part of `npm test`).

**Golden-Query Evaluation:**
- `test/discovery-search.test.ts` is a **non-mocked** evaluation of the BM25 search ranking against the real registered tool registry. Cases assert that natural-language queries surface the expected tool in top-N. Includes a smoke-coverage test: `expect(ratio).toBeGreaterThanOrEqual(0.8)` (≥ 80% of golden queries must hit in top 5). Pattern is reusable for any future ranking-quality tests.

## Common Patterns

**Async testing:**
```typescript
it('should refresh token on 401', async () => {
  const result = await client.makeRequest('/me');
  expect(result).toBeDefined();
});
```
Always `await` the call under test. For rejection assertions:
```typescript
await expect(auth.resolveAccount('nobody@example.com'))
  .rejects.toThrow(/Account 'nobody@example.com' not found/);
```
See `test/multi-account.test.ts:222-225`. For thrown synchronous errors:
```typescript
expect(() => parseTeamsUrl(badUrl)).toThrow('missing threadId, tenantId, or organizerId');
```
See `test/teams-url-parser.test.ts:43-46`.

**Concurrent request testing:**
```typescript
const [r1, r2, r3] = await Promise.all([
  requestContext.run({ accessToken: 'A' }, async () => { /* ... */ }),
  requestContext.run({ accessToken: 'B' }, async () => { /* ... */ }),
  requestContext.run({ accessToken: 'C' }, async () => { /* ... */ }),
]);
```
See `test/request-context.test.ts:96-163`. Use `Math.random()` delays inside mocked `fetch` to interleave handlers and surface race conditions.

**Error testing — async returning error response (not throwing):**
Tool handlers return `{ isError: true, content: [...] }` rather than throwing. Assert against the response shape:
```typescript
const result = await capturedHandler!({});
expect(result.isError).toBe(true);
expect(result.content[0].text).toContain('No accounts found');
```
See `test/http-oauth-fix.test.ts:159-161`.

**JSON-string content assertions:**
Tool responses always wrap data as a JSON string inside `content[0].text`. Tests parse and inspect:
```typescript
const parsed = JSON.parse(result.content[0].text);
expect(parsed.accounts[0]).toHaveProperty('email', 'user@outlook.com');
expect(parsed.accounts[0]).not.toHaveProperty('homeAccountId'); // Security
```
See `test/multi-account.test.ts:163-179`.

**Module reset between tests (when modules cache state at top level):**
```typescript
beforeEach(() => {
  vi.resetModules();
});

async function importHelpers() {
  const mod = await import('../src/auth.js');
  return { getTokenCachePath: mod.getTokenCachePath };
}
```
Required because `src/auth.ts` reads env vars and computes constants at import time. See `test/auth-paths.test.ts:5-21`.

**Top-level await for module-level mocks:**
```typescript
vi.mock('../src/logger.js', () => ({ /* ... */ }));
const { default: GraphClient } = await import('../src/graph-client.js');
```
Top-level `await` works in test files because they are ESM. Use this pattern when you need mocks established before any module-level code runs in the import target. See `test/odata-nextlink.test.ts:1-39`.

## Adding a New Test

1. Create `test/<feature>.test.ts` (or co-locate under `src/__tests__/` if you need to mock paths relative to the source module)
2. Import what you need from `vitest` explicitly even though `globals: true` is set — keeps the file self-documenting
3. Mock the logger and the generated client as the very first `vi.mock` calls if the import chain reaches them
4. Use `beforeEach`/`afterEach` to reset all mock state — `vi.clearAllMocks()`, `vi.unstubAllEnvs()`, `vi.resetModules()`, restore `global.fetch`
5. For regression tests, add a top-of-file block comment citing the GitHub issue number and root-cause summary
6. Run locally with `npm run test:watch` while iterating; run `npm run verify` before pushing to mirror CI

---

*Testing analysis: 2026-04-18*
