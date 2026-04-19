---
phase: 02-graph-transport-middleware-pipeline
plan: "07"
subsystem: api

tags:
  - etag
  - if-match
  - if-none-match
  - optimistic-concurrency
  - precondition-failed
  - auto-attach
  - lru-cache
  - opt-out-sentinel
  - mware-06

# Dependency graph
requires:
  - phase: 02-graph-transport-middleware-pipeline
    provides: middleware pipeline scaffold + composePipeline onion driver + canonical Graph response fixtures (02-01); typed GraphError hierarchy + ODataErrorHandler middleware with parseODataError handing 412 → GraphConcurrencyError(with re-fetch hint) (02-03)
provides:
  - etag-middleware
  - resource-key-from-url
  - etag-cache-lru
  - opt-out-sentinel
  - 412-graph-concurrency-integration
  - chain-order-structural-guard
affects:
  - src/graph-client.ts
  - src/lib/middleware/*
  - 05-tool-surface-refactor (Phase 5 adds ifMatch/ifNoneMatch Zod param sugar atop this headers-map passthrough)
  - phase-3-multi-tenant (T-02-07e: cache key MUST be extended to (tenantId, resourceType, resourceId) before multi-tenant goes live)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level Map<string,string> with insertion-order LRU eviction: cacheSet delete-then-reinsert on existing keys to refresh recency; eviction removes first key once size > CACHE_MAX_SIZE; relies on ECMAScript Map insertion-order guarantee"
    - "Case-insensitive header find/remove helpers operate on plain Record<string,string> — matches RFC 7230 §3.2 header-name case-insensitivity without requiring callers to switch to fetch's Headers class"
    - "Opt-out sentinel via literal string 'null' on the If-Match header — sentinel is handled inside the middleware (strip header + skip auto-attach); no separate API surface required, works uniformly whether caller sets via tool param or raw headers map"
    - "Structural regression test that reads src/graph-client.ts as a string and greps the composePipeline array for middleware ordering — guards the locked chain [ETag, Retry, ODataError, TokenRefresh] against future refactor that reshuffles the array"
    - "Dynamic import of class values inside integration tests that sit after vi.resetModules()-using unit tests, so the class identity in the toBeInstanceOf check matches the one the middleware chain resolves internally"

key-files:
  created:
    - src/lib/middleware/etag.ts
    - test/etag-middleware.test.ts
  modified:
    - src/graph-client.ts

key-decisions:
  - "Cache implementation = module-level Map<string,string> with CACHE_MAX_SIZE=1000 insertion-order eviction. Phase 2 key is resource-path-only per resourceKeyFromUrl matcher; Phase 3 MUST extend to (tenantId, resourceType, resourceId) per T-02-07e disposition before multi-tenant goes live — documented both in the module header and in the 'Next Phase Readiness' section of this summary."
  - "Auto-attach scope locked to 8 regex patterns (DriveItem/Event/Message/Contact × me-scope/users-scope) per D-09. Adding a new resource requires a deliberate ETAG_SUPPORTED_PATTERNS edit + a new resourceKeyFromUrl test case — T-02-07b mitigation (attacker-controllable auto-attach on non-ETag-aware resources)."
  - "Opt-out sentinel = literal string 'null' on If-Match header. Chosen over a separate `ifMatch: null` param so the middleware does NOT need a distinct options-object path; a caller passing `headers: { 'If-Match': 'null' }` through the existing graph-client options.headers passthrough triggers the escape hatch. D-09 spec allowed either — string sentinel wins on uniformity."
  - "412 → GraphConcurrencyError NOT re-handled in this middleware. The ODataErrorHandler (02-03) already throws GraphConcurrencyError with the 'resource changed; re-fetch before retrying.' hint from the class constructor. ETagMiddleware only handles the PRE-request plumbing and the POST-response cache refresh; it lets the typed exception propagate untouched."
  - "Chain position = OUTERMOST. ETag must run before retry so a retried GET does not double-write the cache and the auto-attach header gets added ONCE before RetryHandler forwards the first attempt. Regression-guarded by the structural test that greps src/graph-client.ts."
  - "No log statements on the hot path. ETag plumbing runs on every Graph call; verbose logging would drown out retry / error signal. OTel span attributes (graph.etag.explicit / autoAttached / optedOut / cached) are sufficient for debugging. Matches T-02-07d 'accept' disposition (ETag values are opaque non-PII tokens; D-01 STRICT redaction does not apply)."
  - "ifMatch / ifNoneMatch Zod tool params DEFERRED to Phase 5. Exposing them now would require touching src/graph-tools.ts registerGraphTools which conflicts with 02-04 in Wave 4. The current design leverages graph-client.ts options.headers passthrough so the capability is reachable today via raw headers; Phase 5 adds explicit param sugar."
  - "Structural test added to test/etag-middleware.test.ts (not a separate test file) because it logically belongs to the ETag middleware contract (chain-order invariant for correctness). Pattern E in 02-PATTERNS.md calls for this guard to live with 02-07."

patterns-established:
  - "ETag cache shape: module-level Map<string,string> with delete-then-reinsert touch-on-read + insertion-order eviction. Reusable by any future middleware that needs a bounded LRU without pulling a lru-cache dep."
  - "Integration-test class-identity pattern: dynamic import of class VALUE (not just type) inside tests that sit after vi.resetModules() unit tests, so toBeInstanceOf matches the class the middleware resolves internally. Reusable in any Phase 2+ test that mixes resetModules isolation with instanceof assertions."
  - "Structural chain-order test: fs.readFileSync(src path) + regex extract composePipeline array + indexOf constructor names + index ordering assertion. Reusable if the pipeline gains more middleware in later phases (Phase 6 circuit breaker, Phase 6 per-tenant rate limiter)."
  - "Opt-out via header sentinel string 'null' — zero-API-surface escape hatch. Can be applied to any future middleware that needs an opt-out path without adding a new options field."

requirements-completed:
  - MWARE-06

# Metrics
duration: ~8min
completed: 2026-04-19
---

# Phase 02 Plan 07: ETagMiddleware — Opportunistic If-Match Auto-Attach Summary

**ETagMiddleware as outermost pipeline member implements D-09 OPPORTUNISTIC-AUTO-ATTACH: scoped-resource auto-attach of If-Match from a module-level LRU cache on PATCH/DELETE to DriveItem/Event/Message/Contact; explicit caller If-Match forwarded verbatim; literal 'null' sentinel strips the header and skips auto-attach; successful GETs on supported resources refresh the cache; 412 surfaces as GraphConcurrencyError with re-fetch hint via the existing ODataErrorHandler.**

## Performance

- **Duration:** ~8 min wall-clock (RED tests + implement + wire pipeline + structural regression test + iterate on ESLint / instanceof identity fixes)
- **Started:** 2026-04-19T10:54:32Z
- **Completed:** 2026-04-19T11:02:39Z
- **Tasks:** 3 (Task 1 RED tests, Task 2 ETagMiddleware implementation, Task 3 pipeline wiring + structural test)
- **Files created:** 2 (1 src + 1 test)
- **Files modified:** 1 (src/graph-client.ts)
- **Commits:** 3 atomic + 1 docs (this summary)

## Accomplishments

- **ETagMiddleware class** implementing `GraphMiddleware`. On PATCH/DELETE to an ETag-supported resource (DriveItem / Event / Message / Contact, 8 regex patterns covering me-scope + users-scope + drives-scope), auto-attaches `If-Match` from a module-level cache. Explicit caller-supplied `If-Match` is forwarded verbatim — the middleware never overrides a caller value with the cached one. Literal-`null` sentinel strips the header AND skips auto-attach (D-09 escape hatch for last-writer-wins semantics on an otherwise-ETag-aware resource).
- **resourceKeyFromUrl(url)** helper — matches 8 supported resource patterns against `new URL(url).pathname` with a fallback to the raw URL string for synthetic test fixtures. Returns `null` on unsupported paths so auto-attach is a no-op on non-ETag-aware resources (T-02-07b mitigation).
- **Module-level etagCache** = `Map<string,string>` with `CACHE_MAX_SIZE=1000` insertion-order eviction. `cacheGet` touches-on-read (delete-then-reinsert) to refresh recency so hot keys survive eviction. Phase 2 cache key is resource-path-only; Phase 3 MUST extend to `(tenantId, resourceType, resourceId)` per T-02-07e.
- **Cache refresh** on successful GET (response.ok && supported resource) — reads `ETag` response header case-insensitively and writes the cache. Runs OUTSIDE the `includeHeaders` path already in `graph-client.ts:217-225`, so the cache works for every caller regardless of whether they asked for headers in the response.
- **Chain position locked OUTERMOST** per 02-CONTEXT.md Pattern E: `[ETag, Retry, ODataError, TokenRefresh]`. Outermost placement ensures auto-attach runs before any retry decision; a retried GET writes the cache exactly once; an auto-attached `If-Match` is added before RetryHandler forwards the first attempt.
- **Structural regression guard** — a test in `test/etag-middleware.test.ts` reads `src/graph-client.ts` as a string and greps the `composePipeline` array for middleware ordering. Any refactor that reshuffles the array fails the test before it ships.
- **412 → GraphConcurrencyError** integration-verified via composed `[ETag, ODataErrorHandler]` pipeline with a canonical 412 fixture. The `GraphConcurrencyError` constructor (from 02-03) already appends the `resource changed; re-fetch before retrying.` hint, so ETagMiddleware does NOT re-handle 412 — it lets the typed exception propagate untouched.
- **OTel span `graph.middleware.etag`** per D-03, tagged with boolean attributes `graph.etag.explicit` / `graph.etag.autoAttached` / `graph.etag.optedOut` / `graph.etag.cached` for diagnostic-friendly traces. No hot-path log statements (ETag runs on every call; logging would drown out retry / error signal; span attributes suffice).
- **8 tests GREEN** in `test/etag-middleware.test.ts` (4 unit + 1 integration + 2 resourceKeyFromUrl + 1 structural). Full suite: 366/370 GREEN — same 4 pre-existing spawn-test failures as 02-01 / 02-03 baselines (`test/public-url-failfast.test.ts` + `test/startup-validation.test.ts`), verified pre-existing via `git stash` + re-run on the base commit. Those 4 failures are out of scope per deviation-rule scope boundary.
- **`npm run verify` equivalent:** lint clean (0 errors, 59 pre-existing warnings), format clean, tsup build success (emits `dist/lib/middleware/etag.js`).

## Task Commits

1. **Task 1: Wave 0 RED tests — test/etag-middleware.test.ts** — `0ec622a` (test)
   - 4 unit tests: explicit If-Match passthrough, auto-attach from cache, unsupported-resource skip, opt-out sentinel
   - 1 integration test: 412 surfaces as GraphConcurrencyError via composed `[ETag, ODataErrorHandler]`
   - 2 resourceKeyFromUrl tests: supported patterns + unsupported paths
   - All RED — `Cannot find module '../src/lib/middleware/etag.js'`

2. **Task 2: Implement src/lib/middleware/etag.ts** — `62d65f2` (feat)
   - `src/lib/middleware/etag.ts` (~190 lines) — ETagMiddleware class + resourceKeyFromUrl + etagCache LRU + findHeader/removeHeader case-insensitive helpers + cacheSet/cacheGet touch-on-read helpers
   - Test iterations bundled: dynamic import for `GraphConcurrencyError` value in the integration test (class-identity fix under `vi.resetModules`), top-level type-only import to keep ESLint `no-undef` happy on `as GraphConcurrencyError` casts
   - 7/7 tests transitioned RED → GREEN; lint 0 errors; build emits `dist/lib/middleware/etag.js`

3. **Task 3: Wire ETagMiddleware as outermost + structural regression test** — `ba07593` (feat)
   - `src/graph-client.ts` — added `ETagMiddleware` import; replaced `// ETagMiddleware — 02-07` placeholder with `new ETagMiddleware()` as the first element in the composePipeline array; updated the block comment to reflect the now-complete chain
   - `test/etag-middleware.test.ts` — added one structural test that reads `src/graph-client.ts` as a string and asserts `[ETag, Retry, ODataError, TokenRefresh]` ordering via indexOf + comparison
   - 8/8 ETag tests GREEN; full suite 366/370 (4 pre-existing failures only); lint clean; build success

_(No separate REFACTOR commit was needed — each feat commit produced clean code on the first pass.)_

## Files Created/Modified

### Created

- `src/lib/middleware/etag.ts` (~190 lines) — `ETagMiddleware` class + `resourceKeyFromUrl` function + `etagCache: Map<string,string>` module-level LRU + `findHeader` / `removeHeader` case-insensitive helpers + `cacheSet` / `cacheGet` with touch-on-read recency. Zero project-internal imports beyond `./types.js` (only for `GraphMiddleware` / `GraphRequest` interface types). Analog: `src/lib/middleware/token-refresh.ts` (02-01 middleware class template).
- `test/etag-middleware.test.ts` (~250 lines, 8 tests across 4 describes) — Direct middleware invocation for explicit / auto-attach / unsupported / opt-out unit tests; composePipeline integration for 412 routing; pure-function tests for resourceKeyFromUrl; structural regression test for chain ordering. Uses `vi.resetModules()` + dynamic import for module-level cache isolation between tests. Analog: `test/token-refresh-middleware.test.ts` (02-01 middleware test template) + `test/odata-error-middleware.test.ts` (composePipeline integration pattern).

### Modified

- `src/graph-client.ts`:
  - Added `import { ETagMiddleware } from './lib/middleware/etag.js';` next to the other middleware imports.
  - Updated the pipeline composition block comment to drop the "— this plan" suffix on RetryHandler and to note that the chain is now complete (the structural test in `test/etag-middleware.test.ts` is mentioned as the regression guard).
  - Replaced `// ETagMiddleware — 02-07` placeholder with `new ETagMiddleware(),` as the first element in the `composePipeline([...])` array. Remaining order preserved: `[ETag, Retry, ODataError, TokenRefresh]`.
  - No other changes. The `includeHeaders`-driven `_etag` surface path at lines 217-225 is UNTOUCHED (backwards-compat with any tool relying on it — per plan spec).

## Decisions Made

_All 8 in-plan decisions committed in `key-decisions` frontmatter. No out-of-plan decisions were required._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test Bug] GraphConcurrencyError class-identity mismatch under vi.resetModules**
- **Found during:** Task 2 verification (running test/etag-middleware.test.ts after implementing the middleware)
- **Issue:** The integration test `"412 from PATCH surfaces as GraphConcurrencyError with re-fetch hint"` failed with `expected GraphConcurrencyError: The ETag value pro… { …(8) } to be an instance of GraphConcurrencyError`. Vitest printed a correct-looking error but the `toBeInstanceOf(GraphConcurrencyError)` check still failed. Root cause: earlier tests in the file call `vi.resetModules()`. When the integration test dynamically imports `ODataErrorHandler`, the middleware internally resolves a FRESH `GraphConcurrencyError` class identity (different from the one statically imported at the top of the test file). The `instanceof` operator compares prototype chains by reference, not by structural shape, so two classes with the same name from different module-graph evaluations are `!==`.
- **Fix:** Converted the top-level `import { GraphConcurrencyError }` to an `import type { GraphConcurrencyError }` (preserves the `as GraphConcurrencyError` cast and keeps ESLint `no-undef` happy via a type-only reference). Added a dynamic `const { GraphConcurrencyError: GraphConcurrencyErrorClass } = await import('../src/lib/graph-errors.js');` inside the integration test so the `toBeInstanceOf` check uses the SAME class identity the middleware resolves. Documented the pattern in a comment inside the test so future readers understand the `resetModules` + instanceof interaction.
- **Files modified:** `test/etag-middleware.test.ts` (one import swap + one dynamic import added inside the integration `it` block)
- **Verification:** 8/8 tests GREEN after the fix; lint 0 errors.
- **Committed in:** `62d65f2` (bundled with Task 2 feat commit — the implementation and its passing tests ship together per 02-03 precedent of bundling test-tolerance fixes with the feat that makes them reachable)

**2. [Rule 3 - Blocking] Missing src/generated/client.ts in worktree**
- **Found during:** Pre-Task-1 setup check (listing `src/generated/`)
- **Issue:** The worktree was missing `src/generated/client.ts` — the file is gitignored (produced by `npm run generate` downloading the Microsoft Graph OpenAPI spec). Without it, most existing tests fail at module-resolution time (`src/graph-tools.ts:5 → './generated/client.js'` fails). This is the exact worktree-setup gap documented as Issue #2 in 02-03 summary.
- **Fix:** Copied `src/generated/client.ts` from the parent repo working tree into the worktree before starting Task 1. No code change; the generated file is reproducible via `npm run generate` but that requires a 30-second network round-trip to download the 50 MB upstream YAML, so copying from the parent is faster.
- **Files modified:** `src/generated/client.ts` (copy, not tracked — gitignored)
- **Verification:** Test suite loads successfully (no `Cannot find module './generated/client.js'` errors).
- **Committed in:** Not committed — the file is gitignored per `.gitignore` policy.

---

**Total deviations:** 2 auto-fixed (1 test bug, 1 blocking worktree setup).
**Impact on plan:** Both auto-fixes were necessary pre-conditions for GREEN state. Fix #1 is a pure test-infrastructure fix (class-identity under `vi.resetModules`) that did not change any production behavior; the implementation under test is correct as specified. Fix #2 is a well-documented worktree-setup gap that carries forward from 02-01/02-03 until the worktree provisioning path is fixed phase-wide. No scope creep.

## Issues Encountered

1. **Initial ESLint `no-undef` error on `GraphConcurrencyError`.** Caused by combining a dynamic `await import(...)` with a `toBeInstanceOf(GraphConcurrencyError)` call in the same scope — ESLint's flat config couldn't see the locally-scoped destructured binding as a declared identifier. Initial attempt at a type-only alias import (`GraphConcurrencyError as GraphConcurrencyErrorType`) kept the cast `(err as GraphConcurrencyErrorType).message` but lost the runtime identity for `toBeInstanceOf`. Final solution pairs a top-level `import type { GraphConcurrencyError }` (for the `as` cast) with an inline `const { GraphConcurrencyError: GraphConcurrencyErrorClass } = await import(...)` (for the runtime `toBeInstanceOf` check). See Deviation #1 above.

2. **Pre-existing 4 spawn-test failures in `test/public-url-failfast.test.ts` + `test/startup-validation.test.ts`.** Documented in 02-01 and 02-03 summaries as pre-existing; verified again on this plan by `git stash` + running the two test files in isolation on the base commit. Same 4 failures, same pattern (spawned tsx subprocess exits `null` in this environment due to timeout). Not caused by plan 02-07 and out of scope per the deviation rules (scope boundary: only fix issues DIRECTLY caused by the current task). Logged for awareness; left untouched.

## User Setup Required

None — no external service configuration required. The ETag middleware is a pure transport-layer addition; runtime behavior for existing Graph calls is either identical (unsupported resources pass through unchanged) or strictly better (supported resources auto-attach If-Match when a prior GET seeded the cache, enabling optimistic concurrency with zero tool-layer changes). AI callers that want the new optimistic-concurrency semantics on DriveItem/Event/Message/Contact get them transparently. AI callers that want last-writer-wins can pass `If-Match: 'null'` through `options.headers` as the escape hatch.

## Next Phase Readiness

### What Phase 3 (multi-tenant) MUST do before going live

- **Extend the ETag cache key from resource-path-only to `(tenantId, resourceType, resourceId)`** per T-02-07e disposition. Currently the module-level `etagCache` is keyed by the matched resource path (e.g. `/me/events/abc`). In Phase 2 single-tenant this is safe; in Phase 3 multi-tenant a cache entry written by tenant A's GET could be auto-attached to tenant B's PATCH if the resource path collides (unlikely in practice — tenants have distinct `/users/{id}/...` paths — but a tenant A write to `/me/events/abc` for user-A and tenant B write to `/me/events/abc` for user-B share the cache key since `me` aliases differ per token).
- **Implementation sketch for Phase 3:** change `cacheSet(resourceKey, etag)` / `cacheGet(resourceKey)` to take a composite key `${tenantId}:${resourceKey}`. The `tenantId` is already in `RequestContext` (set to `null` in Phase 2; populated by the Phase 3 router). Read via `requestContext.getStore()?.tenantId` at middleware execution time. Single-line change per cache op; existing tests continue to pass with `tenantId=null` key prefix.

### What Phase 5 (tool-surface refactor) should add

- **Explicit `ifMatch` / `ifNoneMatch` Zod tool params** as sugar over the headers-map passthrough. Today, callers set these via `options.headers = { 'If-Match': '...' }` which works but doesn't appear in the tool's JSON Schema. Phase 5 adds:
  - Optional `ifMatch?: string | 'null'` parameter on every tool that targets an ETag-supported resource (registerGraphTools iterates endpoints; Phase 5 can gate the param on `endpointsData.find(e => e.toolName === tool.alias)?.supportsEtag === true` once the JSON catalog gains that flag).
  - Same for `ifNoneMatch?: string` on GET tools (RFC 7232 semantics: return 304 if match).
  - Translation happens in `executeGraphTool`: map the typed param to `options.headers['If-Match'] = value` BEFORE calling `graphClient.graphRequest`. The middleware chain then behaves exactly as today.
- **Surface ETag round-trip in tool descriptions** — the `llmTip` field for ETag-supported tools should mention "Pass `ifMatch` from the `_etag` you received on the prior GET for optimistic concurrency."

### What Phase 6 (observability) inherits

- **OTel span `graph.middleware.etag` with 4 boolean attributes** (`explicit` / `autoAttached` / `optedOut` / `cached`) — ready for dashboard consumption. Phase 6 OPS can add a Prometheus counter `mcp_graph_etag_auto_attached_total` by sampling the span-attribute boolean across collectors.
- **No log statements in ETag middleware** — deliberately silent on the hot path. If Phase 6 needs ETag-aware log lines, the existing OTel span attributes are the right surface; pino log lines would fire on every PATCH/DELETE and drown out the retry / error signal.

### Chain-order invariant enforced

```
[ETag (02-07), Retry (02-02), ODataError (02-03), TokenRefresh (02-01)]
  outermost                                              innermost
```

The structural test in `test/etag-middleware.test.ts` is now the regression guard for this shape. Any future middleware (Phase 6 circuit-breaker, Phase 6 per-tenant rate limiter) that reshuffles the array will fail the test at PR time.

### Blockers / concerns

None. MWARE-06 is complete. The Phase 2 middleware pipeline is fully assembled. Phase 3 + Phase 5 each have ONE single-line action item called out above (cache-key extension; Zod param sugar) — no architectural rework required.

## Self-Check: PASSED

**Files created — verified existing:**
- `src/lib/middleware/etag.ts` — FOUND
- `test/etag-middleware.test.ts` — FOUND

**Commits — verified in git log:**
- `0ec622a` — test(02-07): Wave 0 RED tests for ETagMiddleware — MWARE-06 — FOUND
- `62d65f2` — feat(02-07): implement ETagMiddleware + resourceKeyFromUrl + LRU etagCache — FOUND
- `ba07593` — feat(02-07): wire ETagMiddleware as outermost in GraphClient pipeline — FOUND

**Verification greps — all match plan contract:**
- `grep -c 'export class ETagMiddleware' src/lib/middleware/etag.ts` → 1
- `grep -c 'export function resourceKeyFromUrl' src/lib/middleware/etag.ts` → 1
- `grep -c 'ETAG_SUPPORTED_PATTERNS' src/lib/middleware/etag.ts` → 3 (definition + iteration + JSDoc reference; plan required ≥2)
- `grep -c 'new ETagMiddleware' src/graph-client.ts` → 1 (pipeline array element)
- `grep -c 'CACHE_MAX_SIZE' src/lib/middleware/etag.ts` → 4 (definition + check + JSDoc references; plan required ≥2)
- Chain order check: `grep -B1 'new RetryHandler' src/graph-client.ts` shows `new ETagMiddleware(),` on the preceding line — PASS

**Test results:**
- 8 new Phase 2.07 tests GREEN (4 unit + 1 integration + 2 resourceKeyFromUrl + 1 structural regression)
- 358 previously-passing tests still GREEN (verified via full-suite run)
- Full suite: 366 tests pass / 4 pre-existing spawn-test failures (test/public-url-failfast.test.ts + test/startup-validation.test.ts — verified pre-existing via git stash + rerun on base commit, same 4 as 02-01 / 02-03 summaries document)

**Build pipeline:**
- `npm run lint` → 0 errors, 59 pre-existing warnings (unchanged from base)
- `npm run format:check` → all files pass
- `npm run build` → tsup build success (`dist/lib/middleware/etag.js` 3.2 KB emitted)

**Success criteria from plan (all MET):**
- [x] `src/lib/middleware/etag.ts` exists with ETagMiddleware + resourceKeyFromUrl + LRU-capped etagCache
- [x] Explicit caller-supplied If-Match forwarded verbatim
- [x] Auto-attach If-Match on PATCH/DELETE to supported resources from prior GET cache
- [x] Cache refresh on successful GET to supported resources
- [x] Opt-out sentinel `If-Match: 'null'` strips header AND skips auto-attach
- [x] Unsupported resources pass through (no-op)
- [x] 412 surfaces as GraphConcurrencyError via ODataErrorHandler (integration-verified)
- [x] ETagMiddleware is the OUTERMOST middleware in the pipeline
- [x] Cache capped at 1000 entries with insertion-order eviction
- [x] 8 tests in test/etag-middleware.test.ts pass (plan expected 7; the structural regression test makes it 8)
- [x] Lint clean, format clean, build success, full suite regression clean (same 4 pre-existing failures)

---
*Phase: 02-graph-transport-middleware-pipeline*
*Completed: 2026-04-19*
