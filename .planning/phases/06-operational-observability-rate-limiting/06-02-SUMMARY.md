---
plan: 06-02
phase: 06-operational-observability-rate-limiting
status: complete
completed: 2026-04-22
tasks: 3/3
commits: 5
dependencies_addressed:
  - OPS-05
  - OPS-06
  - D-01
  - D-05
  - D-06
---

# Plan 06-02 — Per-Graph-request span + metric emission

## Completed Tasks

| # | Commit | Description |
|---|--------|-------------|
| 1 | `4556625` (test) + `6ac82b6` (feat) | otel-metrics Meter singleton + 7 instruments (Counter, Histogram, ObservableGauge, UpDownCounter) + labelForTool re-export from registry-validator |
| 2 | `093b80c` (test) + `8bc2299` (feat) | Wrap `GraphClient.makeRequest` in `graph.request` parent span; finally-block emission of mcpToolCallsTotal + mcpToolDurationSeconds + mcpGraphThrottledTotal (429 path); span attributes: tenant.id, tool.name (workload prefix), tool.alias (full), http.status_code, retry.count, graph.request_id |
| 3 | `9e77f78` | RetryHandler terminal-exit throttle-metric emission via updateContext centralization; 4 new unit tests |

## Key Artifacts

### New modules
- `src/lib/otel-metrics.ts` — Meter + 7 named instruments + labelForTool re-export + wirePkceStoreGauge helper
- `test/lib/otel-metrics.test.ts` — registry + label cardinality tests
- `test/lib/graph-client.span.test.ts` — span-attribute tests
- `test/lib/middleware/retry.span.test.ts` — 429 throttle-metric regression (4 tests)

### Modified
- `src/graph-client.ts` — tracer.startActiveSpan('graph.request') wrap + finally-block metric emission
- `src/graph-tools.ts` — requestContext.run augmented with toolAlias
- `src/lib/middleware/retry.ts` — import mcpGraphThrottledTotal; extend updateContext; add emitThrottleMetric helper
- `src/lib/tool-selection/registry-validator.ts` — no behavior change; export surface confirmed
- `src/request-context.ts` — added optional toolAlias?: string

## Cardinality Guard (D-06)

- `tool` metric label = workload prefix (first `/-/./_` segment, ~40 values)
- Full alias (~14k values) → span attribute `tool.alias` only (tracing backends tolerate high cardinality)
- Verified by `test/lib/otel-metrics.test.ts` — labelForTool cases cover all 5 product prefixes + beta + camelCase

## Verification

- Unit tier (`npm test`): 4/4 retry.span tests green; all otel-metrics + graph-client.span tests green from earlier commits
- Typecheck clean (`tsc --noEmit`)
- No regression in 40 Phase 2 middleware tests or 116 tool-selection/request-context tests

## Dependencies Unblocked

- 06-03 can now host the PrometheusExporter (already refactored in 06-01); metrics emitted from 06-02 become scrapeable once 06-03 wires the /metrics server
- 06-04 can import `mcpRateLimitBlockedTotal` directly for its 429-before-Graph blocks
- 06-07 runbook has named instruments to document

## Self-Check: PASSED

All 3 tasks atomic commits. SUMMARY committed. No shared-artifact modifications.
