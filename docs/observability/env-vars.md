# Observability Env Vars Reference

Phase 6 (Operational Observability & Rate Limiting) adds the following env vars. All are optional with sensible defaults.

## OpenTelemetry (plan 06-01, OPS-05 + OPS-06)

| Var                            | Default | Purpose                                                                                                                                                           |
| ------------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT`  | (unset) | OTLP/HTTP trace exporter URL (e.g., `http://otel-collector:4318`). When unset, NodeSDK starts but drops spans.                                                    |
| `MS365_MCP_PROMETHEUS_ENABLED` | `0`     | When `1` or `true`, PrometheusExporter wires up (constructed with `preventServerStart: true`) and plan 06-03's metrics server hosts `/metrics` on the port below. |

### NodeSDK bootstrap invariant

`src/index.ts` line 2 is `import './lib/otel.js'` — this registers auto-instrumentation hooks before pino, Express, or any transport module loads. Do not reorder. When running via `node --require` or a loader, ensure the loader is applied before the application start.

## Prometheus /metrics server (plan 06-03, OPS-07)

| Var                        | Default | Purpose                                                                                                                                                                                                                   |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MS365_MCP_METRICS_PORT`   | `9464`  | Port for the metrics Express app. Dedicated from the main transport port so scrape traffic is isolated from application auth.                                                                                             |
| `MS365_MCP_METRICS_BEARER` | (unset) | Optional Bearer token gating `GET /metrics`. When unset/empty, the endpoint is open — operators should bind only to 127.0.0.1 or behind a reverse-proxy ACL. When set, callers must send `Authorization: Bearer {token}`. |

### Metrics endpoint security posture

- **Localhost-only deploys:** leave `MS365_MCP_METRICS_BEARER` unset; bind 127.0.0.1:9464.
- **Publicly-exposed deploys:** set `MS365_MCP_METRICS_BEARER` to a random 32-byte token; document it to the Prometheus scrape job.
- **Reverse-proxy deploys:** either approach works; the proxy typically adds network ACLs and/or its own auth layer.

## Per-tenant rate limiting (plan 06-04, OPS-08)

| Var                                      | Default | Purpose                                                                                                                              |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MS365_MCP_DEFAULT_REQ_PER_MIN`          | `1000`  | Platform default request-rate ceiling (requests/minute/tenant) when the tenant row's `rate_limits` column is NULL.                   |
| `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` | `50000` | Platform default Graph token-budget (resource units/minute/tenant) when `rate_limits` is NULL. See runbook.md for tier-based sizing. |

Admin API `PATCH /admin/tenants/:id` accepts a `rate_limits` object (shape `{ request_per_min: int, graph_points_per_min: int }`) to override these per tenant.

## Where env vars are loaded

`dotenv/config` is imported AFTER `./lib/otel.js` in `src/index.ts` so that OTel reads env from the real process environment (systemd / Docker / CI), not from `.env`. Values documented here take effect on the next server restart.
