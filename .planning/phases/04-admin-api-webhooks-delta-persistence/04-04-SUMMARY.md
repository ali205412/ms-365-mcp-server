---
phase: 04-admin-api-webhooks-delta-persistence
plan: 04
subsystem: api
tags:
  [admin, auth, entra, api-key, dual-stack, rbac, jose, lru-cache, phase-4]

# Dependency graph
requires:
  - phase: 01-foundation-hardening
    provides:
      "pino logger with REDACT_PATHS (D-01); src/lib/redact.ts scrubHeaders +
      SENSITIVE_HEADERS already includes 'x-admin-api-key' from 04-03"
  - phase: 03-multi-tenant-identity-state-substrate
    provides:
      "src/oauth-provider.ts decodeJwt pattern + WR-08 decode-only invariant;
      src/lib/microsoft-auth.ts createBearerMiddleware header-read pattern;
      src/lib/tenant/load-tenant.ts LRUCache + factory-with-deps pattern;
      src/lib/redis.ts RedisClient type; src/lib/postgres.ts Pool"
  - phase: 04-admin-api-webhooks-delta-persistence
    provides:
      "04-01: createAdminRouter + TODO(04-04) anchor + problemUnauthorized/
      problemForbidden shorthands; 04-03: verifyApiKeyPlaintext +
      ApiKeyIdentity (with revokedAt field) + API_KEY_PREFIX constant"
provides:
  - "src/lib/admin/auth/entra.ts — verifyEntraAdmin(token, deps) + 
    createAdminEntraMiddleware(deps). Decode-only jose.decodeJwt + 5m LRU
    of Graph /me/memberOf results keyed by UPN (max 200 entries). aud
    fast-fail before Graph round-trip. Graph 401/5xx fail-closed → null.
    Exports __resetEntraCacheForTesting + __setEntraCacheTtlForTesting
    (test-only)."
  - "src/lib/admin/auth/api-key.ts — verifyApiKeyHeader(headerValue, deps) +
    createAdminApiKeyMiddleware(deps). Delegates to 04-03's
    verifyApiKeyPlaintext, checks revokedAt, adapts to the dual-stack
    identity shape (actor='api-key:${keyId}', source='api-key',
    tenantScoped=api_key.tenant_id)."
  - "src/lib/admin/auth/dual-stack.ts — createAdminAuthMiddleware(deps) +
    AdminIdentity union type + declare-module augmentation for
    Request.admin. Header precedence api-key > Bearer; neither → 401."
  - "src/lib/admin/router.ts — r.use(createAdminAuthMiddleware(deps))
    mounted between /health and sub-routes (replaces TODO(04-04) anchor)."

affects:
  - "04-02 (/admin/tenants CRUD): handlers read req.admin.actor for audit
    writes and req.admin.tenantScoped for RBAC. Middleware is already in
    the admin router chain; 04-02 slots into the existing TODO(04-02)
    anchor in router.ts and inherits auth for free."
  - "04-03 (/admin/api-keys CRUD): handlers ALREADY read req.admin per
    their own AdminContext interface — dual-stack middleware now supplies
    the shape so existing tests' stubbed req.admin transitions to real
    runtime populate. No code change to api-keys.ts required."
  - "04-05 (/admin/audit query): consumes req.admin.tenantScoped for the
    RBAC scope filter; global admins see all rows, tenant-scoped admins
    see only their own."
  - "04-06 (admin-action audit logging): writeAudit calls read
    req.admin.actor as the audit.actor column."

# Tech tracking
tech-stack:
  added:
    # No new runtime deps — jose + lru-cache already in package.json from
    # Phases 1-3; argon2 consumed transitively via 04-03.
    - "(no new runtime deps — pure composition of jose + lru-cache +
      existing 04-03 verifyApiKeyPlaintext)"
  patterns:
    - "Decode-only JWT validation (WR-08 invariant) — jose.decodeJwt parses
      payload WITHOUT signature verify; aud check fast-fails forged tokens;
      Graph /me/memberOf is the authoritative signature check because the
      actual Bearer call hits Graph's validator"
    - "Fail-closed on infrastructure outage — Graph 5xx/network failure
      returns null (→ 403 by middleware), NOT fail-open. Auth gates never
      grant access without a live downstream check"
    - "Helper-based composition (NOT middleware-in-middleware) for dual-
      stack — sub-middlewares that short-circuit with res.status(401)
      never call next(), so wrapping them in a Promise deadlocks. Using
      the underlying verifyApiKeyHeader + verifyEntraAdmin helpers keeps
      the short-circuit protocol owned by the outer handler"
    - "5m LRU keyed by UPN (not token) — amortizes /me/memberOf round-trips
      to 1 per UPN per TTL window; survives token refresh since the user
      identity is stable; cache entry holds only group-ID array, never
      the bearer token"
    - "Declaration-merging for Request.admin — express-serve-static-core
      augmentation makes req.admin type-visible to every downstream
      handler without per-call casting (PATTERNS.md:400 pattern)"
    - "__setEntraCacheTtlForTesting test hook — same workaround as 04-03's
      __setApiKeyCacheTtlForTesting: LRUCache captures ttl at construction
      and performance.now() debouncing makes vi.useFakeTimers unreliable;
      swap the module cache reference + real-time sleep at 1/3000th scale"
    - "Pre-flight decode for 401 vs 403 discrimination — middleware decodes
      before calling verifyEntraAdmin so malformed/missing-upn/aud-mismatch
      → 401 (identity invalid) can be distinguished from valid-identity-
      but-not-member → 403 (authorization missing)"

key-files:
  created:
    - "src/lib/admin/auth/entra.ts"
    - "src/lib/admin/auth/api-key.ts"
    - "src/lib/admin/auth/dual-stack.ts"
    - "src/lib/admin/__tests__/auth-entra.test.ts"
    - "src/lib/admin/__tests__/auth-dual-stack.test.ts"
    - "src/lib/admin/__tests__/auth-context.int.test.ts"
  modified:
    - "src/lib/admin/router.ts — replaced TODO(04-04) anchor with
      `r.use(createAdminAuthMiddleware(deps))` between /health and
      /api-keys mounts; updated middleware-order doc comment"

key-decisions:
  - "Helpers over sub-middlewares in dual-stack.ts — composing two Express
    middlewares via a synthetic next callback deadlocks whenever the inner
    middleware short-circuits with res.status(401).json(...) (no next()
    called → wrapping Promise never resolves). Calling verifyApiKeyHeader
    and verifyEntraAdmin directly avoids this entirely; the outer handler
    owns every res.status(...) call"
  - "Pre-flight decodeJwt in dual-stack to discriminate 401 vs 403 — the
    plan's behaviour block requires malformed-token-but-Bearer → 401 and
    non-member-but-valid-token → 403. Letting verifyEntraAdmin return null
    for both cases would collapse the distinction; an outer pre-flight
    decode enables the middleware to return 401 for (malformed || missing
    upn || aud mismatch) and let the helper-returned null imply 403"
  - "Revoked api-key → 401 (not 403) — per RESEARCH.md Open Question 3 +
    RFC 7235 semantics: a revoked credential is no longer a valid identity,
    so 401 (retry-with-different-credentials) is correct. 403 would imply
    'this identity is valid but forbidden', which is wrong for revoked"
  - "EntraAdminIdentity.tenantScoped is ALWAYS null (v2.0) — Entra group
    membership grants GLOBAL admin access. Per-tenant admin scoping is an
    API-key-only surface. This keeps the RBAC surface simple: one bit
    ('is this admin global or tenant-scoped?') determines every filter"
  - "LRU cache keyed by UPN (not token) — survives token refresh for the
    same user; never holds bearer credentials in memory; amortizes Graph
    round-trips at a per-user granularity. Max 200 entries is 200 concurrent
    admin users, comfortable headroom for single-tenant deployments"
  - "Graph fetch failure fails CLOSED (→ null → 403) — per RESEARCH.md V2
    ASVS: an auth gate must not grant access during a downstream outage.
    The 5m LRU absorbs Graph transient failures AFTER the first successful
    probe (cached group membership), but the first-ever probe failing for
    a given UPN correctly returns 403 until Graph recovers"
  - "Middleware mount order tls → cors → /health → auth → sub-routes is
    locked in router.ts with explicit comment. /health BEFORE auth is the
    only route that bypasses auth; every sibling plan (04-02, 04-05, 04-06)
    that inserts routes AFTER the TODO anchors inherits auth automatically"

patterns-established:
  - "Three-file auth module layout under src/lib/admin/auth/ — entra.ts
    (strategy A), api-key.ts (strategy B), dual-stack.ts (composer).
    Future auth surfaces (e.g., mTLS in v2.1+) drop in as a fourth file
    and the dual-stack composer extends to a triple-stack by duplicating
    the helper-call pattern"
  - "Shared AdminAuthDeps interface — pgPool + redis + entraConfig +
    optional fetchImpl. Every admin auth middleware factory in this plan
    and future plans accepts the same deps bag so callers can pass one
    object; test code injects fetchImpl to mock /me/memberOf without
    touching the production fetch"
  - "Admin-identity discriminated union — AdminIdentity =
    EntraAdminIdentity | ApiKeyAdminIdentity. Handlers switch on .source
    to apply RBAC. Both shapes share {actor, source, tenantScoped}, so
    common code (audit writer, request logger) reads the common subset
    without discrimination"

requirements-completed:
  - "ADMIN-04"
  - "ADMIN-05"

# Metrics
duration: ~14min
completed: 2026-04-20
---

# Phase 4 Plan 04: Admin auth dual-stack (Entra OAuth + X-Admin-Api-Key) Summary

**Dual-stack admin auth shipped: decode-only Entra JWT validation + 5m LRU cache of Graph /me/memberOf (max 200 entries) + X-Admin-Api-Key middleware delegating to 04-03's verifyApiKeyPlaintext + composed createAdminAuthMiddleware with deterministic api-key > Bearer precedence mounted between /health and sub-routes.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-04-20T08:33:54Z
- **Completed:** 2026-04-20T08:48:02Z
- **Tasks:** 2 (TDD, both green)
- **Files:** 6 created + 1 modified = 7 total
- **Tests added:** 35 (15 entra + 16 dual-stack + 4 integration)
- **Test result:** 94/94 admin tests PASS (35 new + 59 pre-existing)

## Accomplishments

- **Entra admin auth middleware lands** — `verifyEntraAdmin(token, deps)` + `createAdminEntraMiddleware(deps)` in `src/lib/admin/auth/entra.ts`. Decode-only jose.decodeJwt (WR-08 invariant preserved), aud fast-fail before any Graph round-trip, 5-minute LRUCache keyed by UPN (max 200 entries) caching group-ID arrays from /me/memberOf, Graph 401/5xx fail-closed (never grant access during outage). 15 tests cover every edge: malformed token, missing upn, aud mismatch, non-member, cache hit/miss, Graph fetch failure, and the middleware composition matrix.
- **X-Admin-Api-Key middleware delegates to 04-03 verifyApiKeyPlaintext** — `src/lib/admin/auth/api-key.ts` exports `verifyApiKeyHeader(headerValue, deps)` (adapts ApiKeyIdentity into the dual-stack ApiKeyAdminIdentity shape, rejects revoked keys) and `createAdminApiKeyMiddleware(deps)` (header reader + 401 on invalid/revoked/malformed). Single source of truth for plaintext→identity resolution stays in 04-03.
- **Dual-stack composer wires it all together** — `src/lib/admin/auth/dual-stack.ts` exports `createAdminAuthMiddleware(deps)` + `AdminIdentity` union type. Strategy chain: X-Admin-Api-Key first (lower latency, no Graph round-trip), Authorization: Bearer second, neither → 401. Header precedence is deterministic by construction: when BOTH headers are present, api-key wins and Entra is never invoked (T-04-10 mitigation). Pre-flight JWT decode discriminates 401 (malformed identity) from 403 (valid identity, non-member).
- **Request.admin declaration-merged** — `declare module 'express-serve-static-core'` augments `Request` with an optional `admin?: AdminIdentity` property. Every downstream admin handler sees `req.admin` with correct TS types without per-call casting.
- **Router wired** — `src/lib/admin/router.ts` replaces the TODO(04-04) anchor with `r.use(createAdminAuthMiddleware(deps))`; mount order locked as tls → cors → /health (bypass) → auth → sub-routes. The middleware-order doc comment at the top of the file now reflects reality.
- **35 unit + integration tests pass** — 11 verifyEntraAdmin tests, 4 createAdminEntraMiddleware tests, 6 api-key middleware tests, 9 dual-stack tests (including the 8 header-combination scenarios from the plan's behaviour block), 1 mount-order structural test, and 4 integration tests driving a real Express app via `http.createServer` + `fetch` to assert `req.admin` flows end-to-end to a downstream handler.
- **WR-08 PII invariant holds across the admin surface** — assertions in tests 11 (entra), no-PII-leak (dual-stack), and no-token-in-logs (integration) grep every captured logger call and verify the full token and api-key plaintext never appear at info/warn/error levels.

## Task Commits

Each task was committed atomically on worktree branch. Both tasks are TDD (separate RED + GREEN commits).

1. **Task 1 (RED): failing tests for Entra verify + middleware** — `aa481d6` (test)
2. **Task 1 (GREEN): Entra verify + middleware implementation** — `6c3d5a0` (feat)
3. **Task 2 (RED): failing tests for dual-stack + api-key + router wiring** — `b2711cd` (test)
4. **Task 2 (GREEN): dual-stack + api-key + router mount** — `d3cb370` (feat)

Plan metadata commit (this SUMMARY) follows separately.

## New Exports

### src/lib/admin/auth/entra.ts

- `verifyEntraAdmin(token, deps): Promise<EntraAdminIdentity | null>` — consumed by dual-stack
- `createAdminEntraMiddleware(deps): RequestHandler` — Express middleware
- `EntraConfig` interface: `{ appClientId, groupId, graphBase? }`
- `EntraAdminIdentity` interface: `{ actor, source: 'entra', tenantScoped: null }`
- `EntraMiddlewareDeps` interface
- Constants (module-private): `MEMBER_OF_CACHE_MAX = 200`, `MEMBER_OF_CACHE_TTL_MS = 5 * 60 * 1000`
- Test-only: `__resetEntraCacheForTesting()`, `__setEntraCacheTtlForTesting(ttlMs | null)`

### src/lib/admin/auth/api-key.ts

- `verifyApiKeyHeader(headerValue, deps): Promise<ApiKeyAdminIdentity | null>` — dual-stack consumer
- `createAdminApiKeyMiddleware(deps): RequestHandler` — Express middleware
- `ApiKeyAdminIdentity` interface: `{ actor, source: 'api-key', tenantScoped: string }`
- `ApiKeyMiddlewareDeps` interface

### src/lib/admin/auth/dual-stack.ts

- `createAdminAuthMiddleware(deps): RequestHandler` — the composer
- `AdminIdentity` union type: `EntraAdminIdentity | ApiKeyAdminIdentity`
- `AdminAuthDeps` interface: `{ pgPool, redis, entraConfig, fetchImpl? }`
- Module augmentation: `express-serve-static-core.Request.admin?: AdminIdentity`

## Threat Mitigations Landed

| Threat ID | STRIDE Category | Mitigation In This Plan |
| --------- | --------------- | ----------------------- |
| T-04-09   | Spoofing         | Forged Entra tokens bail at aud-check before Graph round-trip (Test 3). Tokens with valid aud but forged signature fail the Graph /me/memberOf call — Graph validates the signature on every API request (Pitfall 5). Test 4 asserts malformed JWT → null; Test 3 asserts aud mismatch → null WITHOUT calling fetchImpl. |
| T-04-10   | Tampering        | Header precedence is deterministic: api-key strategy evaluates first. When both headers present, Test 1 asserts fetchImpl (Graph) is NOT called — the caller with a valid api-key never triggers Entra. Short-circuit 401 on invalid api-key does NOT fall through to Bearer (documented inline). |
| T-04-11   | Repudiation      | req.admin populated ONLY by createAdminAuthMiddleware at middleware layer. Declaration-merging augments `Request` (not `Object.prototype` — attacker-driven prototype pollution cannot inject admin identity). Handlers read req.admin, never body.admin or query.admin. Test 1-4 in auth-context.int.test.ts assert req.admin flows only through the middleware. |
| T-04-09a  | Info Disclosure  | WR-08 invariant: Test 11 (entra) + no-PII-leak (dual-stack) + no-token-in-logs (integration) grep every captured logger call for the full token substring and assert 0 matches at info/warn/error levels. UPN is truncated to first-3-chars-plus-`***` in warn frames for forensic triage. |
| T-04-10a  | DoS              | 5m LRU amortizes /me/memberOf to ≤1 fetch per UPN per TTL window. Cache capped at 200 entries — churn is bounded. Graph's own rate limiting (10k req/min per app) is the outer backstop. |
| T-04-10b  | EoP              | Revoked api-keys return null from verifyApiKeyPlaintext within ≤60s (04-03's LRU TTL) or <100ms (04-03's pub/sub). verifyApiKeyHeader then returns null → middleware returns 401 (Test 3 in dual-stack). |
| T-04-10c  | Info Disclosure  | 401 vs 403 distinction accepted per OWASP ASVS V4 (attackers probing for admin accounts already know the admin URL is sensitive — obfuscating 403→401 would hurt legitimate debugging). |
| T-04-11a  | Spoofing         | /admin/health returns the constant 'admin-router-alive' — no version info, no tenant data. Integration Test 4 asserts the body. |

## Env Vars Consumed

No new env vars introduced by this plan. The Entra config (`MS365_MCP_ADMIN_APP_CLIENT_ID`, `MS365_MCP_ADMIN_GROUP_ID`) was added by plan 04-01; this plan wires it into the auth path.

| Variable                        | Purpose                                                 |
| ------------------------------- | ------------------------------------------------------- |
| `MS365_MCP_ADMIN_APP_CLIENT_ID` | Entra admin app-reg client ID — the `aud` claim target  |
| `MS365_MCP_ADMIN_GROUP_ID`      | Security group object ID — checked in /me/memberOf      |

## Files Created/Modified

### Created

- `src/lib/admin/auth/entra.ts` (~340 lines) — decode-only Entra + 5m LRU
- `src/lib/admin/auth/api-key.ts` (~120 lines) — X-Admin-Api-Key middleware
- `src/lib/admin/auth/dual-stack.ts` (~175 lines) — dual-stack composer
- `src/lib/admin/__tests__/auth-entra.test.ts` (15 tests)
- `src/lib/admin/__tests__/auth-dual-stack.test.ts` (16 tests)
- `src/lib/admin/__tests__/auth-context.int.test.ts` (4 tests, real Express + fetch)

### Modified

- `src/lib/admin/router.ts` — replaced TODO(04-04) anchor with
  `r.use(createAdminAuthMiddleware(deps))`; updated middleware-order
  doc comment to reflect the new state

## Decisions Made

- **Helper-based composition in dual-stack.ts** — my initial implementation wrapped the two sub-middlewares (`createAdminApiKeyMiddleware` + `createAdminEntraMiddleware`) in synthetic `next` callbacks so the composer could observe whether each ran. This deadlocked whenever a sub-middleware short-circuited with `res.status(401).json(...)` and never called `next()`. The wrapping Promise never resolved and tests timed out at 5s. The fix was to drop the middleware-composition pattern entirely and call the underlying `verifyApiKeyHeader` + `verifyEntraAdmin` helpers directly from the composer. This preserves the same observable behaviour (401/403 discrimination, header precedence, declaration-merged req.admin) while giving the outer handler exclusive ownership of every `res.status(...)` call.
- **Pre-flight decodeJwt in dual-stack for 401 vs 403 discrimination** — the plan's behaviour block explicitly requires Bearer-with-malformed-token → 401 and Bearer-with-valid-token-but-non-member → 403. Both cases cause `verifyEntraAdmin` to return null, so a single null-check in the composer would collapse the two HTTP codes into one. Adding a pre-flight `decodeJwt` + aud check in the composer lets us map (malformed || missing upn || aud mismatch) → 401 before calling the helper, and helper-returned null → 403 afterwards.
- **5m LRU keyed by UPN, not token** — two design choices: (a) UPN is stable across token refresh for the same user, so the cache survives short-lived Entra access-token rotation; (b) the cache never holds bearer credentials — the token is passed as `Authorization: Bearer ${token}` to the fetchImpl on every miss but is never stored at rest. This matches WR-08's "tokens don't sit in memory" posture.
- **`__setEntraCacheTtlForTesting` test hook** — same issue as 04-03's api-keys `__setApiKeyCacheTtlForTesting`: LRUCache captures ttl at construction and reads time via `performance.now()` with 1-second debouncing; `vi.useFakeTimers` cannot reliably expire a 300_000ms TTL. Swapping the module cache reference with a 100ms-TTL variant and using real-time `setTimeout(250)` is the deterministic path.
- **Graph fetch failure fails CLOSED (→ null → 403)** — per the plan's V2 ASVS row: an auth gate must not grant access when a downstream check cannot run. Alternative would be "fail open" (return the cached identity if any prior call succeeded), but that opens a privilege-escalation vector — an attacker who times a Graph outage could retain admin access after their group membership was revoked. 403 during Graph outage is the correct trade-off.
- **EntraAdminIdentity.tenantScoped = null always** — the v2.0 RBAC surface has two tiers only: global (Entra group members, see all tenants) and tenant-scoped (api-key holders, see only their own tenant). Adding per-tenant Entra admins would require a per-tenant group lookup and complicate the reasoning about which admins can see what; deferred to v2.1+.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] vi.useFakeTimers + LRUCache TTL collision**

- **Found during:** Task 1 GREEN verification (Test 7 initial run)
- **Issue:** Plan Task 1 behaviour block specified `vi.useFakeTimers();  vi.advanceTimersByTime(5*60*1000 + 1000);` for the TTL-expiry test. LRUCache reads time via `performance.now()` with 1-second debouncing — fake timers do not mock `performance.now()` reliably in Node 22+, so the cached entry never expired and fetchImpl was called once instead of twice. Test 7 initially failed with "expected 2 to be 1".
- **Fix:** Added `__setEntraCacheTtlForTesting(ttlMs | null)` test-only export that swaps the module cache with a 100ms-TTL variant. Test 7 now uses `setTimeout(250)` real-time sleep. Identical strategy to 04-03's `__setApiKeyCacheTtlForTesting`.
- **Files modified:** src/lib/admin/auth/entra.ts, src/lib/admin/__tests__/auth-entra.test.ts
- **Verification:** Test 7 passes in ~300ms; fetchImpl call-count asserted exactly 2.
- **Committed in:** 6c3d5a0 (Task 1 GREEN)

**2. [Rule 3 — Blocking] Middleware-composition deadlock in dual-stack**

- **Found during:** Task 2 GREEN initial run (tests 3, 4, 6, 7 timed out at 5s)
- **Issue:** Plan Task 2 <action> block showed a composition pattern:
  ```typescript
  apiKey(req, res, (err?: unknown) => {
    if (err) { next(err); return; }
    if (req.admin) { next(); return; }
    entra(req, res, (err2?: unknown) => { ... });
  });
  ```
  This deadlocks whenever a sub-middleware short-circuits with `res.status(401).json(...)` without calling `next()` — the synthetic `next` callback is never invoked, any wrapping Promise never resolves, the test times out. The plan's example was taken from `src/lib/auth-selector.ts:67-151`, but auth-selector's sub-middleware is `createBearerMiddleware` which ALWAYS calls next(next) and lets the wrapping handler decide the status; my sub-middleware shape (per api-key.ts + entra.ts) emits 401/403 inline.
- **Fix:** Rewrote `createAdminAuthMiddleware` in `dual-stack.ts` to call the underlying helpers (`verifyApiKeyHeader`, `verifyEntraAdmin`) directly rather than wrapping the sub-middlewares. The outer handler owns every `res.status(...)` call and the control flow is linear. Pre-flight JWT decode added in the Bearer branch for 401 vs 403 discrimination.
- **Files modified:** src/lib/admin/auth/dual-stack.ts
- **Verification:** All 20 Task 2 tests pass in ~22 seconds (4 tests removed 5s timeouts); header precedence, revoked-key 401, non-member 403, malformed 401, no-PII-leak invariants all hold.
- **Committed in:** d3cb370 (Task 2 GREEN)

**3. [Rule 2 — Missing critical] Mock Response needed `headersSent` flag**

- **Found during:** Task 2 GREEN initial run (partial — before deviation 2 was applied)
- **Issue:** The `makeReqRes` helper in auth-dual-stack.test.ts did not include `headersSent` on the mock Response. My initial dual-stack implementation (pre-deviation-2) read `res.headersSent` to detect sub-middleware short-circuits; the flag was always `false` on the stub, so the composer tried to fall through to Entra even after api-key had already sent a 401.
- **Fix:** Augmented `makeReqRes` to set `headersSent = true` inside the mock's `json()` and `send()` methods. Even after deviation 2 eliminated the `res.headersSent` check in production code, keeping this makes the mock a faithful Express-Response stand-in for future tests that may exercise short-circuit paths.
- **Files modified:** src/lib/admin/__tests__/auth-dual-stack.test.ts
- **Verification:** Mock Response now accurately models Express semantics; no test depends on the old always-false behaviour.
- **Committed in:** d3cb370 (Task 2 GREEN — bundled with deviation 2 since both landed in the same commit)

**4. [Rule 1 — Bug] Mount-order test matched JSDoc instead of call-site**

- **Found during:** Task 2 GREEN initial run (router.ts mount order test failed with "expected 3524 to be less than 1418")
- **Issue:** The mount-order test used `src.indexOf('createAdminAuthMiddleware')` to locate the auth middleware mount position. The JSDoc comment at the top of router.ts mentions `createAdminAuthMiddleware` before the actual `r.use(createAdminAuthMiddleware(deps))` call, so `indexOf` matched the comment position (authIdx=1418) instead of the call-site position (3524).
- **Fix:** Changed the grep to `src.indexOf('r.use(createAdminAuthMiddleware(')` — matches only the actual call-site expression, not documentation mentions. Same change applied to `createAdminCorsMiddleware` for consistency.
- **Files modified:** src/lib/admin/__tests__/auth-dual-stack.test.ts
- **Verification:** Mount order now correctly asserts cors < /health < auth < api-keys (155 < 163 < 172 < 175).
- **Committed in:** d3cb370 (Task 2 GREEN)

---

**Total deviations:** 4 auto-fixed (2 Rule 3 — blocking test-infra + blocking middleware deadlock, 1 Rule 2 — missing headersSent, 1 Rule 1 — grep false positive)

**Impact on plan:** The middleware-deadlock deviation (#2) is the most substantive — it changed the implementation shape from the plan's sub-middleware composition pattern to a helper-direct pattern. The observable behaviour (401/403 matrix, header precedence, declaration-merging, req.admin population) is identical; only the internal wiring changed. The plan's dual-stack matrix (tests 1-8) all still assert the same invariants and all pass. Deviations #1, #3, #4 are test-infrastructure refinements that don't change production code semantics.

## Issues Encountered

- **Worktree base reset required at agent start** — worktree HEAD was at `751dae1f`; orchestrator expected `8a92e2e`. `git reset --hard 8a92e2e` applied per worktree_branch_check; verified before any work began.
- **Planning directory missing in worktree** — worktree base (8a92e2e) didn't include any `.planning/phases/04-admin-api-webhooks-delta-persistence/` files. Read the PLAN + CONTEXT + PATTERNS + RESEARCH files from the parent repo at `/home/yui/Documents/ms-365-mcp-server/.planning/` instead, and created the `.planning/...` directory in the worktree when writing this SUMMARY. The orchestrator owns merging this directory back to main.
- **`node_modules` not present at agent start** — ran `npm install --no-audit --no-fund --prefer-offline` to populate. Completed in ~7s.
- **Pre-existing 69-test failure baseline** — out-of-scope for this plan. Baseline failures are all due to missing `src/generated/client.ts` (gitignored; produced by `npm run generate`) — documented in 04-03 SUMMARY. My 35 new tests introduce zero new failures: admin test suite is 94/94 green; `npm run build` exits 0.

## Deferred Issues

None — every test in the plan's behaviour matrix passes. The plan's Tests 1-11 (entra verifyEntraAdmin), Tests 10a-e (entra middleware composition), Tests 1-8 (dual-stack matrix), and integration tests 1-4 (req.admin end-to-end) are all implemented and green.

## User Setup Required

None for this plan — /admin/* auth is only active when operators set `MS365_MCP_ADMIN_APP_CLIENT_ID` + `MS365_MCP_ADMIN_GROUP_ID` in their runtime env (the gate established by plan 04-01). No new env vars introduced by this plan. Operators onboarding an admin user must:
1. Assign the user to the Entra security group identified by `MS365_MCP_ADMIN_GROUP_ID`.
2. Acquire an access token for the admin app registration (`aud` = `MS365_MCP_ADMIN_APP_CLIENT_ID`).
3. Present it as `Authorization: Bearer <token>`.

Or, for automation: issue an API key via plan 04-03's `POST /admin/api-keys` and present it as `X-Admin-Api-Key: <plaintext>`.

## Next Phase Readiness

- **Admin auth surface is GREEN** — 35 new tests, 94/94 admin tests pass, build exits 0, mount order locked.
- **Downstream plans have clean seams** — 04-02/04-05/04-06 slot into their TODO anchors in `createAdminRouter` (after the auth mount at line 172) and inherit `req.admin` automatically. 04-03 already consumes the same `AdminContext` shape internally (per api-keys.ts line 120), so its existing handlers work without modification — the real middleware just populates what its stubs assumed.
- **VALIDATION.md task entries 04-04-01, 04-04-02, 04-04-03** — all mapped to concrete tests in this plan's test files. A downstream verifier can confirm by running `npx vitest run src/lib/admin/__tests__/auth-*.test.ts`.
- **No blockers** — Phase 4 Wave 3's sibling plans (04-05 audit, 04-06 audit logging) can execute immediately on this plan's commits. Wave 2 plans (04-02 tenants, 04-03 api-keys) that landed earlier already have stubs for `req.admin`; the real middleware replaces those stubs transparently.

## Self-Check: PASSED

**Files (all existence-verified 2026-04-20T08:48:02Z in worktree):**

- FOUND: src/lib/admin/auth/entra.ts
- FOUND: src/lib/admin/auth/api-key.ts
- FOUND: src/lib/admin/auth/dual-stack.ts
- FOUND: src/lib/admin/\_\_tests\_\_/auth-entra.test.ts
- FOUND: src/lib/admin/\_\_tests\_\_/auth-dual-stack.test.ts
- FOUND: src/lib/admin/\_\_tests\_\_/auth-context.int.test.ts

**Commits (all present on `worktree-agent-aa63b80b` branch):**

- FOUND: aa481d6 (Task 1 RED)
- FOUND: 6c3d5a0 (Task 1 GREEN)
- FOUND: b2711cd (Task 2 RED)
- FOUND: d3cb370 (Task 2 GREEN)

**Automated verifications:**

- `npx vitest run src/lib/admin/__tests__/` — 94/94 PASS (35 new + 59 pre-existing)
- `npm run build` — exits 0
- Plan acceptance-criteria greps (Task 1):
  - `grep "MEMBER_OF_CACHE_MAX = 200"` — matches
  - `grep "MEMBER_OF_CACHE_TTL_MS = 5 \* 60 \* 1000"` — matches
  - `grep "decodeJwt"` — matches
  - `grep "/me/memberOf"` — matches (fetch URL)
  - `grep "export async function verifyEntraAdmin"` — matches
  - `grep "export function createAdminEntraMiddleware"` — matches
  - `grep "LRUCache"` — matches
  - `grep "problemForbidden\|problemUnauthorized"` — matches (both)
- Plan acceptance-criteria greps (Task 2):
  - `grep "export async function verifyApiKeyHeader" src/lib/admin/auth/api-key.ts` — matches
  - `grep "export function createAdminApiKeyMiddleware" src/lib/admin/auth/api-key.ts` — matches
  - `grep "verifyApiKeyPlaintext" src/lib/admin/auth/api-key.ts` — matches (consumes 04-03)
  - `grep "export function createAdminAuthMiddleware" src/lib/admin/auth/dual-stack.ts` — matches
  - `grep "declare module 'express-serve-static-core'" src/lib/admin/auth/dual-stack.ts` — matches
  - `grep "verifyApiKeyHeader\|verifyEntraAdmin" src/lib/admin/auth/dual-stack.ts` — matches (both)
  - `grep "createAdminAuthMiddleware(deps)" src/lib/admin/router.ts` — matches
- Mount-order acceptance (line numbers from grep -n):
  - cors=155 < health=163 < auth=172 < api-keys=175 (all four checks satisfy plan's awk criteria)

## TDD Gate Compliance

- **RED commits** (tests failing before impl):
  - `aa481d6` (Task 1) — `Cannot find module '../auth/entra.js'` for auth-entra.test.ts
  - `b2711cd` (Task 2) — `Cannot find module '../auth/dual-stack.js'` for both new test files
  Both verified by running `npx vitest run` before writing impl; both failed at module-resolve time with canonical RED errors.
- **GREEN commits** (impl makes RED pass):
  - `6c3d5a0` (Task 1) — entra.ts shipped; all 15 tests pass
  - `d3cb370` (Task 2) — api-key.ts + dual-stack.ts shipped; router.ts TODO(04-04) replaced; all 20 new tests pass; 94/94 admin suite green
- **REFACTOR:** not a separate commit for either task. Prettier formatting applied inline during verification before each GREEN commit; no semantic refactoring was needed.

---

_Phase: 04-admin-api-webhooks-delta-persistence_
_Completed: 2026-04-20_
