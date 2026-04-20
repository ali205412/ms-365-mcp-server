---
phase: 04-admin-api-webhooks-delta-persistence
plan: 09
subsystem: database
tags: [delta, graph-delta, persistence, transactional, resync, pg, for-update, upsert, phase-4]

# Dependency graph
requires:
  - phase: 03-multi-tenant-identity-state-substrate
    provides:
      - migrations/20260501000200_delta_tokens.sql (delta_tokens table with composite PK + FK CASCADE)
      - src/lib/postgres.ts (pool + withTransaction wrapper shape)
      - src/lib/graph-errors.ts (GraphError hierarchy with statusCode / code fields)
      - src/lib/redact.ts (zero-dep pure-helper module convention)
  - phase: 02-graph-transport-middleware-pipeline
    provides:
      - PageIterator used by callers to full-sweep on first invocation
      - parseODataError normalises resyncRequired / syncStateNotFound / syncStateInvalid codes
provides:
  - withDeltaToken(pool, tenantId, resource, fn) transactional wrapper
  - normalizeResourceKey(path, userOid?) pure canonicalisation helper
  - SYNC_RESET_CODES readonly set + isSyncReset(err) predicate
  - Pitfall 7 collision fix — /me, users/<oid>, USERS/<oid>/ resolve to one key
  - Row-level SELECT ... FOR UPDATE contract for concurrent-caller serialization
  - 410 Gone / resyncRequired one-shot DELETE + retry substrate
affects:
  - Phase 5 (coverage expansion — any mail.list-messages-delta, calendar-delta,
    groups.list-members-delta, etc. MCP tool wires through this wrapper)
  - Phase 6 (observability — delta_tokens.updated_at cross-referenced with audit_log
    for operator-visible delta cadence tuning)

# Tech tracking
tech-stack:
  added: []  # no new runtime deps — pure TypeScript + pg + existing graph-errors
  patterns:
    - "Pure zero-dep helper module (style: src/lib/redact.ts) for normalisation"
    - "Transactional wrapper around per-tenant Postgres table with FOR UPDATE"
    - "One-shot resync: DELETE stale row + retry with null + persist fresh link"
    - "Opaque delta tokens: never logged, never inspected (Graph docs contract)"

key-files:
  created:
    - src/lib/delta/resource-key.ts
    - src/lib/delta/with-delta-token.ts
    - src/lib/delta/__tests__/resource-key.test.ts
    - src/lib/delta/__tests__/with-delta-token.int.test.ts
    - src/lib/delta/__tests__/with-delta-token.resync.int.test.ts
    - src/lib/delta/__tests__/with-delta-token.concurrency.int.test.ts
  modified: []

key-decisions:
  - "Opaque delta tokens never logged — per Microsoft Graph docs 'don't inspect the token contents' (04-RESEARCH.md Pattern 6) and D-01 redact contract. Test 7 greps the emitted warn meta for the seeded token fragment and fails if it leaks."
  - "Resource key normalization is a pure zero-dep helper — Zod refinements live at the call-site. Avoids coupling the normaliser to project logger/pg/etc."
  - "pg-mem fallback for concurrency tests — pg-mem/index.js:3108 explicitly ignores FOR UPDATE. Tests verify chained-link observation via sequential calls; end-to-end row locking deferred to manual validation per VALIDATION.md 'Delta resync after resource reset'."
  - "One-shot resync commits the DELETE before rethrowing persistent 410 — the stale row is gone for good; the caller decides whether to retry later. Never loops."

patterns-established:
  - "Delta persistence substrate: any delta-supporting MCP tool wraps its Graph call in withDeltaToken(pool, tenantId, resource, fn). Wrapper handles persistence + resync; caller owns URL construction and page iteration."
  - "Resource key normalisation sits at the caller boundary (Zod refinement or typed handler). Tool aliases are NOT valid resource keys."

requirements-completed: [MWARE-08]

# Metrics
duration: ~6 min
completed: 2026-04-20
---

# Phase 04 Plan 09: Delta-token Persistence Summary

**withDeltaToken transactional wrapper over delta_tokens table with SELECT ... FOR UPDATE serialisation, one-shot 410/resyncRequired handling, and pure-helper Graph path normaliser.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-20T07:57:45Z
- **Completed:** 2026-04-20T08:03:51Z
- **Tasks:** 2
- **Files created:** 6 (2 source + 4 test suites)
- **Files modified:** 0
- **Tests added:** 29 (13 resource-key + 5+1 happy-path + 7 resync + 3 concurrency)

## Accomplishments

- `withDeltaToken<T>(pool, tenantId, resource, fn)` ships the D-17 transactional contract: SELECT delta_link FOR UPDATE → call fn(stored || null) → UPSERT nextDeltaLink → COMMIT. Caller's fn throws non-resync error → ROLLBACK preserves stored link.
- Sync-reset detection recognises HTTP 410 Gone AND `syncStateNotFound` / `syncStateInvalid` / `resyncRequired` codes (Assumption A4). Path: DELETE stale row → retry fn(null) ONCE → persist fresh link. Persistent reset COMMITs the DELETE and propagates the second error.
- `normalizeResourceKey(input, userOid?)` pure zero-dep helper canonicalises Graph paths: lowercase, drop query, drop trailing slashes, `/me/<X>` → `users/<oid>/<X>` when oid supplied, strip leading slash. Pitfall 7 collision closed: `/me/messages`, `users/<oid>/messages`, and `USERS/<oid>/messages/` all collapse to the same key.
- SELECT ... FOR UPDATE serialises overlapping callers per (tenant, resource) in production Postgres. Tests use pg-mem and verify the observable contract via sequential chained calls; per-resource and per-tenant isolation tests demonstrate PK + FK CASCADE correctness.
- Logger.warn on resync carries `{ tenantId, resource, errorCode }` ONLY — never the delta-link content. Test 7 (resync) asserts no base64url token fragment leaks to log meta.

## Task Commits

Each task split into RED/GREEN per plan-level TDD contract:

1. **Task 1 RED: failing normalizeResourceKey suite** — `a72401d` (test)
2. **Task 1 GREEN: implement normalizeResourceKey** — `00e6acd` (feat)
3. **Task 2 RED: failing withDeltaToken integration suites** — `549aeeb` (test)
4. **Task 2 GREEN: implement withDeltaToken + resync** — `3e5a02c` (feat)

_Plan metadata commit (SUMMARY) is produced by this message._

## Files Created/Modified

- `src/lib/delta/resource-key.ts` (51 lines) — Pure zero-dep canonicalisation helper. No project-internal imports. Follows `src/lib/redact.ts` convention.
- `src/lib/delta/with-delta-token.ts` (155 lines) — Transactional wrapper + `isSyncReset` predicate + `SYNC_RESET_CODES` readonly set. Imports `GraphError` and `logger` only.
- `src/lib/delta/__tests__/resource-key.test.ts` (89 lines) — 13 unit cases covering lowercase, slash, query, `/me` rewrite, leading-slash, idempotency, Pitfall 7 collision, underscore paths.
- `src/lib/delta/__tests__/with-delta-token.int.test.ts` (254 lines) — 6 integration cases on pg-mem: first-sweep, second-incremental, rollback-on-throw, null-link UPSERT skip (existing + fresh), per-tenant isolation.
- `src/lib/delta/__tests__/with-delta-token.resync.int.test.ts` (273 lines) — 7 cases: HTTP 410, three SYNC_RESET_CODES variants, persistent 410 propagation, non-resync-error no-retry, logger.warn telemetry with no token leak.
- `src/lib/delta/__tests__/with-delta-token.concurrency.int.test.ts` (187 lines) — 3 cases: chained sequential calls observe updated link, per-resource isolation, per-tenant isolation. Documents pg-mem FOR UPDATE limitation.

## Decisions Made

- **Opaque delta tokens never logged** — Microsoft Graph docs state explicitly "don't inspect the token contents" (04-RESEARCH.md Pattern 6). The resync logger call carries tenantId + resource + errorCode only. Test 7 asserts the seeded token fragment does not appear anywhere in the log meta.
- **Pure zero-dep resource-key module** — Follows `src/lib/redact.ts` convention. Callers own Zod refinement / validation / logging so the normaliser stays cheap and testable.
- **pg-mem fallback for FOR UPDATE tests** — pg-mem ignores FOR UPDATE (source comment at pg-mem/index.js:3108). We document this in the test file header and cover the observable contract via sequential chained calls. End-to-end locking is deferred to VALIDATION.md manual validation against real Postgres, which is consistent with how the testcontainers-pg fixture is wired but not yet exercised by the suite.
- **One-shot retry, never loop** — Persistent 410 propagates. The DELETE is committed so the stale row is gone; the caller decides whether to retry later. This matches D-17 and guards against the T-04-22 DoS threat.

## Deviations from Plan

### Auto-fixed: Test 7 for /me without oid

**1. [Rule 1 - Bug] Test 7 behavior aligned to reference implementation**
- **Found during:** Task 1 test authoring
- **Issue:** The plan's `<behavior>` section says `normalizeResourceKey('/me/messages')` (without userOid) should return `'/me/messages'` (leading slash preserved), but the plan's reference implementation in `<action>` unconditionally strips the leading slash at step 5, so the function actually returns `'me/messages'`. The two descriptions contradict each other.
- **Fix:** Authored the test to match the reference implementation's actual behavior (`'me/messages'`). The plan-level grep acceptance criteria (`grep "replace.*\\\\/+\\$"` and `grep "/me/"`) validate the implementation mechanically, and the chosen behavior is internally consistent with the leading-slash-strip rule documented throughout the plan.
- **Files modified:** `src/lib/delta/__tests__/resource-key.test.ts` (Test 7)
- **Verification:** All 13 resource-key tests pass; the idempotency test (Test 11) and Pitfall 7 collision test (Test 12) both hold against the actual behavior.
- **Committed in:** `a72401d` (RED) + `00e6acd` (GREEN)

### Auto-fixed: Added Test 4b for null-link on fresh resource

**2. [Rule 2 - Missing coverage] Explicit "no row created" case for null nextDeltaLink**
- **Found during:** Task 2 test authoring
- **Issue:** Plan's Test 4 says "delta_tokens row unchanged (if already existed) or no row created (if first call)". The "existing row" branch was explicit but the "first call with null link" branch was not independently asserted — a subtle bug could pass Test 4 by still INSERTing an empty-string link.
- **Fix:** Added Test 4b asserting `readDeltaLink` returns null after a fresh-resource call with `nextDeltaLink: null`. Confirms the `if (result.nextDeltaLink)` guard actually skips the UPSERT rather than inserting an empty string.
- **Files modified:** `src/lib/delta/__tests__/with-delta-token.int.test.ts`
- **Verification:** Test 4b passes; first-call happy-path (Test 1) still inserts a row when `nextDeltaLink` is non-null.
- **Committed in:** `549aeeb` (RED) + `3e5a02c` (GREEN)

---

**Total deviations:** 2 auto-fixed (1 bug — test/impl contradiction resolution, 1 missing coverage — null-link fresh-resource case)
**Impact on plan:** Both auto-fixes strengthen the contract without changing scope. Plan's acceptance-criteria greps still all pass; file count + test count are slightly higher than the plan minimum (13/5/7/3 expected → 13/6/7/3 delivered).

## Issues Encountered

- **pg-mem ignores SELECT ... FOR UPDATE** — Confirmed by the `pg-mem/index.js:3108` source comment ("ignore 'for update' clause (not useful in non-concurrent environements)"). Resolution: the concurrency suite verifies the observable serialisation contract via sequential chained calls (sufficient for the typical caller-level observation), documents the pg-mem limitation in the test file header, and defers full row-lock verification to the VALIDATION.md manual step against real Postgres. The plan explicitly anticipated and permitted this fallback.
- **Pre-existing unrelated test failures in the broader suite** — `npm test -- --run` shows 25 failed test files / 69 failed tests before and after this plan's work (verified via git stash + re-run). Out of scope for this plan per SCOPE BOUNDARY; logged to phase `deferred-items.md` equivalent via this summary. The delta-module suite itself (29 tests across 4 files) is 100% green.

## Threats Mitigated

| ID | Category | Disposition | Mitigation |
|----|----------|-------------|-----------|
| T-04-21 | Tampering | mitigate | SELECT ... FOR UPDATE serialises overlapping (tenant, resource) calls; chained-link observation verified in concurrency suite |
| T-04-22 | DoS | mitigate | One-shot resync with explicit propagation; no retry loop |
| T-04-23 | Info Disclosure | mitigate | PK (tenant_id, resource) enforces isolation; normalizeResourceKey avoids collision; FK CASCADE honours Phase 3 cryptoshred contract |
| T-04-21a | Info Disclosure | mitigate | Opaque delta-token content never logged; Test 7 greps the log for seeded token fragment |
| T-04-21c | EoP | mitigate (caller-side) | withDeltaToken receives tenantId as explicit parameter; caller's dual-stack RBAC (04-04) ensures cross-tenant calls are blocked upstream |

Accepted (no technical control): T-04-22a (direct-table-write bypass), T-04-21b (repudiation of opaque tokens), T-04-23a (unbounded delta_tokens growth — bounded in practice by tenant × resource count; FK CASCADE handles tenant deletes).

## User Setup Required

None. This is a pure library. Integration with delta-supporting MCP tools (mail.list-messages-delta, etc.) is a call-site wiring concern deferred to Phase 5 coverage expansion.

## Phase 4 Progress Signal

This plan closes the **ninth and final** requirement of Phase 04:
- ADMIN-01..ADMIN-06 (plans 04-01..04-06)
- WEBHK-01..WEBHK-03 (plans 04-07..04-08)
- **MWARE-08 (plan 04-09) ← this plan**

Phase 4 completion of the remaining plans (01..08) is owned by the orchestrator and the other parallel worktree agents. This worktree's contribution is MWARE-08 only.

## Next Phase Readiness

- **Ready for call-site integration** in Phase 5 coverage expansion: any tool that wants delta semantics wraps its Graph call in `withDeltaToken(pool, tenantId, normalizeResourceKey(path, userOid), fn)`. Caller builds the URL using the stored link (or the delta-endpoint default when null), paginates via PageIterator, and returns the final `@odata.deltaLink`.
- **VALIDATION.md manual step** deferred to phase-level UAT: seed a stale delta_tokens row against a real Graph tenant; call a delta-supporting tool; verify one-shot 410 recovery via pino `warn` log + fresh link persisted.
- **No blockers** for dependent plans. delta_tokens schema (Phase 3 plan 03-01) is already migrated; this plan only adds runtime library code.

## Self-Check

- [x] `src/lib/delta/resource-key.ts` FOUND (51 lines, min 40)
- [x] `src/lib/delta/with-delta-token.ts` FOUND (155 lines, min 100)
- [x] `src/lib/delta/__tests__/resource-key.test.ts` FOUND (13 tests passing)
- [x] `src/lib/delta/__tests__/with-delta-token.int.test.ts` FOUND (6 tests passing)
- [x] `src/lib/delta/__tests__/with-delta-token.resync.int.test.ts` FOUND (7 tests passing)
- [x] `src/lib/delta/__tests__/with-delta-token.concurrency.int.test.ts` FOUND (3 tests passing)
- [x] Commit `a72401d` (test RED Task 1) FOUND in `git log`
- [x] Commit `00e6acd` (feat GREEN Task 1) FOUND in `git log`
- [x] Commit `549aeeb` (test RED Task 2) FOUND in `git log`
- [x] Commit `3e5a02c` (feat GREEN Task 2) FOUND in `git log`
- [x] `npm run build` exits 0
- [x] `npx eslint src/lib/delta/` reports no issues
- [x] `npx prettier --check src/lib/delta/` reports "All matched files use Prettier code style"
- [x] 29/29 delta tests pass via `npm test -- src/lib/delta/__tests__/ --run`

## Self-Check: PASSED

---
*Phase: 04-admin-api-webhooks-delta-persistence*
*Completed: 2026-04-20*
