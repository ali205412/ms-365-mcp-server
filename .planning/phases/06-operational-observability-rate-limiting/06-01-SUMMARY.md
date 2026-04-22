---
phase: 06-operational-observability-rate-limiting
plan: "01"
subsystem: infra
tags:
  - otel
  - opentelemetry
  - prometheus
  - observability
  - env-vars
  - bootstrap
  - verification

# Dependency graph
requires:
  - phase: 01-foundation-hardening
    provides: "src/lib/otel.ts NodeSDK bootstrap (plan 01-07 OPS-02 landing) — OTLPTraceExporter, PrometheusExporter, auto-instrumentations for HTTP/Express/PG/IORedis with fs disabled"
provides:
  - "PrometheusExporter constructed with preventServerStart: true — exporter NO LONGER binds its own HTTP listener. Plan 06-03 will host getMetricsRequestHandler behind a Bearer-gated Express app."
  - "Named export `prometheusExporter: PrometheusExporter | undefined` from src/lib/otel.ts — plan 06-03 consumes this via dynamic import."
  - "ignoreOutgoingRequestHook on @opentelemetry/instrumentation-http that filters outbound POSTs targeting the OTLP collector host (closes Pitfall 7 — self-referential span flood under collector backpressure)."
  - "docs/observability/env-vars.md: operator-facing reference for every Phase 6 env var (OPS-05/06/07/08) with defaults, plan IDs, and security posture guidance."
  - "docs/observability/README.md: index page for the observability docs directory — cross-references planned 06-07 artifacts (runbook, metrics-reference, grafana-starter, prometheus-scrape)."
  - ".env.example phase6-observability + phase6-rate-limit region blocks documenting MS365_MCP_METRICS_PORT, MS365_MCP_METRICS_BEARER, MS365_MCP_DEFAULT_REQ_PER_MIN, MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN."
  - "test/lib/otel-bootstrap.test.ts — asserts SDK bootstrap invariants (first-import P-9, preventServerStart enforced, named export, global tracer + meter)."
affects:
  - "06-02 (OTel instrumentation at GraphClient.makeRequest — reuses bootstrap, no re-wire)"
  - "06-03 (metrics server hosts prometheusExporter behind Bearer auth)"
  - "06-04 (rate-limit middleware reads MS365_MCP_DEFAULT_* defaults)"
  - "06-07 (runbook + metrics-reference + grafana-starter land in same docs/observability/ directory)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "P-7 hoisted logger mock + vi.resetModules for side-effect module tests"
    - "P-9 first-import invariant asserted at test level (any reorder breaks CI)"
    - "P-10 region:/endregion: marker discipline for .env.example append-only extensions"
    - "preventServerStart + named exporter export pattern for metric endpoint hosting"
    - "ignoreOutgoingRequestHook pattern for self-export span filtering"

key-files:
  created:
    - "docs/observability/env-vars.md"
    - "docs/observability/README.md"
    - "test/lib/otel-bootstrap.test.ts"
  modified:
    - "src/lib/otel.ts"
    - ".env.example"

key-decisions:
  - "preventServerStart: true — exporter does not bind; plan 06-03 hosts the handler behind a dedicated Bearer-gated Express app (D-02)"
  - "MS365_MCP_METRICS_PORT env var (default 9464) — operators can override without code changes; consumed at otel.ts bootstrap and again by plan 06-03 metrics server"
  - "ignoreOutgoingRequestHook performs host-substring match against a pre-parsed URL.host extracted once at bootstrap — O(1) per outbound request; null/invalid endpoints are no-ops"
  - "Target IgnoreOutgoingRequestFunction signature accepts `string | null | undefined` for hostname/host (matches http.RequestOptions; crashing the SDK because the operator typoed OTEL_EXPORTER_OTLP_ENDPOINT is unacceptable)"
  - "env-vars.md documents 'NodeSDK bootstrap invariant' section — operators running with --require or a loader must apply it before application start"
  - "New observability docs live at docs/observability/ — future 06-07 artifacts (runbook, metrics-reference, grafana-starter.json, prometheus-scrape.yml) will land in the same directory"

patterns-established:
  - "Named export from side-effect module: assign to a `let` binding before SDK construction, expose via explicit `export { name }` at module tail — avoids default-export ambiguity while keeping the side-effect import pattern intact"
  - "Hoisted logger mock via vi.hoisted + vi.mock('../../src/logger.js') — per P-7; aligns with test/audit/audit-writer.test.ts and test/tenant/sharepoint-domain-migration.test.ts"
  - "Test the source-level contract when runtime inspection is infeasible — reading otel.ts content to match /ignoreOutgoingRequestHook/ is preferable to trying to invoke the hook through the SDK's private instrumentation tree"

requirements-completed:
  - OPS-05
  - OPS-06

# Metrics
duration: ~20min
completed: 2026-04-22
---

# Phase 6 Plan 01: OTel Bootstrap Verification + Env Var Contract Summary

**PrometheusExporter refactored to preventServerStart: true with named export for 06-03 hosting, ignoreOutgoingRequestHook closes Pitfall 7, and every Phase 6 env var documented in .env.example + docs/observability/env-vars.md.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-22T00:33Z (approx, worktree checkout + reads)
- **Completed:** 2026-04-22T00:45Z (final commit)
- **Tasks:** 3 (Task 3 committed first per TDD RED-GREEN ordering)
- **Files modified/created:** 5

## Accomplishments

- Phase 1's NodeSDK bootstrap in `src/lib/otel.ts` verified end-to-end for Phase 6 needs — no re-implementation, narrow refactor only (D-01 scope honored)
- `PrometheusExporter` now constructs with `preventServerStart: true`, so plan 06-03 can host `getMetricsRequestHandler` inside a dedicated Bearer-gated Express app (D-02)
- New named export `prometheusExporter: PrometheusExporter | undefined` is the stable API surface plan 06-03 imports
- `ignoreOutgoingRequestHook` on the http auto-instrumentation filters outbound requests targeting the OTLP collector host — closes Pitfall 7 (self-export span flood under slow-collector backpressure)
- Every Phase 6 env var is now documented in `.env.example` (two new region blocks) and `docs/observability/env-vars.md` (operator-facing reference with defaults, plan IDs, and security posture guidance)
- `test/lib/otel-bootstrap.test.ts` locks in eight invariants — SDK start with/without Prometheus, named export presence, preventServerStart enforcement, first-import invariant (P-9), ignoreOutgoingRequestHook source wiring, and global tracer + meter accessors

## Task Commits

Each task was committed atomically; Task 3 (RED test) was committed first to honour TDD ordering even though the plan file lists it third:

1. **Task 3: Write bootstrap verification test (RED phase)** — `86d7a1a` (test)
2. **Task 1: Refactor PrometheusExporter to preventServerStart + export it + add ignoreOutgoingRequestHook (GREEN phase)** — `48120ac` (feat)
3. **Task 2: Add Phase 6 env-var regions to .env.example + create docs/observability/env-vars.md + README.md** — `ceba02c` (docs)

_TDD note: Task 3 was written before Task 1's implementation existed; running `vitest` against it at that moment produced two expected failures (missing `prometheusExporter` export and missing `ignoreOutgoingRequestHook`). Task 1 turned those failures green without modifying the test — canonical RED → GREEN._

## Files Created/Modified

- **`src/lib/otel.ts`** (modified) — PrometheusExporter constructor now supplies `preventServerStart: true` + port resolution from `MS365_MCP_METRICS_PORT` (default 9464); module-level `prometheusExporter` binding + named export at tail; OTLP host extracted once at bootstrap for the `ignoreOutgoingRequestHook` closure; service-name resource, OTLPTraceExporter wiring, and shutdown hook preserved exactly.
- **`test/lib/otel-bootstrap.test.ts`** (created) — 8 tests across 5 describe blocks. Uses `vi.hoisted` + `vi.mock('../../src/logger.js')` so the side-effect import of otel.ts doesn't pull pino transports into the test process. Port 0 / 19464 selected to avoid collisions with real metric servers.
- **`.env.example`** (modified) — two appended regions: `phase6-observability` for OTel + Prometheus vars; `phase6-rate-limit` for 06-04 defaults. No existing region touched.
- **`docs/observability/env-vars.md`** (created) — operator-facing env var reference. Three tables (OTel, metrics server, rate limits) + security-posture guidance + NodeSDK bootstrap invariant note.
- **`docs/observability/README.md`** (created) — index of current + planned observability docs. Cross-references plan 06-07 artifacts so future agents land documentation consistently.

## Decisions Made

- **TDD ordering applied:** The plan lists Task 1 → Task 2 → Task 3 but Task 1 has `tdd="true"` and its verification target is `test/lib/otel-bootstrap.test.ts` (created in Task 3). Executing strictly in plan order would violate RED-then-GREEN. I ran Task 3 first (commit = RED: two expected failures), then Task 1 (commit = GREEN: all 8 tests pass), then Task 2 (docs, no test impact). This honours the plan's `<done>` criteria for all three tasks and preserves TDD discipline.
- **Type signature on ignoreOutgoingRequestHook:** The upstream `IgnoreOutgoingRequestFunction` type expects `req.hostname` / `req.host` to be `string | null | undefined` (follows `http.RequestOptions`). Narrowing to `string | undefined` caused a TS2322 against the auto-instrumentation contract. Widened the parameter type to `{ hostname?: string | null; host?: string | null }` and added a `typeof h === 'string'` runtime guard before calling `.includes(...)` — zero change to behaviour under any valid input.
- **Port 0 in two test cases:** `vi.stubEnv('MS365_MCP_METRICS_PORT', '0')` lets the kernel choose a free port inside the test, isolating the assertion from whatever real port a concurrent dev server might hold. The bind-collision test uses a deterministic high port (19464) instead so the success condition ("second listener on the same port binds cleanly") is testable.
- **Documentation placement:** `docs/observability/` was new. I created a minimal `README.md` listing planned 06-07 artifacts (runbook, metrics-reference, grafana-starter.json, prometheus-scrape.yml). Plan 06-07 will expand; this file is the anchor that keeps future docs in one discoverable place.

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed with the exact content, grep counts, and behavior criteria the plan specified. TDD ordering (Task 3 → 1 → 2 instead of 1 → 2 → 3) is not a deviation; it is the canonical way to satisfy a `tdd="true"` task whose test file is authored by a later task. The plan's `<acceptance_criteria>` and `<done>` blocks do not impose commit order, only that each task's artifacts exist and the verification gate passes at the end.

**Total deviations:** 0
**Impact on plan:** None. All downstream plans (06-02, 06-03, 06-04, 06-07) can proceed against the agreed API surface without adjustment.

## Issues Encountered

- **Pre-existing TypeScript errors (12) in files unrelated to this plan.** `npx tsc --noEmit` surfaces TS2307 "cannot find module './generated/client.js'" in `src/graph-tools.ts`, `src/index.ts`, `src/lib/tool-schema.ts`, and `src/lib/tool-selection/registry-validator.ts`. These are caused by `src/generated/client.ts` being absent from the worktree (regenerated at build via `npm run generate`; gitignored). Confirmed pre-existing by `git stash && npx tsc --noEmit` on a clean tree showing the same 12 errors. Out of scope per SCOPE BOUNDARY; my changes add zero new TypeScript errors.
- **Pre-existing test failures (133/1025) in the full suite.** Same root cause — tests importing `src/generated/client.js` fail at collection time when the file is absent. The plan's target test (`test/lib/otel-bootstrap.test.ts`) and spot-check tests that don't import the generated client (`test/retry-handler.test.ts`, `test/oauth-register.test.ts`, `test/logger-pino.test.ts`, `test/auth-paths.test.ts`, `test/auth-tools.test.ts`, `test/bm25.test.ts`, `test/deps.test.ts`) all pass. Out of scope.
- **Pre-existing prettier / eslint warnings** in 45 unrelated files. My 5 files all pass `npx prettier --check` and `npx eslint` cleanly.

## User Setup Required

None — no external service configuration required by this plan. Operators wanting to exercise the documented env vars can copy `.env.example` → `.env` and uncomment the `# MS365_MCP_METRICS_PORT=`, `# MS365_MCP_METRICS_BEARER=`, etc. lines. Plan 06-07's runbook will expand the operator story with sample Prometheus scrape targets.

## Next Phase Readiness

- **Plan 06-02 (OTel instrumentation at GraphClient.makeRequest):** Ready. `trace.getTracer('ms-365-mcp-server')` + `metrics.getMeter('ms-365-mcp-server')` verified accessible after `src/lib/otel.js` import. Plan 06-02 emits spans + counters from the single Graph chokepoint without re-wiring the SDK.
- **Plan 06-03 (Bearer-gated metrics server):** Ready. `import { prometheusExporter } from '../src/lib/otel.js'` returns the instance when `MS365_MCP_PROMETHEUS_ENABLED=1`. Plan 06-03 wraps `exporter.getMetricsRequestHandler` in a tiny Express app with `MS365_MCP_METRICS_BEARER` auth middleware, listening on `MS365_MCP_METRICS_PORT`.
- **Plan 06-04 (per-tenant rate limiting):** Ready. `MS365_MCP_DEFAULT_REQ_PER_MIN` + `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` are documented defaults that plan 06-04 reads when the tenant row's `rate_limits` column is NULL.
- **Plan 06-07 (runbook + dashboards):** Ready. `docs/observability/` is the committed directory; README indexes the planned artifacts so they will land with consistent naming.
- **Downstream verification:** The `ignoreOutgoingRequestHook` will activate only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; operators deploying without OTLP see a no-op hook. This is the intended posture and matches the existing "silent no-op when unset" contract.

## Self-Check: PASSED

- `src/lib/otel.ts` exists with `preventServerStart: true` (1 match), `export { prometheusExporter }` (1 match), `ignoreOutgoingRequestHook` (1 match).
- `test/lib/otel-bootstrap.test.ts` exists and passes 8/8 tests on `NODE_OPTIONS=--max-old-space-size=12288 npx vitest run test/lib/otel-bootstrap.test.ts`.
- `.env.example` contains `# region:phase6-observability` (1), `# endregion:phase6-observability` (1), `# region:phase6-rate-limit` (1), `# endregion:phase6-rate-limit` (1). Each Phase 6 env var name appears exactly once: `MS365_MCP_METRICS_PORT` (1), `MS365_MCP_METRICS_BEARER` (1), `MS365_MCP_DEFAULT_REQ_PER_MIN` (1), `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` (1).
- `docs/observability/env-vars.md` exists and contains `MS365_MCP_METRICS_PORT` and `preventServerStart`.
- `docs/observability/README.md` exists.
- Commits verified present: `86d7a1a`, `48120ac`, `ceba02c` (`git log --oneline -3`).
- `src/index.ts` line 2 still `import './lib/otel.js'` — `head -3 src/index.ts | grep -c "import './lib/otel.js'"` equals 1 (first-import invariant preserved).
- `src/lib/otel.ts` + `test/lib/otel-bootstrap.test.ts` clean under `npx eslint` and `npx prettier --check`.
- `npx tsc --noEmit` reports the same 12 pre-existing errors as the clean tree — zero new TS errors introduced by this plan.

---

_Phase: 06-operational-observability-rate-limiting_
_Plan: 01 — verify OTel bootstrap + document env var contract_
_Completed: 2026-04-22_
