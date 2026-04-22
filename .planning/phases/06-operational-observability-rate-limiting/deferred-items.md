# Deferred Items — Phase 6

## Environmental / Infrastructure (out of scope for code plans)

### Integration test environment relies on Docker Hub reachability

**Observed in:** plan 06-08 (gap closure for 06-03 Task 3) — 2026-04-22

**Issue:** `MS365_MCP_INTEGRATION=1` drives the shared vitest `globalSetup` at
`test/setup/integration-globalSetup.ts` which always spins up
`@testcontainers/postgresql` + `@testcontainers/redis` containers. This pulls
`postgres:16-alpine` and `redis:7-alpine` from Docker Hub, and Testcontainers
also requires Ryuk (sidecar container) by default.

When the workstation hits an anonymous Docker Hub rate limit, the globalSetup
fails before any test can run — even tests that do NOT need Postgres or Redis
(like `test/integration/metrics-endpoint.int.test.ts`, which is fully in-memory).

**Status:** Not a code bug. Test code itself passes when the env has images
available (7/7 verified via a local config that skips globalSetup).

**Mitigation (future):**
- CI should authenticate Docker Hub to raise the rate limit.
- Consider splitting globalSetup into subsystem-scoped hooks that only fire
  when the corresponding test files are selected (e.g., `pg-globalSetup.ts`
  vs `redis-globalSetup.ts` vs nothing for self-contained int tests).
- Alternatively, gate globalSetup container startup on a secondary flag like
  `MS365_MCP_INTEGRATION_DB=1` so `MS365_MCP_INTEGRATION=1` alone runs the
  in-memory int tests only.

**Scope:** Out of scope for plan 06-08 (wiring + integration test). Log here
for a future infrastructure plan or phase wrap-up.
