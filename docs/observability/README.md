# Observability Docs

This directory contains operator-facing documentation for the Phase 6 observability surface.

| File                                 | Audience          | Purpose                                             |
| ------------------------------------ | ----------------- | --------------------------------------------------- |
| `env-vars.md`                        | Operators         | Env var reference for OTel, Prometheus, rate limits |
| `runbook.md` (plan 06-07)            | On-call / SRE     | Alert patterns, tuning guide, reverse-proxy configs |
| `metrics-reference.md` (plan 06-07)  | Dashboard authors | Each metric: name, labels, typical values, PromQL   |
| `grafana-starter.json` (plan 06-07)  | Dashboard authors | 5-panel starter Grafana v10 dashboard               |
| `prometheus-scrape.yml` (plan 06-07) | Operators         | Reference scrape-target fragment                    |

See `.env.example` for the canonical list of env vars and their defaults.
