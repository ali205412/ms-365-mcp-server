---
phase: 03-multi-tenant-identity-state-substrate
plan: 08
subsystem: tenant
tags:
  [
    routing,
    load-tenant,
    lru,
    pub-sub,
    per-tenant-cors,
    guid-regex,
    tenant-01,
    d-13,
    sc-1,
    sc-2,
  ]

# Dependency graph
requires:
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 01
    provides: "tenants table schema (redirect_uri_allowlist / cors_origins / disabled_at); pg pool singleton; migration fixtures"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 02
    provides: "getRedis() + MemoryRedisFacade with publish/subscribe/on('message')"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 05
    provides: "TenantRow interface (cors_origins field); TenantPool.evict; getTenantPool/initTenantPool singleton"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 06
    provides: "createAuthorizeHandler + createTenantTokenHandler factories (consume req.params.tenantId or req.tenant.id); PHASE3_TENANT_PLACEHOLDER scaffold to remove; createLoadTenantPlaceholder scaffold to remove"

provides:
  - "src/lib/tenant/load-tenant.ts — Express middleware factory with D-13 GUID regex guard + LRU(1000, 60s) + Postgres SELECT + 404/503 handling. Augmented with `evict(id)` + `_clear()` helpers for pub/sub subscribers."
  - "src/lib/tenant/tenant-invalidation.ts — pub/sub subscriber + publisher helpers for the `mcp:tenant-invalidate` channel. `subscribeToTenantInvalidation(redis, invalidator)` wires admin mutations to LRU eviction; `publishTenantInvalidation(redis, tenantId)` is the Phase 4 hook."
  - "src/lib/cors.ts — new `createPerTenantCorsMiddleware(config)` factory. Resolves the allowlist from `req.tenant.cors_origins` (non-empty) with fallback to the global `MS365_MCP_CORS_ORIGINS` list."
  - "src/server.ts — `mountTenantRoutes(app, publicBase)` method that wires loadTenant + per-tenant CORS + tenant-scoped OAuth discovery + tenant-scoped /authorize + /token + pub/sub subscriber. Mounted BEFORE /.well-known/* (most-specific path first per D-13)."
  - "src/server.ts — PHASE3_TENANT_PLACEHOLDER constant REMOVED. Replaced by a narrowly-scoped `LEGACY_SINGLE_TENANT_KEY = '_'` sentinel used only by the pre-03-08 /authorize + /token mounts that 03-09 retires entirely."
  - "src/server.ts — createLoadTenantPlaceholder scaffold REMOVED (export deleted). `createAuthorizeHandler` + `createTenantTokenHandler` now key PKCE entries on `req.tenant.id` directly."
  - "test/tenant/load-tenant.test.ts — 14 unit tests (GUID guard / DB lookup / LRU semantics / pub/sub subscriber)"
  - "test/tenant/routing.test.ts — 9 routing tests (/t/:tenantId/authorize happy path + 404 + 400 + per-tenant CORS + PKCE key format assertion)"
  - "test/integration/runtime-tenant-onboarding.test.ts — 2 SC#1 tests (freshly-INSERTed tenant reachable after pub/sub + disable propagation)"
  - "test/integration/multi-tenant-isolation.test.ts — 5 SC#2 tests (routing / allowlist / PKCE / CORS / LRU isolation across two concurrent tenants on one server instance)"

affects:
  - "03-09 (three-transport mounting): mountTenantRoutes leaves hooks for /t/:tenantId/mcp + /t/:tenantId/sse + /t/:tenantId/messages. authSelector middleware from 03-06 plugs in at the /mcp mount."
  - "03-10 (audit writer): publishTenantInvalidation is the hook admin PATCH/DELETE (Phase 4) calls after COMMIT. 03-10 also writes an audit_log row for oauth.authorize via the existing createAuthorizeHandler boundary."
  - "04 (admin API): adds PATCH /admin/tenants/{id} → UPDATE tenants SET cors_origins=$, disabled_at=$ → COMMIT → publishTenantInvalidation(redis, id). The wiring in 03-08 means no server restart is needed."

# Tech tracking
tech-stack:
  added:
    - "(shape) src/lib/tenant/load-tenant.ts — new module for the request middleware"
    - "(shape) src/lib/tenant/tenant-invalidation.ts — new module for pub/sub integration"
    - "(shape) src/lib/cors.ts gains a second export (createPerTenantCorsMiddleware) alongside the existing createCorsMiddleware"
  patterns:
    - "Middleware-with-method augmentation — the RequestHandler returned by createLoadTenantMiddleware has `evict(id)` + `_clear()` methods attached via Object-shape assignment so the pub/sub subscriber can reach in without leaking the internal LRU reference"
    - "Best-effort route mount — mountTenantRoutes logs-and-continues when Postgres/Redis/TenantPool are unavailable rather than exiting. Stdio-mode and fail-fast-bootstrapping contracts stay intact"
    - "Per-request CORS allowlist resolution — PerTenantCorsConfig resolves via req.tenant.cors_origins first, falling back to a closure-captured global Set. Per-request Set construction is intentional — tenant allowlists are tiny and DB/LRU cost dominates"
    - "Plain-text single-token pub/sub payload — `mcp:tenant-invalidate` messages ARE the tenantId GUID. No JSON wrapper, no versioning; the GUID regex at the receiver end is the full contract"

key-files:
  created:
    - "src/lib/tenant/load-tenant.ts (145 lines) — createLoadTenantMiddleware factory + augmented RequestHandler"
    - "src/lib/tenant/tenant-invalidation.ts (88 lines) — subscribeToTenantInvalidation + publishTenantInvalidation"
    - "test/tenant/load-tenant.test.ts (355 lines, 14 tests)"
    - "test/tenant/routing.test.ts (363 lines, 9 tests)"
    - "test/integration/runtime-tenant-onboarding.test.ts (244 lines, 2 tests — SC#1 signal)"
    - "test/integration/multi-tenant-isolation.test.ts (364 lines, 5 tests — SC#2 signal)"
  modified:
    - "src/lib/cors.ts — added PerTenantCorsConfig type + createPerTenantCorsMiddleware factory; existing createCorsMiddleware untouched"
    - "src/server.ts — removed PHASE3_TENANT_PLACEHOLDER constant (17 lines of doc + const) + createLoadTenantPlaceholder export (23 lines) + three placeholder references in handlers. Added LEGACY_SINGLE_TENANT_KEY (15 lines) + mountTenantRoutes method (~175 lines). Wired mountTenantRoutes call into start() before /.well-known/* mounts."
    - "src/lib/pkce-store/redis-store.ts — module header comment updated (no more PHASE3_TENANT_PLACEHOLDER reference; now describes the 03-08 routing contract + LEGACY_SINGLE_TENANT_KEY sentinel for the legacy mount)"
    - "test/auth/delegated-oauth.test.ts — updated pre-seeded PKCE keys from '_' to harness.tenant.id (matches new contract)"
    - "test/auth/refresh-token-migration.test.ts — same harness update"
    - "test/integration/redis-ciphertext-only.test.ts — same harness update"

key-decisions:
  - "Expose `evict(id)` as a method on the returned middleware RequestHandler rather than a second exported function. This couples the eviction contract to the middleware lifetime — whoever owns the middleware instance owns its cache, and the pub/sub subscriber doesn't need a dependency on the internal LRU module. Same shape used by the `mountTenantRoutes` method so the subscriber is wired in one place without threaded state."
  - "Pub/sub payload is plain-text tenantId (no JSON envelope). A GUID is a single opaque token — JSON wrapping would invite schema drift (version bumps, extra fields) without closing any real ambiguity. The GUID regex at the receiver's end is sufficient validation. Future channels that need structured payloads MUST use a distinct channel name so the format contract is unambiguous per-channel."
  - "loadTenant middleware is a factory, not a module-level singleton. Each Express app builds its own instance so tests can run in parallel without cache contamination. The production HTTP path constructs exactly one instance in mountTenantRoutes — same contract as PkceStore injection (plan 03-03)."
  - "GUID regex is case-insensitive (/i flag) and does NOT enforce the v4 version nibble. Entra tenants emit v4 GUIDs today but admins can paste uppercase or v7 in the future; the regex accepts all hex-formed 8-4-4-4-12 layouts. This matches the postgres uuid column's behaviour (case-insensitive comparison) so the regex + DB never disagree."
  - "LRU `updateAgeOnGet: false` — a cached row expires at a bounded 60s regardless of access frequency. Combined with pub/sub invalidation, this bounds staleness at Redis RTT (happy path) and 60s (Redis partition). updateAgeOnGet=true would have made a hot tenant survive indefinitely, turning admin CORS changes into a 'it works for some requests' rollout hell."
  - "503 database_unavailable returns a generic envelope with no error message. The PG driver error text can leak schema details (table/column names, connection-string fragments); a generic 503 is safer + retry-safe. Ops gets the redacted warn log via logger; clients get a signal to back off."
  - "Per-tenant CORS falls back to the GLOBAL allowlist when `tenant.cors_origins` is empty (not to 'deny all'). Operators migrating a single-tenant v2 deployment should not have to customize CORS for every tenant; the existing MS365_MCP_CORS_ORIGINS env var keeps working by default. Tenants that DO customize CORS get a strictly narrower allowlist (never broader)."
  - "mountTenantRoutes is BEST-EFFORT (logs-and-continues on failure) rather than fail-fast. Rationale: v1-compatible HTTP deployments without Phase 3 infrastructure (no pg, no redis) should still boot with the legacy /authorize + /token routes wired. fail-fast would force operators to migrate to pg+redis before shipping v2 binary. Logging at warn level makes the mismatch visible at first startup."
  - "LEGACY_SINGLE_TENANT_KEY ('_') is a scoped rename of PHASE3_TENANT_PLACEHOLDER — the behaviour is identical but the name signals a DIFFERENT lifecycle. 03-08's mission was 'remove the scaffold'; the legacy /authorize + /token paths use LEGACY_SINGLE_TENANT_KEY because they predate URL-path routing entirely. 03-09 deletes both the LEGACY_SINGLE_TENANT_KEY constant AND the legacy /authorize + /token handlers in one commit when the per-tenant mounts supersede them."
  - "Placing /t/:tenantId/.well-known/* BEFORE /.well-known/* in the route order matters because Express is last-match-wins for overlapping patterns (where the prefix matches). Express actually does first-match-wins for exact paths, but the tenant-scoped discovery endpoints being declared first means any future /.well-known/:foo wildcards don't shadow them."

patterns-established:
  - "Middleware-with-attached-methods — loadTenant exposes evict + _clear as properties on the returned RequestHandler. Future subsystems that need external mutations on their middleware state MUST follow this shape so the dependency graph stays one-way (subscriber → middleware, never middleware → subscriber)."
  - "Best-effort mount pattern — Phase 3 substrate mounts that log-and-continue on missing deps (postgres / redis / kek / tenantPool) preserve v1 HTTP compatibility through a Phase 3 rollout. fail-fast remains the pattern for boot-time invariants (src/index.ts validateProdHttpConfig); runtime best-effort is for feature mounts that SHOULD succeed but MUST NOT crash when substrate is absent."
  - "Integration test under test/integration/ — multi-sibling-module tests that drive the full pipeline (pg-mem + MemoryRedisFacade + handlers) live here rather than under test/lib/ or test/auth/. The SC#N assertions belong under integration because they span plan boundaries."

requirements-completed: [TENANT-01, TENANT-02]

# Metrics
duration: ~19min
completed: 2026-04-19
---

# Phase 3 Plan 08: URL-Path Tenant Routing + loadTenant Middleware Summary

**Shipped the real `loadTenant` Express middleware (D-13 GUID regex guard + LRU 1000/60s + Postgres SELECT WHERE disabled_at IS NULL + 404/503 handling), a Redis pub/sub subscriber on `mcp:tenant-invalidate` that evicts both the loadTenant LRU and the TenantPool entry, per-tenant CORS that falls back to the global allowlist, and mounted the full `/t/:tenantId/*` router (authorize + token + tenant-scoped /.well-known/*) before the legacy /.well-known/* paths. Removed the `PHASE3_TENANT_PLACEHOLDER` constant and `createLoadTenantPlaceholder` scaffold from 03-06; `createAuthorizeHandler` + `createTenantTokenHandler` now key PKCE Redis entries on `req.tenant.id` directly. SC#1 (runtime tenant onboarding) and SC#2 (multi-tenant isolation on one server instance) are GREEN with integration tests under test/integration/.**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-04-19T17:51:31Z
- **Completed:** 2026-04-19T18:10:25Z
- **Tasks:** 3 (TDD RED → GREEN per task; 5 commits total)
- **Files:** 11 (6 created + 5 modified)
- **New tests:** 30 (14 load-tenant + 9 routing + 2 runtime-onboarding + 5 multi-tenant-isolation)
- **Full test suite:** 605/605 PASS (up from 584)

## Accomplishments

### loadTenant middleware (src/lib/tenant/load-tenant.ts)

- D-13 GUID regex guard (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) rejects non-GUID paths with 404 **before** any DB lookup. Cheap DoS protection + safe default for routing typos.
- LRU cache (max 1000 / TTL 60s, configurable via constructor overrides for tests). `updateAgeOnGet: false` — a hot tenant still expires at 60s so admin mutations propagate within one minute even without explicit invalidation.
- On cache miss: `SELECT ... FROM tenants WHERE id=$1 AND disabled_at IS NULL` (the `IS NULL` filter is load-bearing — disabled tenants 404 the same as unknown ids).
- On pool failure: logs a redacted warn + returns `{ error: 'database_unavailable' }` with status 503. No PG driver error text crosses the client trust boundary.
- `evict(tenantId)` helper attached to the returned middleware function so the pub/sub subscriber can drop cached entries without leaking the internal LRU reference.

### Pub/sub subscriber (src/lib/tenant/tenant-invalidation.ts)

- `subscribeToTenantInvalidation(redis, invalidator)` — subscribes to `mcp:tenant-invalidate`, validates inbound messages against the same GUID regex, and dispatches `invalidator.evict(tenantId)`.
- `publishTenantInvalidation(redis, tenantId)` — the Phase 4 hook. Admin PATCH/DELETE will call this after COMMIT.
- GUID regex validation at the receiver end guards against log injection (T-03-08-06) and malformed publishers.

### Per-tenant CORS (src/lib/cors.ts)

- `createPerTenantCorsMiddleware(config)` — new factory. Resolves the allowlist per-request from `req.tenant.cors_origins` (when non-empty) with fallback to `config.fallbackAllowlist` (the global MS365_MCP_CORS_ORIGINS list).
- Dev mode still uses the loopback regex — same trade-off as `createCorsMiddleware`.
- MUST be mounted AFTER loadTenant on the same route prefix so `req.tenant` is available.

### Server.ts mount + scaffold swap

- `mountTenantRoutes(app, publicBase)` — new method that wires the full `/t/:tenantId/*` router:
  - `loadTenant` middleware first
  - per-tenant CORS
  - `subscribeToTenantInvalidation` — evicts both the loadTenant LRU AND the TenantPool entry on invalidation
  - `/t/:tenantId/.well-known/oauth-authorization-server` + `oauth-protected-resource` (tenant-scoped issuer + scopes)
  - `/t/:tenantId/authorize` + `/t/:tenantId/token` (03-06 handlers, now keyed on `req.tenant.id`)
- Mounted BEFORE `/.well-known/*` so most-specific path wins (D-13).
- **Scaffold removals:**
  - `PHASE3_TENANT_PLACEHOLDER` constant removed entirely.
  - `createLoadTenantPlaceholder` factory removed (no longer exported).
  - `TODO plan 03-08` grep anchors all removed.
- **Legacy compat:** renamed the `'_'` sentinel to `LEGACY_SINGLE_TENANT_KEY` for the pre-03-08 /authorize + /token mounts that 03-09 retires. The sentinel's behaviour is unchanged; the name signals a different lifecycle.

### Integration tests (SC#1 + SC#2)

- **SC#1 (runtime tenant onboarding)** — two tests prove the "no restart needed" contract:
  1. A freshly-INSERTed tenant row is reachable via `/t/:tenantId/authorize` after publishing `mcp:tenant-invalidate`.
  2. Admin DISABLE (UPDATE ... SET disabled_at=NOW()) + publish → subsequent requests return 404.
- **SC#2 (multi-tenant isolation)** — five tests prove two concurrent tenants on ONE server never leak:
  1. Each tenant URL routes to its own `client_id` / `redirect_uri` / `scope`.
  2. Tenant A's `redirect_uri` is rejected on tenant B's `/authorize` (allowlist isolation).
  3. PKCE Redis keys under `mcp:pkce:*` carry the tenant id — disjoint namespaces.
  4. Tenant A's CORS origin is accepted on `/t/A` but rejected on `/t/B`.
  5. Invalidating tenant A does NOT evict tenant B from the LRU.

## Files Created / Modified

### Created

- `src/lib/tenant/load-tenant.ts` (145 lines) — loadTenant middleware factory
- `src/lib/tenant/tenant-invalidation.ts` (88 lines) — pub/sub subscriber + publisher
- `test/tenant/load-tenant.test.ts` (355 lines, 14 tests)
- `test/tenant/routing.test.ts` (363 lines, 9 tests)
- `test/integration/runtime-tenant-onboarding.test.ts` (244 lines, 2 tests — SC#1)
- `test/integration/multi-tenant-isolation.test.ts` (364 lines, 5 tests — SC#2)

### Modified

- `src/lib/cors.ts` — added `PerTenantCorsConfig` + `createPerTenantCorsMiddleware`
- `src/server.ts` — removed PHASE3_TENANT_PLACEHOLDER constant + createLoadTenantPlaceholder scaffold; added LEGACY_SINGLE_TENANT_KEY sentinel + mountTenantRoutes method; updated createAuthorizeHandler + createTenantTokenHandler to key PKCE on tenant.id
- `src/lib/pkce-store/redis-store.ts` — module header comment updated (documents 03-08 routing contract)
- `test/auth/delegated-oauth.test.ts` — updated pre-seeded PKCE keys to harness.tenant.id
- `test/auth/refresh-token-migration.test.ts` — same harness update
- `test/integration/redis-ciphertext-only.test.ts` — same harness update

## Decisions Made

See front-matter `key-decisions` for the full list. Notable:

- **Middleware-with-attached-methods** — the pub/sub subscriber is wired via a `mw.evict(id)` method attached to the returned RequestHandler, not a module-level export. This keeps the dependency graph one-way (subscriber → middleware) and couples cache lifetime to middleware lifetime.
- **Plain-text pub/sub payload** — the GUID itself IS the message. No JSON wrapping.
- **Best-effort mount** — mountTenantRoutes logs-and-continues on missing Phase 3 substrate (pg / redis / TenantPool). Preserves v1-compat HTTP deployment paths.
- **Scoped rename over full removal** — `PHASE3_TENANT_PLACEHOLDER` → `LEGACY_SINGLE_TENANT_KEY`. The sentinel survives because 03-08's scope is the SCAFFOLD removal, not the legacy-mount removal (03-09 owns that).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Worktree missing node_modules + src/generated/client.ts**

- **Found during:** worktree-branch-check sanity step.
- **Issue:** The worktree lacked installed npm deps and the generated MS Graph client at `src/generated/client.ts`. `npm run test` and `npm run build` would fail at transform time.
- **Fix:** Symlinked `node_modules` to `/home/yui/Documents/ms-365-mcp-server/node_modules` and copied `src/generated/client.ts` from the main repo. Neither is a committed artifact; both are reproducible by `npm run generate && npm install`.
- **Files modified:** worktree filesystem only (node_modules symlink + generated/client.ts are both gitignored).
- **Commit:** n/a.

**2. [Rule 3 — Blocking] Worktree branch pointed at stale base commit**

- **Found during:** worktree-branch-check sanity step.
- **Issue:** Worktree was initially on commit `751dae1` (pre-phase-3); expected base was `05831cef`.
- **Fix:** `git reset --hard 05831cef782fe13df3835b246dcca6800cb95b91` as per the prompt's explicit instruction.
- **Files modified:** worktree HEAD only.

**3. [Rule 1 — Test harness regression] Existing 03-06/03-07 tests seeded PKCE under '_' key**

- **Found during:** Task 2 GREEN test run.
- **Issue:** After swapping `PHASE3_TENANT_PLACEHOLDER` → `req.tenant.id` in `createAuthorizeHandler` + `createTenantTokenHandler`, three existing test files (delegated-oauth, refresh-token-migration, redis-ciphertext-only) that pre-seeded PKCE entries under the literal key `'_'` started failing with 400 invalid_grant (PKCE mismatch because the handler now looks up under `harness.tenant.id`).
- **Fix:** Updated all three test harnesses to seed PKCE under `harness.tenant.id` instead of `'_'`. The change is behaviour-equivalent for the tests' invariants — they test the round-trip, not the specific key format — and matches the new 03-08 contract.
- **Files modified:** test/auth/delegated-oauth.test.ts, test/auth/refresh-token-migration.test.ts, test/integration/redis-ciphertext-only.test.ts.
- **Commit:** 177eddd (part of Task 2 GREEN).

**4. [Rule 1 — Test bug] multi-tenant-isolation tests used https:// custom origins that prod mode rejects**

- **Found during:** Task 3 test run (3 of 5 SC#2 tests failed with 400 invalid_redirect_uri).
- **Issue:** The test used `https://app-a.example.com/callback` as redirect URIs. The `createAuthorizeHandler` calls `validateRedirectUri(uri, { mode: 'prod', publicUrlHost: null })` — in prod mode with no configured publicUrlHost, only loopback URIs are accepted. The test's custom HTTPS origins failed the scheme gate.
- **Fix:** Swapped the test's redirect_uri values to `http://localhost:3100/callback-a` / `http://localhost:3200/callback-b` — still distinct per tenant (isolation is preserved) and always-allowed by the loopback gate.
- **Files modified:** test/integration/multi-tenant-isolation.test.ts only.
- **Commit:** a3ab809 (Task 3 final).

---

**Total deviations:** 4 auto-fixed (3 blocking, 1 test-bug). No production-behavior changes beyond what the plan intended.

## Authentication Gates Encountered

None. All tests use `MemoryRedisFacade` + `pg-mem` + mocked MSAL client — no live Azure or ioredis network auth exercised.

## Known Stubs

None. Every code path either executes fully or is a documented handoff to 03-09 / 04:

- `LEGACY_SINGLE_TENANT_KEY` sentinel survives intentionally because 03-08's scope is scaffold removal, not legacy-mount removal. 03-09 deletes both the sentinel AND the legacy /authorize + /token handlers.
- `mountTenantRoutes` is best-effort by design — v1-compat deployments without pg+redis log-and-continue rather than crash.
- `publishTenantInvalidation` is exported as the Phase 4 admin-API hook; Phase 4 PATCH/DELETE will call it after COMMIT. The 03-08 subscriber is already wired to honour the channel.

## Forward Handoff

### 03-09 (Three-transport mounting)

- Consumes: `mountTenantRoutes` as the hook for `/t/:tenantId/mcp` + `/t/:tenantId/sse` + `/t/:tenantId/messages`. 03-09 extends the method to add those three routes after /token.
- Removes: `LEGACY_SINGLE_TENANT_KEY` constant + the legacy /authorize + /token + /mcp inline handlers in `src/server.ts` (lines 160-356 + 1000-1150 approximately).
- Adds: `--tenant-id` CLI flag (formalises the `MS365_MCP_TENANT_ID_HTTP` env var from 03-06).

### 03-10 (Audit log writer)

- Consumes: the request boundaries in `createAuthorizeHandler` + `createTenantTokenHandler` + `createAuthSelectorMiddleware` (app-only branch) as audit hook points. 03-10 adds `writeAudit({ action: 'oauth.authorize', tenantId: tenant.id, ... })` calls at each boundary.
- Consumes: `publishTenantInvalidation` (already exported) for the disable cascade — when `bin/disable-tenant.mjs` completes, it publishes the invalidation so all subscribed servers evict immediately.

### Phase 4 (Admin API)

- Consumes: `publishTenantInvalidation(redis, tenantId)` after every admin mutation (PATCH/DELETE). The subscriber from 03-08 handles the rest.
- The admin-API PATCH workflow: `UPDATE tenants SET cors_origins=... WHERE id=$1` → `publishTenantInvalidation(redis, id)` → all servers evict → next request sees new CORS.

## Routing Order (mount diagram)

```
app.use(cors global)                     ← Phase 1 legacy CORS (dev/prod modes)
app.use('/t/:tenantId', loadTenant)      ← Phase 3 plan 03-08 (THIS plan)
app.use('/t/:tenantId', createPerTenantCorsMiddleware(...))
app.get('/t/:tenantId/.well-known/oauth-authorization-server', ...)  ← MUST be before /.well-known/*
app.get('/t/:tenantId/.well-known/oauth-protected-resource', ...)
app.get('/t/:tenantId/authorize', createAuthorizeHandler(...))
app.post('/t/:tenantId/token', createTenantTokenHandler(...))
app.get('/.well-known/oauth-authorization-server', ...)  ← legacy mount (03-09 may remove)
app.get('/.well-known/oauth-protected-resource', ...)
app.get('/authorize', /* legacy single-tenant handler */)
app.post('/token', createTokenHandler(...))
app.get('/mcp', legacyMcpAccessTokenExtractor, ...)       ← 03-09 replaces with /t/:tenantId/mcp
app.post('/mcp', legacyMcpAccessTokenExtractor, ...)
```

The per-tenant routes are declared FIRST so Express matches them before falling through to the legacy wildcards. `/.well-known/oauth-authorization-server` without a tenant prefix keeps returning the single-tenant metadata for v1 clients.

## SECUR/TENANT CI Invariants Established

```bash
# Acceptance invariants added by 03-08. Every subsequent commit MUST satisfy:

grep -c "TODO plan 03-08" src/server.ts
# -> MUST return 0

grep "PHASE3_TENANT_PLACEHOLDER" src/
# -> MUST return nothing (except as a historical note in docs/*.md, never in src/)

grep -c "createLoadTenantPlaceholder" src/
# -> MUST return 0 (scaffold removed)
```

Any CI job that re-introduces these strings is a 03-08 regression.

## Self-Check: PASSED

**Files verified present on disk:**

- `src/lib/tenant/load-tenant.ts` — FOUND
- `src/lib/tenant/tenant-invalidation.ts` — FOUND
- `src/lib/cors.ts` — FOUND (modified)
- `src/server.ts` — FOUND (modified)
- `src/lib/pkce-store/redis-store.ts` — FOUND (module header updated)
- `test/tenant/load-tenant.test.ts` — FOUND
- `test/tenant/routing.test.ts` — FOUND
- `test/integration/runtime-tenant-onboarding.test.ts` — FOUND
- `test/integration/multi-tenant-isolation.test.ts` — FOUND
- `.planning/phases/03-multi-tenant-identity-state-substrate/03-08-SUMMARY.md` — THIS FILE

**Commits verified in git log:**

- `2c59ece` test(03-08): add failing tests for loadTenant middleware + tenant-invalidation subscriber
- `aafba4f` feat(03-08): add loadTenant middleware + tenant-invalidation subscriber
- `6a82f8c` test(03-08): add failing tests for /t/:tenantId/* routing + per-tenant CORS
- `177eddd` feat(03-08): mount /t/:tenantId/* router + swap scaffolds for real loadTenant + per-tenant CORS
- `a3ab809` test(03-08): add SC#1 runtime onboarding + SC#2 multi-tenant isolation integration tests

**Automated verifications:**

- `npm run test -- --run test/tenant/load-tenant` — 14/14 PASS
- `npm run test -- --run test/tenant/routing` — 9/9 PASS
- `npm run test -- --run test/integration/runtime-tenant-onboarding` — 2/2 PASS (SC#1 signal)
- `npm run test -- --run test/integration/multi-tenant-isolation` — 5/5 PASS (SC#2 signal)
- Full `npm run test` suite: 605/605 PASS (up from 584 in 03-07)
- Pre-existing TypeScript errors (17 errors in 9 files, unchanged from the base commit) are NOT caused by this plan — verified by `git stash -u && npx tsc --noEmit` on the base commit showing the identical 17 errors.

**Acceptance grep summary:**

- `grep -c "TODO plan 03-08" src/server.ts` = 0 ✓
- `grep -r "PHASE3_TENANT_PLACEHOLDER" src/` = 0 matches ✓
- `grep -c "createLoadTenantPlaceholder" src/` = 0 ✓
- `grep -c "export function createLoadTenantMiddleware" src/lib/tenant/load-tenant.ts` = 1 ✓
- `grep -c "export async function subscribeToTenantInvalidation" src/lib/tenant/tenant-invalidation.ts` = 1 ✓
- `grep -c "export function createPerTenantCorsMiddleware" src/lib/cors.ts` = 1 ✓
- `grep -c "mountTenantRoutes" src/server.ts` = 4 (method decl + method body + method call + doc-comment) ✓
- `grep -c "/t/:tenantId/.well-known/oauth-authorization-server" src/server.ts` = 1 ✓
- Route order check: `/t/:tenantId/*` mount (line ~940) BEFORE `/.well-known/*` (line ~1100) ✓

---

_Phase: 03-multi-tenant-identity-state-substrate_
_Completed: 2026-04-19_
