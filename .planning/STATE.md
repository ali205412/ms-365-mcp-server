---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: null
last_updated: "2026-05-08T18:30:00.000Z"
last_activity: 2026-05-08 -- Phase 08 Plan 08-06 completed
progress:
  total_phases: 9
  completed_phases: 8
  total_plans: 86
  completed_plans: 78
  percent: 90
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18)

**Core value:** One deployable, multi-tenant MCP gateway that exposes the entire Microsoft Graph surface an organization needs — with tenant isolation, resilient Graph transport, and all four identity flows — so AI assistants can safely act on behalf of any user or app across any registered tenant.
**Current focus:** Phase 08 — maximal-mcp-claude-connector-surface

## Current Position

Phase: 08 (maximal-mcp-claude-connector-surface) — EXECUTING
Plan: 6 of 14 completed; next 08-07
Status: Executing Phase 08
Last activity: 2026-05-08 -- Phase 08 Plan 08-06 completed

Progress: [█████████░] 89% (8/9 phases)

## Performance Metrics

**Velocity:**

- Total plans completed: 19
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 03 | 10 | - | - |
| 6 | 9 | - | - |

**Recent Trend:**

- Last 5 plans: 08-02, 08-03, 08-04, 08-05, 08-06
- Trend: complete

*Updated after each plan completion*
| Phase 07 P11 | 8min | 3 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- v2 major rewrite (breaking changes OK) over evolution — documented in PROJECT.md
- Keep `openapi-zod-client` generator; do NOT wrap `@microsoft/msgraph-sdk` — SDK audit confirms our pipeline is the right shape for MCP
- All four identity flows concurrent (delegated, app-only, bearer pass-through, device code) — landed together in Phase 3 to avoid double-touching AuthManager
- Stack additions: Postgres (durable tenant registry, audit, delta tokens) + Redis (PKCE, token cache, rate limits) — both lazy/optional in stdio mode
- [Phase 07]: Tenant resource reads compare URI tenant id against getRequestTenant().id before any data read. — Mitigates tenant resource URI information disclosure for Plan 07-11.
- [Phase 07]: Endpoint schema resources validate aliases against discoveryCatalogSet, not the visible discovery-v1 meta-tool set. — Allows discovery tenants to inspect generated Graph/product schemas without exposing them in tools/list.
- [Phase 07]: Tenant resources are registered as concrete caller-tenant URIs; templates are limited to workload and endpoint schema families. — Prevents cross-tenant template enumeration while keeping resources/list discoverable for the caller tenant.
- [Phase 08]: Editable skills are now exposed through discovery-mode skill tools and canonical `m365://tenant/{tenantId}/skills/...` resources with `mcp://` compatibility aliases; published saves validate tool/memory/resource references before persistence.

### Roadmap Evolution

- Phase 7 added: agentic-tool-surface — discovery-mode default + MCP Resources (templated, per-tenant) + Prompts (10 canned workflows) + Notifications (tools/list, resources/list, resources/updated) + Logging capability + Completions + per-tenant memory (bookmarks, recipes, facts via Postgres + BM25 + optional pgvector) + admin API CRUD for memory + opt-in migration tool. Out of scope: Tasks/Elicitation/Sampling/Roots (no claude.ai client support yet).
- Phase 8 added: maximal-mcp-claude-connector-surface — editable skills as DB-backed MCP prompts, MCP Apps, structured outputs/output schemas, richer resources/completions/notifications, capability-gated sampling/elicitation/roots/tasks, transport parity, and connector naming hardening for Claude/Cowork clients that ignore `serverInfo.name` or show generic `ToolHub` labels.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- Curated beta whitelist policy needs explicit sign-off in Phase 5 discuss-phase (per research SUMMARY gaps)
- Default essentials preset composition (~150 ops) needs explicit sign-off in Phase 5 discuss-phase
- MSAL pool eviction policy (LRU vs idle-timeout) needs decision during Phase 3 planning
- Phase 1 manual smokes pending operator sign-off: Docker HEALTHCHECK under real runtime, Compose+Caddy end-to-end, migrate-tokens round-trip with real OS keychain, kernel SIGTERM graceful shutdown, OTLP trace reaches collector

## Session Continuity

Last session: 2026-05-08T15:25:41.524Z
Stopped at: context exhaustion at 75% (2026-05-08)
Resume file: None

## Quick Tasks Completed

| ID | Slug | Date | Description | Status |
|----|------|------|-------------|--------|
| 260425-bxa | coolify-pull-policy | 2026-04-25 | `pull_policy: always` on mcp service — force Coolify to re-pull GHCR `:latest` on every redeploy. Resolves stale-image blocker that was masking the Redis subscriber-mode fixes (`ee08ae4`, `3027552`) and producing `rate_limit_error` on `tools/call`. | complete ✓ |
| 260425-e5x | mcp-401-www-authenticate | 2026-04-25 | Emit `WWW-Authenticate: Bearer …resource_metadata=…` on every 401 from the MCP path (RFC 9728 / MCP 2025-06-18). Fixes Claude.ai-style connector failure "Couldn't reach the MCP server". 5 emit sites + new helper + 12 unit tests. Commits `f1f67d3`, `2c3bce6`. | complete ✓ |
| 260425-gug | oauth-discovery-dcr | 2026-04-25 | RFC 8414 host-prefixed metadata routes + `registration_endpoint` in per-tenant auth-server metadata + `MS365_MCP_OAUTH_REDIRECT_HOSTS` env (default `claude.ai`) for DCR allowlist. Unblocks Claude.ai connector OAuth dance after /register stopped returning 400. Commit `a15eed8`. | complete ✓ |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |
