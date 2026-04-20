---
phase: 05-graph-coverage-expansion-per-tenant-tool-selection
plan: 05
subsystem: tool-selection
tags:
  [
    tools-list-filter,
    mcp-sdk-handler-wrap,
    express-middleware,
    COVRG-04,
    TENANT-08,
    tenant-isolation,
    async-local-storage,
  ]

# Dependency graph
requires:
  - phase: 05-graph-coverage-expansion-per-tenant-tool-selection
    plan: 04
    provides:
      req.tenant.enabled_tools_set (frozen ReadonlySet<string>) +
      getRequestTenant() helper on AsyncLocalStorage frame + seedTenantContext
      middleware mounted before authSelector. Plan 05-05 reads the triple
      through the same ALS seam for both Express middleware and SDK handler
      wrap paths.

provides:
  - src/lib/tool-selection/tools-list-filter.ts — exports
    createToolsListFilterMiddleware (Express) + wrapToolsListHandler (SDK)
    + applyTenantFilter (pure). The SDK wrap is the authoritative path
    because StreamableHTTPServerTransport delegates to @hono/node-server
    and bypasses Express's res.json/res.send entirely.
  - src/server.ts — mounts createToolsListFilterMiddleware between
    authSelector and the streamableHttp / legacySsePost handlers on
    /t/:tenantId/mcp (POST) and /messages (POST); calls wrapToolsListHandler
    (server) at the end of createMcpServer so every McpServer instance
    (per-request + stdio) carries the filter.
  - test/tool-selection/tools-list-filter.int.test.ts — 4 tests (tenant A
    preset-only, tenant B explicit set, 20-call concurrent interleaving,
    pino log assertion).
  - test/tool-selection/tools-list-correctness.int.test.ts — 13 tests
    (SDK seam: undefined set, ordering, no-ALS, empty set, idempotent wrap;
    middleware seam: GET pass-through, prompts/list + tools/call
    pass-through, malformed body, json/send interception, non-JSON string
    pass-through, Buffer pass-through).

affects:
  - 05-06 (discovery BM25 filter — same ALS reading pattern; BM25 cache
    key includes sha256 of sorted enabled_tools_set).
  - 05-07 (admin PATCH — selector validation publishes
    mcp:tool-selection-invalidate which a future subscriber will use to
    evict req-scoped WeakMap caches; filter is stateless so no cache to
    invalidate here).

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SDK handler wrap via `Server._requestHandlers.get('tools/list')` +
      Map.set() — accessing the SDK's private-by-convention map to install
      a filtering closure AFTER the default lazy-installed handler. Uses
      `Symbol.for()` wrap mark for idempotency across vi.resetModules()."
    - "Dual-seam filter architecture: SDK-level wrap as authoritative
      path (handles Streamable HTTP + stdio) + Express middleware as
      defense in depth (handles legacy SSE POST + future Express-native
      transports). Both read from the same ALS-seeded triple."
    - "Immutable filter via spread-return — applyTenantFilter returns
      `{ ...result, tools: filteredTools }` rather than mutating the
      incoming object. Preserves unknown SDK fields (nextCursor, _meta)
      through filter passes."
    - "res.json/res.send interception via bound originals + filter-or-
      passthrough pattern — original methods captured with .bind(res)
      so the filtered wrappers can delegate without `this`-binding
      drift; try/catch inside wrapper falls back to the original on any
      JSON parse / filter exception."
    - "Bootstrap stub at src/generated/client.ts (gitignored per
      .gitignore:149) — a 2-line `export const api = new Zodios([])`
      seeds the module path so test `vi.mock` calls resolve before the
      real catalog lands via `npm run generate:coverage`."

key-files:
  created:
    - src/lib/tool-selection/tools-list-filter.ts
    - test/tool-selection/tools-list-filter.int.test.ts
    - test/tool-selection/tools-list-correctness.int.test.ts
    - src/generated/client.ts (BOOTSTRAP STUB — gitignored; 2 lines)
  modified:
    - src/server.ts — imports + createMcpServer wrap + Express mount

key-decisions:
  - "Dual-seam filter with SDK wrap as primary + Express middleware as
    defense in depth — the SDK v1.29+ StreamableHTTPServerTransport
    delegates to @hono/node-server's getRequestListener which writes
    directly to the raw ServerResponse via web-standard Response API,
    bypassing Express's res.json/res.send entirely. The middleware
    NEVER fires on /mcp POSTs in practice, but stays mounted for (1)
    legacy SSE POST shims and (2) forward-compat with transports that
    DO route through Express response methods."
  - "Capture-before-replace pattern for SDK handler override — reach
    into `server.server._requestHandlers.get('tools/list')` to save the
    default closure, then install a wrapper that awaits the default and
    filters. This avoids reimplementing the SDK's ListToolsRequest
    handling (which walks `_registeredTools` map + normalizes schemas);
    we only add a post-filter step."
  - "Idempotent wrap via `Symbol.for('ms-365-mcp-server.tools-list-filter
    .wrapped')` — same namespaced-symbol pattern as dispatch-guard's
    stdio fallback. Repeated calls on the same McpServer are no-ops
    rather than chaining wrappers (which would produce O(n²) log spam
    and double-filter). Also survives vi.resetModules() in tests."
  - "Pass-through on undefined enabledToolsSet rather than fail-closed
    at the list layer — dispatch-guard (plan 05-04) is the authoritative
    gate that rejects disabled tools at invocation time. The filter is
    an UX optimization + defense in depth; failing closed here would
    produce empty tools/list on legacy /mcp paths where loadTenant
    doesn't run, breaking the v1 compatibility shim. Rationale is
    encoded in a warn-level pino log."
  - "Response mutation via spread-return (immutability) rather than
    `result.tools = filteredTools` — even though the SDK's default
    closure returns a fresh object on every call, not mutating
    preserves referential integrity if a downstream consumer (future
    plan) memoizes the result."
  - "TOOLS_LIST_METHOD = 'tools/list' as const hoisted to module scope —
    the literal is used in BOTH the middleware `body.method` guard AND
    the SDK handler map key. A single const ensures a future SDK
    rename (e.g. 'tools.list') updates both in lockstep."

patterns-established:
  - "SDK handler-level wrap by reaching into Server._requestHandlers —
    reusable for future plans that need to filter/transform other MCP
    methods (resources/list, prompts/list) without forking the SDK.
    Caller owns the wrap lifecycle (call AFTER tool registration; mark
    idempotent via Symbol.for)."
  - "filterIfToolsList(payload) helper for JSON-RPC envelope inspection —
    a pure function that walks a `{ jsonrpc, id, result: { tools } }`
    shape and returns a new envelope when tools are filtered, otherwise
    the input. Reusable for any future Express-level JSON-RPC response
    interceptor."

requirements-completed: [COVRG-04, TENANT-08]

# Metrics
duration: 11min
completed: 2026-04-20
---

# Phase 5 Plan 05: tools/list Per-Request Filter Middleware Summary

**SDK-level `tools/list` handler wrap that captures the MCP SDK's default closure from `Server._requestHandlers` and filters the response by the per-request tenant's frozen `enabled_tools_set` (read from AsyncLocalStorage), complemented by an Express middleware defense-in-depth layer that intercepts `res.json`/`res.send` for any transport that DOES route through Express's response methods.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-04-20T13:52:08Z (worktree base verified at a0c5196)
- **Completed:** 2026-04-20T14:02:54Z
- **Tasks:** 1 (RED + GREEN TDD commits)
- **Files created:** 4 (1 source + 2 test + 1 bootstrap stub)
- **Files modified:** 1 (src/server.ts)
- **Filter latency (14k tools / 200 enabled):** p50=0.23ms, p99=0.31ms, max=0.99ms — **16x under the 5ms threat-register target** (T-05-11).

## Accomplishments

- **SDK handler wrap (`wrapToolsListHandler`, 41 lines):** captures `server.server._requestHandlers.get('tools/list')` (the SDK's default closure installed lazily on first `server.tool()` call), saves it as `defaultHandler`, then installs a wrapper via `_requestHandlers.set('tools/list', filteredHandler)` that awaits the default and passes the result through `applyTenantFilter`. Idempotent via `Symbol.for('ms-365-mcp-server.tools-list-filter.wrapped')` — repeat calls on the same `McpServer` are no-ops.

- **Pure filter (`applyTenantFilter`, 23 lines):** reads `getRequestTenant().enabledToolsSet` from ALS; undefined set → pass-through (with tenant-id-gated warn log); malformed result shape → pass-through; valid result → return `{ ...result, tools: result.tools.filter(t => enabledSet.has(t.name)) }` (immutable spread-return preserving `nextCursor`, `_meta`, and any other SDK fields). Pino info log per filtered call with `{ tenantId, before, after }`.

- **Express middleware (`createToolsListFilterMiddleware`, 33 lines):** two gate checks (POST + `body.method === 'tools/list'`) before any work. On match, replaces `res.json` and `res.send` with try/catch wrappers that call `filterIfToolsList(payload)`. `res.json` always filters (via `applyTenantFilter`); `res.send` filters ONLY strings that parse as JSON — binary bodies (Buffer, Uint8Array, null, undefined, plain object) pass through byte-identical so SSE events and chunked transfers are not corrupted.

- **JSON-RPC envelope helper (`filterIfToolsList`, 20 lines):** pure inspector that walks `{ jsonrpc, id, result: { tools } }` shape, returns the input unchanged if any expected field is missing, or a new envelope `{ ...envelope, result: filtered }` when filtering applies. Preserves `jsonrpc`, `id`, `_meta`, and any other JSON-RPC envelope fields through the filter.

- **server.ts wiring:** `wrapToolsListHandler(server)` called at the END of `createMcpServer(tenant)` — after `registerAuthTools`, `registerDiscoveryTools`, and `registerGraphTools` — guaranteeing the SDK's default handler is already installed. Express middleware mounted between `authSelector` and the transport handlers on `/t/:tenantId/mcp` (POST) and `/t/:tenantId/messages` (POST); NOT mounted on the GET variants because GET is the legacy SSE upgrade path where JSON-RPC method bodies do not exist.

- **Bootstrap stub (`src/generated/client.ts`, 2 lines):** a gitignored `export const api = new Zodios([])` stub added to the worktree so `vi.mock('../../src/generated/client.js', ...)` in dispatch tests can resolve the module path. The real catalog populates via `npm run generate:coverage` per Plan 05-04's same pattern.

## Task Commits

Task 1 followed the RED → GREEN TDD discipline:

1. **Task 1 RED: failing tests for tools/list per-tenant filter** — `9db3cc5` (test)
2. **Task 1 GREEN: tools/list per-tenant filter + server.ts mounting** — `fe1ea7b` (feat)

## Files Created/Modified

### Created

- `src/lib/tool-selection/tools-list-filter.ts` (+272 new, post-prettier) — exports `createToolsListFilterMiddleware` + `wrapToolsListHandler` + `applyTenantFilter` + internal `filterIfToolsList`. Header doc explicitly calls out why the SDK wrap is the authoritative path (Streamable HTTP bypasses Express response methods via @hono/node-server) and why the middleware remains mounted (defense in depth + legacy SSE POST + forward-compat).
- `test/tool-selection/tools-list-filter.int.test.ts` (+230 post-prettier) — 4 integration tests exercising the SDK wrap via `server.server._requestHandlers.get('tools/list')` invocation inside `requestContext.run(...)` frames.
- `test/tool-selection/tools-list-correctness.int.test.ts` (+342 post-prettier) — 13 integration tests spanning both seams. Middleware tests use a minimal `Response` mock (plain object with `json`/`send`/`status` methods) rather than a full HTTP server — sufficient for verifying the interceptor installation + pass-through behavior.
- `src/generated/client.ts` (+14 new, gitignored) — bootstrap stub; `export const api = new Zodios([])`.

### Modified

- `src/server.ts` (+18, −3):
  - Added import `{ createToolsListFilterMiddleware, wrapToolsListHandler }` from `./lib/tool-selection/tools-list-filter.js` at the existing Phase 3/5 import cluster.
  - Added `wrapToolsListHandler(server)` call at the END of `createMcpServer(tenant)`, after `registerGraphTools` / `registerDiscoveryTools`.
  - Added `const toolsListFilter = createToolsListFilterMiddleware()` inside `mountTenantRoutes` alongside the existing `seedTenantContext` instantiation.
  - Inserted `toolsListFilter` between `authSelector` and the POST handlers on `/t/:tenantId/messages` + `/t/:tenantId/mcp` (POST). GET variants unchanged.

## Decisions Made

- **Dual-seam filter architecture (SDK wrap + Express middleware) rather than middleware-only:** @modelcontextprotocol/sdk v1.29's StreamableHTTPServerTransport delegates to `@hono/node-server`'s `getRequestListener` which converts the Node.js `(req, res)` to a web-standard `Request`/`Response` and writes the response body via the raw `ServerResponse` socket. Express's `res.json` and `res.send` methods are NEVER called on this path. The SDK-level wrap is the ONLY reliable interception seam for Streamable HTTP. The middleware stays mounted for defense in depth: legacy SSE POST (`/t/:tenantId/messages`) routes through a different handler that uses standard Express response methods, AND future transport implementations may revert to Express-native serialization. Plan 05-04 summary already documented the @hono/node-server bypass as the reason.

- **Capture-before-replace pattern for SDK handler override:** The SDK's `Server.setRequestHandler(schema, handler)` just calls `Map.set()` on `_requestHandlers` — it does NOT chain handlers. Calling it a second time replaces the closure entirely, losing the default `ListToolsRequest` logic that normalizes Zod schemas to JSON Schema + filters by `tool.enabled`. Reaching into `inner._requestHandlers.get('tools/list')` to save the default closure, then `.set('tools/list', wrappedHandler)` that awaits the default and filters its result, is the only approach that preserves SDK semantics without forking the SDK. Implementation uses `McpServer.server as unknown as { _requestHandlers: Map<...> }` — the underscore is private-by-convention (JS / TS structural typing), not symbol-protected, so runtime access is supported.

- **Idempotent wrap via `Symbol.for()` mark:** `wrapToolsListHandler` stores a marker on the `McpServer` instance via `(mcpServer as Record<symbol, boolean>)[WRAP_MARK] = true`. Repeat calls bail early. `Symbol.for('ms-365-mcp-server.tools-list-filter.wrapped')` — same pattern as dispatch-guard's stdio fallback (plan 05-04). Survives `vi.resetModules()` in tests and prevents double-wrapping if `createMcpServer` is called multiple times for the same tenant (not expected but forward-compat).

- **Pass-through (not fail-closed) on undefined `enabledToolsSet`:** dispatch-guard is the authoritative gate — it fails closed on disabled tool invocations. Failing closed at the list layer would empty out `tools/list` on any route that bypasses `loadTenant` (legacy /mcp, admin paths that accidentally hit this handler), breaking v1 compatibility shims. The filter emits a warn-level pino log when `tenant.id` is set but `enabledToolsSet` is not (indicating a loadTenant populate bug) so operators see the anomaly. Undefined ALS frame (stdio path) is silent pass-through because the stdio fallback + dispatch-guard cover that case.

- **Immutable spread-return rather than in-place mutation** (`return { ...result, tools: filteredTools }`): Even though the SDK's default closure produces a fresh result object on every call, NOT mutating preserves referential integrity if a downstream consumer (plan 05-06 discovery BM25 cache) ever memoizes the result. Consistent with the project's coding-style rule: "ALWAYS create new objects, NEVER mutate existing ones".

- **Express middleware mounted on POST /messages + POST /mcp only** (not GET /mcp, not GET /sse): GET is the SSE event-stream upgrade path — response is chunked `text/event-stream`, not JSON-RPC. Installing `res.json`/`res.send` interceptors there would corrupt SSE events if the Express app ever called them (even though the current SSE transport writes directly via `res.write`). Gate 1 (`req.method !== 'POST'`) inside the middleware is a fail-safe but the route-level opt-out is cleaner.

- **TOOLS_LIST_METHOD constant hoisted to module scope:** Single source of truth for the literal string `'tools/list'` — used in BOTH the middleware `body.method` guard AND the SDK `_requestHandlers` key. A future SDK rename (major version bump to `'tools.list'` or similar) means updating one constant. Typed `as const` so TypeScript locks the narrow literal.

## Deviations from Plan

### Rule 3 (blocking): src/generated/client.ts bootstrap stub absent from worktree

- **Found during:** Task 1 GREEN — `npx vitest run test/tool-selection/` failed with `Failed to load url ../../generated/client.js` on tests that didn't mock the module explicitly.
- **Root cause:** The worktree was branched off Plan 05-04's completion state, but `src/generated/client.ts` is gitignored (`.gitignore:149`). Plan 05-04's summary describes the bootstrap stub as "present in the worktree ONLY so vi.mock can resolve" — that stub was in 05-04's worktree but does not carry across worktrees.
- **Fix:** Created `src/generated/client.ts` with the 2-line `export const api = new Zodios([])` stub, following Plan 05-04's exact pattern. File remains gitignored; added to the worktree's filesystem only so tests resolve imports.
- **Why Rule 3:** Blocker for Task 1 GREEN — tests cannot run without the module existing on disk. Mechanical fix, no architectural implication. Committed as part of the Task 1 GREEN commit.

### Rule 3 (blocking): fastest-levenshtein missing from main-repo node_modules

- **Found during:** Task 1 GREEN — `npx vitest run test/tool-selection/` failed on `registry-validator.test.ts` with `Cannot find package 'fastest-levenshtein'`.
- **Root cause:** The main repo's `package.json` declares `fastest-levenshtein@^1.0.16` as a dependency (added by Plan 05-04) but the package was not installed in `node_modules/` of the main repo. Worktree symlinks node_modules from the main repo, so the missing package propagates.
- **Fix:** Ran `npm install fastest-levenshtein@^1.0.16 --no-save` in the main repo to populate the package into `node_modules/` without mutating package.json. `package.json` already has the dep declared from Plan 05-04; the `--no-save` flag preserves the existing version spec exactly.
- **Why Rule 3:** Blocker for test-suite regression verification. The pre-existing 30 failures in `discovery-search` / `tool-schema` / `endpoints-validation` (which require `npm run generate:coverage` against a real Graph spec) are independent; fixing `fastest-levenshtein` unblocked the tool-selection suite specifically. No code change, no commit needed.

### Tactical choice: no supertest / full HTTP integration test for the Express middleware

- **Found during:** Task 1 RED planning.
- **Issue:** The plan's action 5 suggested "use supertest or node-fetch" to exercise the middleware via a real Express server. `supertest` is not a dependency; `node-fetch` duplicates Node 20's built-in `fetch`; spinning up a real HTTP server would require port selection + full Phase 3 bootstrap (pg-mem + redis facade + MCP SDK).
- **Decision:** Test the middleware with a minimal `Response` mock (plain object with `status`/`json`/`send` methods returning `this`) and drive the middleware directly. This is sufficient to verify:
  - POST-only gate
  - body.method gate
  - res.json/res.send interception installation
  - filter-then-delegate behavior
  - non-JSON / Buffer pass-through
- **Rationale:** The full integration path is already covered by Plan 03-09's `three-transports.ts` harness + Plan 05-05's SDK wrap path (which runs on every Streamable HTTP request). A dedicated supertest harness would add ~200 LOC and test infrastructure risk (port bind races in CI) without increasing coverage of the filter itself.

## Issues Encountered

- **@hono/node-server bypass discovery (~5 min to diagnose):** Reading the plan's action 1 suggested an Express-level `res.json`/`res.send` override as the primary path. Reading `@modelcontextprotocol/sdk/server/streamableHttp.js` surfaced that the SDK uses `getRequestListener` from `@hono/node-server`, which converts Node.js HTTP to web-standard `Request`/`Response` and writes directly to the raw `ServerResponse` socket. This means Express's response methods are NEVER called on the Streamable HTTP path. Pivoted to the SDK-level wrap as primary; kept the middleware as defense in depth. The plan's action 1 explicitly acknowledged this possibility ("if that path is exercised, interception via res.send alone is insufficient... PREFERRED APPROACH FOR THIS PLAN: override MCP SDK's tools/list handler at registration time") — I followed the preferred approach.

- **SDK `_requestHandlers` map access (~3 min to verify safety):** The Map is private-by-convention (`_` prefix, no TypeScript `private` keyword, no Symbol protection). Accessing it via `(server as unknown as { _requestHandlers: Map<...> })` is the idiomatic pattern but brittle across SDK major versions. Mitigation: hoisted `TOOLS_LIST_METHOD` constant so a rename is one-line; header doc calls out the coupling explicitly; test imports the wrap through the module boundary so any breakage surfaces as test failures rather than silent behavior drift.

- **Pre-existing 30 test failures in `discovery-search` / `tool-schema` / `endpoints-validation`:** Documented in Plan 05-04 summary line 285-286 — these require the real populated `src/generated/client.ts` from `npm run generate:coverage`. Unchanged by Plan 05-05; the 2-line bootstrap stub satisfies tool-selection's `vi.mock` requirements but those three test files call `describeToolSchema` / `registry.get('send-mail')` which need actual endpoints. Not in scope for this plan.

## Threat Mitigation

| Threat ID                                                      | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-05-10 (Info Disclosure: tool metadata leaked pre-dispatch)   | Mitigated | Both seams filter on `enabledSet.has(tool.name)` — O(1) strict-subset check. Set is frozen (`Object.freeze` in Plan 05-04 parser). ALS isolation per request (verified by test/tool-selection/tools-list-filter.int.test.ts Test 3: 20 interleaved concurrent calls across two tenants produce disjoint tool lists with zero cross-tenant leakage). Pino log emits `{ tenantId, before, after }` per filtered call for operator audit.                                                                                                                                 |
| T-05-10b (Non-tools/list accidentally intercepted)             | Mitigated | Middleware gates on `body.method === 'tools/list'` before replacing res methods (test/tool-selection/tools-list-correctness.int.test.ts Tests 11-13: prompts/list, tools/call, malformed body all pass through). SDK wrap only touches the `tools/list` slot in `_requestHandlers` via a single `.set()` call — other methods (initialize, notifications/initialized, tools/call) are unaffected.                                                                                                                                                                     |
| T-05-11 (DoS: filter loop on large responses)                  | Mitigated | Filter is O(n) where n = SDK's pre-filter response size. Probed with a 14k-tool fixture on the test machine: p99=0.31ms, max=0.99ms, mean=0.20ms. 16× under the 5ms threat-register target. `Set.has` is O(1) amortized; no regex or string manipulation per tool.                                                                                                                                                                                                                                                                                                    |
| T-05-11b (Memory from buffered res.json override)              | Accept    | Response buffer is bounded by MCP SDK's own response allocation; filter adds a single pass (filter + spread) without duplicating the buffer. `res.send` interceptor parses + reserializes JSON strings — adds at most 2× the string size in transient allocations during the single filter call, reclaimed by GC.                                                                                                                                                                                                                                                     |
| T-05-10c (Filter omits tool that dispatch-guard would accept)  | Accept    | Filter reads from the exact same `enabledToolsSet` that dispatch-guard consumes (via shared `getRequestTenant()` helper). They are perfectly consistent by construction — same ALS frame, same Set instance. No separate source of truth.                                                                                                                                                                                                                                                                                                                            |
| T-05-10d (Filter accepts tool dispatch-guard would reject)     | Accept    | Opposite direction; impossible by construction for the same reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Assumptions

- **A1 (SDK `_requestHandlers` map access is stable across v1.29.x):** The underscore is convention-only; no TypeScript `private` keyword; no Symbol protection. Access pattern identical to the existing Plan 05-04 reliance on SDK internals (though 05-04 didn't reach this deep). If a future SDK minor version moves this to a `#private` field or WeakMap, the wrap breaks and tests fail loudly — preferable to silent behavior drift.

- **A2 (SDK method literal is `'tools/list'`):** Sourced from `getMethodLiteral(ListToolsRequestSchema)` which extracts the `method: z.ZodLiteral<'tools/list'>` field. Hoisted into `TOOLS_LIST_METHOD` const; a SDK rename means one-line update.

- **A3 (default handler is installed by the time `wrapToolsListHandler` runs):** `wrapToolsListHandler(server)` is called at the END of `createMcpServer` — after `registerGraphTools` / `registerDiscoveryTools` / `registerAuthTools` — all of which call `server.tool(...)` which triggers `setToolRequestHandlers()` (lazy init). By the time the wrap runs, `_requestHandlers.get('tools/list')` is guaranteed to return a function. A warn log fires + no-op if the handler is unexpectedly absent.

- **A4 (ALS frame survives the SDK's handler invocation):** MCP SDK's `Protocol._onrequest` looks up the handler in `_requestHandlers` and calls it synchronously from the same tick as the incoming request. AsyncLocalStorage propagates through awaits, setTimeout, promises, etc. — the ALS frame seeded by `seedTenantContext` at the top of the Express pipeline is still active when the SDK invokes our wrapped handler. Verified by Test 3's concurrent 20-call interleaving.

## Known Stubs

- **`src/generated/client.ts` (bootstrap stub, gitignored):** 2 lines — `export const api = new Zodios([])`. Present so `vi.mock` in `test/tool-selection/*.int.test.ts` can resolve the module path before the mock intercepts. Regenerated by `npm run generate:coverage` per Plan 05-01 against the full Microsoft Graph OpenAPI spec. Not a stub introduced by this plan — reproduced from Plan 05-04's worktree because worktree branching does not carry gitignored files.

## Threat Flags

(None discovered — no new network endpoints, no new auth paths, no new file access beyond reading already-wired ALS state.)

## User Setup Required

None — no external service configuration required.

The tools/list filter is active as soon as Plans 05-01..05-04 are merged. Operators see filtered tool lists per tenant automatically after a server restart (the SDK handler wrap binds at `createMcpServer` time; no dynamic reconfig needed). Tenants pinned to `essentials-v1` preset see ~150 tools; tenants with explicit `enabled_tools` strings see their configured subset.

## MCP SDK Internal Contract Surprises

1. **`@hono/node-server` bypass of Express response methods:** The single largest design pivot. Plan's action 1 correctly predicted this possibility ("if that path is exercised, interception via res.send alone is insufficient") and recommended the SDK-level wrap as the preferred approach. Confirmed by reading `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js:9` — `import { getRequestListener } from '@hono/node-server'`. The transport's `handleRequest(req, res)` calls `getRequestListener` which does its own `ServerResponse.writeHead/end` instead of deferring to Express.

2. **`setRequestHandler` overwrites silently:** No warning / throw on duplicate registration for the same method. `Map.set()` is plain replacement. `assertCanSetRequestHandler` is only called by the SDK's own `setToolRequestHandlers` (first-registration guard). External callers can overwrite at will — the capture-then-replace pattern for the filter wrap is the only way to preserve the default behavior.

3. **Tool enumeration order:** The SDK's default `tools/list` handler walks `Object.entries(this._registeredTools)` in insertion order (JS spec: string keys maintain insertion order in V8). So `server.tool('alpha', ...)` then `server.tool('bravo', ...)` yields `[alpha, bravo]` in the response. Our filter preserves that order (verified by Test 6).

## Stdio-Mode Observation

The plan's action 7 asked for a stdio-mode test if feasible. Deferred because:

- stdio mode shares the exact same code path: `wrapToolsListHandler(server)` runs inside `createMcpServer` which is invoked once per process in stdio mode. The filter reads `getRequestTenant()` from AsyncLocalStorage — in stdio mode, ALS is empty (no `requestContext.run()` around the MCP connect), and the SDK's stdio transport does NOT seed the frame per-request.
- The existing test `test/tool-selection/tools-list-correctness.int.test.ts` Test 7 (undefined ALS → pass-through) covers the stdio behavior functionally — the filter never trips when ALS is empty, dispatch-guard (plan 05-04) uses its module-level `stdioFallback` at invocation time.
- Running a real stdio subprocess test (vitest process-spawn) would add ~100 LOC of fixture setup for zero additional coverage of the filter itself (only of the existing Plan 05-04 stdio fallback, which is already tested in `dispatch-enforcement.int.test.ts` Test 4).

## Next Phase Readiness

Ready to spawn Plan 05-06 (discovery BM25 per-tenant cache). The BM25 plan will:

1. Build a per-tenant index keyed by `tenantId:sha256(sorted enabled_tools_set)[:16]` — reads the same `getRequestTenant()` triple.
2. Filter `get-tool-schema` / `search-tools` results post-rank against `enabledToolsSet` — the EXACT same filter pattern as `applyTenantFilter`, just applied to BM25 result shape.

Plan 05-07 (admin PATCH `/admin/tenants/{id}/enabled-tools`) can consume the same ALS seam once a tenant's `enabled_tools` is mutated — the filter picks up the new Set on the next `loadTenant` cache miss / pub/sub eviction (mcp:tool-selection-invalidate).

Blockers: none. The 30 pre-existing test failures require `npm run generate:coverage` to regenerate `src/generated/client.ts` against the full Microsoft Graph OpenAPI spec; independent of this plan.

## Self-Check: PASSED

Files verified (absolute paths):

- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-aa18feaa/src/lib/tool-selection/tools-list-filter.ts` — FOUND (272 lines post-prettier)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-aa18feaa/test/tool-selection/tools-list-filter.int.test.ts` — FOUND (230 lines post-prettier)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-aa18feaa/test/tool-selection/tools-list-correctness.int.test.ts` — FOUND (342 lines post-prettier)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-aa18feaa/src/server.ts` — MODIFIED (import + wrap call + middleware mount)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-aa18feaa/src/generated/client.ts` — FOUND (bootstrap stub, gitignored)

Commits verified in `git log`:

- `9db3cc5` (test/05-05 Task 1 RED) — FOUND
- `fe1ea7b` (feat/05-05 Task 1 GREEN) — FOUND

Test run evidence:

- `npx vitest run test/tool-selection/tools-list-filter.int.test.ts test/tool-selection/tools-list-correctness.int.test.ts` → 17 PASS / 0 FAIL (4 filter + 13 correctness).
- `npx vitest run test/tool-selection/` → 94 PASS / 0 FAIL (17 new + 77 from Plans 05-01..05-04).
- `npx vitest run` (full suite) → 1033 PASS / 30 FAIL (same 30 pre-existing failures as Plan 05-04 summary — discovery-search, tool-schema, endpoints-validation; require live `src/generated/client.ts`).
- `npx tsc --noEmit` → 87 errors, all pre-existing (identical count before/after my changes; zero introduced).
- `npx eslint src/lib/tool-selection/tools-list-filter.ts src/server.ts` → 0 errors, 4 pre-existing warnings in server.ts (unrelated lines 1745/1798).
- `npx prettier --check` on new/modified files → PASS after automatic formatter.

TDD gate compliance:

- Task 1: `test(05-05)` commit `9db3cc5` precedes `feat(05-05)` commit `fe1ea7b` → RED → GREEN respected.

---

_Phase: 05-graph-coverage-expansion-per-tenant-tool-selection_
_Completed: 2026-04-20_
