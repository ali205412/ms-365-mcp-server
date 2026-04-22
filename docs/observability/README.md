# Observability Docs

Operator-facing documentation for the Phase 6 observability and rate-limit surface.

| File                                                   | Audience          | Purpose                                                                 |
| ------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------- |
| [env-vars.md](./env-vars.md)                           | Operators         | Env var reference for OTel, Prometheus, rate-limit defaults             |
| [runbook.md](./runbook.md)                             | On-call / SRE     | Alert patterns, troubleshooting, incident response                      |
| [metrics-reference.md](./metrics-reference.md)         | Dashboard authors | Per-metric specification: name, labels, source, PromQL                  |
| [grafana-starter.json](./grafana-starter.json)         | Dashboard authors | 5-panel Grafana v10+ starter dashboard (import via UI or `grafana-cli`) |
| [prometheus-scrape.yml](./prometheus-scrape.yml)       | Operators         | Reference Prometheus scrape-target fragment                             |
| [rate-limit-tuning.md](./rate-limit-tuning.md)         | Operators         | Sizing guide for per-tenant rate-limit budgets                          |
| [reverse-proxy/caddy.md](./reverse-proxy/caddy.md)     | Operators         | Caddy v2 reference config (recommended proxy)                           |
| [reverse-proxy/nginx.md](./reverse-proxy/nginx.md)     | Operators         | nginx reference config with SSE-friendly settings                       |
| [reverse-proxy/traefik.md](./reverse-proxy/traefik.md) | Operators         | Traefik label-based reference config                                    |

## Quickstart

Operator setup checklist for a new deployment:

1. Set env vars per [env-vars.md](./env-vars.md) — at minimum `MS365_MCP_PROMETHEUS_ENABLED=1` and an `OTEL_EXPORTER_OTLP_ENDPOINT` if you want traces.
2. Expose port 9464 (metrics) — either behind a network ACL (default posture) OR behind `MS365_MCP_METRICS_BEARER` (publicly-exposed deployments).
3. Point Prometheus at `/metrics` via [prometheus-scrape.yml](./prometheus-scrape.yml).
4. Import [grafana-starter.json](./grafana-starter.json) into Grafana v10+ for immediate visibility.
5. Tune per-tenant rate limits via admin API — see [rate-limit-tuning.md](./rate-limit-tuning.md).
6. Put a reverse proxy in front — [Caddy](./reverse-proxy/caddy.md) recommended; [nginx](./reverse-proxy/nginx.md) and [Traefik](./reverse-proxy/traefik.md) documented as alternatives. SSE endpoints (`/t/:tenantId/sse`) REQUIRE buffering-off directives.

## Architecture (Phase 6 scope)

See `.planning/ROADMAP.md` §Phase 6 for the 7-plan breakdown:

- Plan 06-01: OTel SDK bootstrap verification + env var contract
- Plan 06-02: `graph.request` parent span + per-request metric emission (OPS-05/06)
- Plan 06-03: Prometheus `/metrics` server with Bearer auth (OPS-07)
- Plan 06-04: Per-tenant sliding-window rate limiter (OPS-08)
- Plan 06-05: OAuth-surface integration test suite (ROADMAP SC#4/5)
- Plan 06-06: Multi-tenant correctness regression suite (SC#4)
- Plan 06-07: This documentation set
