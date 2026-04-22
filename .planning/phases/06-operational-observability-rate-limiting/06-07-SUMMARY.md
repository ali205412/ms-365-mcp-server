---
phase: 06-operational-observability-rate-limiting
plan: "07"
subsystem: docs
tags:
  - docs
  - runbook
  - grafana
  - prometheus
  - rate-limit-tuning
  - reverse-proxy
  - observability
  - d-09

# Dependency graph
requires:
  - phase: 06-operational-observability-rate-limiting
    provides: "Metric names + labels from plans 06-02 (mcp_tool_calls_total, mcp_tool_duration_seconds, mcp_graph_throttled_total), 06-03 (mcp_oauth_pkce_store_size), 06-04 (mcp_rate_limit_blocked_total)"
  - phase: 06-operational-observability-rate-limiting
    provides: "Env var contract from plan 06-01 (MS365_MCP_METRICS_PORT, MS365_MCP_METRICS_BEARER, MS365_MCP_DEFAULT_REQ_PER_MIN, MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN)"
  - phase: 03-multi-tenant-identity-state-substrate
    provides: "KEK rotation procedure (03-04-SUMMARY.md) — cross-referenced, not duplicated, per delegation principle"
  - phase: 04-admin-api-webhooks-delta-persistence
    provides: "Audit-log query cookbook (04-05-SUMMARY.md) — cross-referenced, not duplicated"
provides:
  - "docs/observability/runbook.md — alert patterns + PromQL expressions + troubleshooting + incident response"
  - "docs/observability/metrics-reference.md — per-metric table (name, labels, source file, typical values, PromQL)"
  - "docs/observability/grafana-starter.json — Grafana v10+ dashboard JSON with exactly 5 panels per D-09 (uid: null, schemaVersion: 41)"
  - "docs/observability/prometheus-scrape.yml — both localhost-only and Bearer-gated scrape-config variants"
  - "docs/observability/rate-limit-tuning.md — S/M/L tier sizing guide + per-tenant override via admin PATCH + observed-cost mechanism explanation"
  - "docs/observability/reverse-proxy/caddy.md — recommended proxy with flush_interval -1 for SSE + 1h long-lived timeouts + security headers"
  - "docs/observability/reverse-proxy/nginx.md — secondary proxy with proxy_buffering off for SSE + 1h proxy_read_timeout + IP-allowlist admin server block"
  - "docs/observability/reverse-proxy/traefik.md — secondary proxy with responseforwarding.flushInterval=100ms + label-based security middleware"
  - ".env.example cross-references — docs/observability/env-vars.md (inside phase6-observability region) + rate-limit-tuning.md (inside phase6-rate-limit region)"
  - "docs/observability/README.md expanded from 5-file index to full 9-file index with quickstart checklist and Phase 6 architecture map"
affects:
  - "Operators — complete handoff surface for Phase 6 observability + rate-limit surface. No source code modified."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delegation-not-duplication: cross-reference Phase 3/4 summaries for KEK rotation + audit-log cookbook instead of rewriting"
    - "D-09 scope discipline: exactly 5 panels in the starter dashboard to avoid 'maintenance burden for no value'"
    - "Pitfall 8 application: uid scrubbed to null in grafana-starter.json so import generates fresh uids"
    - "SSE buffering-off directives per proxy: Caddy flush_interval -1, nginx proxy_buffering off, Traefik responseforwarding.flushInterval=100ms"
    - "Env-var region cross-references via comments (not new vars) — polish-only, no duplicate vars"

key-files:
  created:
    - "docs/observability/runbook.md"
    - "docs/observability/metrics-reference.md"
    - "docs/observability/grafana-starter.json"
    - "docs/observability/prometheus-scrape.yml"
    - "docs/observability/rate-limit-tuning.md"
    - "docs/observability/reverse-proxy/caddy.md"
    - "docs/observability/reverse-proxy/nginx.md"
    - "docs/observability/reverse-proxy/traefik.md"
  modified:
    - "docs/observability/README.md"
    - ".env.example"

key-decisions:
  - "D-09 applied verbatim: exactly 5 panels in grafana-starter.json — no scope creep toward comprehensive dashboards that create maintenance burden for operators"
  - "schemaVersion 41 baseline chosen — matches Grafana v10+ per RESEARCH Assumption A2; operators on v11 upgrade through normal import workflow"
  - "uid: null per Pitfall 8 — Grafana generates a fresh uid at import time, preventing uid collisions that would overwrite operator-customized dashboards"
  - "DS_PROMETHEUS templating variable — operators pick their Prometheus datasource at import time instead of hard-coding one uid"
  - "Phase 3 KEK rotation + Phase 4 audit-log cookbook cross-referenced, not duplicated — documentation belongs next to the code that owns the concern"
  - "Caddy designated primary proxy + nginx/Traefik secondary per ROADMAP §Phase 6 plan 06-07 directive; each doc has a curl -N SSE verification block so operators test buffering before deploying"
  - "S/M/L tier sizing answer to RESEARCH Open Question #4: 50k/150k/300k graph_points_per_min with ~24% ratio of Microsoft Graph per-tenant 10s peaks — documented rationale so operators can derive custom sizing"
  - ".env.example polish: cross-reference comments inserted inside existing phase6-observability + phase6-rate-limit regions — no new env vars, no duplicate regions, preserves append-only region discipline (P-10)"
  - "Applied prettier auto-formatting post-write (column-aligned markdown tables + single-quoted YAML strings) — a separate style commit follows each content commit so reviewers can see content vs. format separately"

patterns-established:
  - "Documentation commits use docs(plan-id) conventional prefix; the final plan's documentation set lands as atomic per-task commits + a follow-up style commit"
  - "Per-metric reference table format: Type, Labels, Source (file path), Plan (which 06-NN), Unit. Makes it obvious to dashboard authors where each metric is emitted from"
  - "Reverse-proxy reference docs follow a common structure: recommended-or-secondary statement → Critical directive → Reference config → SSE Verification block → Notes"

requirements-completed:
  - OPS-05
  - OPS-06
  - OPS-07
  - OPS-08

# Metrics
duration: ~8 min
completed: 2026-04-22
---

# Phase 6 Plan 07: Operator-Facing Observability + Rate-Limit Documentation Summary

**Phase 6 documentation handoff — 8 new docs under `docs/observability/` (runbook with alert patterns for every emitted metric, per-metric PromQL reference, 5-panel D-09 Grafana starter, tier-sized rate-limit tuning guide, Prometheus scrape-config, and 3 reverse-proxy refs) plus `.env.example` cross-reference polish, all cross-referencing Phase 3/4 runbooks per delegation-not-duplication principle.**

## Performance

- **Duration:** ~8 min (start 2026-04-22T07:46:06Z, end 2026-04-22T07:53:38Z — plus ~3 min context read-in before the start marker)
- **Started:** 2026-04-22T07:46Z
- **Completed:** 2026-04-22T07:54Z
- **Tasks:** 3/3 atomic commits (plus 1 follow-up style commit)
- **Files created/modified:** 10 (8 created, 2 modified)
- **Lines:** 1,089 total across new docs

## Accomplishments

- **Full operator handoff surface landed.** `docs/observability/` now carries every document an operator needs to bring up Phase 6: environment-variable reference, metric catalog, alerting runbook, dashboard starter, scrape config, tuning guide, and three reverse-proxy reference configs. The README is the discoverable entry point with a quickstart checklist.
- **D-09 honored verbatim.** `grafana-starter.json` has exactly 5 panels — no scope creep into a 20-panel "comprehensive dashboard" that creates maintenance burden. schemaVersion 41 matches Grafana v10+; uid scrubbed to null per Pitfall 8 so imports generate fresh uids.
- **Cross-references Phase 3 + 4 runbooks.** KEK rotation (03-04-SUMMARY.md + `bin/rotate-kek.mjs`) and audit-log cookbook (04-05-SUMMARY.md + `GET /admin/audit`) are linked, not duplicated. The runbook's "Cross-Reference Index" table names every off-surface topic with its owning phase summary.
- **Answered RESEARCH Open Question #4.** `rate-limit-tuning.md` publishes an S/M/L tier sizing matrix (50k/150k/300k `graph_points_per_min`) grounded in the 24% ratio of Microsoft Graph per-tenant 10s peaks.
- **SSE buffering addressed for all three proxies.** Caddy: `flush_interval -1`. nginx: `proxy_buffering off` inside the `/t/:tenantId/(sse|messages|mcp)` location. Traefik: `responseforwarding.flushInterval=100ms`. Each doc ends with a `curl -N` verification command so operators test before deploying.
- **`.env.example` polish.** Cross-reference comments added inside existing `phase6-observability` + `phase6-rate-limit` regions. No new env vars. No duplicate regions. Append-only discipline (P-10 region markers) preserved.

## Task Commits

| # | Commit | Description |
|---|--------|-------------|
| 1 | `b876df8` | docs(06-07): add runbook, metrics-reference, rate-limit-tuning + prometheus-scrape (Task 1) |
| 2 | `e9ee934` | docs(06-07): add grafana-starter.json with 5 panels (D-09, Task 2) |
| 3 | `295ba1b` | docs(06-07): add reverse-proxy configs + .env.example polish (Task 3) |
| style | `f1c6141` | style(06-07): apply prettier formatting to observability docs |

## Files Created / Modified

### Created

| File | Lines | Purpose |
|------|-------|---------|
| `docs/observability/runbook.md` | 176 | Alert patterns (PromQL + response playbooks for 5 metrics) + troubleshooting (401/503/Redis/OTLP) + incident response (Redis outage, AAD outage, tenant impersonation, token leak) + cross-reference index |
| `docs/observability/metrics-reference.md` | 158 | Per-metric table for 7 instruments (name, labels, source, plan, unit) + span attribute schema + OTel scope filter expression |
| `docs/observability/grafana-starter.json` | 279 | 5-panel Grafana v10+ dashboard (schemaVersion 41, uid: null, DS_PROMETHEUS templating variable) |
| `docs/observability/prometheus-scrape.yml` | 52 | Two scrape configurations — localhost-only (no auth) and Bearer-gated (with YOUR_BEARER_TOKEN placeholder) |
| `docs/observability/rate-limit-tuning.md` | 79 | Platform defaults + per-tenant override syntax + S/M/L tier sizing guide + observed-cost mechanism explanation + monitoring hook |
| `docs/observability/reverse-proxy/caddy.md` | 86 | Recommended primary proxy — Caddyfile reference with flush_interval -1 + 1h timeouts + security headers + metrics ACL |
| `docs/observability/reverse-proxy/nginx.md` | 114 | Secondary proxy — nginx.conf with proxy_buffering off + 1h proxy_read_timeout + separate admin + metrics server blocks + SSE verification command |
| `docs/observability/reverse-proxy/traefik.md` | 67 | Secondary proxy — docker-compose labels with responseforwarding.flushInterval=100ms + ip-allowlist middleware + certresolver labels |

### Modified

| File | Change |
|------|--------|
| `docs/observability/README.md` | Expanded from 5-file index (stub landed in plan 06-01) to full 9-file index; added Quickstart 6-step checklist; added Architecture section listing the 7-plan Phase 6 breakdown |
| `.env.example` | Two cross-reference comments inserted: inside `phase6-observability` region points to `docs/observability/env-vars.md`; inside `phase6-rate-limit` region points to `docs/observability/rate-limit-tuning.md` |

## Decisions Made

- **D-09 applied verbatim.** 5 panels exactly; no 6th panel "because a comprehensive dashboard would be nicer." The value is operator trust: we ship what matches the locked scope.
- **schemaVersion 41 (Grafana v10+) vs later.** Picked 41 per RESEARCH Assumption A2. Grafana auto-upgrades dashboards on import for v11+, so we avoid requiring operators to choose our target version manually.
- **uid: null scrubbing.** Pitfall 8. Fresh uid at import = no collision with operator-customized dashboards that might share a uid from a previous template.
- **DS_PROMETHEUS templating variable.** Lets the operator pick their own Prometheus datasource at import time. Hard-coding a uid would mean every operator has to jq-patch the JSON before importing.
- **Cross-reference, not duplicate, Phase 3 KEK rotation + Phase 4 audit-log cookbook.** Phase 3 landed `bin/rotate-kek.mjs` + 03-04-SUMMARY.md (22.5K); Phase 4 landed `GET /admin/audit` + 04-05-SUMMARY.md (28.7K). Re-writing the procedures in Plan 06-07's runbook would create drift. Linking preserves the single source of truth.
- **Caddy designated primary.** ROADMAP §Phase 6 plan 06-07 explicitly says "Caddy primary, nginx + Traefik secondary." The recommendation is baked into each proxy doc's opening paragraph so operators don't have to guess.
- **S/M/L tier sizing picks.** 50k / 150k / 300k `graph_points_per_min` — ~24% of Microsoft's 10s peak ResourceUnits. 24% gives headroom for (a) retry overhead and (b) multiple mcp tenants sharing the same Graph tenant. Documented rationale so operators can derive custom sizing for non-S/M/L cases.
- **Post-write prettier reformat as a separate commit.** Content commits are atomic (one per plan task); the prettier reformat commit follows so reviewers can see content vs. formatting separately. Equivalent to Phase 5's codegen + style separation pattern.

## Deviations from Plan

**None** — plan executed exactly as written. All 3 tasks landed with the exact content, grep counts, and behavior criteria the plan specified.

**Total deviations:** 0
**Impact on plan:** None. All 8 new docs exist, the README update is in place, `.env.example` carries both cross-reference comments, and all grep/line-count acceptance criteria pass.

## Issues Encountered

- **Pre-existing prettier warnings (50 files) on `npm run format:check`.** None of the warnings are in files this plan modifies. All Plan 06-07 files pass `npx prettier --check docs/observability/` cleanly (verified after the style commit).
- **Pre-existing lint warnings (152 warnings, 0 errors) on `npm run lint`.** Same as above — all in unrelated files. Plan 06-07 modifies only documentation, so no lint impact.
- **Prettier auto-reformatted markdown tables (column alignment) and YAML scalars (single-quote strings).** Expected — Prettier normalizes these. Documented content and grep targets unchanged; re-ran all acceptance-criteria greps after the reformat and all still pass.

## User Setup Required

None — documentation only. Operators adopting these docs:

1. Copy `.env.example` → `.env`, uncomment + fill in the `MS365_MCP_*` vars documented in `docs/observability/env-vars.md`.
2. Import `docs/observability/grafana-starter.json` into Grafana v10+.
3. Point Prometheus at `/metrics` per `docs/observability/prometheus-scrape.yml`.
4. Apply one of the three reverse-proxy reference configs.

## Next Phase Readiness

- **Plan 06-07 is the last plan in Phase 6.** Documentation handoff is complete; operators can stand up the full Phase 6 surface from this docs set alone.
- **Downstream phases (Phase 7+) inherit the docs structure.** Future phases should extend `docs/observability/` rather than creating parallel directories; the README acts as the index.
- **Deferred items tracked in 06-CONTEXT.md §Deferred Ideas** — per-tool rate limits, Grafana Cloud preset, SIEM shipping, etc. All out of v1.0 scope. If POLISH-01 (Caddy bundled TLS preset) is resumed, it lands as a `docs/observability/reverse-proxy/caddy-tls-bundle.md` sibling.

## Self-Check: PASSED

- **File existence:** `test -f docs/observability/runbook.md && test -f docs/observability/metrics-reference.md && test -f docs/observability/grafana-starter.json && test -f docs/observability/prometheus-scrape.yml && test -f docs/observability/rate-limit-tuning.md && test -f docs/observability/reverse-proxy/caddy.md && test -f docs/observability/reverse-proxy/nginx.md && test -f docs/observability/reverse-proxy/traefik.md && test -f docs/observability/README.md` — all 9 files present.
- **Grafana JSON valid + 5 panels + uid null + schemaVersion 41:** `jq '.panels | length'` = 5, `jq '.uid'` = null, `jq '.schemaVersion'` = 41.
- **runbook.md metric + cross-reference coverage:** `mcp_graph_throttled_total` (3 matches), `mcp_rate_limit_blocked_total` (4 matches), `03-04-SUMMARY.md` (3 matches), `04-05-SUMMARY.md` (2 matches), line count 176 (≥ 100).
- **metrics-reference.md completeness:** `mcp_tool_calls_total` (3 matches), `histogram_quantile` (2 matches), line count 158 (≥ 80).
- **rate-limit-tuning.md tier matrix:** `Small (S)` + `Medium (M)` + `Large (L)` all present (1 match each).
- **prometheus-scrape.yml Bearer variant present:** `Bearer` (4 matches).
- **Reverse-proxy SSE directives:** caddy.md `flush_interval` (5 matches), nginx.md `proxy_buffering off` (4 matches), traefik.md `flushInterval` (3 matches) + `traefik.http` (24 matches).
- **.env.example cross-references:** `rate-limit-tuning.md` (1 match), `docs/observability/env-vars.md` (1 match).
- **Commits verified present:** `git log --oneline -5` shows `f1c6141`, `295ba1b`, `e9ee934`, `b876df8` atop the base.
- **prettier check clean for docs/observability:** `npx prettier --check docs/observability/` returns "Prettier: All files formatted correctly".
- **No source code modified:** `git diff --stat 51e348e..HEAD` shows only `docs/observability/*`, `.env.example`, and `.planning/phases/06-*/06-07-SUMMARY.md` (this file) — zero `src/` or `test/` changes.

---

_Phase: 06-operational-observability-rate-limiting_
_Plan: 07 — Operator-facing observability + rate-limit documentation_
_Completed: 2026-04-22_
