---
phase: 02-graph-transport-middleware-pipeline
plan: "01"
subsystem: api

tags:
  - middleware-scaffold
  - pipeline
  - onion-model
  - kiota-pattern
  - request-context
  - graph-client-refactor
  - token-refresh

# Dependency graph
requires:
  - phase: 01-foundation-hardening
    provides: pino logger + D-01 STRICT redaction (01-02), RequestContext via AsyncLocalStorage (01-02), OTel bootstrap with graph.* span namespace (01-02), refreshAccessToken helper in src/lib/microsoft-auth.ts (01-02)
provides:
  - graph-middleware-pipeline-scaffold
  - graph-request-type
  - graph-middleware-interface
  - composePipeline-onion-driver
  - double-call-guard
  - token-refresh-middleware
  - request-context-retry-fields
  - canonical-graph-response-fixtures
  - toResponse-fixture-helper
affects:
  - src/graph-client.ts
  - src/request-context.ts
  - src/lib/middleware/*
  - 02-02-plan (RetryHandler outer middleware)
  - 02-03-plan (ODataErrorHandler middle middleware + GraphError hierarchy)
  - 02-04-plan (PageIterator calls through the chain per page)
  - 02-05-plan (BatchClient routes /$batch POST through the chain)
  - 02-06-plan (UploadSession bypasses chain via _skipRetry marker)
  - 02-07-plan (ETagMiddleware outermost middleware + structural order test)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Onion-model middleware interface: execute(req, next) -> Promise<Response> with closure-bound next (Koa-style, diverges from Kiota's mutation-based next-setter)"
    - "composePipeline driver with index-sentinel double-call guard"
    - "Per-middleware OTel span naming graph.middleware.{name}"
    - "Chain order convention: [ETag, Retry, ODataError, TokenRefresh] outermost-to-innermost; hole-filling pattern as subsequent plans land"
    - "Canonical test fixtures with real Graph hyphenated innerError field names (request-id, client-request-id) preserved verbatim"
    - "vi.hoisted for spy variables referenced in vi.mock factories"

key-files:
  created:
    - src/lib/middleware/types.ts
    - src/lib/middleware/pipeline.ts
    - src/lib/middleware/token-refresh.ts
    - test/fixtures/graph-responses.ts
    - test/pipeline.test.ts
    - test/middleware-types.test.ts
    - test/token-refresh-middleware.test.ts
  modified:
    - src/graph-client.ts
    - src/request-context.ts

key-decisions:
  - "Closure-bound next() (argument) instead of Kiota's instance-field next — matches Koa async middleware and avoids mutation-based chain construction"
  - "Double-call guard (index sentinel) throws deterministically when a middleware calls next() twice; protects against duplicate POST/PATCH/DELETE side effects"
  - "Chain order locked: [ETag (02-07), RetryHandler (02-02), ODataErrorHandler (02-03), TokenRefreshMiddleware (this plan)] — outermost to innermost. 02-01 leaves placeholder comments in the constructor array for subsequent plans to fill in"
  - "TokenRefreshMiddleware sits INNERMOST — refresh is a transport concern orthogonal to retry logic; outer middleware sees the post-refresh response, not the raw 401"
  - "RequestContext extended with optional retryCount + lastStatus + graph.coalesce; all optional means existing consumers are unaffected"
  - "Fixture file named test/fixtures/graph-responses.ts (no .test. segment) so Vitest's default glob ignores it — imported by middleware tests as a shared resource"
  - "Canonical fixtures preserve Graph's hyphenated innerError field names verbatim (request-id, client-request-id) — matches real wire format, addresses kiota-typescript #75 camelCase-clone anti-pattern"
  - "Used vi.hoisted() for refreshSpy in token-refresh test because vi.mock() is hoisted above top-level declarations"

patterns-established:
  - "Middleware class shape: module-level tracer, class implements GraphMiddleware, readonly name, execute wraps work in tracer.startActiveSpan with try/finally span.end. Pattern A in 02-PATTERNS.md."
  - "Wave 0 RED test structure: vi.mock('../src/logger.js') + direct middleware.execute() invocation + vi.fn() next spy. Pattern B in 02-PATTERNS.md."
  - "Pipeline wiring in GraphClient constructor: composePipeline([...middlewares], terminal) → readonly this.pipeline field → performRequest delegates via this.pipeline(req)"

requirements-completed:
  - MWARE-01
  - MWARE-02
  - MWARE-03
  - MWARE-04
  - MWARE-05
  - MWARE-06
  - MWARE-07

# Metrics
duration: ~10min
completed: 2026-04-19
---

# Phase 02 Plan 01: Graph Transport Middleware Pipeline Scaffold Summary

**Kiota-pattern onion middleware driver + TokenRefreshMiddleware extracted from v1 401-refresh path; GraphClient.performRequest now delegates to composePipeline; RequestContext extended with retryCount/lastStatus/graph.coalesce for downstream Phase 2 middleware to consume.**

## Performance

- **Duration:** ~10 min wall-clock (test + implement + refactor + regression)
- **Started:** 2026-04-19T10:11:28Z
- **Completed:** 2026-04-19T10:21:12Z
- **Tasks:** 3 (Task 1 RED tests, Task 2 types+pipeline, Task 3 TokenRefresh+GraphClient refactor)
- **Files created:** 7 (3 src + 4 test)
- **Files modified:** 2 (src/graph-client.ts + src/request-context.ts)
- **Commits:** 3 atomic + 1 docs (this summary)

## Accomplishments

- **GraphMiddleware interface** with closure-bound `next()` — the shape every Phase 2 middleware (02-02 through 02-07) implements.
- **composePipeline driver** with onion-model dispatch and a deterministic double-call guard (T-02-01a, T-02-01b mitigation) — a buggy middleware that awaits `next()` twice is surfaced at test time, not in production with duplicate POSTs.
- **TokenRefreshMiddleware** — v1 401-refresh semantics extracted verbatim, now sitting innermost in the pipeline. Outer middlewares will see the post-refresh response, not the raw 401.
- **GraphClient refactor** — `performRequest` builds a `GraphRequest` and delegates to `this.pipeline(req)`. Inline 401-refresh branch in `makeRequest` deleted; private `refreshAccessToken` method deleted (the helper `refreshAccessToken` in `src/lib/microsoft-auth.ts` is now called directly from the middleware).
- **RequestContext extension** — optional `retryCount` + `lastStatus` + `graph.coalesce` fields reserved. Non-breaking (all optional, no existing consumer reads them).
- **Canonical Graph fixtures** — 5 fixtures (429 / 503 / 412 / 400 / 500) lifted verbatim from Graph docs with hyphenated `innerError` field names preserved. Shared module for every subsequent Phase 2 middleware test.
- **All 307 existing Phase 1 tests still pass** — the pipeline refactor is behaviourally transparent. Binary-response, OData-nextLink, request-context concurrency, HTTP/OAuth-mode tests all GREEN.

## Task Commits

1. **Task 1: Wave 0 RED tests** — `5f4dde1` (test)
   - `test/pipeline.test.ts` — 3 tests (dispatch order, double-call guard, terminal-once)
   - `test/middleware-types.test.ts` — 1 test (interface shape, runtime + compile)
   - `test/fixtures/graph-responses.ts` — 5 canonical fixtures + `toResponse()` helper

2. **Task 2: Implement types + pipeline** — `84acee9` (feat)
   - `src/lib/middleware/types.ts` — exports `GraphRequest` (+ `_skipRetry` marker for 02-06) and `GraphMiddleware` interface
   - `src/lib/middleware/pipeline.ts` — exports `composePipeline` with index-sentinel guard
   - Wave 0 tests transitioned from RED to GREEN (4/4)

3. **Task 3: Extract TokenRefreshMiddleware + refactor GraphClient** — `79c000f` (feat)
   - `src/lib/middleware/token-refresh.ts` — TokenRefreshMiddleware class
   - `test/token-refresh-middleware.test.ts` — 2 tests (non-401 passthrough + 401 refresh-and-retry)
   - `src/request-context.ts` — RequestContext extended with retryCount / lastStatus / graph.coalesce
   - `src/graph-client.ts` — constructor wires pipeline; performRequest delegates; inline 401-refresh deleted; private refreshAccessToken method deleted

_(No separate REFACTOR commit was needed — Task 2 and Task 3 each produced clean code on the first pass.)_

## Files Created/Modified

### Created

- `src/lib/middleware/types.ts` — `GraphRequest` (url, method, headers, body, `_skipRetry`) + `GraphMiddleware` interface. Small, dependency-free, type-only. Analog: `src/request-context.ts` header style.
- `src/lib/middleware/pipeline.ts` — `composePipeline(middlewares, terminal)` returns a dispatcher that walks the chain with `let index = -1` sentinel; `if (i <= index) throw new Error('next() called multiple times')` is the double-call guard. Analog: `src/lib/bm25.ts` pure-algorithm module with JSDoc-heavy algorithm explanation.
- `src/lib/middleware/token-refresh.ts` — `TokenRefreshMiddleware implements GraphMiddleware`. On 401 + refresh token in `requestContext.getStore()`, calls `refreshAccessToken` and retries once. Analog: the middleware class shape is the template for 02-02 / 02-03 / 02-07.
- `test/fixtures/graph-responses.ts` — `canonical429Throttle`, `canonical503ServiceUnavailable`, `canonical412PreconditionFailed`, `canonical400ValidationError`, `canonical500InternalServer` + `toResponse(f)` helper. Used by every Phase 2 middleware test.
- `test/pipeline.test.ts` — 3 tests exercising the driver directly (no mocks beyond `vi.fn()` spies).
- `test/middleware-types.test.ts` — 1 test that imports the module at runtime (via `await import`) so RED fails audibly; the `import type` pattern alone would be erased at transform time.
- `test/token-refresh-middleware.test.ts` — 2 tests. Uses `vi.hoisted()` for the `refreshSpy` so the `vi.mock('../src/lib/microsoft-auth.js', ...)` factory sees the spy after hoisting.

### Modified

- `src/graph-client.ts`:
  - Added `import { composePipeline } from './lib/middleware/pipeline.js'`, `import { TokenRefreshMiddleware } from './lib/middleware/token-refresh.js'`, `import type { GraphRequest } from './lib/middleware/types.js'`.
  - Removed `import { refreshAccessToken } from './lib/microsoft-auth.js'` (the middleware owns this import now; GraphClient no longer references the helper directly).
  - Added `private readonly pipeline: (req: GraphRequest) => Promise<Response>` field.
  - Constructor builds the pipeline with `[new TokenRefreshMiddleware(this.authManager, this.secrets)]` plus placeholder comments for ETag (02-07), RetryHandler (02-02), ODataErrorHandler (02-03). Terminal handler is `(req) => fetch(req.url, { method, headers, body })`.
  - `makeRequest` — deleted the inline `if (response.status === 401 && refreshToken) { ... }` branch.
  - `performRequest` — builds a `GraphRequest` and calls `return this.pipeline(req)` instead of `fetch(...)`.
  - Deleted the `private async refreshAccessToken` method entirely.
  - `makeRequest`'s 403-scope-error branch, generic 4xx/5xx handling, binary-response detection, `includeHeaders` / ETag surfacing, and `formatJsonResponse` all left UNTOUCHED — 02-03 owns 4xx/5xx typed-error parsing; 02-07 owns ETag plumbing.
- `src/request-context.ts`:
  - `RequestContext` interface extended with three new optional fields: `retryCount?: number`, `lastStatus?: number`, `graph?: { coalesce?: boolean }`. All optional — no existing consumer reads them, so the extension is non-breaking. 02-02 RetryHandler will write retryCount/lastStatus; 02-05 reserves `graph.coalesce` for Phase 6 auto-batch per D-07.

## Decisions Made

_All in-plan; no deviation from the committed D-05..D-09 chain._

- **Chain ordering locked:** `[ETag, RetryHandler, ODataError, TokenRefresh]` outermost-to-innermost. 02-01's constructor array deliberately leaves holes (comments) for 02-02 / 02-03 / 02-07 to fill in — order is load-bearing. 02-07 will include a structural regression test that greps for this shape.
- **Closure-bound `next()` over Kiota's instance-field next-setter** — matches Koa/Express async middleware patterns and makes the double-call guard possible as a simple index-sentinel check.
- **Fixture file lives outside the `*.test.ts` glob** — `test/fixtures/graph-responses.ts` named without a `.test.` segment so Vitest's default `include: ['**/*.{test,spec}.{ts,tsx}']` ignores it. Confirmed via a Vitest list run that finds no `graph-responses` entry.
- **Hyphenated `innerError` field names preserved verbatim** — `request-id`, `client-request-id`. Tests assert against the real Graph wire format, not a camelCased clone. This matters for 02-03 parseODataError which must read BOTH hyphenated AND camelCase keys (kiota-typescript issue #75).
- **`vi.hoisted()` wrapper for the refresh spy** — `vi.mock()` is hoisted above top-level declarations, so a plain `const refreshSpy = vi.fn()` followed by `vi.mock(..., () => ({ refreshAccessToken: refreshSpy }))` hits "Cannot access 'refreshSpy' before initialization". `vi.hoisted(() => ({ refreshSpy: vi.fn() }))` moves the spy to hoist time. Pattern to reuse in 02-02 / 02-03 / 02-07 retry / error / etag tests where spies need to be referenced by mocks.

## Deviations from Plan

None — plan executed exactly as written. All 3 tasks completed in order with RED → GREEN transitions where the plan called for TDD, and all verification greps (`grep -c ...`) match the contract in the plan.

## Issues Encountered

1. **Initial RED test for `middleware-types.test.ts` leaked as GREEN.** Root cause: a pure `import type { ... }` statement is erased at the TypeScript transform stage, so Vitest never resolved the module path and the test silently passed even though the module didn't exist. **Resolution:** added an `await import('../src/lib/middleware/types.js')` runtime import inside the `it` block so module resolution happens at test time. Not a deviation — just a Vitest-semantics nuance the plan didn't explicitly call out.

2. **First draft of `test/token-refresh-middleware.test.ts` hit `ReferenceError: Cannot access 'refreshSpy' before initialization`.** Root cause: `vi.mock()` is hoisted above all top-level declarations, so a bare `const refreshSpy = vi.fn()` declared before the mock factory is still in the TDZ at hoist time. **Resolution:** moved the spy into `vi.hoisted()`. Pattern captured in "Decisions Made" and 02-PATTERNS.md for downstream middleware plans to reuse.

3. **Pre-existing unrelated test failures on the base commit** — `test/public-url-failfast.test.ts` and `test/startup-validation.test.ts` (4 spawn-tests that exit `null` because the spawned tsx process times out in this environment). Verified pre-existing by stashing all working-tree changes and re-running; same 4 failures. NOT caused by plan 02-01 and NOT in scope for this plan per the deviation rules (scope boundary: only fix issues DIRECTLY caused by the current task). Logged for awareness; left untouched.

## User Setup Required

None — no external service configuration required. The pipeline scaffold is internal refactor; runtime behaviour for existing Graph calls is identical.

## Next Phase Readiness

### What 02-02 (RetryHandler) should read first

- **`src/lib/middleware/token-refresh.ts`** — template for 02-02's `src/lib/middleware/retry.ts`. Same class shape: module-level `const tracer = trace.getTracer('graph-middleware')`, `class RetryHandler implements GraphMiddleware`, `readonly name = 'retry'`, `async execute(req, next)` wraps work in `tracer.startActiveSpan('graph.middleware.retry', async (span) => { try { ... } finally { span.end(); } })`.
- **`test/token-refresh-middleware.test.ts`** — template for 02-02's `test/retry-handler.test.ts`. Same `vi.hoisted` + `vi.mock('../src/logger.js', ...)` + direct `mw.execute(mkReq(), next)` invocation pattern.
- **`test/fixtures/graph-responses.ts`** — `canonical429Throttle` + `canonical503ServiceUnavailable` are exactly what the RetryHandler needs to assert against. Import the fixtures, use `toResponse()` to build the `Response` instances the middleware sees from `next()`.

### Pipeline registration hole left for 02-02

In `src/graph-client.ts`:

```typescript
this.pipeline = composePipeline(
  [
    // ETagMiddleware — 02-07
    // RetryHandler — 02-02           <-- 02-02 inserts here
    // ODataErrorHandler — 02-03
    new TokenRefreshMiddleware(this.authManager, this.secrets),
  ],
  ...
);
```

02-02 replaces the `// RetryHandler — 02-02` comment with `new RetryHandler(),` (or equivalent). Order is load-bearing: RetryHandler MUST sit between the ETag placeholder and the ODataErrorHandler placeholder to satisfy the chain-ordering invariant documented in 02-PATTERNS.md Pattern E.

### RequestContext fields ready for 02-02 to populate

- `retryCount?: number` — write on every retry loop iteration.
- `lastStatus?: number` — write on every retry loop iteration.
- `graph?: { coalesce?: boolean }` — reserved for Phase 6; 02-02 does not touch it.

Access via:

```typescript
import { requestContext } from '../../request-context.js';
const ctx = requestContext.getStore();
if (ctx) {
  ctx.retryCount = attempt;
  ctx.lastStatus = response.status;
}
```

### Blockers / concerns

None. Scaffold is complete, transparent, and fully tested.

## Self-Check: PASSED

**Files created — verified existing:**
- `src/lib/middleware/types.ts` — FOUND
- `src/lib/middleware/pipeline.ts` — FOUND
- `src/lib/middleware/token-refresh.ts` — FOUND
- `test/fixtures/graph-responses.ts` — FOUND
- `test/pipeline.test.ts` — FOUND
- `test/middleware-types.test.ts` — FOUND
- `test/token-refresh-middleware.test.ts` — FOUND

**Commits — verified in git log:**
- `5f4dde1` — test(02-01): Wave 0 RED tests — FOUND
- `84acee9` — feat(02-01): GraphMiddleware interface + composePipeline onion driver — FOUND
- `79c000f` — feat(02-01): extract 401-refresh to TokenRefreshMiddleware; wire GraphClient to pipeline — FOUND

**Verification greps — all match plan contract:**
- `grep -c 'composePipeline' src/graph-client.ts` → 2 (import + constructor)
- `grep -c 'private async refreshAccessToken' src/graph-client.ts` → 0
- `grep -c 'class TokenRefreshMiddleware' src/lib/middleware/token-refresh.ts` → 1
- `grep -c 'export interface GraphMiddleware' src/lib/middleware/types.ts` → 1
- `grep -c 'export function composePipeline' src/lib/middleware/pipeline.ts` → 1
- `grep -c 'retryCount' src/request-context.ts` → 1
- `grep -c 'lastStatus' src/request-context.ts` → 1
- `grep -c 'coalesce' src/request-context.ts` → 2 (field + comment)

**Test results:**
- 6 new Phase 2 tests GREEN (3 pipeline + 1 middleware-types + 2 token-refresh)
- 307 existing Phase 1 tests GREEN
- 4 pre-existing spawn-test failures in `test/public-url-failfast.test.ts` and `test/startup-validation.test.ts` — verified pre-existing on base commit, unrelated to this plan

**Build pipeline:**
- `npm run lint` → 0 errors, 59 pre-existing warnings
- `npm run format:check` → all files pass
- `npm run build` → tsup build success

---
*Phase: 02-graph-transport-middleware-pipeline*
*Completed: 2026-04-19*
