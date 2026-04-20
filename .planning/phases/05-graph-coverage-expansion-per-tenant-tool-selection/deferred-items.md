# Phase 05 Deferred Items

## Pre-existing test failures (out of scope for Plan 05-06)

Confirmed pre-existing on the base commit (3ab3204). Running vitest on
the base branch before applying 05-06 changes produces these same 4
failures:

- `test/public-url-failfast.test.ts`:
  - `Test 12: prod HTTP mode + missing MS365_MCP_PUBLIC_URL exits 78` — expected 78 received null
  - `Test 13: prod stdio mode (no --http) does not exit 78 on missing PUBLIC_URL` — expected 0 received null
- `test/startup-validation.test.ts`:
  - `Test 9: prod HTTP mode + missing CORS_ORIGINS exits 78` — expected 78 received null
  - `Test 10: prod stdio mode (no --http) does not exit 78 on missing CORS` — expected 0 received null

These tests spawn `node dist/index.js` subprocesses and rely on `dist/`
being freshly built. The worktree does not run `npm run build` as part
of the executor workflow; the subprocess exit code is `null` because the
spawn fails before reaching the fail-fast logic. Fixing requires either
building `dist/` in the worktree CI path or rewriting the tests to invoke
the TS source via tsx. Either direction is out of scope for COVRG-05 /
D-20 (per-tenant BM25 cache) and is filed here for a later plan.

## Pre-existing test failures (out of scope for Plan 05-07)

Confirmed pre-existing on worktree base (2dbe2b2) before any 05-07
changes. `test/tool-selection/discovery-filter.int.test.ts` has two
failing tests because the bootstrap stub `src/generated/client.ts`
exports `new Zodios([])` — an empty endpoints array — whereas those
tests require `send-mail` / `list-users` / `list-mail-messages`
aliases to exist in the live registry.

- `Test 1: search-tools returns BM25-ranked results scoped to the tenant
  enabled set` — expected `['send-mail', ...]` received `[]`.
- `Test 2: get-tool-schema rejects tools outside the tenant enabled set`
  — expected non-error, received error (alias not found).

Fix requires running `npm run generate` inside the worktree to produce
the real `src/generated/client.ts` from the Microsoft Graph OpenAPI
spec. The regen step is ~8 min and network-dependent; out of scope for
the PATCH-endpoint surface area of plan 05-07. Tracked here for a later
plan that integrates `npm run generate` into the executor pre-test
pipeline or switches the affected tests to a vi.mock-backed registry
fixture identical to the admin integration tests added in 05-07.
