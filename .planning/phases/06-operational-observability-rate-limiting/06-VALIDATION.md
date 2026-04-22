---
phase: 6
slug: operational-observability-rate-limiting
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-22
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Detailed test map lives in `06-RESEARCH.md § Validation Architecture`; this file is the Nyquist gate contract.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^3.1.1 + @vitest/coverage-v8 ^3.2.4 |
| **Config file** | `vitest.config.js` (integration pattern gated by `MS365_MCP_INTEGRATION=1`) |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm run test:int` (= `MS365_MCP_INTEGRATION=1 NODE_OPTIONS=--max-old-space-size=12288 vitest run`) |
| **Estimated runtime** | ~20s unit · ~180s integration (incl. Testcontainers startup) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (unit tier only)
- **After every plan wave:** Run `npm run test:int` if the wave touched OAuth, metrics, or rate-limit integration paths
- **Before `/gsd-verify-work`:** Full integration suite must be green + coverage gate ≥70% on OAuth lines
- **Max feedback latency:** 20s for unit, 180s for integration

---

## Integration-Tier Test Topology (two tiers)

Phase 6 integration tests divide into two groups by harness dependency:

### Tier A — Testcontainers-backed (real Postgres + Redis via globalSetup)

Requires the vitest `globalSetup` from plan 06-05 (`test/setup/integration-globalSetup.ts`) to be in place. These tests call `inject('pgUrl')` / `inject('redisUrl')` to connect to the per-process container pair.

| File | Consumes | Reason |
|------|----------|--------|
| `test/integration/oauth-surface/pkce-concurrent.int.test.ts` | globalSetup (optional) | Uses MemoryRedisFacade by default; container available for stronger concurrency proofs |
| `test/integration/oauth-surface/register-invalid-redirect.int.test.ts` | none (Express + createRegisterHandler) | Self-contained; no harness dep |
| `test/integration/oauth-surface/token-error-paths.int.test.ts` | none (Express + createTokenHandler) | Self-contained; log-scrub regression only |
| `test/integration/oauth-surface/well-known-metadata.int.test.ts` | none (Express + inline handlers) | Self-contained |
| `test/integration/multi-tenant/token-isolation.int.test.ts` | globalSetup (pgUrl + redisUrl) | Real Postgres migrations + Redis KEY inspection |
| `test/integration/multi-tenant/disable-cascade.int.test.ts` | globalSetup (pgUrl + redisUrl) | DEK cryptoshred + Redis keyspace deletion end-to-end |
| `test/integration/multi-tenant/bearer-tid-mismatch.int.test.ts` | globalSetup (pgUrl optional; redisUrl for audit log) | Tenant seed + bearer middleware + audit row |

### Tier B — Self-contained (pg-mem + ioredis-mock, no harness dep)

These tests spin up their own in-process Postgres (pg-mem) and their own `ioredis-mock` instance. They do NOT require the Testcontainers globalSetup; they run even if Docker is unavailable (they require only `MS365_MCP_INTEGRATION=1`).

| File | Backing stores | Reason |
|------|----------------|--------|
| `test/integration/metrics-endpoint.int.test.ts` | In-memory MeterProvider + ephemeral Express `metricsServer` | No persistence dependency |
| `test/integration/rate-limit/gateway-429.int.test.ts` | pg-mem (migration-driven) + ioredis-mock (ZSET + EVAL) | Plan 06-04 Task 3 self-contained integration |
| `test/integration/rate-limit/admin-config.int.test.ts` | pg-mem (migration-driven) + MemoryRedisFacade | Plan 06-04 Task 2 Admin PATCH persistence |

**Rationale:** Splitting the integration tier into two tiers enables parallel wave execution. Plan 06-04's rate-limit tests (Tier B) do NOT block on plan 06-05's globalSetup (Tier A) — they are self-contained with pg-mem + ioredis-mock. Plan 06-05 runs in wave 1 alongside plan 06-01 so the Tier A harness is available when waves 2–4 integration tests execute, but plan 06-04's rate-limit integration tests can run in wave 3 even if plan 06-05 hasn't fully landed because they don't rely on Testcontainers.

---

## Per-Task Verification Map

See `06-RESEARCH.md § Validation Architecture § Phase Requirements → Test Map` for the authoritative matrix. Summary of Wave 0 files that must exist before plan execution starts, annotated with tier:

| Wave 0 File | Requirement Coverage | Tier | Status |
|-------------|----------------------|------|--------|
| `test/setup/integration-globalSetup.ts` | ROADMAP SC#4 (multi-tenant), OAuth-surface (optional) | Tier A harness | ⬜ pending |
| `test/setup/otel-test-reader.ts` | OPS-05, OPS-06 (unit) | Unit helper | ⬜ pending |
| `test/lib/otel-metrics.test.ts` | OPS-06 | Unit | ⬜ pending |
| `test/lib/rate-limit/sliding-window.test.ts` | OPS-08 | Unit (ioredis-mock) | ⬜ pending |
| `test/lib/graph-client.span.test.ts` | OPS-05 | Unit | ⬜ pending |
| `test/integration/metrics-endpoint.int.test.ts` | OPS-07 | Tier B (self-contained) | ⬜ pending |
| `test/integration/rate-limit/gateway-429.int.test.ts` | OPS-08 | Tier B (pg-mem + ioredis-mock) | ⬜ pending |
| `test/integration/rate-limit/admin-config.int.test.ts` | D-11 | Tier B (pg-mem + ioredis-mock) | ⬜ pending |
| `test/integration/oauth-surface/pkce-concurrent.int.test.ts` | ROADMAP SC#4 | Tier A (optional container) | ⬜ pending |
| `test/integration/oauth-surface/register-invalid-redirect.int.test.ts` | ROADMAP SC#4 | Tier B (self-contained) | ⬜ pending |
| `test/integration/oauth-surface/token-error-paths.int.test.ts` | ROADMAP SC#4 (log scrub) | Tier B (self-contained) | ⬜ pending |
| `test/integration/oauth-surface/well-known-metadata.int.test.ts` | D-10 (coverage lift) | Tier B (self-contained) | ⬜ pending |
| `test/integration/multi-tenant/token-isolation.int.test.ts` | ROADMAP SC#4 | Tier A (globalSetup required) | ⬜ pending |
| `test/integration/multi-tenant/disable-cascade.int.test.ts` | ROADMAP SC#4 | Tier A (globalSetup required) | ⬜ pending |
| `test/integration/multi-tenant/bearer-tid-mismatch.int.test.ts` | ROADMAP SC#4 | Tier A (globalSetup for audit row) | ⬜ pending |
| `bin/check-oauth-coverage.mjs` | D-10 line-range gate | CI script | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Plan 06-05 lands the Tier A harness (globalSetup, pkce-fixture, tenant-seed) in **wave 1** alongside plan 06-01. Rate-limit integration tests (06-04, wave 3) run without blocking on 06-05 because they are Tier B (self-contained with pg-mem + ioredis-mock). OAuth-surface integration tests (06-05 wave 1) test existing `src/server.ts` OAuth handlers — no source-code dependency on 06-02/06-03/06-04.

- [ ] `npm install --save-dev @testcontainers/redis@11.14.0` — new devDep required by plan 06-05 Tier A harness
- [ ] `test/setup/integration-globalSetup.ts` — vitest globalSetup that starts one Postgres + one Redis container per process and exposes URLs via `project.provide()` (Tier A harness)
- [ ] `test/setup/otel-test-reader.ts` — in-memory MeterProvider + `InMemoryMetricExporter` helper for unit tests
- [ ] `test/setup/pkce-fixture.ts` — `newPkce()` helper (crypto.randomBytes + sha256)
- [ ] `test/fixtures/tenant-seed.ts` — tenant-insert helper reusing `runtime-tenant-onboarding.test.ts` pattern
- [ ] `bin/check-oauth-coverage.mjs` — post-processor over `coverage-final.json` that sums hits on OAuth-handler line ranges of `src/server.ts` and exits non-zero if `<70%`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator can scrape `/metrics` in a live Docker Compose deployment | OPS-07 | Requires real OTel collector + Prometheus; integration test covers HTTP contract but not end-to-end scrape loop | Run `docker compose up` with included `docker-compose.obs.yml` reference stack; verify Prometheus target shows `UP` and dashboards populate |
| Grafana starter JSON imports cleanly in Grafana v10 | D-09 | Grafana schema validation requires Grafana instance | Import `docs/observability/grafana-starter.json` into a Grafana v10 instance; verify all 5 panels render without errors |
| Runbook alert suggestions match real-world signal-to-noise | Plan 06-07 | Alert tuning depends on operator traffic patterns | Operator review during staging rollout |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (listed above)
- [ ] No watch-mode flags (integration tests use `vitest run`, not `vitest`)
- [ ] Feedback latency < 20s unit, < 180s integration
- [ ] `nyquist_compliant: true` set in frontmatter after plans pass checker

**Approval:** pending
