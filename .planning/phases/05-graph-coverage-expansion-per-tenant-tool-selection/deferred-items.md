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
