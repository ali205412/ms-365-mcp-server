# Metrics Reference

Complete list of metrics emitted by ms-365-mcp-server v2, their labels, source files, typical values, and ready-to-paste PromQL expressions.

All metrics carry the Meter scope `otel_scope_name="ms-365-mcp-server"` in the Prometheus exposition.

## Counter — `mcp_tool_calls_total`

| Property | Value                                               |
| -------- | --------------------------------------------------- |
| Type     | Counter (cumulative)                                |
| Labels   | `tenant`, `tool`, `status`                          |
| Source   | `src/graph-client.ts` — `makeRequest` finally block |
| Plan     | 06-02                                               |
| Unit     | —                                                   |

**Cardinality**: `tenant` = registered tenant count × `tool` = ~40 workload prefixes × `status` = ~15 HTTP status codes. For 10 tenants: ~6,000 series max.

**Labels — semantics:**

- `tenant`: Tenant ID from `requestContext.tenantId` (or `"unknown"` in stdio mode).
- `tool`: Workload prefix via `labelForTool(alias)` (D-06 cardinality guard). Examples: `mail`, `users`, `drives`, `powerbi`.
- `status`: HTTP response status as string (`"200"`, `"429"`, `"500"`, etc.).

**PromQL — requests per second per tenant:**

```promql
sum by (tenant) (rate(mcp_tool_calls_total[1m]))
```

**PromQL — error rate per tenant:**

```promql
sum by (tenant) (rate(mcp_tool_calls_total{status=~"[45].."}[5m])) / sum by (tenant) (rate(mcp_tool_calls_total[5m]))
```

## Histogram — `mcp_tool_duration_seconds`

| Property | Value                                               |
| -------- | --------------------------------------------------- |
| Type     | Histogram                                           |
| Labels   | `tenant`, `tool`                                    |
| Source   | `src/graph-client.ts` — `makeRequest` finally block |
| Plan     | 06-02                                               |
| Unit     | seconds                                             |

**PromQL — p95 latency per workload:**

```promql
histogram_quantile(0.95, sum by (le, tool) (rate(mcp_tool_duration_seconds_bucket[5m])))
```

**PromQL — p99 latency per tenant:**

```promql
histogram_quantile(0.99, sum by (le, tenant) (rate(mcp_tool_duration_seconds_bucket[5m])))
```

## Counter — `mcp_graph_throttled_total`

| Property | Value                                                 |
| -------- | ----------------------------------------------------- |
| Type     | Counter                                               |
| Labels   | `tenant`                                              |
| Source   | `src/graph-client.ts` + `src/lib/middleware/retry.ts` |
| Plan     | 06-02                                                 |

Increments on every HTTP 429 from Graph.

**PromQL — throttled requests/s per tenant:**

```promql
sum by (tenant) (rate(mcp_graph_throttled_total[5m]))
```

## Counter — `mcp_rate_limit_blocked_total`

| Property | Value                              |
| -------- | ---------------------------------- |
| Type     | Counter                            |
| Labels   | `tenant`, `reason`                 |
| Source   | `src/lib/rate-limit/middleware.ts` |
| Plan     | 06-04                              |

`reason` ∈ `{request_rate, graph_points}` — which budget was exhausted. Increments on every GATEWAY 429 (not Graph's 429 — that's `mcp_graph_throttled_total`).

**PromQL — blocked-per-reason:**

```promql
sum by (tenant, reason) (rate(mcp_rate_limit_blocked_total[5m]))
```

## Gauge (Observable) — `mcp_oauth_pkce_store_size`

| Property | Value                                           |
| -------- | ----------------------------------------------- |
| Type     | ObservableGauge                                 |
| Labels   | (none)                                          |
| Source   | `src/lib/pkce-store/*` via `wirePkceStoreGauge` |
| Plan     | 06-03                                           |

Single aggregate count — reveals only store population, not individual entries. PKCE entries have a 10-minute TTL in Redis.

**PromQL:**

```promql
mcp_oauth_pkce_store_size
```

## Gauge (Observable) — `mcp_token_cache_hit_ratio`

| Property | Value                                            |
| -------- | ------------------------------------------------ |
| Type     | ObservableGauge                                  |
| Labels   | `tenant`                                         |
| Source   | reserved — callback wiring deferred to follow-up |
| Plan     | 06-02 (instrument), 06-07+ wiring                |

Reserved for future MSAL cache instrumentation. Per-scrape delta of hits/acquires; Prometheus computes `rate()` at query time.

**PromQL (when wired):**

```promql
mcp_token_cache_hit_ratio
```

## UpDownCounter — `mcp_active_streams`

| Property | Value                                                 |
| -------- | ----------------------------------------------------- |
| Type     | UpDownCounter                                         |
| Labels   | `tenant`                                              |
| Source   | reserved — SSE + streamable HTTP open-socket tracking |
| Plan     | 06-02 (instrument), follow-up wiring                  |

## Span Attributes (not metrics — trace-only)

Emitted by the `graph.request` parent span in `src/graph-client.ts`:

| Attribute          | Cardinality             | Source                                                                  |
| ------------------ | ----------------------- | ----------------------------------------------------------------------- |
| `tenant.id`        | bounded by tenant count | requestContext.tenantId                                                 |
| `tool.name`        | ~40                     | `labelForTool(alias)` (workload prefix)                                 |
| `tool.alias`       | ~14k                    | Full tool alias (never a metric label)                                  |
| `http.status_code` | ~15                     | response.status                                                         |
| `graph.request_id` | unbounded per request   | response header `request-id` — file Microsoft support tickets with this |
| `retry.count`      | 0–3                     | requestContext.retryCount (from RetryHandler)                           |

## OTel Scope

Every metric carries:

```
otel_scope_name="ms-365-mcp-server"
otel_scope_version="<npm_package_version or undefined>"
```

Useful for filtering in a multi-service Prometheus deployment.
