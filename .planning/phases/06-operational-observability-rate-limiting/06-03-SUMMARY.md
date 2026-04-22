---
plan: 06-03
phase: 06-operational-observability-rate-limiting
status: partial
completed: 2026-04-22
tasks: 2/3 complete + Task 3 pending
commits: 4
dependencies_addressed:
  - OPS-07
  - D-02
  - D-08
---

# Plan 06-03 — Prometheus /metrics endpoint on port 9464 (PARTIAL)

## Status

Agent execution interrupted by rate limit during Task 3. Tasks 1 + 2 complete
(GREEN committed atomically); Task 3 (server.ts wiring + integration test) is
deferred as a post-waves gap.

## Completed Tasks

| # | Commit | Description |
|---|--------|-------------|
| 1 | `233d5fa` (RED) + `cef0d03` (GREEN) | Bearer-auth middleware — `createBearerAuthMiddleware()` gates `/metrics` when `MS365_MCP_METRICS_BEARER` is set; returns 401 + `WWW-Authenticate` on missing/wrong token; open endpoint when env var unset |
| 2 | `827a733` (RED) + `6859d53` (GREEN partial) | `PkceStore.size()` interface + implementations: `MemoryPkceStore` (O(1) via Map.size) + `RedisPkceStore` (non-blocking SCAN MATCH mcp:pkce:* COUNT 500); metrics-server source file committed |

## Artifacts Committed

### New modules
- `src/lib/metrics-server/bearer-auth.ts` (3.2K) — optional Bearer-auth Express middleware with 401 + WWW-Authenticate
- `src/lib/metrics-server/metrics-server.ts` (5.1K) — Express app on `MS365_MCP_METRICS_PORT` hosting `prometheusExporter.getMetricsRequestHandler()`

### Modified
- `src/lib/pkce-store/pkce-store.ts` — interface extended with `size(): Promise<number>`
- `src/lib/pkce-store/memory-store.ts` — O(1) Map.size implementation
- `src/lib/pkce-store/redis-store.ts` — cursor-based SCAN (never KEYS on prod)

### Test files (RED, committed)
- Bearer-auth unit tests green (via agent commits)
- PkceStore.size() unit tests GREEN (via agent commits)

## Pending (Task 3)

- `src/server.ts` — wire `createMetricsServer(prometheusExporter, authMiddleware)` in `MicrosoftGraphServer.start()`; call `wirePkceStoreGauge(this.pkceStore)` after PKCE-store init; register shutdown hook
- `test/integration/metrics-endpoint.int.test.ts` — end-to-end test against the live Express app on port 9464

## Verification

- Unit tier: bearer-auth tests + PkceStore.size() tests green
- Typecheck clean for committed modules
- Integration test for end-to-end `/metrics` scrape: PENDING

## Follow-Up

Task 3 is isolated wiring — can be completed in a post-waves pass. No downstream
plan consumes the live endpoint at runtime (06-04 imports the Counter directly
from `src/lib/otel-metrics.ts`, not via HTTP scrape).

## Self-Check: PARTIAL

Tasks 1+2 atomic RED/GREEN committed. Task 3 pending.
