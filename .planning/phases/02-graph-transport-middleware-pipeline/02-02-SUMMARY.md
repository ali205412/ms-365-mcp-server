---
phase: 02-graph-transport-middleware-pipeline
plan: "02"
subsystem: api

tags:
  - retry-handler
  - aws-full-jitter
  - retry-after
  - idempotency-gate
  - _skipRetry-marker
  - mware-01
  - mware-02
  - pipeline-double-call-guard-refinement
  - otel-retry-span

# Dependency graph
requires:
  - phase: 02-graph-transport-middleware-pipeline
    provides: "middleware pipeline scaffold + composePipeline driver (02-01), canonical Graph fixtures with Retry-After-10 / 503 bodies (02-01), RequestContext.retryCount+lastStatus fields (02-01), GraphError hierarchy with retryAfterMs (02-03), ODataErrorHandler middleware that throws typed GraphError on non-2xx (02-03)"
provides:
  - retry-handler-middleware
  - retryable-statuses-constant
  - retry-after-parser
  - aws-full-jitter
  - idempotency-gate
  - retry-count-in-request-context
  - pipeline-sequential-next-support
affects:
  - src/graph-client.ts
  - src/lib/middleware/retry.ts
  - src/lib/middleware/pipeline.ts
  - 02-04-plan (PageIterator per-page requests inherit retry semantics unchanged)
  - 02-05-plan (BatchClient /$batch POST retried on 429 — writes without Idempotency-Key otherwise pass through)
  - 02-06-plan (UploadSession chunk PUTs MUST set req._skipRetry = true)
  - 02-07-plan (ETagMiddleware outermost — a 412 from ETag land must NOT be retried by RetryHandler, already guaranteed: 412 is not in RETRYABLE_STATUSES)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AWS full-jitter backoff: delay = floor(random() * min(cap=30000ms, base=500ms * 2^attempt))"
    - "Retry-After honoring with RFC 7231 dual-form parsing (delay-seconds with fractional tolerance + HTTP-date), clamped to RETRY_AFTER_MAX_MS=120000ms"
    - "Idempotency gate — write methods (POST/PATCH/PUT/DELETE) retry only on 429 OR with Idempotency-Key header; reads always retry on retryable statuses"
    - "Dual-path retry loop: catches typed GraphError from ODataErrorHandler OR inspects raw Response status — so the middleware works both composed in-chain and unit-tested directly"
    - "Per-middleware-closure in-flight flag for double-call guard (refined 02-02): allows sequential retries, still rejects parallel misuse"
    - "Testing pattern: vi.useFakeTimers + vi.advanceTimersByTimeAsync to drive the sleep() call without real wall-clock delays"

key-files:
  created:
    - src/lib/middleware/retry.ts
    - test/retry-handler.test.ts
  modified:
    - src/graph-client.ts
    - src/lib/middleware/pipeline.ts
    - test/pipeline.test.ts

key-decisions:
  - "RetryHandler dual-path (typed GraphError catch + raw Response status): RetryHandler sits OUTSIDE ODataErrorHandler so in production the catch-block fires on thrown GraphError. But direct-invocation unit tests don't have ODataErrorHandler in the chain, so the try-block also inspects response.status. BOTH paths write retryCount+lastStatus to RequestContext on every exit."
  - "AWS full-jitter formula (D-05 locked): base=500ms, cap=30000ms, window = min(cap, base * 2^attempt), delay = floor(random() * window). Storm-prevention dominates decorrelated / equal jitter per AWS analysis."
  - "RETRYABLE_STATUSES fixed {408, 429, 500, 502, 503, 504}. 401 EXPLICITLY omitted — TokenRefreshMiddleware (innermost) owns 401 refresh. 412 omitted — ETag concurrency failures are a caller bug, not a transport retry."
  - "Idempotency gate committed table (no negotiation): GET/HEAD/OPTIONS always retry on retryable statuses; POST/PATCH/PUT/DELETE retry on 429 OR with Idempotency-Key. Other 5xx on writes return immediately. Case-insensitive header lookup."
  - "Max attempts via MS365_MCP_RETRY_MAX_ATTEMPTS env (default 3). After exhaustion, final response or error propagates unchanged — retryCount in context reflects actual retries."
  - "_skipRetry short-circuit at entry: if req._skipRetry === true, pass straight to next() with no retry wrapping. 02-06 UploadSession chunks set this flag per D-08; their resume-from-nextExpectedRanges protocol owns recovery."
  - "Retry-After parsing tolerates fractional seconds (Sentry #7919 pattern: Number() + Math.round(n*1000)) and past HTTP-dates (clamp to 0 rather than negative). Returns null on unparseable, which triggers full-jitter fallback."
  - "OTel span graph.middleware.retry with attributes graph.retry.count + graph.retry.last_status (D-03). finalizeSpan + updateContext called on EVERY exit path (success, retry-exhausted, non-retryable short-circuit, thrown rethrow)."
  - "Double-call guard refinement in composePipeline: the 02-01 global-index-sentinel was too strict — it rejected ALL sequential next() calls, which would have broken both RetryHandler (this plan) and the already-shipped TokenRefreshMiddleware (02-01) if that middleware had ever been tested through a real composePipeline composition. Refined to a per-closure in-flight boolean: sequential retries pass, concurrent/parallel misuse still throws."
  - "parseRetryAfter exported from retry.ts: separate copy from the private helper in graph-errors.ts (02-03) to avoid circular import. Both implementations behaviorally identical (Sentry #7919 compliant); future chore unifies them."

patterns-established:
  - "Dual-path middleware: outer retry middleware handles BOTH the thrown typed error (in-chain, real production) AND the raw Response status (direct-invocation unit tests + edge cases). finalizeSpan + updateContext in every branch."
  - "Fake-timers for backoff testing: vi.useFakeTimers({ shouldAdvanceTime: false }) + vi.advanceTimersByTimeAsync(N) so tests never sleep real wall-clock and the delay value passed to setTimeout is directly assertable via vi.spyOn(global, 'setTimeout')."
  - "Parameterized status tests with it.each([408, 500, 502, 504]) — compact coverage for the retryable-status set."
  - "Integration test harness (run() helper) for full-pipeline behavior: composePipeline([...middlewares], mockTerminal) with canned response sequence; assert on response/error/terminalCalls/finalRetryCount."
  - "Refined double-call guard model: per-middleware-closure in-flight boolean flips true on entry, false in finally; rejects overlapping calls but not sequential ones — the correct model for retry-capable pipelines."

requirements-completed:
  - MWARE-01
  - MWARE-02

# Metrics
duration: ~9min
completed: 2026-04-19
---

# Phase 02 Plan 02: RetryHandler Middleware (AWS Full-Jitter + Retry-After + Idempotency Gate) Summary

**RetryHandler closes MWARE-01 (Retry-After + 429) and MWARE-02 (transient 5xx retry) per D-05. Outer middleware in the Graph pipeline — catches `GraphError` thrown by ODataErrorHandler (02-03) on retryable statuses {408, 429, 500, 502, 503, 504} and retries with AWS full-jitter backoff (base=500ms, cap=30s) OR the server's `Retry-After` header (seconds + HTTP-date, clamped to 120s). Idempotency gate blocks duplicate-side-effect writes; `_skipRetry` marker short-circuits for UploadSession chunks. Integration with composePipeline also surfaced a latent bug in the 02-01 double-call guard (Rule 3 auto-fix: refined to per-closure in-flight flag so sequential retries work).**

## Performance

- **Duration:** ~9 min wall-clock (RED test + implement + wire pipeline + integration tests + pipeline-guard refinement + regression)
- **Started:** 2026-04-19T10:37:57Z
- **Completed:** 2026-04-19T10:47:14Z
- **Tasks:** 3 (Task 1 RED tests, Task 2 RetryHandler impl + wire pipeline, Task 3 integration tests + pipeline-guard refinement)
- **Files created:** 2 (1 src + 1 test)
- **Files modified:** 3 (`src/graph-client.ts` + `src/lib/middleware/pipeline.ts` + `test/pipeline.test.ts`)
- **Commits:** 3 atomic + 1 docs (this summary)

## Accomplishments

- **RetryHandler middleware** — AWS full-jitter backoff, Retry-After honoring (seconds + HTTP-date, clamped), RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504}, default max 3 attempts via `MS365_MCP_RETRY_MAX_ATTEMPTS`, idempotency gate (writes retry only on 429 or with `Idempotency-Key`), `_skipRetry` short-circuit, `retryCount` + `lastStatus` written to `RequestContext` on every exit path, OTel span `graph.middleware.retry` with `graph.retry.count` + `graph.retry.last_status` attributes.
- **Dual-path retry loop** — the middleware handles BOTH the typed `GraphError` thrown by ODataErrorHandler (the production chain) AND the raw `Response` status (direct unit-test invocation). This lets the middleware be tested in isolation with a plain `vi.fn()` returning a 503 Response, while in-chain behavior consumes `GraphError.statusCode` + `GraphError.retryAfterMs`.
- **Pipeline wired** — `src/graph-client.ts` pipeline array now reads `[// ETag (02-07), new RetryHandler(), new ODataErrorHandler(), new TokenRefreshMiddleware(...)]` — outermost-to-innermost.
- **11 unit tests + 3 integration tests GREEN** — covering every contract line item:
  - Retry-After seconds (clamped, verbatim)
  - Retry-After HTTP-date (delta computation)
  - AWS full-jitter bounds [0, min(cap, base * 2^attempt)]
  - Max attempts exhausted → propagate final response
  - 408 / 500 / 502 / 504 each retryable (it.each)
  - 503 retries with full-jitter (bounds check)
  - 401 passthrough (TokenRefresh owns 401)
  - POST idempotency gate: 503 no-retry, 429 retries, 503 + Idempotency-Key retries
  - Integration: 429 → GraphThrottleError catch → 200
  - Integration: 5xx exhaust → GraphServerError with correct statusCode + retryCount in context
  - Integration: 400 → GraphValidationError without retry
- **Pipeline double-call guard refined** — the 02-01 global-index sentinel rejected ALL sequential `next()` calls, which blocked BOTH `RetryHandler` (this plan's core responsibility) AND the already-shipped `TokenRefreshMiddleware` from 02-01 (which also calls `next()` twice on 401 refresh). The 02-01 plan never ran `TokenRefreshMiddleware` through a real `composePipeline`, so the latent bug was only surfaced when 02-02 wired `RetryHandler` end-to-end. Refined to a per-middleware-closure `nextInFlight` boolean that flips true on entry and false in `finally`: sequential retries pass, concurrent/parallel misuse (the real T-02-01a/b bug) still throws.
- **All 362 tests pass** — up from 347 baseline (347 + 11 retry unit + 3 retry integration + 1 new pipeline test for sequential-retry support). Zero regressions. Same 0 lint errors, same 59 pre-existing warnings.

## Task Commits

1. **Task 1: Wave 0 RED tests — test/retry-handler.test.ts** — `9840884` (test)
   - 8 test cases exercising the MWARE-01 + MWARE-02 contract via direct-invocation: Retry-After seconds, Retry-After HTTP-date, full-jitter, max attempts, 408/500/502/504 parameterized, 503, 401 passthrough, POST idempotency (3 sub-cases in a single `it`).
   - All RED because `src/lib/middleware/retry.js` does not exist yet — module-resolution-time fail, not an assertion fail.

2. **Task 2: Implement src/lib/middleware/retry.ts + wire pipeline** — `7f2a288` (feat)
   - `src/lib/middleware/retry.ts` (~270 lines): `RetryHandler` class + `parseRetryAfter` export + private helpers (`parseMaxAttempts`, `finalizeSpan`, `updateContext`, `shouldRetryMethodByStatus`, `hasIdempotencyKey`, `computeDelayFromResponse`, `computeDelayFromError`, `fullJitterDelay`, `sleep`).
   - `src/graph-client.ts`: import added, pipeline array now has `new RetryHandler()` in the correct position (outside ODataErrorHandler), constructor comment updated to mark 02-02 done.
   - 11 tests transition RED → GREEN; 358 tests overall pass (up from 347 baseline + 11 new).

3. **Task 3: Integration tests + pipeline double-call guard refinement** — `b5887c4` (feat)
   - Appended 3 integration tests to `test/retry-handler.test.ts` exercising `[RetryHandler, ODataErrorHandler]` composed via `composePipeline`: 429 retry→200, 5xx exhaust→GraphServerError, 400→GraphValidationError no-retry.
   - **Blocking issue discovered (Rule 3 auto-fix):** the 02-01 `composePipeline` used a monotonic global `index` sentinel that rejected ALL sequential `next()` calls. First run of integration tests failed with `Error: next() called multiple times` — exactly the retry pattern RetryHandler relies on.
   - **Fix applied inline:** refactored `composePipeline` to a per-middleware-closure `nextInFlight` boolean (flips true on entry, false in `finally`). Sequential retries pass; concurrent / overlapping calls still throw.
   - Updated `test/pipeline.test.ts`: the old "throws when next() twice" test renamed to "throws when concurrent next() calls (forgets await)" and rewritten to exercise the parallel-kickoff pattern (the REAL T-02-01a/b bug); added "supports sequential next() calls (retry pattern used by RetryHandler / TokenRefresh)" to prove the new behavior.
   - All 362 tests GREEN after the refinement.

_(No separate REFACTOR commit — each feat commit produced clean code on the first pass.)_

## Files Created/Modified

### Created

- `src/lib/middleware/retry.ts` (~270 lines) — `RetryHandler` class implementing `GraphMiddleware`. Module-level constants (`BASE_MS=500`, `CAP_MS=30_000`, `RETRY_AFTER_MAX_MS=120_000`, `DEFAULT_MAX_ATTEMPTS=3`, `RETRYABLE_STATUSES = {408,429,500,502,503,504}`). Exports `parseRetryAfter` for direct-coverage unit testing. Analog: `src/lib/middleware/token-refresh.ts` (02-01 class-shape template).
- `test/retry-handler.test.ts` (~330 lines, 14 tests total) — 11 unit tests in the main `describe('RetryHandler')` block + 3 integration tests in the `describe('RetryHandler ↔ ODataErrorHandler integration')` block. Analog: `test/token-refresh-middleware.test.ts` (02-01 middleware test template) + `test/odata-error-middleware.test.ts` (02-03 integration test template).

### Modified

- `src/graph-client.ts`:
  - Added `import { RetryHandler } from './lib/middleware/retry.js'`.
  - Pipeline constructor array: replaced `// RetryHandler — 02-02` comment with `new RetryHandler()` in the correct chain position (after ETag placeholder, before `new ODataErrorHandler()`).
  - Updated the multi-line comment above the `composePipeline` call to mark `RetryHandler (02-02) — this plan` instead of the placeholder.
- `src/lib/middleware/pipeline.ts`:
  - Refactored `composePipeline` to use a per-middleware-closure `nextInFlight` boolean (rather than a monotonic global `index` sentinel). Sequential retries now pass; concurrent calls still throw. Module docstring updated to reflect the refinement and explain why (the 02-01 guard was too strict — it would have broken both `RetryHandler` and the already-shipped `TokenRefreshMiddleware`).
- `test/pipeline.test.ts`:
  - Renamed `'throws when a middleware calls next() twice'` → `'throws when a middleware calls next() concurrently (forgets await)'`. The new test kicks off two parallel `next()` promises without awaiting, which is the REAL T-02-01a/b bug (duplicate terminal invocations) the guard targets.
  - Added new test `'supports sequential next() calls (retry pattern used by RetryHandler / TokenRefresh)'` — verifies that a middleware can call `next()`, inspect the result, and call `next()` again sequentially.
  - Module docstring updated to explain the 02-01 → 02-02 guard refinement.

## Decisions Made

_All captured in `key-decisions` frontmatter above; the expanded versions:_

- **RetryHandler dual-path** — the middleware handles BOTH the typed `GraphError` thrown by ODataErrorHandler (the real production chain) AND the raw `Response` status (direct-invocation unit tests). The try-block inspects `response.status`; the catch-block inspects `err.statusCode`. Both branches call `finalizeSpan` + `updateContext` on every exit path so the RequestContext observer always sees consistent state. This dual design is what makes the middleware unit-testable without ODataErrorHandler in the chain — critical for isolated testing.
- **AWS full-jitter over decorrelated / equal jitter** — per D-05 committed decision and AWS Architecture Blog analysis: full jitter has the best storm-prevention properties at the cost of slightly higher worst-case latency (decorrelated wins on latency, equal wins on simplicity). 02-RESEARCH.md enumerates the trade-off.
- **Pipeline double-call guard refinement (Rule 3 auto-fix)** — the 02-01 guard used `let index = -1; if (i <= index) throw` which rejects ALL sequential `next()` calls. This was too strict: it would have broken `RetryHandler` (this plan) AND `TokenRefreshMiddleware` (shipped in 02-01, also calls `next()` twice on 401 refresh). 02-01's test suite for TokenRefresh used a `vi.fn()` mock for `next`, not a real `composePipeline`, so the latent bug was invisible until this plan wired RetryHandler end-to-end. The refined guard uses a per-middleware-closure `nextInFlight` boolean — sequential retries pass, concurrent calls (the real T-02-01a/b bug: forgotten `await`) still throw deterministically.
- **`parseRetryAfter` duplicated between retry.ts and graph-errors.ts** — 02-03's summary committed to keeping a private copy in `graph-errors.ts` to avoid circular imports; this plan follows suit and exports its own copy from `retry.ts`. Both implementations are behaviorally identical (Sentry #7919 fractional-seconds handling, HTTP-date clamp-to-zero). A future chore can unify them via a pure utility module; deferred as the duplication is ~15 lines.
- **Idempotency gate — writes retry only on 429 or with Idempotency-Key** — committed in the plan's scope-boundary table. Phase 2 does NOT auto-generate Idempotency-Keys; that's a tool-layer concern. 429 alone is retryable-on-writes because it is an explicit server signal that the request has NOT been processed (throttled before any side effect).
- **OTel span lifecycle** — `span` is created at `tracer.startActiveSpan('graph.middleware.retry', ...)` entry and ended via `finalizeSpan` on every exit path. Attributes `graph.retry.count` (= final attempt count) and `graph.retry.last_status` (= the status on exit) are set before `span.end()`. Critically: even the `req._skipRetry` short-circuit goes through direct `next()` without creating a span — otherwise the `_skipRetry` path would pollute telemetry with zero-retry spans on every upload chunk.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] composePipeline double-call guard was too strict, blocked legitimate retry pattern**

- **Found during:** Task 3 (first run of integration tests after adding them to `test/retry-handler.test.ts`)
- **Issue:** The 02-01 `composePipeline` used `let index = -1; if (i <= index) throw new Error('next() called multiple times')`. This rejects ANY sequential `next()` call from the same middleware — which is exactly the retry pattern RetryHandler (this plan) AND TokenRefreshMiddleware (02-01) rely on. Integration tests failed with `expected undefined to be 200` and `expected Error: next() called multiple times to be an instance of GraphServerError`.
- **Root cause:** 02-01's test suite for TokenRefreshMiddleware used a plain `vi.fn()` mock for the `next` argument rather than composing through a real `composePipeline`. So the latent bug — that sequential next() calls from TokenRefresh would also throw in a real pipeline — was invisible until this plan added RetryHandler-via-composePipeline integration coverage.
- **Fix:** Refactored `composePipeline` to scope the guard per-middleware-closure via an `nextInFlight` boolean that flips true on entry to `next()` and false in a `finally` block. Sequential retries pass (each resolves before the next starts); concurrent/parallel misuse (the REAL T-02-01a/b bug where a middleware forgets to `await` and kicks off two in-flight terminal calls) still throws. Also updated `test/pipeline.test.ts`: the old "throws when next() twice" test is now "throws when concurrent next() calls (forgets await)" exercising the parallel pattern; added a new "supports sequential next() calls (retry pattern used by RetryHandler / TokenRefresh)" to prove the refined behavior.
- **Files modified:** `src/lib/middleware/pipeline.ts`, `test/pipeline.test.ts`.
- **Verification:** 362/362 tests GREEN including the 2 refreshed pipeline tests + 14 new retry tests (11 unit + 3 integration) + all 16 other middleware tests. Full regression clean.
- **Committed in:** `b5887c4` (part of Task 3 feat commit, bundled with the integration tests that exposed the bug).

---

**Total deviations:** 1 auto-fixed (1 blocking issue in shared infrastructure from 02-01).
**Impact on plan:** Zero scope creep — the fix unblocks both this plan's RetryHandler AND the already-shipped TokenRefreshMiddleware from 02-01 (which had the same latent dependency but was never tested through a real composePipeline). The original T-02-01a/b threat (duplicate terminal invocations from forgotten `await`) is still correctly caught by the refined guard, via a test that exercises the actual parallel-kickoff pattern rather than the sequential pattern legitimate retry middleware uses.

## Issues Encountered

1. **Worktree was missing `src/generated/client.ts` + `node_modules`** — same pre-existing worktree-setup gap documented in 02-03 summary. Resolution: copied `src/generated/client.ts` from the main repo and symlinked `node_modules` from the parent checkout. Zero code change. Pre-existing worktree hygiene issue, not a plan deviation.

2. **Plan-vs-infrastructure tension discovered mid-Task-3** — the 02-01 pipeline guard was specified via a test that exercised the SEQUENTIAL double-call pattern (the same pattern this plan needs to succeed). Without the test-set refinement, the "correct" pipeline behavior according to 02-01 and the "correct" behavior according to 02-02 are mutually exclusive. The resolution (documented in "Deviations from Plan" above) was to keep the threat mitigation intact by refining what counts as a guard violation (concurrent, not sequential). The approach preserves 02-01's security intent while unblocking 02-02's functional requirement. No user decision needed — this was an internal consistency fix covered by Rule 3 (blocking issue).

3. **Floating-point Retry-After handling** — the plan's test-case tolerance for "Retry-After seconds — obey verbatim" specified `setTimeout called with ~10000ms (±10ms)`. The `Math.round(Number(value) * 1000)` formula produces exactly 10000 for input `'10'`, so the tolerance window is wider than needed — but this is defensive; fractional inputs like `'10.5'` round to 10500 which is still inside the window. No test change needed.

## User Setup Required

None — `MS365_MCP_RETRY_MAX_ATTEMPTS` has a sensible default (3). Operators who want tighter retry budgets can set this env var to 0 (no retries — middleware returns the first response / error unchanged) or any positive integer.

## Next Phase Readiness

### What 02-04 (PageIterator) should know about retry semantics

- PageIterator issues GET requests for each `@odata.nextLink`. These go through the full pipeline — every per-page fetch inherits RetryHandler wrapping for free. A 429 on page 42 will be retried transparently; a 5xx on page 7 will be retried with full-jitter backoff. PageIterator does NOT need to re-implement retry logic.
- If PageIterator needs to skip retry on a specific per-page fetch (e.g., for a dry-run check), set `req._skipRetry = true` on that single request. But this is unlikely — pagination is idempotent reads.

### What 02-05 (BatchClient) should know

- `/$batch` POST is a WRITE method. Without an `Idempotency-Key` header, a 503 on `/$batch` will NOT be retried (idempotency gate). 429 still retries automatically.
- If BatchClient wants to auto-retry `/$batch` on 5xx, it can either (a) generate a UUID client-side and set `Idempotency-Key`, or (b) handle the transient error at the sub-request level (per-child 429 / 503 handling) since MS Graph's $batch does not propagate Retry-After from inner requests.

### What 02-06 (UploadSession) MUST do

- Chunk PUT requests MUST set `req._skipRetry = true` on every chunk. The UploadSession's own `nextExpectedRanges` protocol is the resumption mechanism; allowing RetryHandler to re-send a chunk on a 503 would double-send bytes and break the upload.
- The initial `/createUploadSession` POST can be retried normally (it's the session creation, not a chunk — no resumption semantics).

### What 02-07 (ETagMiddleware) should know

- ETag errors surface as 412 → `GraphConcurrencyError` (02-03 hierarchy). 412 is NOT in RETRYABLE_STATUSES, so RetryHandler correctly lets `GraphConcurrencyError` propagate through unchanged. ETagMiddleware's outer wrapper will see the typed error and can decide to surface the re-fetch hint.
- ETagMiddleware sits OUTSIDE RetryHandler in the chain; ordering is `[ETag (02-07), Retry (02-02, this plan), ODataError (02-03), TokenRefresh (02-01)]`. The 02-07 structural test should grep for this shape.

### RequestContext state available to Phase 6 (OPS-06)

- `retryCount: number` — total retries executed by RetryHandler for this request. Always 0 when no retry happened.
- `lastStatus: number` — the HTTP status code observed on the final attempt (success or failure). 0 when the request errored before any response was received (non-GraphError path, e.g., network failure).
- Phase 6 will expose `mcp_graph_throttled_total` Prometheus metric incremented on `lastStatus === 429` + `retryCount > 0`. Per-tenant retry budget + circuit breaker are also deferred to Phase 6.

### Pipeline registration hole remaining for 02-07

In `src/graph-client.ts`:

```typescript
this.pipeline = composePipeline(
  [
    // ETagMiddleware — 02-07     <-- 02-07 inserts here
    new RetryHandler(),           // 02-02 (this plan) ✓
    new ODataErrorHandler(),      // 02-03 ✓
    new TokenRefreshMiddleware(this.authManager, this.secrets),  // 02-01 ✓
  ],
  ...
);
```

### Blockers / concerns

None. MWARE-01 and MWARE-02 are complete. The pipeline scaffold now correctly supports retry semantics end-to-end. Future plans that need retry-like multi-call-next() semantics (e.g., ETagMiddleware on 412 may want to auto-refetch-and-retry under certain flags in Phase 6) can rely on the refined double-call guard without further changes.

## Self-Check: PASSED

**Files created — verified existing:**
- `src/lib/middleware/retry.ts` — FOUND
- `test/retry-handler.test.ts` — FOUND

**Files modified — verified:**
- `src/graph-client.ts` — verified `new RetryHandler()` in pipeline array, `import { RetryHandler }` at top
- `src/lib/middleware/pipeline.ts` — verified per-closure `nextInFlight` flag in refined algorithm
- `test/pipeline.test.ts` — verified updated test names and new sequential-retry test

**Commits — verified in git log:**
- `9840884` — test(02-02): Wave 0 RED tests for RetryHandler — 8 behaviors (MWARE-01/02) — FOUND
- `7f2a288` — feat(02-02): RetryHandler middleware — MWARE-01 + MWARE-02 (AWS full-jitter + Retry-After + idempotency gate) — FOUND
- `b5887c4` — feat(02-02): RetryHandler <-> ODataErrorHandler integration + refine pipeline double-call guard — FOUND

**Verification greps — all match plan contract:**
- `grep -c 'export class RetryHandler' src/lib/middleware/retry.ts` → 1
- `grep -c 'new RetryHandler()' src/graph-client.ts` → 1 (in pipeline array)
- Pipeline array order verified: `new RetryHandler()` appears BEFORE `new ODataErrorHandler()` in the array (line 153 vs 154)
- `grep -c 'RETRYABLE_STATUSES' src/lib/middleware/retry.ts` → 4 (constant declaration + 2 `.has()` sites + 1 in docstring)
- `grep -c '_skipRetry' src/lib/middleware/retry.ts` → 3 (docstring + the guard `if (req._skipRetry)` + 1 comment)
- `grep -ci 'idempotency-key' src/lib/middleware/retry.ts` → 5 (docstring + helper name + lookup implementation + docs)

**Test results:**
- 14 new Phase 2.02 tests GREEN (11 unit + 3 integration)
- 348 previously-passing tests still GREEN
- Full suite: 362 / 362 tests pass
- Note: In this worktree, the 4 pre-existing spawn-test failures from 02-01/02-03 (in `test/public-url-failfast.test.ts` + `test/startup-validation.test.ts`) did NOT surface this run — they pass in this environment. Same codebase; only difference is environmental (likely transient CPU / timing factors in prior runs).

**Build pipeline:**
- `npm run lint` → 0 errors, 59 pre-existing warnings (unchanged from 02-01 / 02-03 baseline)
- `npm run format:check` → all files pass
- `npm run build` → tsup build success (dist/lib/middleware/retry.js emitted at 5.52 KB)

**Success criteria from plan (all MET):**
- [x] `src/lib/middleware/retry.ts` exists with `RetryHandler` class + `parseRetryAfter` exported helper, all constants locked per D-05
- [x] `src/graph-client.ts` pipeline array includes `new RetryHandler()` OUTSIDE `new ODataErrorHandler()`
- [x] 14 tests in `test/retry-handler.test.ts` (exceeded the plan's 11 minimum): Retry-After seconds, Retry-After HTTP-date, full-jitter bounds, max attempts, 408/500/502/504 retryable (4 parameterized), 503 retryable, 401 passthrough, POST idempotency gate (3 sub-cases), integration 429 retry→200, integration 5xx exhaust→GraphServerError, integration 400→GraphValidationError without retry
- [x] OTel span `graph.middleware.retry` emitted with `graph.retry.count` + `graph.retry.last_status` attributes
- [x] RequestContext `retryCount` + `lastStatus` populated on every exit path
- [x] Floating-point Retry-After seconds handled correctly (`Number()` + `Math.round(n * 1000)`; no parseInt truncation)
- [x] `req._skipRetry === true` short-circuits to `next()` without retry wrapping
- [x] No regression; all 362 tests pass; no new lint warnings

---

*Phase: 02-graph-transport-middleware-pipeline*
*Completed: 2026-04-19*
