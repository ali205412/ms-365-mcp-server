# Phase 6 Runbook — Alerts, Troubleshooting, Incident Response

This runbook covers operational response patterns for the metrics and rate-limit surface landed in Phase 6. It does NOT replace the Phase 3/4 runbooks; it complements them. For KEK rotation see `.planning/phases/03-multi-tenant-identity-state-substrate/03-04-SUMMARY.md` and `bin/rotate-kek.mjs`. For audit-log queries see `.planning/phases/04-admin-api-webhooks-delta-persistence/04-05-SUMMARY.md` and the `GET /admin/audit` endpoint.

## Alert Patterns

### Graph throttling — `mcp_graph_throttled_total`

**PromQL:**

```promql
sum by (tenant) (rate(mcp_graph_throttled_total[5m])) > 0.5
```

**What it means:** Graph is returning HTTP 429 to this tenant at > 0.5/s. Could be legitimate (tenant exceeding Graph's per-tenant quotas — Microsoft S-tier = 3,500 ResourceUnits / 10s) or a bug (RetryHandler not backing off correctly).

**Response:**

1. Check `mcp_tool_calls_total{tenant=X, status="429"}` — high 429 count?
2. Check trace exemplars for `graph.request` spans with high `retry.count` values (Phase 2 RetryHandler already backs off per `Retry-After`).
3. If legitimate: consider tenant-specific rate-limit tuning via admin API (see [rate-limit-tuning.md](./rate-limit-tuning.md)).
4. If a bug: check the RetryHandler's `Retry-After` parsing for regressions (02-02-SUMMARY.md).

### Gateway rate-limit blocks — `mcp_rate_limit_blocked_total`

**PromQL:**

```promql
sum by (tenant, reason) (rate(mcp_rate_limit_blocked_total[5m])) > 0.1
```

**What it means:** The GATEWAY (not Graph) is 429ing a tenant. `reason` is either `request_rate` (per-minute request ceiling) or `graph_points` (resource-unit ceiling). These are gateway budgets you've configured via admin API, not Microsoft's.

**Response:**

1. Identify the tenant + reason: `sum by (tenant, reason) (rate(mcp_rate_limit_blocked_total[5m]))`
2. Decide: is this a misbehaving client that should stay blocked? Or a legitimate tenant whose budget is too tight?
3. To raise the budget for one tenant: `PATCH /admin/tenants/:id {"rate_limits": {"request_per_min": 2000, "graph_points_per_min": 100000}}`.
4. To raise the platform default for all tenants without explicit config: adjust `MS365_MCP_DEFAULT_REQ_PER_MIN` / `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` env vars and restart.

See [rate-limit-tuning.md](./rate-limit-tuning.md) for the sizing guide.

### p95 latency degradation — `mcp_tool_duration_seconds`

**PromQL:**

```promql
histogram_quantile(0.95, sum by (le, tool) (rate(mcp_tool_duration_seconds_bucket[5m]))) > 5
```

**What it means:** p95 latency for a workload exceeds 5 seconds. Likely causes: Graph-side slowdown, network partition to Entra, oversized page sizes, retry storms.

**Response:**

1. Check `mcp_graph_throttled_total` — is it correlated? Throttling causes retries which multiply observed duration.
2. Check traces — look for long-running `graph.request` spans; inspect `retry.count` attribute.
3. Check Graph-side request-id (span attribute `graph.request_id`) against the Microsoft Graph service-health status.

### 5xx rate spike

**PromQL:**

```promql
sum by (tenant) (rate(mcp_tool_calls_total{status=~"5.."}[5m])) > 0.1
```

**What it means:** Graph responses > 500 status code at > 0.1/s. Phase 2's RetryHandler handles 502/503/504 with backoff; 500 is passed through.

**Response:**

1. Check `status` label distribution — 502/503/504 vs 500 vs other 5xx.
2. 500 from Graph = upstream bug, consider filing a Microsoft support ticket with the `graph.request_id` from the span.
3. 503 = throttling or maintenance; Phase 2 retries automatically. If exhausting retries, widen `MS365_MCP_RETRY_MAX_ATTEMPTS`.

### PKCE store size growth — `mcp_oauth_pkce_store_size`

**PromQL:**

```promql
mcp_oauth_pkce_store_size > 10000
```

**What it means:** PKCE store (Redis-backed per 03-03) has > 10k entries. Each entry has a 10-minute TTL; sustained high values suggest a client is /authorize-ing without /token-ing (abandoned flows).

**Response:**

1. Check `mcp:pkce:*` keys in Redis: `redis-cli KEYS "mcp:pkce:*" | wc -l`
2. Abandoned flows self-expire within 10m. Sustained growth = client bug OR abuse.
3. If abuse: consider tightening `/authorize` rate-limits (Phase 6 plan 06-04 middleware) or adding a per-IP gate at the reverse proxy.

## Troubleshooting

### /metrics returns 401

Check `MS365_MCP_METRICS_BEARER` env var:

- Unset/empty: endpoint is open — scraper should NOT send Authorization.
- Set: scraper MUST send `Authorization: Bearer {token}` exactly matching the env value.

The comparison is constant-time via `crypto.timingSafeEqual` so a 401 on mismatch reveals only the length of the expected token (acceptable per D-02 threat model).

### /metrics returns 503

Metrics server is running but Prometheus exporter returned an error. Check server logs for the startup message:

```
plan 06-03 — metrics server listening on all interfaces { metricsPort: 9464, bearerGated: true }
```

If the log is absent, `MS365_MCP_PROMETHEUS_ENABLED` was not `1` at startup.

### Rate-limit middleware returns 503

Redis is unavailable. Middleware fails closed (documented in Security Domain §Checklist). Recovery:

1. Check Redis health: `redis-cli PING` (from within the container network).
2. Check the server's `/readyz` — Phase 3 flips this to 503 when Redis is unreachable.
3. Fix the Redis connection; requests recover automatically.

### Trace spans missing from OTLP collector

Common causes:

1. `OTEL_EXPORTER_OTLP_ENDPOINT` unset — SDK starts but drops spans (Pitfall 1 in RESEARCH.md).
2. Collector unreachable — check server logs for OTLP export errors.
3. ESM auto-instrumentation gap (Pitfall 9 in RESEARCH.md) — our manual spans in `graph.request` should still flow, but auto-spans on Express/pg/ioredis may not. Operators running with `NODE_OPTIONS='--experimental-loader=@opentelemetry/instrumentation/hook.mjs'` get fuller coverage.

## Incident Response

### Redis outage

**Signal:** `mcp_rate_limit_blocked_total` drops to zero (nothing to measure) + 503s from the gateway.

**Response:**

1. Verify via `/readyz` — Phase 3 readiness probe returns 503 when Redis is down.
2. Restart Redis; the MCP gateway does NOT need restart (lazy Redis connect via ioredis).
3. After recovery, rate-limit counters are FRESH — tenants that hit their ceiling during the outage window get a free window. This is acceptable; document in post-mortem.

### Entra AAD outage

**Signal:** 401/403 spike on `mcp_tool_calls_total` across many tenants + p95 latency spike.

**Response:**

1. Check MSAL token acquire errors in server logs.
2. Consult Microsoft 365 Service Health.
3. Our gateway cannot help — we're a passthrough. Customers will see errors; once Entra recovers, clients automatically reconnect.

### Tenant impersonation detected (T-06-05)

**Signal:** Audit log shows `auth.tid_mismatch` entries.

**Response:**

1. Query: `GET /admin/audit?action=auth.tid_mismatch&since=...`.
2. Identify the URL tenant and the token's `tid` — note both tenant IDs and the caller IP.
3. If coordinated: consider disabling the offending tenant's client registration or rotating the targeted tenant's DEK (Phase 3 cryptoshred primitive — see `bin/disable-tenant.mjs`).

### Security incident — suspected token leak

1. Identify the tenant: usually appears in Entra's sign-in logs first.
2. Rotate the tenant's secrets: `PATCH /admin/tenants/:id` with new `client_secret_ref` + invoke DEK rotation (Phase 3 plan 03-04).
3. Cryptoshred the current cache: tenant delete + re-create, OR admin API tool rotates the DEK explicitly.

See [KEK rotation procedure (phase 03-04-SUMMARY.md)](../../.planning/phases/03-multi-tenant-identity-state-substrate/03-04-SUMMARY.md) for the deeper rotation playbook.

## Cross-Reference Index

| Topic                    | Primary doc                                                                                         | Why cross-referenced                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| KEK + DEK rotation       | `.planning/phases/03-multi-tenant-identity-state-substrate/03-04-SUMMARY.md` + `bin/rotate-kek.mjs` | Phase 3 owns the rotation primitive; Plan 06-07 does not duplicate. |
| Audit-log query cookbook | `.planning/phases/04-admin-api-webhooks-delta-persistence/04-05-SUMMARY.md` + `GET /admin/audit`    | Phase 4 owns the query surface.                                     |
| Graceful shutdown        | `.planning/phases/01-foundation-hardening/01-05-SUMMARY.md`                                         | Phase 1 owns the shutdown contract.                                 |
| MSAL pool eviction       | `.planning/phases/03-multi-tenant-identity-state-substrate/03-05-SUMMARY.md`                        | Phase 3 owns the pool.                                              |
| PKCE store lifecycle     | `.planning/phases/03-multi-tenant-identity-state-substrate/03-03-SUMMARY.md`                        | Phase 3 owns the store.                                             |
