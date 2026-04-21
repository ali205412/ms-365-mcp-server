# Phase 6 Discussion Log — /gsd-discuss-phase --auto

**Mode:** `--auto` (Claude selected recommended defaults; all choices logged)
**Gathered:** 2026-04-21

## Gray Areas Identified

Analysis of ROADMAP Phase 6 + codebase scout surfaced 11 implementation gray areas.

**Areas auto-selected for discussion:** all 11 (per `--auto` mode rule: auto-select every gray area).

## Auto-Selected Decisions

For each gray area, Claude picked the first/recommended option with the rationale below. These are captured as D-01..D-11 in `06-CONTEXT.md`.

### D-01: OTel Bootstrap Reuse
- **Alternatives considered:** (a) reuse `src/lib/otel.ts` from Phase 1, (b) rewrite to fit Phase 6 spec
- **Chosen:** (a) reuse
- **Why:** The module already exists, is imported first, and has 109 lines of working NodeSDK wiring. Rewriting is pure churn.

### D-02: Metrics Endpoint Auth
- **Alternatives:** (a) optional Bearer for non-localhost, (b) always open, (c) admin API-key required
- **Chosen:** (a) optional Bearer
- **Why:** ROADMAP text explicitly calls for this. Matches the dual-stack admin auth philosophy without requiring Prometheus scrapers to do OAuth.

### D-03: Rate-Limit Algorithm
- **Alternatives:** (a) Redis sliding-window (ZSET + timestamps), (b) Redis token-bucket (INCR+EXPIRE), (c) fixed-window (INCR+EXPIRE)
- **Chosen:** (a) sliding-window
- **Why:** ROADMAP specifies "sliding-window counter". Fair across window boundaries unlike fixed-window. Webhook fixed-window rate-limit stays for 401 flood protection — different concern.

### D-04: Rate-Limit Granularity
- **Alternatives:** (a) per-tenant only, (b) per-tenant per-tool, (c) per-tenant per-user
- **Chosen:** (a) per-tenant only
- **Why:** ROADMAP: "configure a tenant's request budget". Per-tool would explode Redis key cardinality. Per-user complicates admin UX. Tenant = billing boundary = budget boundary.

### D-05: Graph Token Budget Accounting
- **Alternatives:** (a) parse `Retry-After` + `x-ms-resource-unit` headers, (b) estimate from static cost table, (c) rely on Graph's own throttling (no separate counter)
- **Chosen:** (a) observe from headers
- **Why:** ROADMAP: "accumulated from observed Graph throttle headers". Observation-based scales automatically; static cost tables rot.

### D-06: Metric Label Cardinality
- **Alternatives:** (a) full tool alias (42K values), (b) workload prefix (~40 values), (c) category (~5 values)
- **Chosen:** (b) workload prefix for metrics; full alias still on traces
- **Why:** Prometheus best practice is <10K series per metric. Full alias × statuses × tenants explodes past 1M. Workload prefix keeps metrics tractable without losing granularity in traces.
- **ROADMAP tension:** ROADMAP spec says `mcp_tool_calls_total{tenant, tool, status}`. Claude interprets `tool` as workload prefix, not full alias. Researcher should verify this interpretation before planning.

### D-07: Integration Test Infrastructure
- **Alternatives:** (a) Testcontainers (real Postgres+Redis), (b) pg-mem + MemoryRedisFacade, (c) mix (Testcontainers in CI, in-memory local)
- **Chosen:** (c) mix
- **Why:** Existing admin tests use pg-mem — keep them. New OAuth-surface tests need HTTP round trips and real Redis TTL semantics. Testcontainers gated by `MS365_MCP_INTEGRATION=1`.

### D-08: Metrics Endpoint Port Binding
- **Alternatives:** (a) dedicated port 9464, (b) main app port with route prefix
- **Chosen:** (a) dedicated port
- **Why:** Already wired that way in `otel.ts`. Cleaner auth boundary; easier to firewall.

### D-09: Grafana Dashboard Scope
- **Alternatives:** (a) comprehensive JSON (10+ panels), (b) starter (3-5 panels), (c) documentation only (no JSON)
- **Chosen:** (b) starter
- **Why:** ROADMAP: "starter committed under docs/observability/". Comprehensive dashboards are operator taste — shipping 20 panels creates a maintenance burden.

### D-10: OAuth-Surface Test Baseline
- **Alternatives:** (a) ≥70% on OAuth-handler lines of `src/server.ts` specifically, (b) ≥70% whole-file coverage
- **Chosen:** (a) OAuth-handler lines only
- **Why:** ROADMAP success criterion 5: "70% on OAuth-surface lines". Whole-file coverage is skewed by MCP transport branches.

### D-11: Rate-Limit Admin API Surface
- **Alternatives:** (a) extend existing `/admin/tenants/:id` PATCH with `rate_limits` field, (b) new dedicated `/admin/tenants/:id/rate-limits` sub-resource
- **Chosen:** (a) extend existing PATCH
- **Why:** Reuses audit log + Zod validation + pub/sub invalidation path. No new REST surface.

## Scope Creep Redirected

No scope creep surfaced in auto-mode (no user questions = no freeform input to redirect).

## Deferred Items

See `06-CONTEXT.md <deferred>` section. Captured 8 out-of-scope ideas to prevent loss.

## Human Review Gate

Because `--auto` mode skipped interactive questions, the user should read `06-CONTEXT.md` before `/gsd-plan-phase 6` runs and redirect any auto-chosen decision that doesn't match intent. Key candidates for review:

- **D-06** (metric cardinality) — Claude reinterpreted ROADMAP `tool` label as workload prefix. If operator wants per-alias granularity in metrics, revisit.
- **D-07** (test infra) — Claude chose mix; if operator wants pure Testcontainers or pure in-memory, say so.
- **D-11** (rate-limit admin API) — Claude chose to extend existing endpoint; if operator wants a dedicated sub-resource for audit clarity, revisit.

Everything else tracks the ROADMAP text directly and is low-risk to auto-lock.

---

*Log written: 2026-04-21 as part of /gsd-discuss-phase --auto*
