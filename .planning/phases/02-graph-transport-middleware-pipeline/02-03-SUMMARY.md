---
phase: 02-graph-transport-middleware-pipeline
plan: "03"
subsystem: api

tags:
  - odata-error
  - graph-error
  - typed-errors
  - error-parsing
  - innerError
  - request-id
  - mcp-meta
  - retry-after-parsing
  - mware-07

# Dependency graph
requires:
  - phase: 02-graph-transport-middleware-pipeline
    provides: middleware pipeline scaffold + composePipeline onion driver + canonical Graph response fixtures with hyphenated innerError keys + TokenRefreshMiddleware (innermost) from plan 02-01
provides:
  - graph-error-hierarchy
  - parse-odata-error
  - odata-error-middleware
  - mcp-meta-graph-envelope
  - typed-retryable-errors
  - requires-org-mode-detection
  - retry-after-ms-helper
affects:
  - src/graph-client.ts
  - src/lib/*
  - 02-02-plan (RetryHandler outer middleware — catches GraphThrottleError / GraphServerError by class; consumes retryAfterMs)
  - 02-07-plan (ETagMiddleware outermost — wraps ODataErrorHandler; 412 → GraphConcurrencyError shape owned here)
  - 02-04-plan (PageIterator — per-page fetch inherits typed-error throw semantics, no silent swallow)
  - 02-05-plan (BatchClient — per-sub-request error parsing uses parseODataError directly)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure domain module with ZERO project-internal imports (src/lib/graph-errors.ts) — safe to load before logger / OTel bootstrap; same zero-dep pattern as Phase 1 src/lib/redact.ts"
    - "Typed error hierarchy with class-selection-by-status-code ONLY — the `code` field never drives subclass selection (T-02-03f defense against attacker-controllable `code`)"
    - "Hyphenated-first innerError key extraction (request-id / client-request-id) with camelCase fallback (requestId / clientRequestId) — matches real Graph wire format per Kiota issue #75"
    - "Response.clone().json() before body read in middleware — fetch Response bodies are single-use streams; clone preserves upstream re-read capability"
    - "Non-JSON error body fallback to synthetic { error: { code: 'nonJsonError', message: <text> } } envelope — callers always receive a typed GraphError"
    - "Separation of parsing from presentation: parseODataError sets requiresOrgMode boolean; graph-client.ts composes the '--org-mode' operator hint string"

key-files:
  created:
    - src/lib/graph-errors.ts
    - src/lib/middleware/odata-error.ts
    - test/graph-errors.test.ts
    - test/odata-error-middleware.test.ts
  modified:
    - src/graph-client.ts

key-decisions:
  - "GraphError hierarchy: base class + 5 subclasses (GraphThrottleError 429, GraphConcurrencyError 412, GraphAuthError 401/403, GraphValidationError 400/422, GraphServerError 5xx). Unknown statuses fall back to base GraphError."
  - "Subclass selection uses statusCode ONLY — the `code` field from the error envelope is purely informational (T-02-03f mitigation against spoofed `code` values on attacker-controllable bodies)."
  - "parseODataError tolerance: hyphenated innerError keys + camelCase fallback + legacy `innererror` lowercase field name + null/empty/non-JSON body graceful fallback with synthetic unknownError code."
  - "parseRetryAfter lives INSIDE src/lib/graph-errors.ts (private helper, not exported) — 02-02 RetryHandler will carry its own copy to avoid a circular-import risk; re-unification is a later chore per the plan's 'For now:' clause."
  - "Retry-After parsing tolerates fractional seconds (Sentry #7919 — Number() + Math.round(value * 1000)) and past HTTP-dates (clamp to 0 rather than negative)."
  - "403 org-mode hint detection: requiresOrgMode=true when body.error.message matches /scope|permission/i AND statusCode === 403. graph-client.ts catch-block appends '. This tool requires organization mode. Please restart with --org-mode flag.' to the MCP error text — preserves the v1 org-mode user guidance while moving the detection into typed-error land."
  - "ODataErrorHandler chain position locked: INSIDE RetryHandler slot (02-02) and OUTSIDE TokenRefreshMiddleware (innermost) — so RetryHandler sees the typed exception for retry decisions, and 401 refresh still runs innermost before ODataError surfaces."
  - "Non-JSON response bodies fall back to { error: { code: 'nonJsonError', message: <raw-text> } } synthetic envelope — gateway errors / HTML pages / TLS failures still produce a GraphError rather than a generic Error."
  - "graphRequest catch-block branches: GraphError instances surface _meta.graph = { code, statusCode, requestId, clientRequestId, date }; non-GraphError errors (network, auth-resolution) fall back to the pre-existing envelope WITHOUT _meta.graph (those errors carry no Microsoft requestId)."

patterns-established:
  - "Pure domain module (no project-internal imports) as the Phase 1 gold standard for security-critical / load-order-sensitive helpers — applied to src/lib/graph-errors.ts and already established by src/lib/redact.ts. Testable without mocking."
  - "parseODataError signature (body, statusCode, headers?) — stable contract 02-02 (RetryHandler needs retryAfterMs) and 02-07 (ETagMiddleware needs GraphConcurrencyError class-check on 412) depend on this."
  - "Middleware Response.clone() for body-read safety — single-use-stream pattern for 02-05 BatchClient when it needs to parse per-sub-request envelopes."
  - "_meta.graph MCP envelope shape: { code, statusCode, requestId, clientRequestId, date } — AI callers can paste requestId directly into a Microsoft support ticket."

requirements-completed:
  - MWARE-07

# Metrics
duration: ~7min
completed: 2026-04-19
---

# Phase 02 Plan 03: Typed ODataError Middleware + GraphError Hierarchy Summary

**Typed GraphError hierarchy (6 classes) + parseODataError helper + ODataErrorHandler middleware replace the v1 string-concat `throw new Error(\`Microsoft Graph API error: ...\`)` at graph-client.ts:152-167 with structured errors that surface Microsoft requestId / clientRequestId / date / code into the MCP response `_meta.graph` envelope so AI callers can paste requestId into a Microsoft support ticket.**

## Performance

- **Duration:** ~7 min wall-clock (RED test + implement + wire pipeline + refactor graphRequest + regression)
- **Started:** 2026-04-19T10:26:51Z
- **Completed:** 2026-04-19T10:33:37Z
- **Tasks:** 3 (Task 1 RED tests, Task 2 hierarchy + parseODataError, Task 3 middleware + pipeline wire + _meta.graph)
- **Files created:** 4 (2 src + 2 test)
- **Files modified:** 1 (src/graph-client.ts)
- **Commits:** 3 atomic + 1 docs (this summary)

## Accomplishments

- **GraphError hierarchy (6 classes)** — base `GraphError` + 5 subclasses selected by HTTP status: `GraphThrottleError` (429), `GraphConcurrencyError` (412, appends re-fetch hint to message), `GraphAuthError` (401/403), `GraphValidationError` (400/422), `GraphServerError` (5xx). All carry structured fields (`code`, `statusCode`, `requestId`, `clientRequestId`, `date`, `innerDetails`, `retryAfterMs`, `requiresOrgMode`) so callers branch on `instanceof` and read by field, not by regex-parsing a text blob.
- **`parseODataError(body, statusCode, headers?)` helper** — single entry-point the middleware and (future) BatchClient per-sub-request parser both call. Tolerant of hyphenated-vs-camelCase innerError keys (Kiota #75), legacy lowercase `innererror` field, malformed / null / non-JSON bodies (graceful fallback to `unknownError` code + synthetic message), and Retry-After header in both seconds and HTTP-date forms (Sentry #7919 fractional-seconds compliance).
- **`ODataErrorHandler` middleware** — slotted INSIDE RetryHandler (02-02 placeholder) and OUTSIDE TokenRefreshMiddleware (innermost). 2xx passes through; non-2xx reads `response.clone().json()` (single-use-stream safety), calls parseODataError, throws the typed subclass. Emits OTel span `graph.middleware.odata-error` with `graph.status` / `graph.error.code` / `graph.error.requestId` attributes. Non-JSON bodies fall back to a synthetic `nonJsonError` envelope so gateway errors / HTML pages still produce a typed GraphError.
- **`graph-client.ts` makeRequest simplification** — removed the three string-concat `throw new Error(\`Microsoft Graph API error:...\`)` blocks (former lines 178-194). That path is now owned entirely by ODataErrorHandler; `makeRequest` is a 2xx-only branch from here on.
- **`graph-client.ts` graphRequest catch-block refactor** — typed branching: GraphError instances surface `_meta.graph = { code, statusCode, requestId, clientRequestId, date }`; `requiresOrgMode=true` appends the `"--org-mode"` operator hint to the MCP error text (preserves v1 guidance); non-GraphError errors fall back to the pre-existing envelope.
- **30 new tests GREEN** — 18 graph-errors.test.ts + 12 odata-error-middleware.test.ts (includes 2 composePipeline integration tests proving outer middleware catches the typed exception and `GraphThrottleError.retryAfterMs` surfaces for 02-02 consumption).
- **Full regression clean** — 343 tests pass (up from 331 at 02-01 baseline; same 4 pre-existing spawn-test failures in `test/public-url-failfast.test.ts` and `test/startup-validation.test.ts` documented in 02-01 summary as unrelated to any Phase 2 plan).

## Task Commits

1. **Task 1: Wave 0 RED tests — test/graph-errors.test.ts** — `f7e5708` (test)
   - 18 test cases exercising the parseODataError contract + GraphError instanceof semantics
   - All RED because `src/lib/graph-errors.js` does not exist yet

2. **Task 2: Implement src/lib/graph-errors.ts** — `88ad098` (feat)
   - 6 class exports + parseODataError helper + private parseRetryAfter / readRetryAfter / extractErrorWrapper / extractInnerError / readInnerField helpers
   - 18 tests transition RED → GREEN
   - Lint clean (0 errors); build success; format check passes
   - Included a test-tolerance fix for the HTTP-date Retry-After case (see "Deviations" below)

3. **Task 3: ODataErrorHandler middleware + wire pipeline + surface _meta.graph** — `07a5d0c` (feat)
   - `src/lib/middleware/odata-error.ts` (new, 77 lines) — middleware class + readErrorBody helper
   - `test/odata-error-middleware.test.ts` (new, 12 tests) — direct-invocation + composePipeline integration
   - `src/graph-client.ts` (modified) — pipeline adds `new ODataErrorHandler()`; makeRequest 4xx/5xx throws removed; graphRequest catch-block typed
   - 12 middleware tests GREEN; 63 key regression tests still GREEN; full suite 343 pass / same 4 pre-existing spawn failures

_(No separate REFACTOR commit — each feat commit produced clean code on the first pass.)_

## Files Created/Modified

### Created

- `src/lib/graph-errors.ts` (~216 lines) — `GraphErrorParams` interface + `GraphError` base class + 5 subclasses + `parseODataError` function + 4 private helpers (`extractErrorWrapper`, `extractInnerError`, `readInnerField`, `readRetryAfter`, `parseRetryAfter`). ZERO project-internal imports — pure domain module, safe to load before the logger or OTel bootstrap. Analog: `src/lib/redact.ts` (Phase 1 gold standard).
- `src/lib/middleware/odata-error.ts` (~94 lines) — `ODataErrorHandler implements GraphMiddleware` class + `readErrorBody` helper. Emits OTel span `graph.middleware.odata-error`; logs at `warn` level via pino (D-01 STRICT redaction applies). Analog: `src/lib/middleware/token-refresh.ts` (02-01 middleware-class template).
- `test/graph-errors.test.ts` (18 tests) — pure-function unit tests for every parseODataError branch. Analog: `test/odata-recursion.test.ts` (pure-function unit test style from 01-09).
- `test/odata-error-middleware.test.ts` (12 tests, 2 describes) — direct-invocation coverage + composePipeline integration block that exercises the actual chain composition. Analog: `test/token-refresh-middleware.test.ts` (02-01 middleware test template).

### Modified

- `src/graph-client.ts`:
  - Added imports: `ODataErrorHandler`, `GraphError` (for instanceof check in graphRequest catch-block).
  - Pipeline constructor array — inserted `new ODataErrorHandler()` in the slot between the RetryHandler placeholder comment (02-02) and `TokenRefreshMiddleware` (innermost). Chain ordering now: `[// ETag, // Retry, ODataErrorHandler, TokenRefresh]`.
  - `makeRequest` — deleted the three string-concat `throw new Error(\`Microsoft Graph API ...\`)` blocks (former lines 178-194 handling 403-scope-error, 403-generic, and non-ok generic). Those paths are now owned by ODataErrorHandler; what remains is a 2xx-only branch.
  - `graphRequest` catch-block — added `if (error instanceof GraphError)` branch that surfaces `_meta.graph = { code, statusCode, requestId, clientRequestId, date }`, appends the `"--org-mode"` operator hint when `requiresOrgMode=true`. Non-GraphError fallback preserves the pre-existing envelope WITHOUT `_meta.graph`.

## Decisions Made

_All committed in the plan's `key-decisions` list; captured in frontmatter above. The expanded versions:_

- **GraphError hierarchy shape** — 6 classes (base + 5 status-specific). `GraphConcurrencyError` is the only subclass that overrides the constructor to append the re-fetch hint to the message (so the AI caller reading `err.message` gets a single-line actionable string, while the raw code stays in `err.code`). Other subclasses are empty marker classes — the `instanceof` discriminator is the whole point.
- **statusCode-only subclass selection** — `parseODataError` uses `statusCode` alone to pick the subclass; the `code` field from the body is purely informational. This blocks T-02-03f (attacker sets `body.error.code = "TooManyRequests"` on a 500 to trick retry logic into retrying a non-retryable status).
- **parseRetryAfter lives inside graph-errors.ts** — the plan's "For now" clause called for an in-file copy to avoid a circular import risk with 02-02's `retry.ts` (which will have its own copy). A later chore will re-unify the helper; both copies implement the same Sentry-#7919-compliant `Number()+Math.round()` formula so they're behaviourally identical.
- **Non-JSON fallback envelope** — gateway errors (Cloudflare HTML pages, TLS failures, upstream 502s) arrive with `content-type: text/html` and unparseable bodies. Rather than let the middleware silently pass-through or throw a generic Error, `readErrorBody` wraps the raw text into `{ error: { code: 'nonJsonError', message: <text> } }` so `parseODataError` still selects the correct statusCode-based subclass.
- **Response.clone() for body read** — fetch Response bodies are single-use streams per the spec; reading `response.json()` consumes the body. We call `response.clone()` before reading so if any upstream consumer re-reads the body (unlikely in this position but future-proof for 02-05 BatchClient per-sub-request parsing) they can.
- **_meta.graph shape** — only 5 structured fields: `code`, `statusCode`, `requestId`, `clientRequestId`, `date`. We deliberately do NOT surface `innerDetails` (may contain field-level validation output with internal object names per threat T-02-03a) or the raw message (Microsoft message is the one field already in `content.text`). AI callers get structured error context without verbose log leakage.
- **403 org-mode detection in parser; hint composition in client** — the parser sets a boolean (`requiresOrgMode`) so downstream callers can decide what to do with it; graph-client.ts composes the `"--org-mode"` operator hint as the final message suffix. Pure separation of parsing from presentation — the hint text is a `graph-client` concern, not a `graph-errors` concern.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test Bug] HTTP-date Retry-After test tolerance too tight for RFC 7231 1-second resolution**
- **Found during:** Task 2 verification (running test/graph-errors.test.ts after implementing src/lib/graph-errors.ts)
- **Issue:** The test `"429 HTTP-date form populates retryAfterMs within tolerance"` encoded a future date as `new Date(Date.now() + 5000).toUTCString()` then asserted `retryAfterMs` fell in `[4900, 5100]` ms. `toUTCString()` truncates to 1-second resolution per RFC 7231 — if the test wall-clock happens to be at second N.8 when encoding, the resulting HTTP date represents second N+1 × 1000 ms = (0.2s + 5s) − (0s timing drift reading the header). Observed value: 4763 ms, below the 4900 floor. The parseRetryAfter implementation itself is correct; the test asserted a tighter tolerance than HTTP-date resolution allows.
- **Fix:** Widened the lower bound from 4900 to 3900 ms (keeping 5100 upper bound). Added a 3-line inline comment explaining the 1-second-truncation + timing-drift relationship so future readers don't tighten the bound again.
- **Files modified:** `test/graph-errors.test.ts` (lines 61-68 in the 429 HTTP-date case)
- **Verification:** 18/18 tests GREEN; full suite regression clean (same 4 pre-existing failures only).
- **Committed in:** `88ad098` (part of Task 2 feat commit, bundled with the implementation it validated).

---

**Total deviations:** 1 auto-fixed (1 test bug).
**Impact on plan:** The fix was a tolerance widening, not a behavior change — the implementation under test is correct as specified; the test assertion needed loosening to match wire-format resolution. No scope creep.

## Issues Encountered

1. **Initial test run reported 0/0 tests because the module did not exist yet.** Expected — this is the Wave 0 RED state. The `import { ... } from '../src/lib/graph-errors.js'` line at the top of `test/graph-errors.test.ts` fails module resolution and Vitest correctly reports the file as failed-to-load rather than running empty. No mitigation needed; the RED → GREEN transition at Task 2 resolved it.

2. **Worktree was missing `src/generated/client.ts` at startup.** Root cause: the generated file is gitignored (it's produced by `npm run generate` which downloads the Microsoft Graph OpenAPI YAML and runs `openapi-zod-client`). The worktree branch inherits the gitignore list from the base commit. Without it, most existing tests fail at module-resolution time (e.g., `src/graph-tools.ts:5 → './generated/client.js'`). **Resolution:** Copied `src/generated/client.ts` from the main repo working tree into the worktree before starting Task 1. This is a pre-existing worktree-setup gap not caused by plan 02-03; future plans in this phase should check for / regenerate the file before running the test suite. No code change made.

3. **Pre-existing unrelated test failures on the base commit** — 4 spawn-test failures in `test/public-url-failfast.test.ts` and `test/startup-validation.test.ts` (the same 4 documented in 02-01 summary as pre-existing). These tests spawn a `tsx` subprocess that times out in this environment and returns `null` exit code. Verified pre-existing by running the test suite on the base commit BEFORE starting Task 1. NOT caused by plan 02-03 and out of scope per deviation rules (scope boundary: only fix issues DIRECTLY caused by the current task). Logged for awareness; left untouched.

## User Setup Required

None — no external service configuration required. The hierarchy + middleware are internal refactors; runtime behaviour for successful Graph calls is identical. Error behaviour changes in one observable way: the MCP envelope now includes `_meta.graph.requestId` on 4xx/5xx, which callers can forward to Microsoft support tickets. This is additive — callers that ignore `_meta` see the pre-existing error text content unchanged (aside from the message format: v1 prefixed with "Microsoft Graph API error: ${status} ${statusText} - ", v2 uses the Microsoft canned error.message directly). Any MCP client that regex-parsed the old text prefix will need to read the structured `_meta.graph` fields instead.

## Next Phase Readiness

### What 02-02 (RetryHandler) should read first

- **`src/lib/graph-errors.ts`** — import `GraphThrottleError`, `GraphServerError`, `GraphError` for the `instanceof` check inside RetryHandler's catch-block. Do NOT import `parseODataError` — RetryHandler operates on the already-typed exception thrown upstream by ODataErrorHandler; parsing responsibility stays with the ODataErrorHandler middleware (T-02-03f separation-of-concerns mitigation).
- **`src/lib/middleware/odata-error.ts`** — template for the `src/lib/middleware/retry.ts` class shape: module-level `const tracer = trace.getTracer('graph-middleware')`, `class RetryHandler implements GraphMiddleware`, `readonly name = 'retry'`, `async execute(req, next)` wraps work in `tracer.startActiveSpan('graph.middleware.retry', async (span) => { try { ... } finally { span.end(); } })`.
- **`err.retryAfterMs`** — populated on `GraphThrottleError` instances when the 429 response carried a `Retry-After` header. RetryHandler reads this directly: `if (err instanceof GraphThrottleError && err.retryAfterMs != null) await sleep(err.retryAfterMs);`. Precedence over the AWS full-jitter backoff math (per D-05 decision).

### What 02-07 (ETagMiddleware) should read first

- **`src/lib/graph-errors.ts`** — import `GraphConcurrencyError` for the 412 path. `GraphConcurrencyError.message` already carries the re-fetch hint ("resource changed; re-fetch before retrying.") so 02-07 doesn't need to re-append it. 02-07 wraps the full pipeline; a 412 response parses through ODataErrorHandler → throws `GraphConcurrencyError` → 02-07's structural test asserts the class surfaces intact to the MCP caller.

### Pipeline registration hole left for 02-02 and 02-07

In `src/graph-client.ts`:

```typescript
this.pipeline = composePipeline(
  [
    // ETagMiddleware — 02-07           <-- 02-07 inserts here
    // RetryHandler — 02-02             <-- 02-02 inserts here
    new ODataErrorHandler(),
    new TokenRefreshMiddleware(this.authManager, this.secrets),
  ],
  ...
);
```

Both placements are load-bearing per 02-CONTEXT.md Pattern E. 02-07's structural test is the regression guard that greps the source file to assert the shape.

### Chain-ordering invariant locked

```
[ETag (02-07), Retry (02-02), ODataError (this plan), TokenRefresh (02-01)]
    outermost                                                      innermost
```

ODataErrorHandler now occupies its final position. Neither 02-02 nor 02-07 should move it.

### Blockers / concerns

None. MWARE-07 is complete and the contract every downstream plan depends on (parseODataError signature, GraphError class hierarchy, `_meta.graph` envelope shape, `retryAfterMs` on GraphThrottleError) is stable.

## Self-Check: PASSED

**Files created — verified existing:**
- `src/lib/graph-errors.ts` — FOUND
- `src/lib/middleware/odata-error.ts` — FOUND
- `test/graph-errors.test.ts` — FOUND
- `test/odata-error-middleware.test.ts` — FOUND

**Commits — verified in git log:**
- `f7e5708` — test(02-03): Wave 0 RED tests for GraphError hierarchy + parseODataError — FOUND
- `88ad098` — feat(02-03): implement src/lib/graph-errors.ts — typed error hierarchy + parseODataError — FOUND
- `07a5d0c` — feat(02-03): ODataErrorHandler middleware + wire pipeline + _meta.graph surfacing — FOUND

**Verification greps — all match plan contract:**
- `grep -c 'export class GraphError' src/lib/graph-errors.ts` → 1
- `grep -c 'export function parseODataError' src/lib/graph-errors.ts` → 1
- `grep -cE 'export class (GraphThrottleError\|GraphConcurrencyError\|GraphAuthError\|GraphValidationError\|GraphServerError)' src/lib/graph-errors.ts` → 5
- `grep -c 'export class ODataErrorHandler' src/lib/middleware/odata-error.ts` → 1
- `grep -c 'new ODataErrorHandler()' src/graph-client.ts` → 1 (in pipeline array)
- `grep -c '_meta' src/graph-client.ts` → 7 (interface + 4 existing formatJsonResponse uses + 2 new graphRequest uses, including `_meta.graph`)
- `grep -c 'Microsoft Graph API error:' src/graph-client.ts` → 0 (string-concat throws fully removed)
- `grep -c 'request-id' src/lib/graph-errors.ts` → 4 (hyphenated fallback code + docstring references)

**Test results:**
- 30 new Phase 2.03 tests GREEN (18 graph-errors + 12 odata-error-middleware)
- 313 previously-passing tests still GREEN (including 63 key regression tests: binary-response, odata-nextlink, graph-api, path-encoding, read-only, multi-account, mail-folders, onedrive-folders, calendar-view)
- Full suite: 343 tests pass / 4 pre-existing spawn-test failures (test/public-url-failfast.test.ts + test/startup-validation.test.ts — verified pre-existing at base commit, same 4 as 02-01 summary documents)

**Build pipeline:**
- `npm run lint` → 0 errors, 59 pre-existing warnings
- `npm run format:check` → all files pass
- `npm run build` → tsup build success (dist/lib/graph-errors.js + dist/lib/middleware/odata-error.js emitted)

**Success criteria from plan (all MET):**
- [x] `src/lib/graph-errors.ts` exists with 6 exports + parseODataError helper
- [x] `src/lib/middleware/odata-error.ts` exists with ODataErrorHandler class
- [x] `src/graph-client.ts` pipeline includes `new ODataErrorHandler()`; 4xx/5xx string-concat throws removed; graphRequest catch surfaces `_meta.graph` with `{ code, statusCode, requestId, clientRequestId, date }`
- [x] Hyphenated innerError fields + legacy `innererror` normalize to camelCase
- [x] Retry-After parsed into `retryAfterMs` on GraphThrottleError
- [x] GraphConcurrencyError message appends "resource changed; re-fetch before retrying."
- [x] 403 + scope/permission sets requiresOrgMode=true; graphRequest catch appends "--org-mode" hint
- [x] 18 graph-errors tests + 12 odata-error-middleware tests GREEN (30 new — exceeded the plan's 9+4=13 minimum)
- [x] No regression; same pre-existing failures as 02-01 baseline

---

*Phase: 02-graph-transport-middleware-pipeline*
*Completed: 2026-04-19*
