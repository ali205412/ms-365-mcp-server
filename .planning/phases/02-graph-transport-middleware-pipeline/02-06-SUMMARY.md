---
phase: 02-graph-transport-middleware-pipeline
plan: "06"
subsystem: api

tags:
  - upload-session
  - resumable-upload
  - 320kib-alignment
  - next-expected-ranges
  - 416-recovery
  - body-parser-limit
  - chunk-put-no-auth
  - drive-item
  - mware-05
  - graph-upload-large-file

# Dependency graph
requires:
  - phase: 02-graph-transport-middleware-pipeline
    provides: "middleware pipeline scaffold + composePipeline (02-01) — session creation POST routes through the FULL chain; _skipRetry marker reserved on GraphRequest type (02-01) for future use; typed GraphError hierarchy + parseODataError helper (02-03) — non-retryable 4xx on chunk PUTs rethrown as typed GraphError; RetryHandler (02-02) does NOT see chunk PUTs because those bypass graphClient entirely (per D-08 + T-02-06d); BatchClient helper-placement pattern (02-05) reused for UploadSessionHelper organizational symmetry"
provides:
  - upload-session-helper
  - align-chunk-size-helper
  - parse-next-expected-ranges-helper
  - progress-iterator
  - chunk-put-direct-fetch-no-auth
  - body-parser-limit-raise
  - graph-upload-large-file-mcp-tool
  - ms365-mcp-body-parser-limit-env
  - ms365-mcp-upload-chunk-size-bytes-env
affects:
  - src/graph-tools.ts
  - src/server.ts
  - src/lib/upload-session.ts
  - .env.example
  - test/tool-filtering.test.ts
  - test/read-only.test.ts
  - test/calendar-view.test.ts
  - Phase 3 (per-tenant admin may override MS365_MCP_BODY_PARSER_LIMIT per tenant)
  - Phase 5 (tool-surface refactor will wire the progress iterator to MCP tool-level progress notifications)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Helper-that-bypasses-the-chain for chunk PUTs: direct global `fetch` call without Authorization header (uploadUrl is pre-authenticated; attaching Authorization returns 401 — T-02-06d). Session creation POST STILL goes through the full pipeline; only per-chunk PUTs bypass."
    - "Progress via AsyncGenerator: uploadLargeFileIter yields `{ bytesSent, totalBytes }` on every successful chunk commit, returns DriveItem as the iterator's final value. uploadLargeFile is a thin wrapper that consumes the iterator and discards progress events."
    - "320 KiB chunk alignment — alignChunkSize snaps DOWN to nearest 327,680-byte multiple (Graph wire-format requirement); clamps to 60 MiB hard cap; falsy / non-finite / zero input floors to one alignment unit (test contract — callers who want the documented 3.125 MB sweet spot pass DEFAULT_CHUNK_SIZE explicitly or unset the env var)."
    - "Resume protocol for transient failures: on 5xx or 416 from a chunk PUT, the helper GETs the session URL to read authoritative `nextExpectedRanges`; if the response body carries an `id` field the upload already completed server-side (recovery path per Graph docs Example 6). Max 3 resume attempts per chunk (T-02-06e livelock prevention)."
    - "JSON-safe typed-error projection at the MCP tool boundary — same pattern as 02-05 graph-batch; `JSON.stringify(Error)` emits `{}` because Error fields are non-enumerable, so the handler explicitly projects `{ code, statusCode, requestId, clientRequestId, date }` into the response text."
    - "Session URL never logged (T-02-06a — uploadUrl is a pre-authenticated Graph session URL; leaking it is a session-hijack vector). Helper logs at info on creation / completion with `{ chunkSize, totalBytes, totalChunks }` and at warn on each 5xx / 416 recovery with `{ status, offset, attempt }` — never the URL."

key-files:
  created:
    - src/lib/upload-session.ts
    - test/upload-session.test.ts
    - .planning/phases/02-graph-transport-middleware-pipeline/02-06-SUMMARY.md
  modified:
    - src/server.ts
    - src/graph-tools.ts
    - .env.example
    - test/tool-filtering.test.ts
    - test/read-only.test.ts
    - test/calendar-view.test.ts

key-decisions:
  - "Module placement: src/lib/upload-session.ts (flat in lib/, NOT under lib/middleware/). Rationale: UploadSessionHelper is NOT a GraphMiddleware — no `execute(req, next)` surface. The three module placements across Phase 2 are now: lib/middleware/*.ts for classes that implement GraphMiddleware (02-01 token-refresh, 02-02 retry, 02-03 odata-error, 02-07 etag); lib/middleware/page-iterator.ts + batch.ts for helpers-that-call-through-the-chain (02-04, 02-05 — kept under middleware/ for organizational symmetry at the time); lib/upload-session.ts FLAT under lib/ because this helper explicitly BYPASSES the chain for chunk PUTs (per D-08 + T-02-06d) — placing it under middleware/ would mislead readers into thinking it composes into the chain."
  - "alignChunkSize zero-input behavior: floors to ONE alignment unit (327,680 bytes), NOT to DEFAULT_CHUNK_SIZE. The test contract from the plan asserts `alignChunkSize(0) === 327_680`. The action-code snippet in the plan used `requested || DEFAULT_CHUNK_SIZE` which contradicts the documented behavior; implementation follows the behavior contract. Callers who want the 3.125 MB sweet spot pass DEFAULT_CHUNK_SIZE explicitly — the UploadSessionOptions.chunkSize resolver does this via `chunkSizeFromEnv()` which returns DEFAULT_CHUNK_SIZE on missing env."
  - "Chunk PUTs use direct global `fetch` (Option B per the plan), NOT graphClient.graphRequest with `_skipRetry: true`. Reasons: (1) graphClient.performRequest unconditionally attaches `Authorization: Bearer ...` — would force Graph to return 401 on pre-authenticated uploadUrl (T-02-06d); (2) Content-Range header shape is not OData 2xx and would confuse ODataErrorHandler on intermediate 202 responses; (3) resume loop handles retry at byte-offset granularity and RetryHandler would double-retry. The `_skipRetry` marker on GraphRequest (02-01) stays wired but unused by this plan — reserved for future callers."
  - "Chain interaction split: session creation POST (`/createUploadSession`) goes through the FULL middleware chain (ETag → Retry → ODataError → TokenRefresh) because the helper calls `graphClient.graphRequest()`. Only per-chunk PUTs bypass. 4xx non-retryable responses on chunk PUTs are parsed via `parseODataError` (direct import from 02-03's graph-errors module) so callers still get typed GraphError — the helper re-implements just the throwing, not the parsing."
  - "Max 3 resume attempts per chunk (MAX_RESUME_ATTEMPTS constant, T-02-06e). Matches D-05's overall retry cap. On the 4th consecutive 5xx / 416 for the SAME chunk, helper throws the parsed GraphError (typed GraphServerError for 5xx, bare GraphError for 416 since 416 is not in the subclass selector). Ceiling prevents livelock against pathological Graph infrastructure or a corrupted session."
  - "Final commit fetch: after the chunk loop exits with `offset >= totalBytes` but without a 200/201 DriveItem response, helper does one final GET of the session URL to retrieve the DriveItem. Covers the 416-recovery happy path where the server already has all bytes and responds to status GETs with the DriveItem envelope directly (Graph docs Example 6)."
  - "Body-parser raise applies to both json and urlencoded middleware in lockstep. Default '60mb' is the D-08 chunk ceiling; operators needing higher set MS365_MCP_BODY_PARSER_LIMIT. The plan's `express.raw({ limit: bodyParserLimit, type: '*/*' })` mount is NOT added in this plan — Phase 2 has no raw-bound endpoint; the raw() configuration will land when Phase 3 adds the HTTP-mode upload route (the plan's body-parser block explicitly notes this)."
  - "graph-upload-large-file MCP tool: registered after graph-batch with the same skip-in-readOnly gate. Zod schema hard-caps chunkSize at MAX_CHUNK_SIZE_BYTES (60 MiB) to protect clients from hitting Graph's reject-on-too-big path. Handler dynamic-imports `src/lib/upload-session.js` so the upload module stays out of the graph-tools module graph for deployments that never enable the tool (same lazy-load as 02-04 page-iterator and 02-05 batch)."
  - "Error envelope projection: typed GraphError fields are explicitly projected into a JSON-safe payload (code, statusCode, requestId, clientRequestId, date) because `JSON.stringify(Error)` emits `{}` (Error fields are non-enumerable by spec). Same pattern as 02-05 graph-batch handler. AI clients can branch on `error.statusCode` / `error.code` client-side."

patterns-established:
  - "Helper that EXPLICITLY bypasses the middleware chain for a protocol-specific subset (chunk PUTs) while routing the protocol's outer shape (session creation POST) through the chain. Applied here for UploadSession; anti-pattern to generalize beyond protocols that require headerless / pre-authenticated URLs (i.e., this is a one-off tailored to Graph's resumable-upload contract, not a template for new middleware-bypassing helpers)."
  - "Contract-wins-over-code snippets: when a plan's behavior table and action-code snippet disagree (here, alignChunkSize(0) = 327_680 in the contract vs = 3_276_800 in the code sample), the contract wins and implementation matches the test. Logged as a deviation (Rule 1 — test contract is the source of truth)."
  - "File placement by architectural role: GraphMiddleware classes → lib/middleware/; helpers that CALL through the chain → lib/middleware/ for organizational symmetry (02-04, 02-05 precedent); helpers that explicitly BYPASS the chain → lib/ (this plan). The placement signals intent to future readers."
  - "Env-driven runtime tuning on critical-size parameters (MS365_MCP_BODY_PARSER_LIMIT for inbound body size, MS365_MCP_UPLOAD_CHUNK_SIZE_BYTES for outbound chunk size) — both documented in .env.example with the contract, default, and safe range. Operators can tune without recompiling."

requirements-completed:
  - MWARE-05

# Metrics
duration: ~10min
completed: 2026-04-19
---

# Phase 02 Plan 06: UploadSessionHelper + graph-upload-large-file MCP Tool Summary

**Resumable Graph upload helper (320 KiB-aligned chunks, nextExpectedRanges resume protocol, 416 recovery, direct-fetch chunk PUTs without Authorization) plus graph-upload-large-file MCP tool that exposes the helper to AI clients — closes MWARE-05 and raises Express body-parser limit to 60 MiB in lockstep (MS365_MCP_BODY_PARSER_LIMIT).**

## Performance

- **Duration:** ~10 min wall-clock (RED tests + implement helper + body-parser raise + register tool + regression-fix tool-count tests)
- **Started:** 2026-04-19T11:36:32Z
- **Completed:** 2026-04-19T11:46:07Z
- **Tasks:** 3 (Task 1 RED tests, Task 2 implement upload-session.ts, Task 3 body-parser + .env + MCP tool + tool-count test regressions)
- **Files created:** 3 (1 src + 1 test + 1 summary)
- **Files modified:** 6 (src/server.ts + src/graph-tools.ts + .env.example + 3 tool-count tests)
- **Commits:** 3 atomic + this summary commit

## Accomplishments

- **MWARE-05 closed:** resumable Graph upload helper with the four D-08 invariants — 320 KiB alignment, nextExpectedRanges resume, 416 recovery, no-Authorization chunk PUTs — delivered end-to-end from helper to MCP tool.
- **No-Authorization chunk PUTs** (T-02-06d): chunk PUTs call `fetch(uploadUrl, { method: 'PUT', body, headers: { 'Content-Length', 'Content-Range' } })` — NO Authorization header, NO graphClient routing. The uploadUrl is pre-authenticated; attaching Authorization would force Graph to return 401. Verified by the "chunk PUTs do NOT include Authorization header" test.
- **5xx + 416 resume protocol** (D-08, T-02-06c): on any 5xx or 416 from a chunk PUT, helper GETs the session URL to read authoritative `nextExpectedRanges`. If the status response carries an `id` field, the upload already completed server-side (recovery path per Graph docs Example 6). Otherwise parse the ranges and resume from the first reported offset. Max 3 resume attempts per chunk (T-02-06e).
- **Progress iterator** (D-08 discretion): `uploadLargeFileIter` is an AsyncGenerator yielding `{ bytesSent, totalBytes }` per chunk commit and returning the DriveItem as the iterator's final value. `uploadLargeFile` is a thin wrapper that consumes the iterator; Phase 5's tool-surface refactor will wire the progress events into MCP's tool-level progress notification channel.
- **320 KiB chunk alignment** with 60 MiB hard cap: `alignChunkSize` snaps DOWN to nearest 327,680 multiple. Zero / non-finite input floors to ONE alignment unit (test contract — the implementation follows the behavior contract, NOT the plan's action-code snippet which returned DEFAULT_CHUNK_SIZE for zero input).
- **Body-parser raise** (CONCERNS.md "Express body-parser 100 KB default"): `express.json({ limit })` and `express.urlencoded({ extended: true, limit })` in src/server.ts now honor `MS365_MCP_BODY_PARSER_LIMIT` (default '60mb'). Raise is in lockstep with D-08 chunk ceiling so base64-encoded upload payloads pass through HTTP transport without triggering 413.
- **graph-upload-large-file MCP tool:** registered in src/graph-tools.ts with Zod schema `{ driveItemPath, contentBase64, chunkSize?, conflictBehavior?, fileName? }`. Handler dynamic-imports the helper, decodes base64, surfaces the DriveItem on success, projects typed GraphError fields to JSON-safe shape on failure. Skipped in read-only mode (upload is a write).
- **Pipeline interaction split**: session creation POST routes through the FULL middleware chain (ETag → Retry → ODataError → TokenRefresh) because the helper calls `graphClient.graphRequest()`. Only per-chunk PUTs bypass. 4xx non-retryable responses on chunk PUTs still surface as typed GraphError via direct `parseODataError` call.
- **Zero regression:** 408 tests pass (up from 403 at 02-05 baseline; 5 new upload-session tests + 3 tool-count test +1 updates). Same 4 pre-existing spawn-test failures in test/public-url-failfast.test.ts and test/startup-validation.test.ts — verified pre-existing by git-stashing all changes and re-running on the base commit; unchanged from 02-01 summary documentation.

## Task Commits

1. **Task 1: Wave 0 RED tests** — `b8437ce` (test)
   - `test/upload-session.test.ts` (194 lines, 5 tests) — covers `alignChunkSize` boundary conditions, `parseNextExpectedRanges` open-ended + closed forms, chunk PUT no-Authorization, 5xx resume via nextExpectedRanges, and 416 recovery via session GET.
   - All RED because `src/lib/upload-session.js` did not exist yet.

2. **Task 2: Implement UploadSessionHelper + pure helpers + progress iterator** — `e89fe6f` (feat)
   - `src/lib/upload-session.ts` (~318 lines) — exports `CHUNK_SIZE_ALIGNMENT`, `DEFAULT_CHUNK_SIZE`, `MAX_CHUNK_SIZE` constants; `alignChunkSize`, `parseNextExpectedRanges`, `UploadSessionHelper`, `UploadProgress`, `UploadSessionOptions`, `DriveItem` interfaces + class.
   - All 5 tests GREEN; lint 0 errors; build success (dist/lib/upload-session.js emitted at 6.58 KB).
   - One auto-fix inside this commit: test contract enforced over plan's action-code snippet (zero input floors to alignment unit, not DEFAULT_CHUNK_SIZE).
   - One auto-fix inside this commit: test file lint error (`RequestInit` is a DOM type not in Node's default types) replaced with inline structural type `{ headers?: Record<string, string> }`.

3. **Task 3: body-parser raise + .env.example + graph-upload-large-file tool + tool-count test regressions** — `c5544d1` (feat)
   - `src/server.ts`: express.json + express.urlencoded now read `MS365_MCP_BODY_PARSER_LIMIT` env (default '60mb'). Rationale comment block on the new constant.
   - `.env.example`: documents `MS365_MCP_BODY_PARSER_LIMIT` (default 60mb) and `MS365_MCP_UPLOAD_CHUNK_SIZE_BYTES` (default 3276800) with full contract + range notes.
   - `src/graph-tools.ts`: registers `graph-upload-large-file` tool after `graph-batch`, skipped in readOnly mode. Hardcoded local `MAX_CHUNK_SIZE_BYTES` constant in the Zod schema to avoid pulling `src/lib/upload-session.ts` into the graph-tools module graph for deployments that never use the upload tool. Handler dynamic-imports `UploadSessionHelper` inside the async tool function.
   - `test/tool-filtering.test.ts` (2 assertions), `test/read-only.test.ts` (1 assertion), `test/calendar-view.test.ts` (1 iteration skip): tool-count regressions updated +1 for the new global tool (same Rule 1 auto-fix pattern as 02-05's graph-batch landing).

_(No separate REFACTOR commit — Task 2 shipped on first pass after the alignChunkSize zero-input contract fix; Task 3 shipped on first pass after the Prettier reformatter auto-cleaned line wrapping.)_

## Files Created/Modified

### Created

- **`src/lib/upload-session.ts`** (~318 lines) — the upload helper. Exports:
  - `CHUNK_SIZE_ALIGNMENT` (320 × 1024 = 327,680), `DEFAULT_CHUNK_SIZE` (× 10 = 3,276,800), `MAX_CHUNK_SIZE` (60 × 1024 × 1024 = 62,914,560) constants.
  - `alignChunkSize(requested: number): number` — pure function; snaps DOWN to nearest alignment; clamps to MAX; zero floors to one unit.
  - `parseNextExpectedRanges(ranges: string[]): Array<{ start: number; end?: number }>` — pure function; handles open-ended (`'77829-'`) and closed (`'12345-55232'`) forms.
  - `UploadProgress`, `UploadSessionOptions`, `DriveItem` type exports.
  - `UploadSessionHelper` class with `uploadLargeFile` (Promise resolution) and `uploadLargeFileIter` (AsyncGenerator yielding progress) methods.
  - Internal helpers: `formatContentRange`, `chunkSizeFromEnv`.
  - Module-level JSDoc explaining the lifecycle, the chain-bypass rationale (3 bullet points: no-auth, Content-Range shape, double-retry), the memory model (Buffer input + one chunk resident), and the observability posture (session URL never logged, T-02-06a).
  - Analog: `src/lib/middleware/batch.ts` (02-05 helper-that-calls-through-the-chain docstring pattern — adapted here for a helper-that-bypasses).
- **`test/upload-session.test.ts`** (~194 lines, 5 tests) — covers the four invariants. Uses the existing `vi.mock('../src/logger.js', ...)` pattern. Uses `vi.stubGlobal('fetch', fetchSpy)` to intercept chunk PUTs and the session-status GETs; mock GraphClient returns a canned createUploadSession envelope. Analog: `test/batch-client.test.ts` (02-05 mock-client pattern).

### Modified

- **`src/server.ts`** (lines 545-556): body-parser limits. `express.json({ limit })` and `express.urlencoded({ extended: true, limit })` now read `process.env.MS365_MCP_BODY_PARSER_LIMIT || '60mb'`. 10-line comment block above the assignment explains the rationale (MWARE-05 large uploads, default 60mb, deferred raw() until Phase 3 HTTP-mode upload route).
- **`src/graph-tools.ts`**: registered `graph-upload-large-file` tool after `graph-batch`. Skipped in read-only mode (upload is a write). Zod schema accepts `driveItemPath`, `contentBase64` (required) + `chunkSize`, `conflictBehavior`, `fileName` (optional). Handler dynamic-imports `UploadSessionHelper`, decodes base64, calls `uploadLargeFile`, surfaces DriveItem on success, projects typed GraphError fields to JSON-safe shape on failure. +~105 lines including the tool block and a local `MAX_CHUNK_SIZE_BYTES` constant.
- **`.env.example`**: appended a new "Upload session — Plan 02-06 / MWARE-05" section documenting `MS365_MCP_UPLOAD_CHUNK_SIZE_BYTES` (default 3,276,800; 320 KiB aligned; 60 MiB cap per chunk) and `MS365_MCP_BODY_PARSER_LIMIT` (default '60mb'; accepts express body-parser size strings).
- **`test/tool-filtering.test.ts`**: 7 → 8 in two assertions (full-registration count + invalid-regex fallback count). Comment notes the +1 is Plan 02-06 graph-upload-large-file.
- **`test/read-only.test.ts`**: 6 → 7 in the non-readOnly full-registration assertion. Comment notes the +1 is Plan 02-06 graph-upload-large-file.
- **`test/calendar-view.test.ts`**: added `if (toolName === 'graph-upload-large-file') continue;` alongside the existing `parse-teams-url` and `graph-batch` skips in the fetchAllPages-parameter iteration.

## Decisions Made

_All captured in the frontmatter `key-decisions` list. Load-bearing expansions:_

- **Helper placement outside lib/middleware/**. This is NOT a GraphMiddleware — no `execute(req, next)` surface. It is also NOT a helper-that-calls-through-the-chain (02-04's page-iterator, 02-05's batch). It is a helper that EXPLICITLY BYPASSES the chain for chunk PUTs. Placing it under `lib/middleware/` would mislead readers into thinking it composes with the chain — flat under `lib/` signals the bypass intent.
- **Contract wins over code snippet.** The plan's behavior table says `alignChunkSize(0) = 327_680` (minimum alignment unit). The plan's action-code snippet uses `requested || DEFAULT_CHUNK_SIZE` which would return DEFAULT_CHUNK_SIZE for zero input. Test case asserts the contract. Implementation follows the contract; logged as Rule 1 auto-fix (test contract is source of truth).
- **Chunk PUTs use direct global `fetch`, not graphClient.** Three reasons:
  1. `graphClient.performRequest` unconditionally adds `Authorization: Bearer ...`. uploadUrl is pre-authenticated — adding Authorization forces Graph to return 401 (T-02-06d).
  2. `Content-Range` header on an intermediate 202 response is not OData 2xx shape; ODataErrorHandler in the chain would misparse it.
  3. Resume loop handles retry at byte-offset granularity; RetryHandler in the chain would double-retry chunks we already committed (chain fighting the resume protocol per D-08 anti-pattern).
  The `_skipRetry` marker (02-01) is NOT used here — direct fetch bypasses the chain completely. The marker stays wired for future callers (e.g., a GET that must never retry).
- **Session creation POST routes through FULL chain.** `graphClient.graphRequest('...createUploadSession', 'POST')` — so Retry/ODataError/TokenRefresh all apply to the session-creation round-trip. A 429 on session creation retries; a 401 refreshes; a 500 retries. Only per-chunk PUTs bypass.
- **4xx on chunk PUTs still produce typed GraphError.** The helper imports `parseODataError` from `src/lib/graph-errors.ts` (02-03's zero-dependency pure module) and calls it directly in the non-retryable 4xx branch. Callers receive the same typed error shape whether the failure was at session creation (through the chain) or at chunk PUT (bypassing the chain).
- **Max 3 resume attempts per chunk.** `MAX_RESUME_ATTEMPTS = 3`. On the 4th consecutive 5xx/416 for the SAME chunk, the helper throws. Matches D-05's overall retry cap. T-02-06e mitigation against a pathological server that keeps returning 500 + unchanging `nextExpectedRanges`.
- **Progress iterator is async generator**, consumed by the Promise API via a `do/while` loop. The iterator yields progress on both (a) successful 202 intermediate chunks with advancing offset and (b) the final 200/201 with DriveItem (last progress event is `bytesSent=totalBytes` right before `return`). Phase 5 will wire this into MCP tool-level progress notifications.
- **JSON-safe error projection at the MCP tool boundary.** Same as 02-05: `JSON.stringify(Error)` emits `{}` because Error fields are non-enumerable by spec. Handler explicitly projects `{ code, statusCode, requestId, clientRequestId, date }` into the response text so AI clients see the structured context.
- **Body-parser raise covers both json + urlencoded** in lockstep. `express.raw({ limit })` is NOT mounted in this plan — Phase 2 has no raw-bound endpoint; the plan's block explicitly defers raw() to Phase 3 when an HTTP-mode upload route lands.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test-Contract-vs-Action-Code-Snippet] alignChunkSize zero-input behavior**
- **Found during:** Task 2 (after first implementation pass, running `npx vitest run test/upload-session.test.ts`)
- **Issue:** The plan's behavior contract in the `<behavior>` block asserts `alignChunkSize(0) === 327_680` (minimum = one alignment unit). The plan's action-code sample in the `<action>` block used `requested || DEFAULT_CHUNK_SIZE` which returns 3,276,800 for zero input. I initially copied the action code verbatim; the test failed with `expected 3276800 to be 327680`.
- **Fix:** Changed the alignChunkSize entry guard from `requested || DEFAULT_CHUNK_SIZE` to `Number.isFinite(requested) && requested > 0 ? requested : 0`. Zero input → `base=0` → `clamped=0` → `aligned=0` → the final ternary `aligned > 0 ? aligned : CHUNK_SIZE_ALIGNMENT` returns one alignment unit. Callers who want the documented 3.125 MB sweet spot pass DEFAULT_CHUNK_SIZE explicitly; the `UploadSessionOptions.chunkSize` resolver at the iterator entry point does this via `chunkSizeFromEnv()` (which returns DEFAULT_CHUNK_SIZE on missing env).
- **Files modified:** `src/lib/upload-session.ts` (alignChunkSize body and JSDoc).
- **Verification:** All 5 upload-session tests GREEN; specifically the 4-case `alignChunkSize` test passed on all 4 inputs (500_000 → 327_680; 3_276_800 → 3_276_800; 100_000_000 → 62_914_560; 0 → 327_680).
- **Committed in:** `e89fe6f` (Task 2 feat commit, bundled with the implementation the fix made correct).

**2. [Rule 1 — Test Lint Bug] RequestInit not defined in Node context**
- **Found during:** Task 2 verification (running `npm run lint` after first pass of tests + implementation)
- **Issue:** The test file cast `call[1] as RequestInit` to type the fetch init argument. `RequestInit` is a DOM type that is not part of Node's default types and not surfaced by the eslint/tsconfig setup — lint reported `'RequestInit' is not defined  no-undef`.
- **Fix:** Replaced the cast with an inline structural type that captures only the headers access the test needs: `call[1] as { headers?: Record<string, string> }`. Behaviorally equivalent for this assertion.
- **Files modified:** `test/upload-session.test.ts` (chunk-PUT-no-auth test, line 108).
- **Verification:** `npm run lint` → 0 errors (59 pre-existing `no-explicit-any` warnings, all in other files, unchanged). Test still GREEN.
- **Committed in:** `e89fe6f` (Task 2 feat commit, bundled with the other fix).

**3. [Rule 1 — Test-Count Regression from New Global Tool] Tool-count tests out of date after graph-upload-large-file registration**
- **Found during:** Task 3 (after registering the tool; ran tool-filtering + read-only + calendar-view tests)
- **Issue:** Same shape as the 02-05 auto-fix — three tests hard-coded expected tool counts based on the pre-plan registration shape. Adding graph-upload-large-file (a new global MCP tool, not a per-endpoint wrapper) made the counts wrong.
- **Fix:** `test/tool-filtering.test.ts` counts 7 → 8 in two assertions; `test/read-only.test.ts` non-readOnly count 6 → 7; `test/calendar-view.test.ts` fetchAllPages iteration skips graph-upload-large-file alongside the existing `parse-teams-url` and `graph-batch` skips. Comments in each updated test cite Plan 02-06 so future readers know where the +1 came from.
- **Files modified:** `test/tool-filtering.test.ts` (2 assertions), `test/read-only.test.ts` (1 assertion), `test/calendar-view.test.ts` (1 iteration skip).
- **Verification:** All previously-failing tests now GREEN; full regression suite unchanged (same 4 pre-existing spawn-test failures only).
- **Committed in:** `c5544d1` (Task 3 feat commit, bundled with the graph-upload-large-file registration that caused the count shift).

---

**Total deviations:** 3 auto-fixed (1 test-contract discrepancy, 1 test lint fix, 1 test-count regression).
**Impact on plan:** All three preserve the plan's architectural intent. The alignChunkSize fix honors the plan's behavior contract over its example code; the RequestInit replacement is a mechanical lint fix; the test-count update is unavoidable whenever a new global tool lands and follows the exact same pattern 02-05 established. No scope creep.

## Issues Encountered

1. **Plan file not present in worktree's .planning/ at base commit.** `.planning/phases/02-graph-transport-middleware-pipeline/02-06-PLAN.md` did not exist in the worktree — only in the main working tree. Root cause: the PLAN.md for this plan was authored in the main working tree and never committed onto the base branch the worktree was cut from. **Resolution:** wrote a minimal stub PLAN.md into the worktree to preserve the frontmatter for SUMMARY traceability; the full plan content was read from `/home/yui/Documents/ms-365-mcp-server/.planning/phases/02-graph-transport-middleware-pipeline/02-06-PLAN.md` (absolute path) for execution. Not a deviation — the worktree's untracked-files state does not affect the code under execution. The stub is included in the docs commit for this summary.

2. **Generated client.ts missing from worktree.** `src/generated/client.ts` is gitignored (produced by `npm run generate`) and does not exist in fresh worktrees. Same issue the 02-03 and 02-05 summaries document. **Resolution:** copied `src/generated/client.ts` from the main working tree into the worktree before running tests. The generated file is large (658 KB / 552 KB minified) and regenerating via `npm run generate` is slow; this pattern is the accepted workaround across Phase 2 plans. No code change made.

3. **Pre-existing spawn-test failures.** 4 tests in `test/public-url-failfast.test.ts` + `test/startup-validation.test.ts` continue to fail because their spawned `tsx` subprocesses time out in this environment and return `null` exit code. Verified pre-existing at the base commit by `git stash` + re-run — same 4 failures with NO changes in the working tree. NOT caused by this plan; out of scope per deviation rules. Same 4 failures documented in 02-01, 02-03, 02-04, 02-05 summaries.

4. **Plan verification grep `Authorization in upload-session.ts == 0` is too strict.** The source file has 4 string matches for "Authorization" — ALL in JSDoc / comments explaining WHY the helper does NOT attach an Authorization header. The actual chunk-PUT headers object contains only `Content-Length` and `Content-Range` — no Authorization key — and the behavior is verified by the test "chunk PUTs do NOT include Authorization header". The grep check conflates documentation presence with behavioral presence; accepted as a nuance of the verification rule. The behavior is correct.

## User Setup Required

None — no external service configuration required. The body-parser limit and chunk-size env vars are optional with safe defaults ('60mb' and 3,276,800 respectively). The `graph-upload-large-file` MCP tool is auto-registered when `readOnly=false` (default) and there is no enabled-tools filter excluding it.

## Next Phase Readiness

### What Phase 3 (multi-tenancy) should read first

- **`src/server.ts`** body-parser block (lines 545-556) — Phase 3 per-tenant admin may override `MS365_MCP_BODY_PARSER_LIMIT` per tenant if per-tenant upload quotas differ. Default '60mb' is single-tenant appropriate.
- **`src/lib/upload-session.ts`** module docstring — Phase 3 should understand that session URLs are in-function-scope only, never cached or logged (T-02-06a / T-02-06g). When Phase 3 adds per-tenant audit logging, the audit must NOT capture the uploadUrl.

### What Phase 5 (tool-surface refactor) should read first

- **`src/lib/upload-session.ts`** `uploadLargeFileIter` method — the AsyncGenerator yields `{ bytesSent, totalBytes }` on every successful chunk commit. Phase 5's tool-surface refactor wires this into MCP's tool-level progress notification channel per the MCP spec. The Promise-returning `uploadLargeFile` method remains as the ergonomic default for callers that don't need progress.
- **`src/graph-tools.ts`** graph-upload-large-file handler — currently consumes the full Buffer end-to-end before returning. Phase 5 can refactor this handler to yield progress events through the MCP progress channel while still returning the final DriveItem envelope as the tool result.

### What Phase 6 (rate limiting) should read first

- **UploadSessionHelper resume-attempt ceiling (`MAX_RESUME_ATTEMPTS = 3`)** — per-chunk only. Phase 6 may add a per-tenant upload-bytes-per-minute budget that aggregates across chunks within a single session AND across sessions for a tenant. That policy lives in Phase 6's rate limiter middleware, NOT in this helper.

### Phase 2 status: 6 of 7 plans complete

After this plan, Phase 2 plans 02-01, 02-02, 02-03, 02-04, 02-05, 02-06, and 02-07 are complete. The chain-ordering invariant remains: `[ETag (02-07), Retry (02-02), ODataError (02-03), TokenRefresh (02-01)]` outermost-to-innermost. 02-06's UploadSessionHelper stands OUTSIDE this chain for chunk PUTs per D-08.

### Blockers / concerns

None. MWARE-05 is closed. The helper contract (signature of `UploadSessionHelper.uploadLargeFile`, `alignChunkSize` / `parseNextExpectedRanges` pure helpers, progress-iterator shape) is stable for Phase 5 to build on without modification.

## Self-Check: PASSED

**Files created — verified existing:**
- `src/lib/upload-session.ts` — FOUND
- `test/upload-session.test.ts` — FOUND
- `.planning/phases/02-graph-transport-middleware-pipeline/02-06-SUMMARY.md` — FOUND (this file)

**Commits — verified in git log:**
- `b8437ce` — test(02-06): Wave 0 RED tests for UploadSessionHelper — MWARE-05 — FOUND
- `e89fe6f` — feat(02-06): UploadSessionHelper — 320 KiB-aligned resumable upload (MWARE-05) — FOUND
- `c5544d1` — feat(02-06): register graph-upload-large-file MCP tool; raise body-parser limit to 60mb — FOUND

**Verification greps — all match plan contract except one documented-as-nuance:**
- `grep -c 'alignChunkSize' src/lib/upload-session.ts` → 2 (export + JSDoc @link)
- `grep -c 'CHUNK_SIZE_ALIGNMENT' src/lib/upload-session.ts` → 5 (definition + alignChunkSize use + JSDoc references + minimum-floor return + documentation table)
- `grep -c 'Authorization' src/lib/upload-session.ts` → 4 (all in module-level and inline JSDoc explaining the no-auth contract; actual chunk PUT headers object contains NO Authorization key — the plan's `== 0` expectation conflates documentation with behavior; verified behaviorally by the `chunk PUTs do NOT include Authorization header` test)
- `grep -c 'MS365_MCP_BODY_PARSER_LIMIT' src/server.ts` → 1 (the env-read assignment on line 554)
- `grep -c 'MS365_MCP_BODY_PARSER_LIMIT' .env.example` → 1 (in the Upload session section)
- `grep -c 'MS365_MCP_UPLOAD_CHUNK_SIZE_BYTES' .env.example` → 1 (in the Upload session section)
- `grep -c 'graph-upload-large-file' src/graph-tools.ts` → 8 (tool name + registration + description + log messages + handler name + title + type-hint key + skip message)
- `grep -c 'express.json({ limit' src/server.ts` → 1 (line 555)

**Test results:**
- 5 new Phase 2.06 tests GREEN (alignChunkSize + parseNextExpectedRanges + 3 UploadSessionHelper tests)
- 403 previously-passing tests still GREEN
- 3 tool-count test regressions auto-fixed (+1 for the new global tool) and GREEN
- Full suite: 408 tests pass / same 4 pre-existing spawn-test failures only (public-url-failfast + startup-validation)

**Build pipeline:**
- `npm run lint` → 0 errors, 59 pre-existing warnings (unchanged)
- `npm run format:check` → all files pass
- `npm run build` → tsup build success (dist/lib/upload-session.js emitted at 6.58 KB)

**Success criteria from plan (all MET):**
- [x] `src/lib/upload-session.ts` exists with UploadSessionHelper + alignChunkSize + parseNextExpectedRanges + progress iterator
- [x] Chunk size defaults to 3,276,800 bytes; aligned to 320 KiB; clamped to 60 MiB
- [x] Chunk PUTs bypass the pipeline and use direct fetch() without Authorization header
- [x] On 5xx, helper GETs session URL for nextExpectedRanges and resumes
- [x] On 416, same resume protocol
- [x] Max 3 resume attempts per chunk; exceeded throws typed GraphError
- [x] Session creation POST goes through the full middleware chain (retry + error parsing + auth)
- [x] Progress iterator yields { bytesSent, totalBytes }
- [x] `src/server.ts` body-parser `limit` raised via `MS365_MCP_BODY_PARSER_LIMIT` env (default 60mb)
- [x] `.env.example` documents `MS365_MCP_BODY_PARSER_LIMIT` + `MS365_MCP_UPLOAD_CHUNK_SIZE_BYTES`
- [x] MCP tool `graph-upload-large-file` registered in src/graph-tools.ts
- [x] 5 tests in test/upload-session.test.ts pass
- [x] `npm run verify` exits 0 for all steps except the 4 pre-existing spawn-test failures unrelated to this plan (generate + lint + format:check + build all pass; 408/412 tests pass with the 4 pre-existing failures documented in 02-01/02-03/02-04/02-05 summaries as unchanged)

---

*Phase: 02-graph-transport-middleware-pipeline*
*Completed: 2026-04-19*
