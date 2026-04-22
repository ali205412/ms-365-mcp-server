---
plan: 06-04
phase: 06-operational-observability-rate-limiting
status: partial
completed: 2026-04-22
tasks: 2/3 complete + Task 3 RED
commits: 5
dependencies_addressed:
  - OPS-08
  - D-03
  - D-04
  - D-05
  - D-11
---

# Plan 06-04 — Per-tenant sliding-window rate limiter (PARTIAL)

## Status

Agent execution interrupted by rate limit after ~25 minutes / 141 tool uses.
Tasks 1 + 2 complete (RED + GREEN committed atomically). Task 3 has RED tests
committed but GREEN implementation pending.

## Completed Tasks

| # | Commit | Description |
|---|--------|-------------|
| 1 | `4309fcc` (RED) + `eceaed5` (GREEN) | Atomic ZSET+Lua sliding-window primitive: `consume(tenantId, window, max)` → `{allowed, retryAfterMs?}`; `observe(tenantId, weight)`; Lua script wrapping ZREMRANGEBYSCORE → ZCARD → conditional ZADD → PEXPIRE in single EVAL (D-03) |
| 2 | `e6e1895` (RED) + `3567767` (GREEN) | Admin PATCH `/admin/tenants/:id` extended with `rate_limits: { request_per_min, graph_points_per_min }` field; Zod-validated; Postgres migration `20260901000000_tenant_rate_limits.sql` (D-11) |
| 3 — PARTIAL | `759a54f` (RED only) | Failing tests for rate-limit middleware + gateway-429 scenarios added; GREEN implementation pending |

## Artifacts Committed

### New modules (complete)
- `src/lib/rate-limit/sliding-window.ts` (4.7K) — `consume()` + `observe()` public API, ioredis `defineCommand` registration
- `src/lib/rate-limit/sliding-window.lua` (2.5K) — atomic Lua script
- `src/lib/rate-limit/defaults.ts` (1.8K) — `MS365_MCP_DEFAULT_REQ_PER_MIN` (1000) / `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` (50000) parsers

### Migration
- `migrations/20260901000000_tenant_rate_limits.sql` — `ALTER TABLE tenants ADD COLUMN rate_limits JSONB NULL`

### Admin PATCH (complete)
- `src/lib/admin/tenants.ts` — `UpdateTenantZod` + `CreateTenantZod` extended with `rate_limits` field; SELECT / INSERT / UPDATE paths propagate the column

### Test files added (RED)
- `test/lib/rate-limit/sliding-window.test.ts` — primitive unit tests (concurrency + boundary)
- `test/lib/rate-limit/middleware.test.ts` — middleware unit tests (Task 3 RED — no GREEN yet)
- `test/integration/rate-limit/gateway-429.int.test.ts` — end-to-end 429 scenario (Task 3 RED)
- `test/integration/rate-limit/admin-config.int.test.ts` — admin PATCH integration (Task 2 — green via pg-mem + MemoryRedisFacade)

## Pending (Task 3 GREEN)

- `src/lib/rate-limit/middleware.ts` (not yet created) — Express middleware gating `/t/:tenantId/mcp` on request-rate AND graph-points budget; emits `mcp_rate_limit_blocked_total{tenant,reason}` on 429
- `src/lib/middleware/retry.ts` — extend with `rateLimit.observe(tenantId, parseResourceUnit(headers))` call
- `src/server.ts` — wire `rateLimit` middleware into `/t/:tenantId/mcp` chain between `loadTenant` and `mcpDispatchHandler`
- `tsup.config.ts` — copy `sliding-window.lua` to dist during build
- `src/lib/tenant/tenant-row.ts` — surface `rate_limits` JSON on `req.tenant`

## Verification

- Unit tier: sliding-window.test.ts tests green at commit `eceaed5`
- Admin PATCH integration: admin-config.int.test.ts green at commit `3567767`
- Migration applies cleanly against test Postgres harness
- Middleware + gateway-429 tests RED as expected (no GREEN yet)

## Follow-Up

Task 3 GREEN implementation is deferred to a post-waves completion pass.
The pending work is isolated (no cross-plan dependencies inward) so it can be
completed without blocking Waves 4's multi-tenant regression + docs work.

## Self-Check: PARTIAL

Tasks 1+2 atomic RED/GREEN committed. Task 3 RED committed but GREEN missing.
Middleware exposition layer (`/metrics` endpoint hosting) also depends on
06-03 Task 3 wiring (partial — see 06-03-SUMMARY when written).
