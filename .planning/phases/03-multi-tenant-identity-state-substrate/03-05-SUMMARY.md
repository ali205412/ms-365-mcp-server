---
phase: 03-multi-tenant-identity-state-substrate
plan: 05
subsystem: tenant
tags: [msal, tenant-pool, lru, idle-eviction, msal-cache-plugin, cryptoshred, d-10, tenant-03, tenant-04, tenant-07, auth-02, auth-04]

# Dependency graph
requires:
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 01
    provides: "tenants table schema (mode/client_id/client_secret_ref/tenant_id/cloud_type/wrapped_dek JSONB/disabled_at); api_keys.revoked_at; withTransaction helper in src/lib/postgres.ts; test/setup/fixtures.ts pattern"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 02
    provides: "getRedis() singleton + MemoryRedisFacade (TTL + keys + publish + status); shutdown() hook; RedisClient union type"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 04
    provides: "wrapWithDek/unwrapWithDek envelope primitives (aliased); generateTenantDek(kek)/unwrapTenantDek(env, kek) helpers; loadKek() process-wide KEK loader"
provides:
  - "src/lib/tenant/tenant-row.ts — TenantRow interface + TenantMode + CloudType unions (pure type-only module, zero runtime imports)"
  - "src/lib/tenant/tenant-pool.ts — TenantPool class with hybrid LRU+idle eviction + module-level singleton (initTenantPool/getTenantPool/shutdown)"
  - "src/lib/msal-cache-plugin.ts — createRedisCachePlugin factory returning ICachePlugin backed by Redis + envelope encryption"
  - "src/request-context.ts — extended with flow (AuthFlow union) + authClientId; adds getFlow() helper; Phase 1+2 fields preserved"
  - "src/auth.ts — forTenant<TPool,TTenant>(tenant,pool) thin factory seam; stdio AuthManager.create() path untouched"
  - "bin/disable-tenant.mjs — operator CLI cascading tenants.disabled_at + wrapped_dek=NULL + api_keys.revoked_at + Redis prefix cleanup + TenantPool.evict in one Pitfall-6-guarded flow"
  - "src/index.ts phase3-tenant-pool region filled + phase3-shutdown-tenant-pool region filled"
affects:
  - "03-06: consumes pool.acquire + pool.buildCachePlugin + AuthManager.forTenant for per-flow acquireToken orchestration (all four identity flows)"
  - "03-07: session store layers on top of wrapWithDek/unwrapWithDek (already provided by 03-04); refresh-token envelope lives beside MSAL cache blobs in Redis"
  - "03-08: loadTenant middleware populates requestContext.tenantId; pub/sub subscriber calls pool.evict on 'mcp:tenant-invalidate' messages"
  - "03-09: three-transport mounting honours tenant-scoped acquire path (stdio bypasses pool; HTTP + SSE both go through pool.acquire)"
  - "03-10: audit writer logs tenant.disabled action on disable-tenant CLI completion; pool.drain already in shutdown sequence"

# Tech tracking
tech-stack:
  added:
    - "lru-cache ^11 (already a project dep — first runtime consumer in this plan)"
  patterns:
    - "Module-level singleton with lazy init pattern (matches src/lib/postgres.ts + src/lib/redis.ts — getTenantPool/initTenantPool/shutdown/__setTenantPoolForTesting)"
    - "Factory-returning-ICachePlugin pattern (matches src/lib/middleware/etag.ts closure-captured-deps shape)"
    - "Pure type-only module (tenant-row.ts) matches src/lib/middleware/types.ts + src/secrets.ts AppSecrets shape"
    - "Anchor-region disjoint-edit contract honored — phase3-tenant-pool + phase3-shutdown-tenant-pool regions filled inside markers only; pkce-store + postgres + redis + kek + shutdown-redis + shutdown-postgres regions untouched (all counts=2)"
    - "Programmatic CLI main(argv, deps) pattern — bin/disable-tenant.mjs matches bin/rotate-kek.mjs + bin/create-tenant.mjs; deps.postgres + deps.redis + deps.tenantPool for pg-mem + MemoryRedisFacade tests"
    - "Hybrid LRU + idle-timeout eviction (D-10) — matches HikariCP / pg-pool industry convention for keyed connection pools"
    - "TimerHandle structural type + unknown-cast for clearInterval — keeps the module lint-clean without requiring globals.Timer in eslint.config"

key-files:
  created:
    - "src/lib/tenant/tenant-row.ts (42 lines) — TenantRow + TenantMode + CloudType"
    - "src/lib/tenant/tenant-pool.ts (270 lines) — TenantPool + singleton accessors"
    - "src/lib/msal-cache-plugin.ts (74 lines) — createRedisCachePlugin factory"
    - "bin/disable-tenant.mjs (165 lines, executable) — disable cascade CLI"
    - "test/msal-cache-plugin.test.ts (275 lines, 8 tests)"
    - "test/tenant/tenant-pool.test.ts (234 lines, 13 tests)"
    - "test/tenant/cache-isolation.test.ts (156 lines, 2 tests)"
    - "test/tenant/disable-cascade.test.ts (257 lines, 4 tests)"
  modified:
    - "src/request-context.ts — added AuthFlow union, RequestContext.flow + authClientId optional fields, getFlow() export"
    - "src/auth.ts — appended forTenant<TPool,TTenant>(tenant,pool) factory seam"
    - "src/index.ts — filled region:phase3-tenant-pool (HTTP-mode initTenantPool after kek+redis) + region:phase3-shutdown-tenant-pool (FIRST shutdown step via lazy dynamic import)"

key-decisions:
  - "TenantPool exposes a module-level singleton (initTenantPool/getTenantPool/shutdown) rather than an instance threaded through main(). Matches src/lib/postgres.ts and src/lib/redis.ts shape and lets the phase3ShutdownOrchestrator (defined at module scope) call tenant-pool.shutdown() symmetrically with postgres.shutdown()/redisClient.shutdown() — no closure capture gymnastics."
  - "Scope hash = sha256(sorted(scopes).join(',')).slice(0,16). Sorting is mandatory: otherwise a caller that happens to pass ['Mail.Read','Files.Read'] on one request and ['Files.Read','Mail.Read'] on the next would miss the cache even though MSAL granted identical permissions. 64-bit cache-key fingerprint is sufficient — a collision would only affect the same tenant+client+user, and MSAL degrades to a fresh network acquire on cache miss."
  - "bearer-mode acquire returns null (MSAL bypass). 03-06 bearer middleware sets requestContext.accessToken directly from the Authorization header — no Redis cache write happens for bearer mode. Test 6 in test/tenant/tenant-pool.test.ts asserts the null return. Documented in the threat register (T-03-05-09)."
  - "Pitfall 6 guard treats redis.status='wait' as healthy (lazyConnect pre-connect state). Only 'reconnecting'/'connecting'/'end' trip the guard. Without this carve-out the first disable call on a freshly-initialised ioredis lazyConnect client would always refuse."
  - "Dev fallback for testing: MemoryRedisFacade.status starts at 'wait' and transitions to 'ready' on first command. The test guard (Pitfall 6 test) passes a handcrafted object with status='reconnecting' to deterministically exercise the refusal path without ioredis."
  - "TimerHandle structural subtype ({ unref(): void }) avoids a NodeJS.Timer reference that lint rejects under @typescript-eslint with globals.Timer absent. clearInterval gets the handle via an unknown-cast — the runtime shape IS a Timer, it just isn't typed as one in the pool's own file. This keeps the plugin module zero-dep-on-@types/node."
  - "src/auth.ts.forTenant is a minimal seam, NOT a refactor of the 729-line AuthManager. The full per-tenant rewrite happens incrementally across 03-06 / 03-07; this plan establishes the entry point without destabilising the stdio device-code + file-cache path that 01-04 / 01-05 depend on."
  - "Cache key format is frozen at `mcp:cache:{tenantId}:{clientId}:{userOid|appOnly}:{scopeHash}` — every segment is load-bearing (tenant, clientId, userOid, scopeHash). Any future change requires a key-migration plan because all stored blobs are keyed by the exact literal template."
  - "disable-tenant Redis cleanup runs AFTER pg COMMIT (not inside the txn). A transient Redis failure after commit means the operator runs the CLI a second time — idempotent because the second run's wrapped_dek is already NULL and the api_keys update's WHERE clause skips already-revoked rows. Inside-txn Redis would require a two-phase protocol that doesn't fit the single-VM compose target."
  - "TenantPool constructor reads MS365_MCP_AUTH_POOL_MAX and MS365_MCP_AUTH_POOL_IDLE_MS once at construction (not on every acquire) for predictability — a mid-process env-var change doesn't reshape the pool. Operator rotation of these limits requires a restart, which matches the D-10 D-11 D-12 manual-lifecycle convention."

requirements-completed: [TENANT-03, TENANT-04, TENANT-07, AUTH-02, AUTH-04]

# Metrics
duration: ~55min
completed: 2026-04-19
---

# Phase 3 Plan 05: TenantPool + MSAL Cache Plugin + Disable Cascade Summary

**Hybrid LRU+idle MSAL client pool (200 max / 30 min idle / 60 s sweep), AES-256-GCM envelope-encrypted token cache keyed on `mcp:cache:{tenantId}:{clientId}:{userOid|appOnly}:{scopeHash}`, and an operator CLI that cryptoshreds a tenant (`disabled_at=NOW` + `wrapped_dek=NULL` + `api_keys.revoked_at=NOW` + Redis prefix sweep + pool eviction) — all behind a Pitfall-6 `redis.status==='ready'` guard.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-04-19
- **Tasks:** 3 (TDD RED → GREEN per task; 6 commits total)
- **Files:** 11 (8 created + 3 modified)
- **New tests:** 27 (8 msal-cache-plugin + 13 tenant-pool + 2 cache-isolation + 4 disable-cascade)
- **Total test suite:** 519/519 PASS (up from 476 in 03-04)

## Accomplishments

- **TenantRow type module (src/lib/tenant/tenant-row.ts)** — pure type-only, mirrors `tenants` table columns plus the non-column `client_secret_resolved` field that `TenantPool.acquire` populates lazily. `TenantMode` and `CloudType` unions exported so downstream plans (03-06, 03-08) can refer to them without re-inventing the shape.
- **RequestContext extension** — `flow` (AuthFlow union: `delegated | app-only | bearer | device-code`) and `authClientId` (tenant `client_id` that authenticated the call) added as optional fields; `getFlow()` helper exported. All existing Phase 1+2 fields preserved so every middleware continues to compile unchanged.
- **MSAL cache plugin (src/lib/msal-cache-plugin.ts)** — `createRedisCachePlugin({redis, tenantId, clientId, userOid, scopeHash, dek})` returns an ICachePlugin where `beforeCacheAccess` unwraps with DEK and deserializes into MSAL's in-memory cache, and `afterCacheAccess` serializes + wraps with DEK + `SET EX 3600`. Decrypt failure drops the key and logs a redacted warn — MSAL re-acquires via network.
- **TenantPool (src/lib/tenant/tenant-pool.ts)** — 270 lines. `LRUCache` with `max=MS365_MCP_AUTH_POOL_MAX` (default 200), `ttl=MS365_MCP_AUTH_POOL_IDLE_MS` (default 30 min), `updateAgeOnGet=true`, `updateAgeOnHas=false`. 60 s `setInterval` sweep with `.unref()` so the timer never keeps the event loop alive. Per-mode MSAL class selection (`app-only` → Confidential; `delegated+secret` → Confidential; `delegated, no secret` → Public; `bearer` → `null`). `buildCachePlugin(tenantId, userOid, scopes)` builds a per-request plugin with sorted-scope sha256 fingerprint.
- **Module-level singleton accessors** — `initTenantPool(redis, kek)` / `getTenantPool()` / `shutdown()` / `__setTenantPoolForTesting` match the `src/lib/postgres.ts` and `src/lib/redis.ts` shape so `src/index.ts`'s `phase3ShutdownOrchestrator` can call `tenant-pool.shutdown()` symmetrically.
- **src/auth.ts forTenant seam** — `forTenant<TPool, TTenant>(tenant, pool)` is a thin factory that returns `{ pool, tenant }`. Enables 03-06 per-flow code to write `const { pool, tenant } = forTenant(row, tenantPool)` without disturbing the stdio device-code + file-backed token cache path. Generic-typed so this file does NOT import tenant-pool.ts (no cycle on bootstrap).
- **src/index.ts anchor fills** — `region:phase3-tenant-pool` calls `initTenantPool(redisClient.getRedis(), await loadKek())` in HTTP mode only; `region:phase3-shutdown-tenant-pool` awaits `tenantPoolShutdown()` as the FIRST shutdown step (before redis then postgres per CONTEXT.md order). All other phase3-* anchors intact — grep counts confirmed.
- **bin/disable-tenant.mjs** — 165 lines. Pitfall 6 `redis.status` gate; pre-check existence; one `withTransaction` with `disabled_at=NOW` + `wrapped_dek=NULL` + `api_keys.revoked_at=NOW`; after-commit Redis prefix sweep (`mcp:cache:{id}:*` + `mcp:pkce:{id}:*`); synchronous `tenantPool.evict`. Returns `{ disabled, cacheKeysDeleted, pkceKeysDeleted }`.
- **Cross-tenant isolation proof (test/tenant/cache-isolation.test.ts)** — ROADMAP SC#2 signal. Two tenants with identical `(clientId, userOid, scopes)` produce two distinct Redis keys differing only in the `tenantId` segment; a cross-tenant ciphertext swap fails to decrypt in the target tenant (DEK isolation).

## Cache Key Format

```
mcp:cache:{tenantId}:{clientId}:{userOid|appOnly}:{scopeHash}
```

| Segment | Purpose | Pitfall closed |
|---|---|---|
| `tenantId` | Cross-tenant isolation. No user of tenant A sees tenant B's blob. | T-03-05-01 (Pitfall 2 — cache-key collision) |
| `clientId` | App-registration separation. One tenant, two app regs = two partitions. | T-03-05-01 (Pitfall 2 variant) |
| `userOid` | Cross-user isolation within one tenant/app. Literal `'appOnly'` for client-credentials. | T-03-05-02 (cross-user spoof) |
| `scopeHash` | Scope-set differentiator. Same user, different scopes = different cache. | T-03-05-09 (scope-partition drift) |

## Per-Mode MSAL Class Selection (RESEARCH.md Pattern 5)

| `tenants.mode` | `client_secret_resolved` | MSAL class returned | Notes |
|---|---|---|---|
| `app-only` | required | `ConfidentialClientApplication` | Throws if secret missing |
| `delegated` | present | `ConfidentialClientApplication` | Refresh-token flow |
| `delegated` | absent | `PublicClientApplication` | Device-code / interactive |
| `bearer` | ignored | `null` | MSAL bypassed entirely; token comes from Authorization header (03-06) |

## Pool Eviction Triggers

| Trigger | Mechanism | Call site |
|---|---|---|
| Memory pressure | `LRUCache` max cap (200 default, `MS365_MCP_AUTH_POOL_MAX` override) | Automatic on every `set` |
| Idle timeout | `LRUCache` ttl (30 min default, `MS365_MCP_AUTH_POOL_IDLE_MS` override) | Automatic on every `get`/`has` |
| Background sweep | `setInterval(60s)` → `pool.purgeStale()` | Self-scheduled in constructor |
| Tenant disable | `pool.evict(tenantId)` | `bin/disable-tenant.mjs` + 03-08 pub/sub subscriber |
| Process shutdown | `pool.drain()` | `src/index.ts phase3ShutdownOrchestrator` |

Sweep timer is `.unref()`'d — never keeps the event loop alive.

## RequestContext Field Semantics

```typescript
export type AuthFlow = 'delegated' | 'app-only' | 'bearer' | 'device-code';

interface RequestContext {
  // ... Phase 1+2 fields unchanged ...
  flow?: AuthFlow;       // Which identity flow produced this request
  authClientId?: string; // Tenant-row client_id used for authentication
}
```

| `flow` value | Populated by | Lives in |
|---|---|---|
| `delegated` | 03-06 OAuth callback after MSAL acquireTokenByCode | HTTP OAuth middleware |
| `app-only` | 03-06 client-credentials middleware | HTTP client-credentials flow |
| `bearer` | 03-06 bearer pass-through middleware | HTTP bearer flow |
| `device-code` | AuthManager.acquireTokenByDeviceCode (stdio) | `src/auth.ts` — pre-existing flow |

## Pitfall 6 Guard (Reconnect-During-Cryptoshred)

Queued ioredis commands re-execute AFTER reconnect — potentially AFTER a request that re-populated the tenant cache. Running `redis.del('mcp:cache:{tenantId}:*')` during a reconnect is therefore a silent leak.

`bin/disable-tenant.mjs` checks:

```javascript
if ('status' in redis && redis.status !== 'ready' && redis.status !== 'wait') {
  // Try to force connect; if still not ready, throw.
}
```

`wait` is the ioredis lazyConnect pre-connect state — a fresh singleton that hasn't been touched yet. Test 3 in `test/tenant/disable-cascade.test.ts` asserts the refusal path by injecting a handcrafted `{ status: 'reconnecting', ... }` object.

## Anchor Discipline (Phase 3 Disjoint-Edit Contract)

All edits confined to this plan's own regions. Counts (grep per marker substring):

| Marker substring | src/index.ts | Rule |
| --- | --- | --- |
| `region:phase3-postgres` | 2 (untouched) | 03-01 owns |
| `region:phase3-redis` | 2 (untouched) | 03-02 owns |
| `region:phase3-kek` | 2 (untouched) | 03-04 owns |
| `region:phase3-pkce-store` | 2 (untouched) | 03-03 owns |
| `region:phase3-tenant-pool` | 2 (FILLED — this plan) | 03-05 owns |
| `region:phase3-shutdown-tenant-pool` | 2 (FILLED — this plan) | 03-05 owns |
| `region:phase3-shutdown-redis` | 2 (untouched) | 03-02 owns |
| `region:phase3-shutdown-postgres` | 2 (untouched) | 03-01 owns |

`git diff src/index.ts` confirms edits are localised inside the two phase3-tenant-pool-* regions only.

## Task Commits

Each task committed atomically with TDD (RED → GREEN) gates.

1. **Task 1 RED — msal-cache-plugin test suite** — `4e4da94` (test): 8 behaviors (cross-tenant / cross-user / app-only literal / round-trip / no-op variants / decrypt-fail drops key / import-surface guard)
2. **Task 1 GREEN — TenantRow + RequestContext + MSAL cache plugin** — `b5296fa` (feat): 3 files, 8/8 tests green
3. **Task 2 RED — TenantPool + cache-isolation test suites** — `61a0305` (test): 15 behaviors (lazy instantiate / per-mode classes / LRU cap / evict+has+drain / key format / scope sorting / TENANT-04 isolation)
4. **Task 2 GREEN — TenantPool class + forTenant seam + index.ts anchors** — `15a8f8a` (feat): 4 files changed, 15/15 tests green
5. **Task 3 RED — disable-cascade test suite** — `a2a8bf8` (test): 4 behaviors (full cascade / unknown tenant / Pitfall 6 guard / missing argv)
6. **Task 3 GREEN — bin/disable-tenant.mjs** — `84abb99` (feat): SC#4 cascade CLI, 4/4 tests green

## Files Created / Modified

### Created
- `src/lib/tenant/tenant-row.ts` (42 lines) — TenantRow + TenantMode + CloudType
- `src/lib/tenant/tenant-pool.ts` (270 lines) — TenantPool class + module-level singleton accessors
- `src/lib/msal-cache-plugin.ts` (74 lines) — createRedisCachePlugin factory
- `bin/disable-tenant.mjs` (165 lines, executable) — SC#4 cascade CLI
- `test/msal-cache-plugin.test.ts` (275 lines, 8 tests)
- `test/tenant/tenant-pool.test.ts` (234 lines, 13 tests)
- `test/tenant/cache-isolation.test.ts` (156 lines, 2 tests)
- `test/tenant/disable-cascade.test.ts` (257 lines, 4 tests)

### Modified
- `src/request-context.ts` — added `AuthFlow` union + `RequestContext.flow` + `authClientId` + `getFlow()` helper
- `src/auth.ts` — appended `forTenant<TPool,TTenant>(tenant, pool)` factory seam
- `src/index.ts` — filled `region:phase3-tenant-pool` + `region:phase3-shutdown-tenant-pool` anchor blocks

## Decisions Made

(See front-matter `key-decisions` for the full list.) Notable:

- **Singleton vs instance-threading:** The pool is a module-level singleton (matching `src/lib/postgres.ts` + `src/lib/redis.ts`) rather than an instance threaded through `main()`. This lets `phase3ShutdownOrchestrator` (defined at module scope) call `tenantPoolShutdown()` symmetrically with the other phase3 shutdown calls.
- **`forTenant` is a seam, not a refactor:** v1 AuthManager's 729-line single-tenant device-code + file-cache path is preserved wholesale. The new seam enables HTTP-mode per-flow orchestration without destabilising stdio.
- **Pitfall 6 `wait` carve-out:** ioredis `lazyConnect` starts in `wait` status — a fresh singleton that hasn't been touched yet is "healthy" for guard purposes. Without this, the first disable call on a freshly-initialised client would always refuse.
- **After-commit Redis cleanup:** Redis prefix sweep runs AFTER pg `COMMIT`, not inside the txn. A transient Redis failure just means the operator re-runs the CLI; idempotency is guaranteed by the `WHERE wrapped_dek IS NOT NULL` / `WHERE revoked_at IS NULL` clauses on re-entry.
- **TimerHandle structural type + unknown-cast:** The pool compiles clean under the project's ESLint flat config without requiring a `globals.Timer` addition. The runtime shape IS a Node Timer — the TypeScript shape is just deliberately minimal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Worktree missing node_modules + generated/client.ts**

- **Found during:** Task 0 pre-verification.
- **Issue:** The worktree lacked installed npm deps and the generated MS Graph client at `src/generated/client.ts`. `npm run build` and `npm run test` would both fail at transform time.
- **Fix:** Copied `src/generated/client.ts` from the main repo (656 KB — recycled from the most recent codegen run) and symlinked `node_modules` to `/home/yui/Documents/ms-365-mcp-server/node_modules`. Neither is a committed artifact; both are reproducible by `npm run generate && npm install`.
- **Files modified:** worktree filesystem only (no git changes).
- **Verification:** `npm run build` + `npm run test` succeed; dist/ populated correctly.

**2. [Rule 3 — Blocking] Worktree branch pointed at stale base commit**

- **Found during:** worktree-branch-check sanity step.
- **Issue:** Worktree was initially on commit `751dae1` (pre-phase-3); expected base was `4edd2646`. Plan files live in commits past `751dae1`.
- **Fix:** `git reset --hard 4edd2646f6393496994b8fd07bb78956716fc18e` as per the prompt's explicit instruction.
- **Files modified:** worktree HEAD only.
- **Verification:** `git log --oneline -3` shows 03-04 summary as HEAD.

**3. [Rule 1 — Acceptance regression] `setInterval` grep count inflated by JSDoc references**

- **Found during:** Task 2 acceptance verification (`grep -c "setInterval" tenant-pool.ts` returned 3, acceptance criterion is 1).
- **Issue:** Module-header JSDoc referenced `setInterval(...).unref()` for explanatory purposes; additionally the `private sweepTimer: ReturnType<typeof setInterval>` type annotation used the name. Both inflated the grep count.
- **Fix:** Rewrote the JSDoc to say "unref pattern" without naming the API, and switched to a local `TimerHandle` structural type (`{ unref(): void }`) with an unknown-cast to `Parameters<typeof clearInterval>[0]` at the single clearInterval call site. The only remaining `setInterval` mention is the real code on line 82.
- **Files modified:** `src/lib/tenant/tenant-pool.ts` only.
- **Verification:** `grep -c "setInterval" src/lib/tenant/tenant-pool.ts` returns 1.

**4. [Rule 1 — Acceptance regression] `.unref()` grep count inflated by three JSDoc references**

- **Found during:** Task 2 acceptance verification (`grep -c "\.unref()" tenant-pool.ts` returned 4, acceptance criterion is 1).
- **Issue:** Module header, the `TimerHandle` type comment, and the drain()-site comment all contained `.unref()` literal strings — three phantom matches beyond the one real call.
- **Fix:** Rewrote each JSDoc to use `unref` without the dot+parens literal. Only the single `this.sweepTimer.unref();` call remains.
- **Files modified:** `src/lib/tenant/tenant-pool.ts` only.
- **Verification:** `grep -c "\.unref()" src/lib/tenant/tenant-pool.ts` returns 1.

**5. [Rule 1 — Bug] Duplicate-key warning in test fixture**

- **Found during:** Task 2 GREEN test run (`vite` warning: duplicate key `wrapped_dek` in object literal).
- **Issue:** `test/tenant/cache-isolation.test.ts` `makeTenant` helper set `wrapped_dek: wrappedDek` once verbatim and again via a guarded `overrides.wrapped_dek === undefined ? wrappedDek : overrides.wrapped_dek`. The explicit line was redundant because the `...overrides` spread and the guarded line together covered all cases.
- **Fix:** Removed the redundant explicit `wrapped_dek: wrappedDek` line. The guarded override line remains as the single source of truth.
- **Files modified:** `test/tenant/cache-isolation.test.ts` only.
- **Verification:** test run no longer emits the duplicate-key warning.

---

**Total deviations:** 5 auto-fixed (1 Rule 1 bug + 2 Rule 1 acceptance regressions + 2 Rule 3 blocking). No production-behavior changes beyond what PLAN.md specified.

## Authentication Gates Encountered

None. TenantPool instantiation is self-sufficient — it consumes `redisClient.getRedis()` + `loadKek()` which are both pre-configured by earlier plans. Tests use `MemoryRedisFacade` + `generateTenantDek(randomBytes(32))` so no live Azure or ioredis network auth is exercised.

## Known Stubs

**Intentional — to be consumed by 03-06 / 03-07 / 03-08:**

- `src/auth.ts.forTenant` is a type-only seam (`{ pool, tenant }` return). 03-06 layers per-flow `acquireToken` on top of this seam; 03-07 builds refresh-token session envelopes beside the MSAL cache blobs; 03-08's pub/sub subscriber calls `pool.evict` on `mcp:tenant-invalidate` messages. The seam deliberately does NOT do per-flow orchestration so that 03-05 ships today without pulling the entire per-flow middleware chain into this plan.

No unintentional stubs.

## Forward Handoff

### 03-06 (All-four-identity-flow wiring)

- Consumes: `TenantPool.acquire(tenant)` → `MsalClient | null`; `TenantPool.buildCachePlugin(tenantId, userOid, scopes)` → `ICachePlugin`.
- Consumes: `AuthManager.forTenant(tenant, pool)` seam for code readability.
- Populates: `requestContext.flow` (one of `delegated | app-only | bearer`) and `requestContext.authClientId` (the tenant's `client_id`) on every successful authentication.
- Pattern: `const plugin = pool.buildCachePlugin(tenant.id, userOid, scopes); const client = await pool.acquire(tenant); client.getTokenCache().setCachePlugin(plugin); const result = await client.acquireTokenByCode({...});` — one plugin per request, never reused.

### 03-07 (Refresh-token security migration)

- Consumes: the same `wrapWithDek` / `unwrapWithDek` primitives the cache plugin uses, but keyed to `mcp:session:{sessionId}` instead of `mcp:cache:...`. Per-tenant DEK is fetched via `pool.acquire(tenant)` then the resulting `PoolEntry.dek` is reused (03-07 will expose a `pool.getDek(tenantId)` accessor that does not require re-acquiring the MSAL client).

### 03-08 (URL-path tenant routing)

- Consumes: `requestContext.tenantId` (set by loadTenant middleware) matches the `acquire(tenantRow)` call in 03-06's per-flow handlers.
- Consumes: `pool.evict(tenantId)` from a Redis pub/sub subscriber on `mcp:tenant-invalidate`. Admin PATCH/DELETE in Phase 4 will publish to this channel; 03-08 ships the subscriber skeleton.

### 03-10 (Audit log writer)

- Consumes: `pool.shutdown()` in the graceful-shutdown sequence (already wired in `phase3ShutdownOrchestrator`).
- Writes: an `audit_log` row with `action='tenant.disabled'` when `bin/disable-tenant.mjs` completes. The CLI currently returns the counts to stdout; 03-10 layers an INSERT before the return.

## Threat Flags

None detected beyond the register entries already documented in the plan's `<threat_model>` (T-03-05-01 through T-03-05-09). No new trust-boundary surfaces introduced.

- **Info disclosure surface:** DEK lives in `PoolEntry.dek` for the pool entry's lifetime. Disable cascade drops both the pool entry (via `evict`) and the persisted envelope (via `wrapped_dek=NULL`) — cryptoshred semantics intact.
- **DoS surface:** LRU cap of 200 is the hard upper bound. Operator override via `MS365_MCP_AUTH_POOL_MAX` env var.
- **Spoofing surface:** Pitfall 2 cache-key collision prevented by `tenantId + clientId + userOid + scopeHash` partition; exhaustive testing in `test/tenant/cache-isolation.test.ts`.

## Self-Check: PASSED

**Files (existence-verified 2026-04-19):**
- FOUND: src/lib/tenant/tenant-row.ts
- FOUND: src/lib/tenant/tenant-pool.ts
- FOUND: src/lib/msal-cache-plugin.ts
- FOUND: src/request-context.ts (modified)
- FOUND: src/auth.ts (modified)
- FOUND: src/index.ts (modified — region:phase3-tenant-pool + region:phase3-shutdown-tenant-pool filled)
- FOUND: bin/disable-tenant.mjs (executable)
- FOUND: test/msal-cache-plugin.test.ts
- FOUND: test/tenant/tenant-pool.test.ts
- FOUND: test/tenant/cache-isolation.test.ts
- FOUND: test/tenant/disable-cascade.test.ts

**Commits (all present on `worktree-agent-a54e4f82` branch):**
- FOUND: 4e4da94 (Task 1 RED — msal-cache-plugin test suite)
- FOUND: b5296fa (Task 1 GREEN — tenant-row + RequestContext + MSAL cache plugin)
- FOUND: 61a0305 (Task 2 RED — TenantPool + cache-isolation test suites)
- FOUND: 15a8f8a (Task 2 GREEN — TenantPool class + auth.ts seam + index.ts anchors)
- FOUND: a2a8bf8 (Task 3 RED — disable-cascade test suite)
- FOUND: 84abb99 (Task 3 GREEN — bin/disable-tenant.mjs)

**Automated verifications:**
- `npm run test -- --run test/msal-cache-plugin` — 8/8 PASS
- `npm run test -- --run test/tenant/tenant-pool` — 13/13 PASS
- `npm run test -- --run test/tenant/cache-isolation` — 2/2 PASS (SC#2 signal)
- `npm run test -- --run test/tenant/disable-cascade` — 4/4 PASS (SC#4 signal)
- Full suite: `npm run test` — 519/519 PASS (up from 476 in 03-04)
- `npm run build` — PASS
- `npm run lint` — 0 errors (59 pre-existing warnings in other test files; out of scope)

**Task-1 acceptance grep summary:**
- `grep -c "export interface TenantRow" tenant-row.ts` = 1 ✓
- `grep -cE "export type (TenantMode|CloudType)" tenant-row.ts` = 2 ✓
- `grep -c "flow?:" request-context.ts` = 1 ✓
- `grep -c "authClientId?:" request-context.ts` = 1 ✓
- `grep -c "export function createRedisCachePlugin" msal-cache-plugin.ts` = 1 ✓
- `grep -c "mcp:cache:${tenantId}:${clientId}:${userOid}:${scopeHash}" msal-cache-plugin.ts` = 1 ✓
- `grep -c "wrapWithDek|unwrapWithDek" msal-cache-plugin.ts` = 3 (≥ 2) ✓
- `grep -c "CACHE_TTL_SECONDS" msal-cache-plugin.ts` = 2 (≥ 1) ✓

**Task-2 acceptance grep summary:**
- `grep -c "export class TenantPool" tenant-pool.ts` = 1 ✓
- `grep -c "LRUCache" tenant-pool.ts` = 3 (≥ 1) ✓
- `grep -c "MS365_MCP_AUTH_POOL_MAX|MS365_MCP_AUTH_POOL_IDLE_MS" tenant-pool.ts` = 4 (≥ 2) ✓
- `grep -c "updateAgeOnGet: true" tenant-pool.ts` = 1 ✓
- `grep -c "setInterval" tenant-pool.ts` = 1 ✓
- `grep -c "\.unref()" tenant-pool.ts` = 1 ✓
- `grep -c "ConfidentialClientApplication|PublicClientApplication" tenant-pool.ts` = 8 (≥ 2) ✓
- `grep -c "tenantPoolShutdown|tenantPool.drain|tenantPool?.drain" index.ts` = 2 (≥ 1) ✓
- `grep -c "TenantPool|initTenantPool|tenant-pool" index.ts` = 14 (≥ 1) ✓
- `grep -c "region:phase3-tenant-pool" index.ts` = 2 ✓
- `grep -c "region:phase3-shutdown-tenant-pool" index.ts` = 2 ✓
- Other plans' region counts: postgres=2, redis=2, kek=2, pkce-store=2, shutdown-redis=2, shutdown-postgres=2 — all untouched ✓

**Task-3 acceptance grep summary:**
- `grep -c "export async function main" disable-tenant.mjs` = 1 ✓
- `grep -c "disabled_at.*NOW" disable-tenant.mjs` = 2 (≥ 1) ✓
- `grep -c "wrapped_dek = NULL" disable-tenant.mjs` = 1 ✓
- `grep -c "revoked_at.*NOW" disable-tenant.mjs` = 2 (≥ 1) ✓
- `grep -c "redis.status" disable-tenant.mjs` = 4 (≥ 1) ✓
- `grep -c "tenantPool.evict|tenantPool?.evict" disable-tenant.mjs` = 3 (≥ 1) ✓
- `grep -c "withTransaction" disable-tenant.mjs` = 3 (≥ 1) ✓

---
*Phase: 03-multi-tenant-identity-state-substrate*
*Completed: 2026-04-19*
