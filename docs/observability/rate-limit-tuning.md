# Rate-Limit Tuning Guide

Per-tenant rate limits are enforced at the gateway via the plan 06-04 sliding-window limiter. Two budgets gate every Graph call:

- `request_per_min` — requests admitted per rolling 60-second window.
- `graph_points_per_min` — Graph Resource Units (from `x-ms-resource-unit` header) admitted per rolling 60-second window.

Either budget exhausted → gateway returns HTTP 429 + `Retry-After` BEFORE any Graph call.

## Platform Defaults

Configured via env vars (apply to tenants with `rate_limits = NULL`):

| Env Var                                  | Default | Meaning                  |
| ---------------------------------------- | ------- | ------------------------ |
| `MS365_MCP_DEFAULT_REQ_PER_MIN`          | 1000    | Requests/min/tenant      |
| `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` | 50000   | ResourceUnits/min/tenant |

## Per-Tenant Override

Use the admin API:

```
PATCH /admin/tenants/{id}
{
  "rate_limits": {
    "request_per_min": 2000,
    "graph_points_per_min": 150000
  }
}
```

Zod validators:

- `request_per_min`: positive integer, max `1_000_000`.
- `graph_points_per_min`: positive integer, max `10_000_000`.

Set `rate_limits: null` to clear the override and re-inherit platform defaults.

## Sizing Guide — Graph Points by Tenant SKU

Microsoft Graph enforces per-tenant resource unit ceilings:

| Graph Tier     | RU / 10s | RU / min (approx) | Conservative `graph_points_per_min` | Rationale                                                                                                |
| -------------- | -------- | ----------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Small (S)**  | 3,500    | 21,000            | **50,000**                          | ~24% of the 10s-peak — headroom for multiple tenants against the same Graph tenant, plus retry overhead. |
| **Medium (M)** | 5,000    | 30,000            | **150,000**                         | Same ratio as S.                                                                                         |
| **Large (L)**  | 8,000    | 48,000            | **300,000**                         | Same ratio as L.                                                                                         |

The `graph_points_per_min` budget is OUR gateway's per-tenant ceiling — it bounds how many ResourceUnits a single tenant can consume from the shared Graph-tenant allowance. Microsoft's actual rate limit is enforced separately at their end; if we 429 a tenant before Graph does, the tenant simply retries later against our budget without hitting Graph's limits.

**Starting rule of thumb:**

- Single-tenant deployment (one Graph tenant, one mcp tenant): use M-tier defaults.
- Multi-tenant deployment (one Graph tenant, N mcp tenants): divide M-tier by N and configure per-tenant.
- Cross-Graph deployment (mcp tenants mapped to DIFFERENT Graph tenants): use M-tier per mcp tenant.

## Sizing Guide — Request Rate

The request-rate budget caps raw tool-call volume regardless of workload. Typical values:

| Use Case                                     | `request_per_min` | Rationale                                                     |
| -------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| Human chat app (one AI assistant per tenant) | 200–500           | A single assistant rarely sustains > 5 tool calls per second. |
| Multiple assistants + automation             | 1,000 (default)   | Headroom for burst without abuse.                             |
| Batch workflows / background agents          | 2,000–5,000       | Elevated but capped to prevent runaway loops.                 |
| Public demo / untrusted clients              | 100               | Low cap; raise per customer.                                  |

## Observed-Cost Mechanism

The `graph_points_per_min` budget is observation-driven. When Graph returns a response with header `x-ms-resource-unit: 5`, the gateway adds 5 to the tenant's rolling count (fire-and-forget via RetryHandler's observe() hook, plan 06-04 D-05).

The INITIAL per-request cost at consume() time is 1 (conservative floor). The ACTUAL cost accrues as responses arrive. Over time the accumulated ZSET converges on the true weighted cost.

Implication: a single very-expensive request (`$expand=manager,team,directReports` = 7+ RU) may temporarily allow a burst beyond the budget before the observed cost catches up. Defense-in-depth: `parseResourceUnit` caps the observed weight at 100 per request (plan 06-04).

## Monitoring

See [runbook.md](./runbook.md) §Gateway rate-limit blocks for alert patterns. The metric `mcp_rate_limit_blocked_total{tenant, reason}` tells you immediately when a tenant is hitting their ceiling; the `reason` label distinguishes `request_rate` from `graph_points`.
