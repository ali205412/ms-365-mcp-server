---
phase: 02-graph-transport-middleware-pipeline
plan: "05"
subsystem: api

tags:
  - batch-client
  - graph-batch-mcp-tool
  - dollar-batch
  - json-batching
  - dependsOn-cycle-detection
  - ssrf-guard
  - relative-url-only
  - per-sub-request-isolation
  - typed-graph-error-per-item
  - d-07-scope-prep

# Dependency graph
requires:
  - phase: 02-graph-transport-middleware-pipeline
    provides: middleware pipeline scaffold + composePipeline (02-01) — POST /$batch routes through the chain; typed GraphError hierarchy + parseODataError helper (02-03) — per-sub-request envelopes parsed with the same function that owns top-level error parsing; RetryHandler idempotency gate (02-02) — /$batch POST is a write method, so only 429 retries without Idempotency-Key per the existing gate
provides:
  - batch-helper-function
  - batch-client-class
  - graph-batch-mcp-tool
  - batch-ssrf-relative-url-guard
  - batch-dependsOn-cycle-detector
  - batch-20-cap-validator
  - batch-per-sub-request-typed-error-surfacing
  - batch-response-order-preservation
affects:
  - src/graph-tools.ts
  - src/lib/middleware/batch.ts
  - test/tool-filtering.test.ts
  - test/read-only.test.ts
  - test/calendar-view.test.ts
  - 02-06-plan (UploadSession — separate resume-from-nextExpectedRanges protocol, no direct batch interaction)
  - D-07 (Phase 6 auto-batch coalescer — reads `requestContext.graph.coalesce` flag and groups matched requests through this same batch() helper)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Helper-that-calls-through-the-chain placement (same model as 02-04 page-iterator) — module lives under src/lib/middleware/ for organizational symmetry but does NOT implement GraphMiddleware; it only calls client.graphRequest('/$batch', ...) and lets the full ETag/Retry/ODataError/TokenRefresh chain wrap the outer POST"
    - "Iterative DFS cycle detection with 3-color state (UNSEEN / ON_STACK / DONE) + parent-chain reconstruction for error messages — bounded depth by 20-cap but defensive against pathological recursion"
    - "Relative-URL-only SSRF gate: accept iff url starts with '/' AND second char is not '/' (rejects protocol-relative) AND no backslash (rejects Windows-path-like inputs). All absolute schemes (http://, https://, file://, gopher://, etc.) blocked before any network I/O"
    - "Per-sub-request response order re-mapping — Graph may re-order when dependsOn absent, so we keep a Map<id, rawResponse> and re-emit in request order for ergonomic caller indexing"
    - "Typed GraphError surfacing per sub-item via direct parseODataError call (02-03 helper) — statusCode alone picks subclass; code field is informational only (T-02-03f discipline preserved)"
    - "JSON-safe error serialization at the MCP tool boundary — Error objects lose their fields across JSON.stringify, so the handler projects error into { code, message, statusCode, requestId, clientRequestId, date } before embedding in the tool response text"

key-files:
  created:
    - src/lib/middleware/batch.ts
    - test/batch-client.test.ts
    - test/graph-batch-tool.test.ts
  modified:
    - src/graph-tools.ts
    - test/tool-filtering.test.ts
    - test/read-only.test.ts
    - test/calendar-view.test.ts

key-decisions:
  - "batch() is a free function; BatchClient is a thin class wrapper that holds a GraphClient reference and delegates to batch(). Both are exported — callers who prefer DI hold BatchClient, callers who just want a one-shot helper call batch() directly. D-07 Phase 6 coalescer will instantiate a BatchClient per request scope."
  - "Module placement: src/lib/middleware/batch.ts (same directory as the other middleware code for symmetry) but batch is NOT a GraphMiddleware — no execute(req, next) surface. It calls client.graphRequest('/$batch', ...) which threads the outer POST through the pipeline. Same placement rationale as 02-04 page-iterator.ts."
  - "MAX_BATCH_SIZE = 20 hardcoded constant (matches Graph's server-side cap). Input.length > 20 throws at entry before any POST — Graph would reject anyway, but the client-side guard gives a deterministic error without a round-trip and prevents T-02-05a (amplification DoS by stuffing a batch with 1000 sub-requests)."
  - "SSRF gate via positive-list (relative path starting with '/' only) rather than negative-list (reject known schemes). Positive-list is future-proof against new URL schemes and catches protocol-relative URLs (//host/path) which a naive 'starts with http://' check would miss. T-02-05b mitigation."
  - "Iterative DFS cycle detector rather than recursive. The 20-cap already bounds recursion depth, but defense-in-depth: a recursive implementation could stack-overflow if the cap was ever raised or bypassed. Error message reconstructs the cycle path via parent-chain walk for operator debuggability. T-02-05c mitigation."
  - "Per-sub-request isolation — one failing sub-request does NOT reject the outer promise. Instead, each BatchResponseItem carries { status, body?, error? } where error is a typed GraphError populated via parseODataError for every non-2xx status. The caller inspects per-item — same mental model as Promise.allSettled() but at the HTTP level."
  - "Response-order preservation: Graph's `responses` array may come back in any order (especially without dependsOn). We map by id and re-emit in input order so callers can index results positionally without sorting. Spec-compliant — the JSON-batching spec defines per-request ids but places no order constraint on the server response."
  - "Outbound envelope omits falsy optional fields (headers when empty, body when undefined, dependsOn when empty) — Graph rejects requests with empty-array `dependsOn` and treats empty-object `headers` inconsistently, so the helper canonicalizes."
  - "Missing-sub-response defense: if Graph omits a sub-response for an input id (should never happen for a well-formed batch), the helper emits a synthetic { id, status: 0, error: GraphError('missingBatchResponse') } so the caller does NOT see a silent gap. Never observed in practice but defensible against a partial Graph outage."
  - "graph-batch MCP tool skipped in readOnly mode — a batch can carry arbitrary POST/PATCH/DELETE sub-requests, so the top-level read-only guard MUST block the batch tool entirely rather than try to inspect each sub-request. Mirrors the existing Graph API tool gating (GET-only in readOnly unless an endpoint carries `readOnly: true`)."
  - "Typed GraphError fields projected to JSON-safe shape at the MCP tool boundary — the handler embeds `{ code, message, statusCode, requestId, clientRequestId, date }` instead of passing the Error instance directly to JSON.stringify (which would emit `{}`). Callers can still branch on `error.statusCode` / `error.code` client-side."

patterns-established:
  - "Validation-first helper: all cheap input checks (empty, cap, duplicate id, per-item SSRF/url shape) run before the expensive dependsOn cycle walk, which runs before the only network I/O (the POST). Throws at the FIRST failure — no partially-validated batch ever reaches the wire."
  - "MCP tool with dynamic-import lazy loading of the underlying helper (`await import('./lib/middleware/batch.js')` inside the handler) — keeps batch out of the module graph for deployments that don't enable the tool (same lazy-load pattern as 02-04 page-iterator import in executeGraphTool)."
  - "JSON-envelope projection at the MCP tool handler: typed-error fields explicitly listed rather than relying on spread-and-stringify. Pattern applies anywhere a handler wraps a library call whose rejection class carries non-enumerable fields."
  - "Tool-count regression tests must be updated when a new global tool lands. Three tests (tool-filtering x 2, read-only x 1) now reflect `+ 1 graph-batch tool (Plan 02-05)`; calendar-view's fetchAllPages assertion also skips graph-batch since the batch tool is a coalescer, not a per-endpoint wrapper."

requirements-completed:
  - MWARE-03

# Metrics
duration: ~9min
completed: 2026-04-19
---

# Phase 02 Plan 05: BatchClient + batch() helper + graph-batch MCP tool Summary

**$batch coalescing helper (up to 20 sub-requests, dependsOn cycle detection, relative-URL SSRF guard, per-sub-request typed-GraphError isolation) plus graph-batch MCP tool that surfaces the helper to AI clients — closes MWARE-03 and establishes the batching seam D-07's Phase 6 auto-batch coalescer will build on.**

## Performance

- **Duration:** ~9 min wall-clock (RED test + implement helper + integrate tool + regression-fix tool-count tests)
- **Started:** 2026-04-19T11:18:35Z
- **Completed:** 2026-04-19T11:27:04Z
- **Tasks:** 3 (Task 1 RED tests, Task 2 implement batch.ts + BatchClient, Task 3 register graph-batch tool + regression-fix tool-count tests)
- **Files created:** 3 (1 src + 2 test)
- **Files modified:** 4 (src/graph-tools.ts + 3 tool-count tests)
- **Commits:** 3 atomic (docs commit for this summary will be 4th)

## Accomplishments

- **MWARE-03 closed:** `$batch` coalescing helper with the four required invariants — 20-cap, dependsOn cycle detection, relative-URL SSRF guard, per-sub-request isolation — delivered end-to-end from helper -> MCP tool.
- **SSRF gate:** `isRelativePath` positive-list accepts only `/` (single slash prefix, no backslashes, no protocol-relative `//host/path`). Absolute `http(s)://`, `file://`, `gopher://`, and any other scheme are rejected BEFORE any network I/O. T-02-05b mitigation.
- **Cycle detector:** Iterative DFS with 3-color state (UNSEEN/ON_STACK/DONE) and parent-chain reconstruction for operator-friendly error messages (`"dependsOn graph has a cycle: a -> b -> c -> a"`). Defends against self-loops, 2-node, and arbitrary n-node cycles. T-02-05c mitigation.
- **Per-sub-request isolation:** Every non-2xx sub-response is parsed via 02-03's `parseODataError` and surfaced as a typed `GraphError` on `result[i].error`. One sub-failure does NOT reject the batch — the caller inspects per-item. Mirrors `Promise.allSettled` semantics at the HTTP level.
- **Response-order preservation:** Graph may return sub-responses in a different order than requested (especially when `dependsOn` is absent). The helper re-maps by id and emits in INPUT order so callers can index results positionally without sorting.
- **graph-batch MCP tool:** Registered in `src/graph-tools.ts` with Zod schema `{ requests: [1..20] of { id, method, url, headers?, body?, dependsOn? } }`. Handler dynamic-imports the batch helper, serializes typed errors to JSON-safe fields (code/message/statusCode/requestId/clientRequestId/date) so AI clients see structured error context. Skipped in readOnly mode (a batch can carry write sub-requests; top-level gate is the right abstraction).
- **Middleware-chain re-use:** The outer `POST /$batch` goes through the FULL chain (ETag -> Retry -> ODataError -> TokenRefresh) because the helper only calls `client.graphRequest()`. A 429 on the batch endpoint itself retries automatically; a 401 refreshes; a 5xx is retried IF an `Idempotency-Key` is present (per 02-02 gate — writes without the header only retry on 429).
- **Zero regression:** 403 tests pass across the full suite (up from 365 at 02-04 baseline); same 4 pre-existing spawn-test failures in `test/public-url-failfast.test.ts` and `test/startup-validation.test.ts` (documented in 02-01 SUMMARY as unrelated to Phase 2 plans).

## Task Commits

1. **Task 1: Wave 0 RED tests** — `0f0b5a3` (test)
   - `test/batch-client.test.ts` — 24 tests covering validation (empty reject, >20 reject, SSRF http/https/protocol-relative/file/, duplicate id reject, unknown dependsOn id reject, self-loop/2-cycle/3-cycle/4-node DAG accept), envelope shape (POST /$batch with requests array, single graphRequest call, Content-Type header), and per-sub-request isolation (order preservation, typed GraphError per item, 2xx + non-2xx mixed).
   - All 24 RED because `src/lib/middleware/batch.js` did not exist yet.

2. **Task 2: Implement BatchClient + batch() helper** — `244124b` (feat)
   - `src/lib/middleware/batch.ts` (~370 lines, prettier-normalized to 427) — exports `batch` free function + `BatchClient` class wrapper + types `BatchRequestItem` / `BatchResponseItem`. Module docstring explains placement (helper-that-calls-through-the-chain, NOT a middleware), the four invariants, and OTel + pino observability.
   - All 24 RED tests transition to GREEN.
   - Prettier reformatted the test file (line-length merge only, no semantic change; tracked as part of Task 2 commit to keep the RED snapshot clean).

3. **Task 3: Register graph-batch MCP tool + tool-count test regression fixes** — `7177c7d` (feat)
   - `src/graph-tools.ts` — `graph-batch` registered in `registerGraphTools` after `parse-teams-url`. Skipped when `readOnly === true` (logger.info notes the skip). Zod schema + destructiveHint + openWorldHint + handler with dynamic-import + typed-error projection.
   - `test/graph-batch-tool.test.ts` (new, 6 tests) — registration (non-readOnly path), readOnly skip, happy-path envelope emission, typed-error JSON projection, SSRF validation surfaced as `isError:true` without graphRequest call, dependsOn cycle surfaced as `isError:true` without graphRequest call.
   - Test count updates (Rule 1 auto-fix — previously-correct test counts no longer match because a new global tool shipped):
     - `test/tool-filtering.test.ts` "should register all tools when no filter is provided" — 6 -> 7.
     - `test/tool-filtering.test.ts` "should handle invalid regex patterns gracefully" — 6 -> 7.
     - `test/read-only.test.ts` "should register all endpoints when not in read-only mode" — 5 -> 6.
     - `test/calendar-view.test.ts` "should include fetchAllPages parameter for GET tools" — skip `graph-batch` alongside `parse-teams-url` since the batch tool is a coalescer with no `fetchAllPages` surface.

_(No separate REFACTOR commit — Task 2 shipped on first pass; Task 3 iterated once to extend the tool description to mention SSRF safety after the first draft test assertion caught the gap.)_

## Files Created/Modified

### Created

- **`src/lib/middleware/batch.ts`** (427 lines) — the batch helper. Exports:
  - `batch(requests, client): Promise<BatchResponseItem[]>` — the free function.
  - `BatchClient` — thin class wrapper with `.submit(requests)` method.
  - `BatchRequestItem` / `BatchResponseItem` — the per-item input/output types.
  - Internal helpers: `validateBatch`, `isRelativePath`, `findCycle` (iterative DFS), `buildCyclePath`, `buildSubRequest`, `parseBatchResponseEnvelope`, `mapResponsesToRequests`.
  - Module docstring + JSDoc on every exported surface + rationale comments at each invariant check. Analog: `src/lib/middleware/page-iterator.ts` (02-04 helper-that-calls-through-the-chain).
- **`test/batch-client.test.ts`** (439 lines, 24 tests) — validation / transport / isolation coverage. Uses the existing `vi.mock('../src/logger.js', ...)` pattern. Mock client captures graphRequest calls for envelope-shape assertions.
- **`test/graph-batch-tool.test.ts`** (247 lines, 6 tests) — MCP tool registration + handler coverage. Uses a minimal mock McpServer stub that captures tool registrations by name for direct handler invocation.

### Modified

- **`src/graph-tools.ts`** — added `graph-batch` registration block after the `parse-teams-url` block:
  - Skip when `readOnly === true`.
  - Zod schema: `requests` array of objects with `id`, `method`, `url`, optional `headers` / `body` / `dependsOn`.
  - Tool description explicitly mentions SSRF safety + 20-cap + per-item isolation so AI clients understand the contract up front.
  - Handler pattern: dynamic-import the batch helper, call it, project typed errors into JSON-safe fields, embed in `content[0].text`. Validation throws caught and surfaced as `isError: true`.
  - ~95 lines added including the zod schema + tool handler.
- **`test/tool-filtering.test.ts`** — 6 -> 7 in two assertions (full-registration count + invalid-regex fallback count).
- **`test/read-only.test.ts`** — 5 -> 6 in the non-readOnly full-registration assertion.
- **`test/calendar-view.test.ts`** — add `if (toolName === 'graph-batch') continue;` alongside the existing `parse-teams-url` skip in the fetchAllPages-parameter check.

## Decisions Made

_All captured in the frontmatter `key-decisions` list. Expanded notes on the load-bearing ones:_

- **Helper, not middleware.** `batch()` does NOT implement `GraphMiddleware.execute(req, next)`. It's a function that calls `client.graphRequest('/$batch', ...)` — which threads the outer POST through the full chain. This matches 02-04's `pageIterator` placement and avoids the "middleware-that-generates-more-work" anti-pattern that would require reentrant double-dispatch through `composePipeline`.
- **Validation order: cheap -> expensive -> I/O.** Empty / cap / per-item SSRF / duplicate-id checks run BEFORE the dependsOn graph walk, which runs BEFORE the only network POST. First failure throws — no partially-validated batch ever reaches the wire.
- **Positive-list SSRF gate.** `isRelativePath(url)` accepts iff `url.startsWith('/') && url[1] !== '/' && !url.includes('\\')`. Rejects absolute `http(s)://`, `file://`, `gopher://`, protocol-relative `//host/path`, and Windows-path-like `\\share`. Future-proof against new URL schemes — a negative-list (reject-known-bad) would miss `gopher://` today or `moz-extension://` tomorrow.
- **Iterative DFS cycle detection.** 3-color state (UNSEEN / ON_STACK / DONE) + explicit stack of `{node, idx}` frames. Detects self-loops (`A -> A`), 2-cycles (`A -> B -> A`), and arbitrary n-cycles. Parent map reconstruction emits a human-readable error message with the full cycle path. Defensive against pathological input even though the 20-cap already bounds depth.
- **Per-sub-request typed errors via parseODataError.** The 02-03 helper is the single parsing entry point — called here per-sub-response with `(body, status, headers)` so we get the same status-code-driven subclass selection as the outer middleware. The `code` field is informational only; subclass selection never reads it (T-02-03f discipline preserved into batch-land).
- **Missing-sub-response defensible fallback.** Synthetic `{ status: 0, error: GraphError('missingBatchResponse') }` rather than leaving a gap in the output array. Never observed in practice but defensible against a partial Graph outage.
- **readOnly skips the whole tool.** A batch can carry arbitrary POST/PATCH/DELETE sub-requests; trying to inspect each one at registration time would be a categorical mistake. The correct abstraction is top-level — readOnly blocks the entire tool.
- **JSON-safe error projection at the MCP tool boundary.** `JSON.stringify(Error)` emits `{}` because Error's fields are non-enumerable by spec. The handler explicitly projects `{ code, message, statusCode, requestId, clientRequestId, date }` so AI clients get structured error context per failing sub-request.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test Bug / Rule 2 — Missing Critical Cross-Cutting Fix] Tool-count regression tests out of date after graph-batch shipped**
- **Found during:** Task 3 (register graph-batch tool), after the full regression suite surfaced 4 new failures in `test/tool-filtering.test.ts` (2) / `test/read-only.test.ts` (1) / `test/calendar-view.test.ts` (1).
- **Issue:** Three tests hard-coded the expected tool count (`toHaveBeenCalledTimes(6)`, `(5)`, etc.) based on the pre-plan registration shape (5 mock endpoints + parse-teams-url). The calendar-view `fetchAllPages parameter` test iterated all registered tools and only excluded `parse-teams-url`. Adding graph-batch (which is neither a per-endpoint wrapper nor has a `fetchAllPages` surface) made both counts and the iteration assertion wrong.
- **Fix:** Updated call counts to `+1` where the full registration count is asserted; added a `if (toolName === 'graph-batch') continue;` alongside the existing `parse-teams-url` skip in the fetchAllPages iteration.
- **Files modified:** `test/tool-filtering.test.ts` (2 assertions), `test/read-only.test.ts` (1 assertion), `test/calendar-view.test.ts` (1 iteration skip). Comments in each updated test call out the Plan 02-05 reason so future readers know where the `+1` came from.
- **Verification:** All 4 failing tests now GREEN; same 4 pre-existing spawn-test failures remain (public-url-failfast + startup-validation) — unrelated to this plan.
- **Committed in:** `7177c7d` (Task 3 commit, bundled with the graph-batch registration that caused the count shift).

**2. [Rule 2 — Missing Critical] Tool description strengthened to document SSRF safety**
- **Found during:** Task 3 (writing the graph-batch tool test), after an assertion `expect(tool.description).toMatch(/SSRF|absolute|relative/i)` failed.
- **Issue:** The initial tool description mentioned "20 sub-requests", "per-item isolation", and "middleware chain", but did NOT mention the SSRF-safety constraint on sub-request URLs. AI clients reading the tool description would not learn that absolute URLs are rejected until they hit the error — an avoidable round-trip.
- **Fix:** Appended one sentence to the tool description: `"Sub-request URLs MUST be relative paths starting with "/" — absolute URLs are rejected for SSRF safety."`
- **Files modified:** `src/graph-tools.ts` (graph-batch tool registration block).
- **Verification:** Test now GREEN; no other description-dependent test was affected.
- **Committed in:** `7177c7d` (Task 3 commit, bundled with the other tool-related changes).

---

**Total deviations:** 2 auto-fixed (1 test-count regression + description gap, 1 missing-critical description content).
**Impact on plan:** Both fixes preserve the plan's architectural intent. The test-count update is mechanical and unavoidable whenever a new global tool lands; the description strengthening is a UX win that the original plan's handler-level tests didn't surface. No scope creep.

## Issues Encountered

1. **Worktree was seeded at the wrong commit.** Initial `git merge-base HEAD` returned `751dae1` (upstream `main`) instead of `288a390...` (expected plan base). The `<worktree_branch_check>` snippet handled this cleanly: `git reset --hard 288a3907236c40c2a6239bfb85e041f7b637f69c` synchronized the worktree to the correct base. The reset was logged in the executor output; no lost work because the worktree had no uncommitted changes at start.

2. **`src/generated/client.ts` absent in the worktree.** Same pre-existing worktree-setup gap documented in 02-03 and 02-04 summaries — the generated file is gitignored and must be copied from the parent repo before tests run. Resolution: `cp /home/yui/Documents/ms-365-mcp-server/src/generated/client.ts ./src/generated/client.ts`. Not committed (still gitignored). Future phase 02 plans should either (a) check for / regenerate the file at executor start, or (b) document the copy-from-parent step in the phase runbook.

3. **Pre-existing 9 TypeScript `tsc --noEmit` errors in unrelated files.** Verified by stashing my changes and re-running `tsc` — same 9 errors (pino-http type mismatch in server.ts, express Request typing in lib/health.ts, Buffer/BodyInit mismatch in graph-client.ts, etc.). NOT caused by plan 02-05 and out of scope per deviation rules. `npm run build` (tsup) succeeds without `tsc` strict-mode checks, matching the existing CI flow. Logged for awareness; left untouched.

4. **Pre-existing 4 spawn-test failures** in `test/public-url-failfast.test.ts` (2) and `test/startup-validation.test.ts` (2) — the exact failures documented in 02-01 / 02-03 / 02-04 summaries. Spawned `tsx` subprocess times out and returns `null` exit code in this environment. Verified pre-existing by checking the full-suite failure list before any Task committed. NOT caused by plan 02-05. Left untouched.

## User Setup Required

None — the batch helper + graph-batch tool are internal transport infrastructure. No new environment variables, no external service configuration. Operators running ms-365-mcp-server v2 with `--read-only` will see the tool skipped (logged at `info` level); all other deployments gain the tool automatically.

## Next Phase Readiness

### What 02-06 (UploadSession) should know

- UploadSession chunk PUTs set `req._skipRetry = true` (per 02-02's idempotency-gate documentation) and have their OWN resume protocol via `nextExpectedRanges`. They do NOT interact with the batch helper. 02-06 is completely orthogonal to 02-05.
- If 02-06 wants to batch the initial `/createUploadSession` POST with other setup calls (unlikely but possible), it can pass the sub-request through batch() like any other write — the idempotency gate is at the outer POST /$batch layer, so 429 retries automatically; other 5xx retries only if an `Idempotency-Key` is set on the outer POST.

### What D-07 (Phase 6 auto-batch coalescer) will build on

- **The batch() function is the primitive.** Phase 6's coalescer will observe `requestContext.graph.coalesce === true` on concurrent calls, group compatible requests (read-only GETs, same auth scope), and call `batch()` with the grouped sub-requests. The 20-cap, SSRF guard, cycle detector, and per-sub-request typed-error surfacing all apply transparently.
- **BatchClient is the injection seam.** Phase 6 will hold a single `BatchClient` instance per coalescing window (per tenant / per request scope) and route grouped calls through `client.submit(requests)`. The class wrapper over the free function exists specifically so the coalescer can be DI-tested without touching the helper function.
- **requestContext.graph.coalesce is reserved.** 02-01 reserved the field but left it unread. Phase 6 is the first consumer. 02-05 does NOT read or write this flag — the batch helper is called explicitly by MCP clients via the graph-batch tool; auto-batching is a separate Phase 6 concern.

### Pipeline registration state (unchanged by this plan)

```typescript
this.pipeline = composePipeline(
  [
    new ETagMiddleware(),          // 02-07 ✓
    new RetryHandler(),            // 02-02 ✓
    new ODataErrorHandler(),       // 02-03 ✓
    new TokenRefreshMiddleware(this.authManager, this.secrets),  // 02-01 ✓
  ],
  ...
);
```

02-05 did NOT modify `src/graph-client.ts`. The batch helper uses the existing `graphRequest` surface — no new middleware, no chain reshape.

### Blockers / concerns

None. MWARE-03 is complete. The batch primitive and its MCP tool surface are ready for Phase 5 AI-tool-surface integration (AI clients can now call `graph-batch` directly) and Phase 6 auto-batch coalescer (BatchClient is the injection seam).

## Threat Flags

None — no new security-relevant surface introduced beyond what the plan's threat model addresses. T-02-05a (amplification DoS via >20 sub-requests) is mitigated via the 20-cap entry validation; T-02-05b (SSRF via absolute sub-request URL) is mitigated via the positive-list relative-URL gate; T-02-05c (request storm via dependsOn cycle) is mitigated via iterative DFS cycle detection. No new network endpoints created. No new auth paths. The graph-batch tool is subject to the existing readOnly flag (skipped entirely; it can carry write sub-requests).

## Self-Check: PASSED

**Files created — verified existing:**
- `src/lib/middleware/batch.ts` — FOUND
- `test/batch-client.test.ts` — FOUND
- `test/graph-batch-tool.test.ts` — FOUND

**Files modified — verified:**
- `src/graph-tools.ts` — verified `graph-batch` registration block present (grep returned 4 matches in the file)
- `test/tool-filtering.test.ts` — verified `toHaveBeenCalledTimes(7)` replaces two `(6)` calls
- `test/read-only.test.ts` — verified `toHaveBeenCalledTimes(6)` replaces `(5)` in the non-readOnly full-reg assertion
- `test/calendar-view.test.ts` — verified `if (toolName === 'graph-batch') continue;` present alongside `parse-teams-url` skip

**Commits — verified in git log:**
- `0f0b5a3` — test(02-05): Wave 0 RED tests for BatchClient + batch() helper — FOUND
- `244124b` — feat(02-05): implement BatchClient + batch() helper — $batch coalescing — FOUND (shell stripped the `$`, commit message body preserves it)
- `7177c7d` — feat(02-05): register graph-batch MCP tool; update tool-count tests — FOUND

**Verification greps — all match plan contract:**
- `grep -c 'export async function batch' src/lib/middleware/batch.ts` → 1
- `grep -c 'export class BatchClient' src/lib/middleware/batch.ts` → 1
- `grep -c 'MAX_BATCH_SIZE = 20' src/lib/middleware/batch.ts` → 1
- `grep -c 'isRelativePath' src/lib/middleware/batch.ts` → 2 (definition + callsite)
- `grep -c 'findCycle' src/lib/middleware/batch.ts` → 2 (definition + callsite)
- `grep -c 'parseODataError' src/lib/middleware/batch.ts` → 7 (2 docstring refs + 1 import + 2 @see JSDoc refs + 2 callsites: synthetic-missing + mapResponses)
- `grep -c 'graph-batch' src/graph-tools.ts` → 7 (header comment + enabledToolsRegex test + server.tool name + title hint + skip log info + failure log + readOnly skip log)
- `grep -cE "relative|absolute|SSRF" src/graph-tools.ts` → 2 (graph-batch tool description + url param schema description)

**Test results:**
- 24 new batch-client tests GREEN (validation + envelope + per-item isolation + class wrapper)
- 6 new graph-batch-tool tests GREEN (registration + readOnly skip + handler happy-path + typed-error projection + SSRF isError + cycle isError)
- 403 tests pass across the full suite (up from 365 at 02-04 baseline)
- 4 pre-existing spawn-test failures in `test/public-url-failfast.test.ts` (2) + `test/startup-validation.test.ts` (2) — same 4 documented in 02-01 SUMMARY; NOT caused by this plan.

**Build pipeline:**
- `npx eslint src/lib/middleware/batch.ts src/graph-tools.ts test/batch-client.test.ts test/graph-batch-tool.test.ts test/tool-filtering.test.ts test/read-only.test.ts test/calendar-view.test.ts` → 0 errors
- `npx prettier --check` on the same files → all pass
- `npm run build` → tsup build success; `dist/lib/middleware/batch.js` emitted (6.6 KB)

**Success criteria from orchestrator (all MET):**
- [x] BatchClient + batch() helper implemented in `src/lib/middleware/batch.ts`
- [x] graph-batch MCP tool registered in `src/graph-tools.ts`
- [x] 20-cap enforcement (throw at entry on >20 sub-requests)
- [x] dependsOn cycle detection (iterative DFS; self-loops + 2-cycles + n-cycles all detected)
- [x] SSRF guard — relative URLs only (positive-list gate rejects http://, https://, //host, file://, backslash)
- [x] Per-sub-request isolation — typed GraphError surfaced per-item via parseODataError; one failure does not reject the batch
- [x] 3 atomic task commits + SUMMARY.md (this document)
- [x] No STATE.md / ROADMAP.md edits (parallel executor contract)

---
*Phase: 02-graph-transport-middleware-pipeline*
*Completed: 2026-04-19*
