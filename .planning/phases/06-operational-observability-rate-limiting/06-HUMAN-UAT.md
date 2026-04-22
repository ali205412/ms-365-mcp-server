---
status: partial
phase: 06-operational-observability-rate-limiting
source: [06-VERIFICATION.md]
started: 2026-04-22
updated: 2026-04-22
---

## Current Test

awaiting human testing

## Tests

### 1. Integration suite + coverage gate (live Docker required)
expected: `MS365_MCP_INTEGRATION=1 npm test` runs all `.int.test.ts` files green against Testcontainers-provided Postgres + Redis; `npm run test:oauth-coverage` exits 0 with ≥70% on OAuth-handler line ranges of `src/server.ts`.
result: pending — Docker Hub image-pull rate limit blocked harness startup in the automated-run sandbox (see `deferred-items.md`).

### 2. Live /metrics scrape (requires running gateway)
expected: With `docker compose up` running a multi-tenant gateway (`MS365_MCP_PROMETHEUS_ENABLED=true`, `MS365_MCP_METRICS_BEARER=testtoken`), `curl -H 'Authorization: Bearer testtoken' http://localhost:9464/metrics` returns 200 with `# TYPE mcp_tool_calls_total counter` in body; unauthenticated curl returns 401 + `WWW-Authenticate: Bearer`.
result: pending — needs operator to launch Docker Compose stack and exercise the scrape endpoint.

### 3. Grafana v10 dashboard import (requires Grafana instance)
expected: Importing `docs/observability/grafana-starter.json` into a Grafana v10+ instance renders all 5 panels (requests/sec per tenant, p50/p95/p99 latency, 429 rate, token-cache hit ratio, PKCE store size) without schema-validation errors.
result: pending — needs Grafana instance + Prometheus datasource configured.

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps

None. All programmatic verification passed; only live-environment smoke tests remain.
