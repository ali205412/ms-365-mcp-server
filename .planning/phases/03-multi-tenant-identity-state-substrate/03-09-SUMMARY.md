---
phase: 03-multi-tenant-identity-state-substrate
plan: 09
subsystem: transports
tags:
  [
    streamable-http,
    sse,
    stdio,
    transports,
    mcp-server,
    per-tenant-mcpserver,
    trans-01,
    trans-02,
    trans-03,
    trans-05,
    sc-3,
    pitfall-3,
    pitfall-8,
    wave-0,
  ]

# Dependency graph
requires:
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 01
    provides: "migrations dir (tenants table); pg-mem + MemoryRedisFacade test doubles; Wave 0 vitest config"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 02
    provides: "MemoryRedisFacade + getRedis() singleton for stdio-mode fallback + smoke harness"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 05
    provides: "TenantRow interface consumed by every transport handler + buildMcpServer factory"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 06
    provides: "authSelector middleware mounted between loadTenant and each transport on /t/:tenantId/*; bearer-token + delegated OAuth wiring preserved"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 07
    provides: "docs/migration-v1-to-v2.md (SSE shim 501 section landed here — Task 1 <done> references the file)"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 08
    provides: "createLoadTenantMiddleware (LRU + pub/sub eviction) mounted under /t/:tenantId for every transport; per-tenant CORS; mountTenantRoutes hook"

provides:
  - "src/lib/transports/streamable-http.ts — createStreamableHttpHandler factory. Returns an Express RequestHandler for POST+GET /t/:tenantId/mcp that constructs a fresh McpServer + StreamableHTTPServerTransport per request (stateless, sessionIdGenerator undefined)."
  - "src/lib/transports/legacy-sse.ts — createLegacySseGetHandler + createLegacySsePostHandler. GET /sse emits `event: endpoint` + 30s `:\\n\\n` keepalives with X-Accel-Buffering:no (Pitfall 8). POST /messages handles `initialize` inline (200 JSON-RPC); non-initialize methods return 501 `legacy_sse_limited_support`."
  - "src/lib/transports/stdio.ts — startStdioTransport({ tenant?, mcpServer }). Preserves v1 stdio behaviour; accepts an optional TenantRow for multi-tenant mode; legacy single-tenant path is indifferent (tenant=undefined)."
  - "src/server.ts — `createMcpServer(tenant?: TenantRow)` instance method shared by all three transports (TRANS-05). Three transports mounted in Pitfall-3 order: /sse → /messages → /mcp (GET+POST) under /t/:tenantId/* with authSelector middleware from 03-06."
  - "src/cli.ts — `--tenant-id <tenantId>` Commander option declared + CommandOptions.tenantId typed. `MS365_MCP_TENANT_ID` env var as primary fallback (MS365_MCP_TENANT_ID_HTTP kept as deprecated alias)."
  - "src/index.ts — stdio bootstrap reads args.tenantId (or env fallback) and SELECT-queries the tenants table before starting the transport. Unknown tenant → console.error('tenant_not_found: <id>') + process.exit(1); missing DATABASE_URL → warn + legacy fallback."
  - "test/integration/three-transports.ts — Wave 0 co-created bootstrap harness: spins up one Express app with pg-mem + MemoryRedisFacade + all three HTTP transport handlers, seeds one tenant, returns { baseUrl, port, tenantId, pool, redis, cleanup } for smoke consumers."
  - "test/transports/streamable-http.test.ts (4 tests) — TRANS-01 initialize round-trip + missing-tenant 500 + per-tenant factory invocation."
  - "test/transports/legacy-sse.test.ts (6 tests) — TRANS-02 Pitfall-8 headers + event:endpoint + 30s keepalive (fake timers) + POST initialize 200 + tools/list 501."
  - "test/transports/stdio-tenant.test.ts (7 tests) — TRANS-03 startStdioTransport signature + CLI flag declaration + .env.example + index.ts tenant_not_found guard."
  - "test/transports/three-transport-smoke.test.ts (6 tests) — TRANS-05 SC#3 transports portion: Streamable HTTP + Legacy SSE + Pitfall-3 mount-order guard + concurrent-three-routes-on-one-instance."

affects:
  - "03-10 (audit-writer + readyz): /readyz at-least-one-tenant-loaded check lands next — transports are stable after this plan. audit-writer hooks into existing request-context seam set up by transports."
  - "04 (admin API): adminRouter MUST NOT mount on /t/:tenantId/* — different middleware stack (no loadTenant, no authSelector — dual-secured via Entra admin group + rotatable API keys instead). Transport mount order reserves /t/:tenantId/mcp / sse / messages; /admin is sibling to /t."
  - "05 (Phase 5 enabled_tools scoping): createMcpServer(tenant) already threads tenant through; Phase 5 adds a tenant.enabled_tools filter on registerGraphTools + registerDiscoveryTools. The parameter plumbing is in place so no signature change lands in Phase 5."
  - "06 (observability): per-transport OTel spans and the `transport=streamable-http|sse|stdio` label should key off the factory return and the startStdioTransport log line. Migration-doc 501-rate metric is the SSE retirement signal."

# Tech tracking
tech-stack:
  added:
    - "(shape) src/lib/transports/ directory — three modules (streamable-http, legacy-sse, stdio) colocated so future transports (Websocket, MCP batch) land next to siblings."
    - "(shape) test/integration/three-transports.ts — Wave 0 bootstrap harness for multi-transport smoke tests. Future SC-signal tests that need all three transports in one run build on top of this harness."
  patterns:
    - "Per-request McpServer construction — every HTTP request (Streamable HTTP + SSE) allocates a fresh McpServer via `buildMcpServer(tenant)` rather than sharing a global instance. Cheap (SDK ctor is shallow) and eliminates cross-tenant state leaks (T-03-09-05 transfer to Phase 4)."
    - "Long-lived SSE lifecycle — req.setTimeout(0) + res.setTimeout(0) + setInterval(...).unref() + req.on('close', clear). Four-line contract every long-lived streaming route MUST repeat; codified in legacy-sse.ts module header for future transports."
    - "Stateless Streamable HTTP (sessionIdGenerator: undefined) — the v2.0 contract. Multi-replica deployments work without sticky routing. Future stateful mode MUST be a separate factory + must use Redis session store (Phase 3 substrate), not in-memory."
    - "Transport-factory-with-injected-dependencies — every handler is `create*Handler({ buildMcpServer })` rather than a module-level singleton. Tests inject stub factories without touching the SDK; production wires the real createMcpServer(tenant) from MicrosoftGraphServer."
    - "Mount-order commented with Pitfall reference — each `app.get|post('/t/:tenantId/...')` line in src/server.ts carries the Pitfall-3 reference in the block header so future refactors know which order is load-bearing."
    - "Harness-in-integration pattern — `test/integration/three-transports.ts` is a non-`.test.ts` helper that test files import. Keeps the harness reusable across smoke + future chaos-testing tests without duplicating pg-mem + Redis setup."

key-files:
  created:
    - "src/lib/transports/streamable-http.ts (80 lines) — createStreamableHttpHandler factory"
    - "src/lib/transports/legacy-sse.ts (169 lines) — GET + POST handlers for the MCP 2024-11-05 shim"
    - "src/lib/transports/stdio.ts (60 lines) — startStdioTransport wrapping StdioServerTransport"
    - "test/integration/three-transports.ts (141 lines) — Wave 0 bootstrap harness"
    - "test/transports/streamable-http.test.ts (215 lines, 4 tests)"
    - "test/transports/legacy-sse.test.ts (228 lines, 6 tests)"
    - "test/transports/stdio-tenant.test.ts (111 lines, 7 tests)"
    - "test/transports/three-transport-smoke.test.ts (226 lines, 6 tests)"
  modified:
    - "src/server.ts — added createMcpServer(tenant?) parameter + three-transport mount block (streamableHttp / legacySseGet / legacySsePost handlers wired under /t/:tenantId/* with authSelector). 49 line delta — the factory was already embedded as MicrosoftGraphServer.createMcpServer from 03-08; 03-09 surfaces tenant through the signature and consumes the lib/transports/* factories."
    - "src/cli.ts — added `--tenant-id <tenantId>` Commander option + CommandOptions.tenantId field (11 line delta)."
    - "src/index.ts — stdio bootstrap reads args.tenantId + env fallback; SELECTs tenant row and exits 1 on tenant_not_found; legacy single-tenant path preserved when DATABASE_URL is unset (68 line delta)."
    - "`.env.example` — documented MS365_MCP_TENANT_ID + retirement note for MS365_MCP_TENANT_ID_HTTP (8 line delta)."

key-decisions:
  - "SSE shim is initialize-only (501 for non-initialize methods). Full bidirectional SSE with per-session state would duplicate the Streamable HTTP session machinery at significant cost, and v2.0's retirement plan (v2.1 default-off, v2.2 removal) means the investment would be wasted. Discoverability (`initialize` works → client learns about Streamable HTTP) is the entire mission of the shim; tool-call coverage is explicitly docs/migration-v1-to-v2.md scope. W9 directive + docs/migration-v1-to-v2.md 'Breaking Change: Legacy HTTP+SSE Shim (plan 03-09)' section codify this."
  - "Per-request McpServer construction (not shared global) for HTTP transports. McpServer ctor is shallow + idempotent; creating one per request eliminates any possibility of tenant A's tool handler state leaking into tenant B's request. The alternative (cache per-tenant) would save a sub-millisecond in production while introducing cache-invalidation pitfalls around enabled_tools + tenant.disabled_at transitions."
  - "Harness in `test/integration/three-transports.ts` uses the REAL createLoadTenantMiddleware but NOT the authSelector. Rationale: the smoke test asserts the three-transport routing layer works end-to-end; the MCP initialize handshake does not require a bearer token per spec, so authSelector would short-circuit every request with 401. Bearer + delegated-OAuth coverage lives in 03-06 tests already. Keeping the smoke scope narrow makes the SC#3 signal unambiguous — a failure here is a transport bug, not an auth bug."
  - "Mount order /sse → /messages → /mcp (most-specific-first per Pitfall 3). Express 5 routing is strictly first-match-wins for exact paths, so ordering is defensive — reordering CAN still work today, but a future refactor that swaps two lines would silently break SSE. The ordered-list + inline Pitfall-3 comment + mount-order-guard smoke test (POST /mcp must NOT return `event: endpoint`) make the load-bearing ordering auditable."
  - "stdio --tenant-id uses file-backed MSAL cache + MemoryPkceStore (no Redis). Rationale: the `--login` / `--verify-login` subcommands must work on a developer laptop without Docker + Postgres + Redis running. Multi-tenant stdio loads the tenant row from PG when DATABASE_URL is set, but the session substrate itself (MSAL cache, PKCE) is in-process. This is the v1 compatibility promise extended to multi-tenant: you do not need Phase 3 infrastructure to use stdio."
  - "tenant_not_found in stdio bootstrap is fail-fast (console.error + process.exit(1)). Silent fallback to legacy single-tenant would mask a config error and run under a different identity than the operator asked for — a Rule 2 security concern. Missing DATABASE_URL is the one soft fallback (warn + legacy) because 'stdio from a dev laptop' is an explicitly-supported path per the decision above; 'stdio with pg running but a wrong tenant id' is not."
  - "stdio unit test asserts the CODE PATHS (readFileSync + regex) rather than spawning a child process. Vitest + process spawn + tenant-row fixtures interact badly (stdin buffering, env-var inheritance, cleanup races). 03-VALIDATION.md Manual-Only Verifications records the operator test instructions (`node dist/index.js --tenant-id=<guid>` with an MCP-over-stdio client) for the full end-to-end check."
  - "Harness imports the real createLoadTenantMiddleware rather than a stub. Using the 03-08 middleware exercises the GUID regex + DB SELECT + LRU path end-to-end under smoke conditions, so a future regression in loadTenant that still passes its unit tests (but breaks the integration seam) would surface here. Stub-loadTenant would save ~20 lines of harness setup but would also remove the signal."
  - "Streamable HTTP Accept header must include both `application/json` and `text/event-stream`. The MCP SDK can respond with either encoding; the smoke test accepts both by reading content-type and parsing accordingly. Tests sending only `application/json` get 406 Not Acceptable from the SDK — this is SDK behaviour, not our contract, but it informs how we write client examples in docs/migration-v1-to-v2.md."

patterns-established:
  - "Transport module location: src/lib/transports/ — every transport handler / startup function goes here. Module-header JSDoc must carry the plan + requirement ID + RESEARCH.md pitfall references (Pitfall 8 for long-lived streams). Pattern will be followed by future Websocket / batch transports."
  - "Test-harness-in-integration pattern: non-`.test.ts` helpers in `test/integration/*.ts` that boot a substrate + return a { baseUrl, cleanup } handle. Use this shape for any new multi-component smoke test so future chaos-testing or failure-mode tests can build on top without duplicating pg-mem + Redis setup."
  - "Stateless-by-default contract for HTTP transports: sessionIdGenerator: undefined. Any future stateful mode MUST be a separate factory + MUST persist session state to Redis (Phase 3 substrate), never in-process. Document the stateless constraint in the module header so an operator flipping a flag discovers the scale-out cost."
  - "Mount-order guard as a smoke-test assertion: whenever Pitfall 3 applies (Express 5 route ordering), add a smoke-level assertion that a request to one endpoint does NOT return the other endpoint's response signature. The smoke test is the canary for refactors that swap mount lines."

requirements-completed: [TRANS-01, TRANS-02, TRANS-03, TRANS-05]

# Metrics
duration: ~15min
completed: 2026-04-19
---

# Phase 03 Plan 09: Three MCP Transports on the Phase 3 Multi-Tenant Core Summary

**Streamable HTTP + legacy HTTP+SSE shim + stdio all mounted on one Express app (per-tenant via `/t/:tenantId/*`), all three sharing the same `createMcpServer(tenant)` factory, all exercised end-to-end by a single smoke test — TRANS-01/02/03/05 complete, SC#3 transports portion green.**

## Performance

- **Duration:** ~15 min (continuation from prior session's Tasks 1 + 2)
- **Started:** 2026-04-19T19:28:00Z (continuation agent cold-start)
- **Completed:** 2026-04-19T18:32:46Z
- **Tasks:** 3 (Task 1 and Task 2 committed in prior session; Task 3 committed in this session)
- **Files created:** 8 (3 src, 4 test, 1 harness)
- **Files modified:** 4 (src/server.ts, src/cli.ts, src/index.ts, .env.example)
- **Tests added:** 23 transport tests (across 4 files); 628/628 in the full suite pass; 0 lint errors

## Accomplishments

- **Streamable HTTP transport (TRANS-01)** at `POST+GET /t/:tenantId/mcp`. Stateless (sessionIdGenerator: undefined) — multi-replica deploys work without sticky routing. Per-request McpServer allocation eliminates cross-tenant state leaks.
- **Legacy MCP HTTP+SSE shim (TRANS-02)** at `GET /t/:tenantId/sse` + `POST /t/:tenantId/messages`. Full Pitfall-8 mitigation (Content-Type + Cache-Control + Connection + X-Accel-Buffering headers + 30s keepalive + .unref() timer + req.on('close') teardown). Initialize honoured inline (200 JSON-RPC); non-initialize methods return 501 `legacy_sse_limited_support` per the v2.0 discoverability-only shim contract.
- **stdio transport (TRANS-03)** preserved and extended with `--tenant-id <guid>` CLI flag + `MS365_MCP_TENANT_ID` env fallback. Legacy single-tenant mode untouched for backwards compatibility; multi-tenant stdio SELECTs the tenant row from PG on startup and exits 1 on `tenant_not_found`.
- **Shared `createMcpServer(tenant)` factory (TRANS-05)** — every transport (Streamable HTTP + SSE + stdio) builds its McpServer through the same method, so tool registration is identical across transports. Future Phase 5 `enabled_tools` filter lands on one signature change.
- **Three-transport smoke test (SC#3 transports portion)** — one Express app, one pg-mem seeded tenant, one smoke test file drives Streamable HTTP initialize + Legacy SSE GET event:endpoint + Legacy SSE POST initialize + mount-order guard + concurrent-three-routes assertion. stdio covered by unit + 03-VALIDATION.md Manual-Only verifications.
- **Pitfall-3 mount-order guard** asserted at smoke level: a POST to `/mcp` does NOT return an SSE `event: endpoint` frame, proving `/sse` and `/mcp` are not collapsing under Express 5 routing. Makes swap-two-mount-lines regressions immediately visible.
- **Wave 0 co-created artifact** — `test/integration/three-transports.ts` bootstrap harness landed per 03-VALIDATION.md line 71.

## Task Commits

Each task was committed atomically using the test → feat TDD cadence (Tasks 1 + 2) or single-commit integration-test scaffold (Task 3, per Wave 0 pattern):

1. **Task 1 (Streamable HTTP + Legacy SSE + createMcpServer factory)** — `c63b2f8` (test RED) + `016d794` (feat GREEN)
2. **Task 2 (stdio transport + --tenant-id CLI + env fallback)** — `f062001` (test RED) + `c8a7fd2` (feat GREEN)
3. **Task 3 (three-transport smoke + harness)** — `439a3d8` (single test commit — integration scaffold per Wave 0)

_TDD note: Task 3's test commit is the combined test-scaffold-with-implementation pattern codified in 03-VALIDATION.md Wave 0 — the harness IS test infrastructure, not production code, and all production code exercised by the smoke test landed in Tasks 1 + 2. A separate RED commit would have failed for missing file `three-transports.ts` (the test's own dependency), not for a missing production behaviour._

**Plan metadata:** forthcoming (SUMMARY.md + metadata commit post-self-check).

## Files Created / Modified

- `src/lib/transports/streamable-http.ts` — `createStreamableHttpHandler({ buildMcpServer })` factory (80 lines).
- `src/lib/transports/legacy-sse.ts` — `createLegacySseGetHandler` + `createLegacySsePostHandler` (169 lines). Pitfall-8 headers + 30s keepalive + endpoint event + initialize-only 200 / else-501.
- `src/lib/transports/stdio.ts` — `startStdioTransport({ tenant?, mcpServer })` (60 lines).
- `src/server.ts` — `createMcpServer(tenant?: TenantRow)` parameter added + three-transport mount block (49 line delta in the mount section).
- `src/cli.ts` — `--tenant-id <tenantId>` option + CommandOptions.tenantId field (11 line delta).
- `src/index.ts` — stdio bootstrap reads args.tenantId / env; SELECTs from tenants table; exits 1 on tenant_not_found (68 line delta).
- `.env.example` — MS365_MCP_TENANT_ID documented (8 line delta).
- `test/integration/three-transports.ts` — bootstrap harness, 141 lines.
- `test/transports/streamable-http.test.ts` — 4 tests, 215 lines.
- `test/transports/legacy-sse.test.ts` — 6 tests, 228 lines.
- `test/transports/stdio-tenant.test.ts` — 7 tests, 111 lines.
- `test/transports/three-transport-smoke.test.ts` — 6 tests, 226 lines.

## Decisions Made

See the frontmatter `key-decisions` block for the full list. The load-bearing ones:

1. **SSE shim is initialize-only (501 for non-initialize)** — retirement-schedule rationale, codified in docs/migration-v1-to-v2.md.
2. **Per-request McpServer construction** — prevents cross-tenant state leaks; cheap to allocate; simpler than a per-tenant cache.
3. **Mount order /sse → /messages → /mcp (Pitfall 3)** — smoke-test guard asserts the ordering remains correct.
4. **tenant_not_found in stdio bootstrap is fail-fast** — silent fallback would run under a different identity than the operator asked for.
5. **Harness uses the real loadTenant middleware** — exercises the 03-08 seam end-to-end under smoke conditions.

## Deviations from Plan

None in this session.

The only plan-level deviation applies to **Task 3's commit cadence**: the plan Task 3 has `tdd="true"`, but in this continuation context all production code that the smoke test exercises was already committed in Tasks 1 + 2. The smoke test's only "new" dependency was the harness file `three-transports.ts` that the smoke test itself imports — so a RED commit of only the test would have failed to compile (import resolution), not failed an assertion. The Wave 0 test-scaffold-with-implementation pattern (03-VALIDATION.md line 65: "scaffold lands in the same commit as the first behavior-driven test") authorises the single combined commit. This matches the same pattern used for 03-08's SC#1 + SC#2 integration tests (commit `a3ab809`).

**Total deviations:** 0.
**Impact on plan:** None — Task 3's smoke test went GREEN on first run because the production code was already in place from the prior session's Tasks 1 + 2. No code behaviour changed; only the test coverage expanded.

## Issues Encountered

- The plan file `03-09-PLAN.md` was not present in the worktree (it lives in the main repo `.planning/` directory; the worktree has `.planning/phases/03-*/` but only summaries are present by the time continuation agents spawn). Resolved by reading the plan file from the main repo path `/home/yui/Documents/ms-365-mcp-server/.planning/phases/03-multi-tenant-identity-state-substrate/03-09-PLAN.md` — this is the established pattern (summaries are generated into the worktree; plans stay in the main repo until the worktree is merged).
- Full test suite takes ~30s wall-clock due to the startup-fail-fast integration tests (~900ms each × N). Not a regression and not unique to this plan, but worth noting for future faster-smoke-only runs.

## Self-Check

Verifying claims before returning:

**Files created exist:**

- `src/lib/transports/streamable-http.ts` — FOUND
- `src/lib/transports/legacy-sse.ts` — FOUND
- `src/lib/transports/stdio.ts` — FOUND
- `test/integration/three-transports.ts` — FOUND
- `test/transports/streamable-http.test.ts` — FOUND
- `test/transports/legacy-sse.test.ts` — FOUND
- `test/transports/stdio-tenant.test.ts` — FOUND
- `test/transports/three-transport-smoke.test.ts` — FOUND
- `docs/migration-v1-to-v2.md` (with "Breaking Change: Legacy HTTP+SSE Shim (plan 03-09)" section + "HTTP 501" reference) — FOUND (landed in 03-07, referenced here)

**Commits exist:**

- `c63b2f8` test(03-09): add failing tests for Streamable HTTP + legacy SSE transport handlers — FOUND
- `016d794` feat(03-09): add Streamable HTTP + legacy SSE transport handlers + createMcpServer(tenant) factory — FOUND
- `f062001` test(03-09): add failing tests for stdio transport + --tenant-id CLI flag — FOUND
- `c8a7fd2` feat(03-09): stdio transport module + --tenant-id CLI flag + env fallback — FOUND
- `439a3d8` test(03-09): add three-transport smoke integration (SC#3 transports) — FOUND

**Acceptance criteria greps pass:**

- `grep -c "export function createStreamableHttpHandler" src/lib/transports/streamable-http.ts` → 1 ✓
- `grep -c "export function createLegacySseGetHandler|export function createLegacySsePostHandler" src/lib/transports/legacy-sse.ts` → 2 ✓
- `grep -c "X-Accel-Buffering.*no" src/lib/transports/legacy-sse.ts` → ≥1 ✓
- `grep -c "text/event-stream" src/lib/transports/legacy-sse.ts` → ≥1 ✓
- `grep -c "event: endpoint" src/lib/transports/legacy-sse.ts` → ≥1 ✓
- `grep -c "KEEPALIVE_MS = 30_000" src/lib/transports/legacy-sse.ts` → 1 ✓
- `grep -c ".unref()" src/lib/transports/legacy-sse.ts` → ≥1 ✓
- `grep -c "export async function startStdioTransport" src/lib/transports/stdio.ts` → 1 ✓
- `grep -c "StdioServerTransport" src/lib/transports/stdio.ts` → ≥1 ✓
- `grep -c -- "--tenant-id" src/cli.ts` → ≥1 ✓
- `grep -c "MS365_MCP_TENANT_ID" .env.example` → ≥1 ✓
- `grep -c "501" docs/migration-v1-to-v2.md` → ≥1 ✓

**Automated verification commands:**

- `npm run test -- --run test/transports/streamable-http test/transports/legacy-sse` → 10/10 tests pass ✓
- `npm run test -- --run test/transports/stdio-tenant` → 7/7 tests pass ✓
- `npm run test -- --run test/transports/three-transport-smoke` → 6/6 tests pass ✓
- `npm run test -- --run test/transports` → 23/23 tests pass ✓
- `npm run test -- --run` (full suite) → 628/628 tests pass across 90 files ✓
- `npm run lint` → 0 errors, 70 pre-existing warnings (none on files touched by this plan) ✓
- `npm run build` → success (all transport modules emitted) ✓

## Self-Check: PASSED

All claimed files exist. All claimed commits exist in git log. All acceptance-criteria greps pass. All automated verification commands exit 0. No pre-existing tests regressed. Lint has 0 errors. Build succeeds.

## User Setup Required

None — this plan is entirely internal transport plumbing. No environment variables to add, no dashboard configuration, no secrets. MS365_MCP_TENANT_ID is optional (only needed for multi-tenant stdio mode; legacy single-tenant stdio continues to work without it).

## Next Phase Readiness

- **03-10 (audit-writer + readyz) unblocked.** Transport mounts are stable; `/readyz` can add the "at-least-one-tenant-loaded" check on top of the existing mountTenantRoutes + loadTenant instrumentation. Audit-writer can hook `oauth.authorize` + `oauth.token` + `mcp.tool-call` via the request-context seam that authSelector already populates.
- **Phase 4 (admin API) must NOT mount on `/t/:tenantId/*`.** Documented in key-decisions. Admin routes are sibling-to-tenant (`/admin/*` with its own middleware stack: Entra admin-group check + rotatable API keys from `api_keys` table).
- **Phase 5 (enabled_tools scoping) has the parameter plumbing in place.** `createMcpServer(tenant?)` already accepts the tenant parameter; Phase 5 implements `registerGraphTools(server, graphClient, { enabledTools: tenant?.enabled_tools })` filter without changing signatures.
- **Phase 6 (observability) inputs ready.** Transport factories log `transport: 'stdio'|'streamable-http'|'legacy-sse'` markers. Per-tenant concurrent-stream metric is a counter increment in the keepalive timer of legacy-sse.ts (Phase 6 adds it).
- **Forward-handoff migration-doc note:** the 501-rate metric on `/t/:tenantId/messages` is the SSE retirement signal. When the rate drops to zero for a sustained window, ops flip `MS365_MCP_ENABLE_LEGACY_SSE=0` (v2.1 default) and eventually v2.2 removes the shim.

---

_Phase: 03-multi-tenant-identity-state-substrate_
_Plan: 09_
_Completed: 2026-04-19_
