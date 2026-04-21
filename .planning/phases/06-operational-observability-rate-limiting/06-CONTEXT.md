# Phase 6: Operational Observability & Rate Limiting — Context

**Gathered:** 2026-04-21
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 6 --auto (Claude selected recommended defaults; all auto-decisions logged with rationale for user review)

<domain>
## Phase Boundary

A production multi-tenant deployment becomes **observable**, **throttle-safe**, and **verifiably correct on the OAuth surface**. Four independent outcomes:

1. **Traces** — Every Graph request emits an OTel span with `{tenant, tool, status, duration_ms, retry_count, http.status_code, graph.request_id}` attributes, exported via OTLP/HTTP to a user-configured collector.
2. **Metrics** — Per-tenant counters + histograms scraped by Prometheus from the server's `/metrics` endpoint.
3. **Rate limits** — Per-tenant request-count + Graph-token-budget enforced via Redis sliding-window counters. 429 returned from the gateway _before_ any Graph call when budget exhausted.
4. **Test coverage** — OAuth surface (PKCE store, /authorize, /token, /register, /.well-known/\*) climbs from **0% → 70%+**; multi-tenant correctness (token isolation, tenant disable cryptoshred, bearer tid mismatch) verified in CI.

Scope is fixed by ROADMAP.md. This discussion captures HOW, not WHAT.

</domain>

<decisions>
## Implementation Decisions

### OTel Bootstrap Reuse

- **D-01:** **Reuse `src/lib/otel.ts`** (landed in Phase 1). Plan 06-01 scope collapses from "bootstrap OTel SDK" to "verify bootstrap still works end-to-end + document env var contract". The existing module already wires `NodeSDK` with `OTLPTraceExporter`, `PrometheusExporter` on port 9464, auto-instrumentations for HTTP/Express/PG/IORedis with fs disabled, and a `ms-365-mcp-server` service-name resource.
    - **Why:** Re-implementing is pure churn. The Phase 1 landing is already imported as the very first line of `src/index.ts` so instrumentation hooks register before pino, Express, or any transport.
    - **How to apply:** Plan 06-01 becomes a verification + documentation plan. Any missing auto-instrumentations (if the researcher finds gaps) get added inline rather than rewritten.

### Metrics Endpoint Auth

- **D-02:** **Metrics on dedicated port 9464, gated by optional Bearer token for non-localhost deployments.** `MS365_MCP_METRICS_BEARER` env var; when set, `/metrics` requires `Authorization: Bearer {token}`; when unset, endpoint is open (assumes localhost-only or reverse-proxy auth).
    - **Why:** ROADMAP text explicitly calls for "optional Bearer auth for non-localhost deployments" on plan 06-03. Matches the Phase 4 admin API dual-stack pattern (OAuth OR API-key) but simpler since Prometheus scrapers don't do OAuth.
    - **How to apply:** Wrap the PrometheusExporter HTTP handler with a Bearer-check middleware. The existing `PrometheusExporter({ port: 9464 })` in `otel.ts` needs a small refactor to let us hook a pre-handler middleware OR we run a tiny dedicated Express app on 9464 that delegates to the exporter's `getMetricsRequestHandler()`.

### Rate-Limit Algorithm

- **D-03:** **Redis sliding-window via ZSET + current-timestamp scores.** `ZADD mcp:rl:req:{tenantId} {now_ms} {request_id}` → `ZREMRANGEBYSCORE ... 0 {now_ms - window_ms}` → `ZCARD` returns current count. Atomically wrapped in a Lua script for race safety.
    - **Why:** Fair across window boundaries (unlike fixed-window `INCR+EXPIRE` which double-counts at the boundary). Higher-volume request-rate limiter deserves the better algorithm — this will fire on every Graph call.
    - **How to apply:** New module `src/lib/rate-limit/sliding-window.ts` exports `consume(tenantId, windowMs, max): Promise<{allowed: bool, retryAfterMs?: number}>`. Existing webhook fixed-window rate-limit in `src/lib/admin/webhooks.ts` stays — it's for 401 flood protection on a different code path.

### Rate-Limit Granularity

- **D-04:** **Per-tenant only.** Single request-rate budget per tenant, single Graph-point budget per tenant. No per-tool or per-user sub-budgets.
    - **Why:** ROADMAP specifies "configure a tenant's request budget" (tenant-level). Per-tool would explode counter cardinality (42K tools × N tenants); per-user complicates admin UX (who owns the budget?). Tenant is the billing boundary — it's the right budget boundary.
    - **How to apply:** Admin API PATCH `/admin/tenants/:id` gains `rate_limits` sub-object: `{request_per_min: number, graph_points_per_min: number}`. Absent = inherit platform default.

### Graph Token Budget Accounting

- **D-05:** **Parse `Retry-After` + `x-ms-resource-unit` headers from Graph responses into per-tenant ZSET.** Key: `mcp:rl:graph:{tenantId}`. Score: observed cost at request time (default 1 when headers absent; parsed weight from `x-ms-resource-unit` when present). Sliding window matches the request-rate window (default 60s).
    - **Why:** ROADMAP explicitly: "accumulated from observed Graph throttle headers". Observation-based scales automatically as Graph policy changes and across workloads (Mail.Read is cheap, Reports API is expensive). Estimating from a static cost table would rot.
    - **How to apply:** `src/lib/middleware/retry-handler.ts` (Phase 2) already parses `Retry-After`. Extend it to also call `rateLimit.observe(tenantId, resourceUnits)`. The sliding-window module gains an `observe(tenantId, weight)` sibling to `consume`.

### Metric Label Cardinality

- **D-06:** **Respect ROADMAP labels as-specified (`{tenant, tool, status}`) but use workload prefix — not full tool alias — for the `tool` label.** `tool` label value = first segment before `.` of the alias (e.g., `mail`, `drives`, `users`, `__powerbi__`). Full tool alias still appears as an OTel span attribute (`tool.alias`) so traces carry it losslessly.
    - **Why:** Full alias = 42K+ distinct values. Cardinality = 42K × 5 statuses × N tenants. At 10 tenants that's 2.1M series per metric — Prometheus OOMs. Workload prefix is ~40 values × 5 statuses × 10 tenants = 2K series, well within Prometheus comfort zone.
    - **How to apply:** `src/lib/otel-metrics.ts` exports a single helper `labelForTool(alias): string` used at metric emission sites. Researcher: verify Prometheus best-practice ceiling; if Phase 6 picks a managed Prometheus (Grafana Cloud, Mimir) with higher ceilings, revisit.

### Integration Test Infrastructure

- **D-07:** **Mix — Testcontainers for CI integration runs, pg-mem + MemoryRedisFacade for local/unit.** Gated by `MS365_MCP_INTEGRATION=1` env var which vitest config already honors (`.int.test.*` files are excluded from the default suite). CI sets the flag; local dev runs fast.
    - **Why:** Existing admin suites use pg-mem/MemoryRedisFacade — keep them. New OAuth-surface tests (06-05) need real HTTP round trips + real Redis TTL semantics to verify PKCE concurrency and token isolation. Testcontainers already installed transitively via test harness.
    - **How to apply:** Extend `test/integration/` directory with `oauth-surface/` subfolder. Each file named `*.int.test.ts`. CI pipeline runs `MS365_MCP_INTEGRATION=1 npm test`.

### Metrics Endpoint Port Binding

- **D-08:** **Bind Prometheus on a dedicated port (default 9464), configurable via `MS365_MCP_METRICS_PORT`.** Kept separate from the main transport port to isolate scrape traffic from application auth and rate-limit scope.
    - **Why:** Matches ROADMAP spec plan 06-03. Cleaner security model: main app can be behind OAuth; metrics port behind network ACL or the Bearer from D-02.
    - **How to apply:** Already wired this way in `src/lib/otel.ts`. Expose as a documented env var in `.env.example` and `docs/observability/`.

### Grafana Dashboard Scope

- **D-09:** **Ship a starter JSON with 3-5 essential panels, not a comprehensive dashboard.** Panels: (1) requests/sec per tenant, (2) p50/p95/p99 latency per workload, (3) 429s blocked per tenant, (4) token-cache hit ratio, (5) PKCE store size.
    - **Why:** ROADMAP: "starter committed under docs/observability/". Operators customize dashboards — shipping 20+ panels creates maintenance burden for no value. 5 panels demonstrates the metric set and intent.
    - **How to apply:** `docs/observability/grafana-starter.json` committed as Grafana v10-compatible dashboard JSON. Ship alongside a README that documents each panel's metric source.

### OAuth-Surface Test Baseline

- **D-10:** **Target ≥70% line coverage on `src/server.ts` OAuth-handler code paths specifically** (not on the whole file — the MCP transport branches would skew the number). Measured by `vitest run --coverage` with a per-region include filter.
    - **Why:** ROADMAP success-criterion #5 says "70% on OAuth-surface lines". CONCERNS.md originally logged 0% — closing this gap is the pitch. Whole-file coverage masks the actual OAuth path.
    - **How to apply:** Add `coverage.include: ['src/server.ts']` + a custom reporter or script to filter output to OAuth-specific line ranges. Acceptance gate in plan 06-05 verification.

### Rate-Limit Admin API Surface

- **D-11:** **Admin PATCH `/admin/tenants/:id` gains optional `rate_limits: { request_per_min, graph_points_per_min }` field. Validated by Zod; missing or null = platform defaults (`MS365_MCP_DEFAULT_REQ_PER_MIN`, `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN`).**
    - **Why:** Reuses existing admin CRUD path (plan 04-02). No new REST surface area; no new auth path; audit row written via the existing `writeAudit` call.
    - **How to apply:** Extend `UpdateTenantZod` schema in `src/lib/admin/tenants.ts`. Migration `20260901000000_tenant_rate_limits.sql` adds `rate_limits JSONB NULL` column. Tenant loader surfaces `rate_limits` on `req.tenant` for the rate-limit middleware to consult.

### Claude's Discretion

- **Span attribute schema beyond the ROADMAP-required set** — planner/researcher can add `authFlow`, `cache.hit`, or similar if they surface useful distinctions.
- **Rate-limit Lua script file layout** — single script vs multiple; separate or shared with webhook rate-limit.
- **Testcontainers startup orchestration** — globalSetup vs per-file; Docker-in-Docker vs host-bound.
- **Which documented alerts ship in the runbook** — minimum set implied by ROADMAP, but exact alert expressions are operator taste.

</decisions>

<specifics>
## Specific Ideas

- **Metric names** (locked by ROADMAP plan 06-03 success criterion 1):
    - `mcp_tool_calls_total{tenant, tool, status}`
    - `mcp_tool_duration_seconds{tenant, tool}` (histogram)
    - `mcp_graph_throttled_total{tenant}`
    - `mcp_oauth_pkce_store_size` (gauge, no labels)
    - `mcp_token_cache_hit_ratio{tenant}` (gauge)
    - `mcp_active_streams{tenant}` (gauge)
    - `mcp_rate_limit_blocked_total{tenant, reason}` (added by plan 06-04)

- **Span attributes** (locked by ROADMAP plan 06-02 success criterion 2):
    - `tenant.id`, `tool.name` (workload prefix), `tool.alias` (full, addition per D-06), `http.status_code`, `graph.request_id` (when ODataError carries it), `retry_count`, `duration_ms`

- **Redis key schemes** (new — locked here):
    - `mcp:rl:req:{tenantId}` — request-count sliding window (ZSET)
    - `mcp:rl:graph:{tenantId}` — Graph-point sliding window (ZSET)
    - Keys inherit TTL = window_ms × 2 as a cleanup safety net

- **Env vars** (new — locked here):
    - `MS365_MCP_METRICS_PORT` (default 9464)
    - `MS365_MCP_METRICS_BEARER` (optional)
    - `MS365_MCP_DEFAULT_REQ_PER_MIN` (default 1000)
    - `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` (default 50000)
    - `OTEL_EXPORTER_OTLP_ENDPOINT` (already read by `otel.ts`)
    - `MS365_MCP_PROMETHEUS_ENABLED` (already read by `otel.ts`)

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + Requirements

- `.planning/ROADMAP.md` §Phase 6 — goal, success criteria, 7-plan breakdown
- `.planning/REQUIREMENTS.md` §OPS-05..08 — acceptance criteria for metrics/traces/rate-limits

### Phase dependencies (existing code the planner must NOT re-implement)

- `src/lib/otel.ts` — **OTel SDK bootstrap already landed (Phase 1)**. Reuse; do not rewrite.
- `src/index.ts` — First import is `./lib/otel.js`. Do not reorder.
- `src/graph-client.ts` — Existing `GraphClient.makeRequest` is the single chokepoint for all Graph traffic. Plan 06-02 instruments HERE, not at N call sites.
- `src/lib/middleware/retry-handler.ts` (Phase 2) — Already parses `Retry-After`. Plan 06-02 extends to emit `mcp_graph_throttled_total` increment; D-05 extends to call `rateLimit.observe`.
- `src/lib/admin/tenants.ts` — Admin PATCH handler that plan 06-04 extends with `rate_limits` field.
- `src/lib/admin/webhooks.ts` — Existing fixed-window rate-limit for 401 flood protection. **Different concern, stays as-is.** Plan 06-04's sliding-window is a NEW module for request-rate.
- `src/lib/redis-facade.ts` — Memory-backed Redis for tests. Add stubs for ZSET commands if missing.

### Previous phase summaries (decisions already made)

- `.planning/phases/01-foundation-hardening/01-07-SUMMARY.md` — OTel bootstrap landing
- `.planning/phases/02-graph-transport-middleware-pipeline/02-02-SUMMARY.md` — RetryHandler patterns
- `.planning/phases/03-multi-tenant-identity-state-substrate/03-02-SUMMARY.md` — Redis patterns
- `.planning/phases/04-admin-api-webhooks-delta-persistence/04-03-SUMMARY.md` — Admin API patterns
- `.planning/phases/04-admin-api-webhooks-delta-persistence/04-07-SUMMARY.md` — Webhook rate-limit reference

### Configuration (existing)

- `vitest.config.js` — `MS365_MCP_INTEGRATION=1` flag already gates `.int.test.*` files. Plan 06-05 relies on this.
- `.env.example` — Plan 06-07 extends with new env vars listed in Specifics above.

### External standards (planner should cite during research)

- OpenTelemetry Semantic Conventions v1.27 — attribute naming (tenant.id, http.status_code)
- Prometheus best practice — [cardinality guidelines](https://prometheus.io/docs/practices/naming/#labels) (drives D-06)
- RFC 6585 §4 — `Retry-After` header semantics (for D-05 parsing)
- Microsoft Graph throttling docs — `x-ms-resource-unit` response header

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/lib/otel.ts`** — Full NodeSDK bootstrap. Trace exporter via `OTLPTraceExporter`, metric reader via `PrometheusExporter({port: 9464})`, auto-instrumentations. **109 lines. Done.**
- **`src/lib/redis-facade.ts`** — `MemoryRedisFacade` for tests. Already supports `on`/`subscribe`/`publish`/`INCR`/`EXPIRE`. ZSET support may need adding.
- **`src/lib/middleware/retry-handler.ts`** — Parses `Retry-After`; emits a structured log on 429. D-05 extends.
- **`src/lib/admin/tenants.ts`** — Admin CRUD pattern. Plan 06-04 extends with `rate_limits`.
- **`src/lib/admin/webhooks.ts` §Path 0** — Existing fixed-window rate-limit (`INCR`+`EXPIRE`) for per-IP 401 flood. Cite in plan 06-04 as contrast — distinct from request-rate.
- **Migrations directory** — 7 migrations exist (Phase 1-5.1). Plan 06-04 adds `20260901000000_tenant_rate_limits.sql`.

### Established Patterns

- **First-import otel** — `src/index.ts` imports `./lib/otel.js` before anything else so auto-instrumentation wraps everything. Plan 06 must not add imports above this.
- **Redis key prefixing** — `mcp:*`. Plan 06-04's sliding-window uses `mcp:rl:*`.
- **Middleware chain order** — Outer-to-inner: `ETag → Retry → ODataError → TokenRefresh`. Plan 06-02 hooks metric emission at the `Retry` layer (after throttle handling) rather than outermost/innermost.
- **Admin API** — Zod validation + audit log + Redis pub/sub invalidation. Plan 06-04's tenant rate-limit config mutations follow this.
- **Integration test gate** — `.int.test.ts` excluded unless `MS365_MCP_INTEGRATION=1`. CI sets it; local dev runs fast.
- **MSAL import order** — `src/auth.ts` lazy-imports heavy deps. Plan 06 stays clear of this surface.

### Integration Points

- **`GraphClient.makeRequest`** — Single entrypoint for all Graph traffic. Plans 06-02 (metrics+traces) and 06-04 (rate-limit gate) wrap this.
- **Admin PATCH flow** — `src/lib/admin/tenants.ts:/:id` → Zod → Postgres UPDATE → audit → Redis publish. Plan 06-04 extends the Zod schema and publishes a `mcp:tenant-invalidate` event so the rate-limit middleware rereads the tenant row.
- **TenantPool** — Plan 06-04's middleware reads per-tenant rate limits from `req.tenant.rate_limits`, which the existing `loadTenant` middleware populates.
- **Prometheus scrape target** — Dedicated port 9464. Docker Compose reference (plan 06-07) exposes this port alongside the main transport port.

</code_context>

<deferred>
## Deferred Ideas

**None of the following are in Phase 6 scope. Captured so they're not lost.**

- **Per-tool rate limiting** — D-04 explicitly scopes to tenant-only. If operator experience reveals need for per-tool budgets, that's a v1.1 addition.
- **Distributed tracing across Graph's internal hops** — OTel only traces the server-side span; the Microsoft-internal `requestId` is carried as an attribute but not a child span. Adding true distributed propagation into Graph would require Microsoft-side support.
- **Grafana Cloud / managed Prometheus preset** — Starter dashboard is generic. Shipping provider-specific variants is v1.1 work if demand emerges.
- **Per-tenant alert rule ship-alongs** — Runbook (plan 06-07) documents alerts but doesn't ship Alertmanager/Grafana alert rules. Operators install those themselves.
- **AI-driven anomaly detection on metrics** — Nice-to-have; out of scope.
- **Soft vs. hard rate-limit (preview mode)** — Plan 06-04 ships hard-limit (429). Soft-limit observation-only mode is a v1.1 iteration if needed.
- **Audit log shipping to SIEM** — Separate operator concern; Phase 4 already writes structured audit rows.
- **Per-tool cost estimation based on `x-ms-resource-unit` history** — D-05 observes; Phase 6 does not build predictive cost models.

</deferred>

---

*Phase: 06-operational-observability-rate-limiting*
*Context gathered: 2026-04-21 via /gsd-discuss-phase --auto*
*All 11 locked decisions (D-01..D-11) were auto-selected from the ROADMAP-recommended first option with rationale logged. User should review and redirect any decision before /gsd-plan-phase 6 runs.*
