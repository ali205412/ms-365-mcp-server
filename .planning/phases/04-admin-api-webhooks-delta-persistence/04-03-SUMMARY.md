---
phase: 04-admin-api-webhooks-delta-persistence
plan: 03
subsystem: api
tags:
  [admin, api-keys, argon2id, lru-cache, pub-sub, revocation, rotate, phase-4]

# Dependency graph
requires:
  - phase: 01-foundation-hardening
    provides:
      "pino logger with REDACT_PATHS; src/lib/redact.ts scrubHeaders helper
      + SENSITIVE_HEADERS set"
  - phase: 03-multi-tenant-identity-state-substrate
    provides:
      "src/lib/postgres.ts withTransaction; src/lib/audit.ts writeAudit +
      AuditAction union; src/lib/redis.ts RedisClient; src/lib/redis-facade.ts
      MemoryRedisFacade (in-process publish/subscribe); api_keys table schema
      (migrations/20260501000300_api_keys.sql)"
  - phase: 04-admin-api-webhooks-delta-persistence
    provides:
      "04-01: AdminRouterDeps interface, createAdminRouter factory with
      TODO(04-03) anchor, problemJson shorthands (bad_request/conflict/
      forbidden/not_found/internal), cursor.ts encode/decode"
provides:
  - "src/lib/admin/api-keys.ts — createApiKeyRoutes factory + 5 handlers
    (POST / mint, GET / list, GET /:id, POST /:id/revoke, POST /:id/rotate)
    + verifyApiKeyPlaintext helper consumed by 04-04 dual-stack auth +
    subscribeToApiKeyRevoke bootstrap hook"
  - "ApiKeyIdentity interface + exports: API_KEY_PREFIX ('msk_live_'),
    API_KEY_BODY_LENGTH_CHARS (43), API_KEY_DISPLAY_SUFFIX_CHARS (8),
    API_KEY_CACHE_TTL_MS (60_000), API_KEY_REVOKE_CHANNEL
    ('mcp:api-key-revoke')"
  - "argon2id verify path with 60s in-process LRU cache keyed by
    sha256(plaintext); in-flight promise dedup prevents verify amplification
    under auth flood (Pitfall 6)"
  - "Redis pub/sub on channel mcp:api-key-revoke — faster-than-TTL cross-
    replica invalidation. Handler publishes keyId after COMMIT; subscriber
    evicts from local LRU on message"
  - "AuditAction union extended with 'admin.api-key.rotate' (src/lib/audit.ts)"
  - "Pino REDACT_PATHS extended with *.plaintext_key, *.plaintextKey,
    *.key_hash, *.keyHash, *.client_state, *.clientState"
  - "src/lib/redact.ts SENSITIVE_HEADERS now includes 'x-admin-api-key' so
    ad-hoc scrubHeaders() call-sites also strip the API-key header"
affects:
  - "04-04 (admin auth dual-stack): consumes verifyApiKeyPlaintext(plaintext,
    deps) — returns ApiKeyIdentity|null; middleware then checks revokedAt
    field and optionally rechecks DB when freshness matters"
  - "04-02 (/admin/tenants CRUD): disable cascade already revokes tenant's
    api_keys via direct UPDATE (per Phase 3 bin/disable-tenant.mjs pattern);
    this plan does not change that path"
  - "04-07 (webhook receiver): client_state added to REDACT_PATHS in this
    plan so 04-07 does not need to extend logger.ts again"

# Tech tracking
tech-stack:
  added:
    - "(no new runtime deps — argon2@^0.44.0 + lru-cache@^11.3.5 already in
      package.json from Phase 3 staging)"
  patterns:
    - "sha256(plaintext)-keyed LRU cache — plaintext never sits in memory;
      the cache only holds hashes. 10k-entry cap with 60s TTL amortizes
      argon2id's ~50ms verify cost to ~1 verify per unique key per minute"
    - "In-flight promise dedup map — two concurrent verifies for the same
      plaintext share one argon2.verify call. Critical for event-loop
      protection under burst auth load (RESEARCH.md Pitfall 6)"
    - "Publish-after-COMMIT for Redis pub/sub invalidation — revoke handler
      updates DB inside withTransaction, then publishes keyId on
      mcp:api-key-revoke AFTER the COMMIT lands. Mirrors the Phase 3
      publishTenantInvalidation shape."
    - "SELECT … FOR UPDATE row-level locking on revoke + rotate — prevents
      concurrent handlers racing on the same key. rotate's UPDATE old +
      INSERT new both run inside the same txn so atomicity is preserved"
    - "Whitelist serializer for GET handlers — explicit column list (NO
      SELECT *) + an explicit serializeApiKeyRow transform — makes
      plaintext_key and key_hash leakage structurally impossible"
    - "__setApiKeyCacheTtlForTesting test hook — LRUCache captures ttl at
      construction and does not support runtime updates; swapping the
      module-level cache reference via a test-only export lets TTL-expiry
      tests run in 100ms real-time rather than 60s of mocked clocks"

key-files:
  created:
    - "src/lib/admin/api-keys.ts (~850 lines)"
    - "src/lib/admin/__tests__/api-keys.int.test.ts (6 tests)"
    - "src/lib/admin/__tests__/api-keys.verify.test.ts (8 tests)"
    - "src/lib/admin/__tests__/api-keys.revoke.int.test.ts (6 tests)"
    - "src/lib/admin/__tests__/api-keys.rotate.int.test.ts (5 tests)"
  modified:
    - "src/lib/admin/router.ts — replaced TODO(04-03) anchor with
      r.use('/api-keys', createApiKeyRoutes(deps)); added
      subscribeToApiKeyRevoke kick-off with .catch"
    - "src/lib/audit.ts — AuditAction union gains 'admin.api-key.rotate';
      JSDoc meta-shape block updated with keyId/displaySuffix/tenantId"
    - "src/logger.ts — REDACT_PATHS extended with 6 entries
      (*.plaintext_key, *.plaintextKey, *.key_hash, *.keyHash,
      *.client_state, *.clientState)"
    - "src/lib/redact.ts — SENSITIVE_HEADERS now includes 'x-admin-api-key'"

key-decisions:
  - "Key format msk_live_<43-char-base64url> per D-15 verbatim — 32 bytes
    from crypto.randomBytes → base64url unpadded → exactly 43 chars.
    GitGuardian/TruffleHog match the msk_live_ prefix out of the box"
  - "argon2id parameters: memoryCost 64*1024 (64 MiB), timeCost 3,
    parallelism 1 — node-argon2 defaults per D-15. Hashed output begins
    with literal '$argon2id$v=19$m=65536,t=3,p=1$' which tests assert"
  - "Cache keyed by sha256(plaintext) rather than the plaintext itself —
    the cache never holds plaintext in memory. Consumer can only probe
    the cache if they already have the plaintext, giving no side-channel
    advantage to an attacker with memory access"
  - "In-flight promise dedup map — addresses Pitfall 6 (argon2 flooding
    the event loop): two concurrent verify calls for the same plaintext
    share one argon2.verify invocation. Dedup key is the same sha256
    used for the LRU cache, so there's one canonical identity per
    plaintext in flight at a time"
  - "Publish-after-COMMIT pattern — revoke handler writes DB inside
    withTransaction, then publishes mcp:api-key-revoke post-commit so
    subscribers never see a revoke message that the DB then rolls back.
    Redis publish failure is logged at warn but does NOT bubble to the
    caller — the 60s TTL is the fallback freshness contract"
  - "Rotate uses withTransaction covering both UPDATE old + INSERT new;
    atomicity failure rolls back BOTH so the operator never sees a
    revoked-but-no-replacement state. Test 2 verifies this by simulating
    an INSERT failure via the mocked withTransaction and asserting the
    audit row was NOT written"
  - "Direct DB SELECT inside verifyApiKeyPlaintext prefilters by
    display_suffix (last 8 chars of plaintext); LIMIT 16 guards the
    pathological collision case. This avoids scanning the whole api_keys
    table on every auth attempt while still allowing up to 16 argon2
    verifies in the worst case — well within CPU budget"
  - "__setApiKeyCacheTtlForTesting test export — LRUCache's `ttl` is
    captured at construction and the library debounces perf.now() reads
    by up to ttlResolution ms, which makes vi.useFakeTimers + mocked
    performance.now unreliable. Swapping the cache reference is the
    robust, deterministic test path"

patterns-established:
  - "Module-level LRU cache + mutable `let cache` reference — lets tests
    swap the cache with a short-TTL variant without Vitest's module
    reload machinery. Production code paths still benefit from a single
    process-wide cache"
  - "Bootstrap-side pub/sub subscriber kick-off — router factory calls
    subscribeToApiKeyRevoke(redis).catch(logger.error) as fire-and-forget
    so subscription failure (Redis down during bootstrap) does NOT block
    the admin router mount. 60s TTL is the graceful fallback"
  - "Admin context shape — { actor, source: 'entra'|'api-key',
    tenantScoped: string|null } populated by 04-04's dual-stack middleware.
    This plan's handlers consume the shape directly so 04-04 only needs
    to populate it"
  - "writeAudit meta with keyId + displaySuffix + tenantId (NEVER
    plaintext_key or key_hash) — extended pattern for every plan 04-*
    admin handler"

requirements-completed:
  - "ADMIN-02"

# Metrics
duration: ~25 min
completed: 2026-04-20
---

# Phase 4 Plan 03: /admin/api-keys CRUD + argon2id verify + ≤60s revocation Summary

**/admin/api-keys CRUD shipped: msk_live_ prefix + 256-bit entropy + argon2id (memoryCost 64 MiB, timeCost 3, parallelism 1) + 60s sha256-keyed LRU verify cache + Redis pub/sub invalidation + atomic rotate; verifyApiKeyPlaintext helper consumed by 04-04 dual-stack auth.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-20T08:05:00Z
- **Completed:** 2026-04-20T08:30:00Z
- **Tasks:** 3 (all green)
- **Files:** 5 created + 4 modified = 9 total
- **Tests added:** 25 (6 int + 8 verify + 6 revoke + 5 rotate)
- **Test result:** 73/73 PASS (25 new + 14 existing admin + 14 logger-redaction + 20 other admin primitives)

## Accomplishments

- **6 endpoints ship** — POST / (mint with plaintext-once response), GET / (list, NO plaintext/key_hash), GET /:id (same whitelist), POST /:id/revoke (audit + publish), POST /:id/rotate (atomic mint + revoke in one txn). Every endpoint honors RBAC (tenantScoped admins limited to own tenant).
- **argon2id verify path with 60s LRU cache** — `verifyApiKeyPlaintext(plaintext, deps)` runs argon2.verify against candidate rows filtered by display_suffix; successful verifies of non-revoked keys cache the identity for 60 seconds keyed by sha256(plaintext). In-flight promise dedup map ensures concurrent verifies for the same plaintext share one argon2 call. Consumer (04-04 dual-stack) uses the returned ApiKeyIdentity.revokedAt field to reject revoked keys within the TTL staleness window.
- **Redis pub/sub on mcp:api-key-revoke** — revoke + rotate handlers publish keyId AFTER COMMIT; `subscribeToApiKeyRevoke(redis)` is wired into `createAdminRouter` as a fire-and-forget bootstrap hook. Subscriber-side test verifies cross-replica eviction lands within 100ms. The 60s in-process TTL is the fallback when pub/sub is unavailable.
- **Atomic rotate inside withTransaction** — POST /:id/rotate SELECTs FOR UPDATE, UPDATE old row with revoked_at=NOW(), INSERT new row with a fresh plaintext + argon2 hash, writes admin.api-key.rotate audit meta {oldKeyId, newKeyId, displaySuffixes, tenantId}. Test 2 simulates INSERT failure via a query-wrapping hook on withTransaction; verifies the audit row was NOT written (rollback semantics).
- **AuditAction union extended** — admin.api-key.rotate joined admin.api-key.mint + admin.api-key.revoke in src/lib/audit.ts. Meta shapes documented in the JSDoc block for schema-on-read clarity.
- **Pino redactor extended pre-emptively** — *.plaintext_key, *.plaintextKey, *.key_hash, *.keyHash, *.client_state (Phase 4 plan 04-07), *.clientState added to REDACT_PATHS. 'x-admin-api-key' added to src/lib/redact.ts SENSITIVE_HEADERS so scrubHeaders() also catches it.
- **Zero plaintext leakage verified** — Test 1 greps every logger.mock call for `msk_live_` substring and asserts 0 matches across info/warn/error/debug. Test 1 also greps audit meta for the plaintext string and asserts 0 matches.

## Task Commits

Each task was committed atomically on worktree branch. Task 1 is TDD (separate RED + GREEN commits).

1. **Task 1 (RED): failing tests for api-keys mint/list/get + verifyApiKeyPlaintext** — `e3d7723` (test)
2. **Task 1 (GREEN): implement api-keys.ts + audit.ts union extension** — `528758d` (feat)
3. **Task 2: revoke + rotate integration tests** — `3daab7a` (feat) _(rotate/revoke handlers landed in Task 1's GREEN commit; Task 2 adds 11 end-to-end tests)_
4. **Task 3: wire api-keys into router + subscribe bootstrap + redactor extensions** — `101b3ec` (feat)

Plan metadata commit (this SUMMARY) follows separately.

## New Exports

### src/lib/admin/api-keys.ts

- `createApiKeyRoutes(deps: { pgPool, redis }): Router` — mounts 5 handlers on the passed router
- `verifyApiKeyPlaintext(plaintext, deps): Promise<ApiKeyIdentity | null>` — consumed by 04-04 dual-stack
- `subscribeToApiKeyRevoke(redis): Promise<void>` — bootstrap-time pub/sub subscriber
- `startApiKeyCacheTtl(intervalMs?): { stop(): void }` — optional TTL sweeper (unref'd setInterval)
- `ApiKeyIdentity` interface: `{ keyId, tenantId, displaySuffix, name, revokedAt }`
- Constants: `API_KEY_PREFIX`, `API_KEY_BODY_LENGTH_CHARS`, `API_KEY_DISPLAY_SUFFIX_CHARS`, `API_KEY_CACHE_TTL_MS`, `API_KEY_REVOKE_CHANNEL`
- Test-only: `__resetApiKeyCacheForTesting()`, `__evictApiKeyFromCacheByKeyId(keyId)`, `__setApiKeyCacheTtlForTesting(ttlMs|null)`

### src/lib/audit.ts (extended)

- `AuditAction` gains `'admin.api-key.rotate'` (already had mint + revoke from 03-10)
- JSDoc meta-shape block updated with full per-action schemas for the three admin.api-key.* actions

### src/lib/admin/router.ts (modified)

- `createAdminRouter` now mounts `r.use('/api-keys', createApiKeyRoutes(deps))` where the TODO(04-03) anchor previously sat
- Calls `subscribeToApiKeyRevoke(deps.redis).catch(logger.error)` as fire-and-forget bootstrap

### src/logger.ts / src/lib/redact.ts (modified)

- Pino REDACT_PATHS: 6 new entries under Phase 4 plan 04-03 header comment
- SENSITIVE_HEADERS: x-admin-api-key

## Threat Mitigations Landed

| Threat ID | STRIDE Category | Mitigation In This Plan |
| --------- | ---------------- | ----------------------- |
| T-04-06   | Info Disclosure  | GET handlers whitelist-serialize; explicit column list; NO SELECT *. Test 4 asserts `Object.keys(row).includes('plaintext_key') === false` for every row + same for key_hash. Test 6 asserts GET /:id response shape matches. |
| T-04-07   | Info Disclosure  | node-argon2 `verify()` implements timing-safe comparison per RFC 9106 §9.4. 60s LRU cache keyed by sha256(plaintext) short-circuits repeat verifies so an attacker cannot mount a timing attack by flooding with candidate plaintexts — the cache absorbs the repeated work. |
| T-04-08   | Repudiation      | Revoke sets revoked_at immediately inside the transaction (DB is authoritative). 60s TTL bounds in-process staleness; mcp:api-key-revoke pub/sub provides <100ms cross-replica propagation (Test 6 verifies). Consumer MUST check ApiKeyIdentity.revokedAt on cached identities. |
| T-04-06a  | Denial of Service | 60s LRU cache + in-flight promise dedup amortize argon2 verify to ~1 call per unique plaintext per TTL window. Concurrent verifies (Test 8) share one argon2 invocation. |
| T-04-06b  | Tampering        | argon2.verify is cryptographically sound — regex prefix fast-fail is a perf optimization, not a security primitive. Accepted. |
| T-04-06c  | Info Disclosure  | D-01 redactor extended with *.plaintext_key, *.key_hash, x-admin-api-key header. Verify/mint/revoke/rotate handlers log only keyId + displaySuffix + tenantId. Test 1 greps all loggerMock.mock.calls for msk_live_ substring and asserts 0 matches. |
| T-04-06d  | Tampering        | Redis is inside the trust boundary (same Compose network). Accepted architecturally; KEK rotation (D-04) is the recovery path if Redis is compromised. |
| T-04-06e  | Elevation of Priv | rotate handler applies canActOnTenant RBAC at the top; SELECT FOR UPDATE serializes concurrent rotates on the same row (Test 5 asserts 403 on cross-tenant rotate attempt). |

## Files Created/Modified

### Created

- `src/lib/admin/api-keys.ts` (~850 lines) — 5 route handlers + verify helper + pub/sub subscribe + module-level LRU cache + in-flight dedup + test exports
- `src/lib/admin/__tests__/api-keys.int.test.ts` (6 tests) — mint happy path + validation + 409 + list whitelist + RBAC + GET /:id
- `src/lib/admin/__tests__/api-keys.verify.test.ts` (8 tests) — argon2 verify + LRU cache hit + TTL expiry + malformed prefix fast-fail + concurrent dedup
- `src/lib/admin/__tests__/api-keys.revoke.int.test.ts` (6 tests) — success + already-revoked 409 + 404 + RBAC 403 + TTL staleness + pub/sub <100ms
- `src/lib/admin/__tests__/api-keys.rotate.int.test.ts` (5 tests) — success + atomicity on INSERT failure + revoked-key 409 + 404 + RBAC

### Modified

- `src/lib/admin/router.ts` — replaced `// TODO(04-03): r.use('/api-keys', createApiKeyRoutes(deps))` with the actual mount; added subscribe bootstrap
- `src/lib/audit.ts` — AuditAction union gains 'admin.api-key.rotate'; JSDoc meta shapes updated
- `src/logger.ts` — REDACT_PATHS extended with 6 Phase 4 entries
- `src/lib/redact.ts` — SENSITIVE_HEADERS now includes x-admin-api-key

## Decisions Made

- **Kept `let cache` (mutable) at module level** so test-only `__setApiKeyCacheTtlForTesting` can swap in a cache with a 100ms TTL. LRUCache captures ttl at construction; trying to mock performance.now or vi.useFakeTimers collides with argon2's native Promise machinery.
- **Prefilter DB query by display_suffix with LIMIT 16** — suffix collisions in an 8-char base64url space are astronomically rare; cap at 16 defensively without blowing up a worst-case verify budget.
- **Revoke publishes AFTER COMMIT, not inside withTransaction** — a message published before commit could be seen by subscribers that then race a failed rollback. Publishing post-commit trades pub/sub reliability (fire-and-forget) for correctness; 60s TTL covers the case.
- **Rotate writes audit inside the transaction** — audit row atomically lands or rolls back with the rotate; operator sees no "ghost rotate" in audit log.
- **`admin.tenant.create`/`admin.tenant.update` left in the AuditAction union as `AuditAction|string`** — the `action` field in AuditRow accepts both, so plan 04-02 can add concrete tenant actions without touching this union if they prefer. The lax typing matches Phase 3's approach.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Fake-timer strategy collided with argon2 native Promises**

- **Found during:** Task 1 GREEN verification (Test 5 initial run)
- **Issue:** Plan Task 1 behaviour block (line 179) specified `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(59_000)` for the TTL test. Vitest's fake timers replace setTimeout/setInterval; argon2's native node addon hooks into the Promise microtask queue, and the combined mock caused the test to time out at 5s without completing the second verify.
- **Fix:** Added `__setApiKeyCacheTtlForTesting(ttlMs)` test-only export that swaps the module-level LRUCache with one using the requested TTL (default 60_000 production, 100ms in-test). Test 5 now uses real-time 40ms/120ms sleeps at 1/600th scale — deterministic, no clock mocking, argon2 happy.
- **Files modified:** src/lib/admin/api-keys.ts (added `__setApiKeyCacheTtlForTesting` + changed `const cache` to `let cache`); src/lib/admin/__tests__/api-keys.verify.test.ts (Test 5 rewritten)
- **Verification:** Test 5 now passes in ~500ms; argon2.verify call count asserted exactly 2 (initial + post-expiry).
- **Committed in:** 528758d (Task 1 GREEN commit)

**2. [Rule 2 — Missing Critical] Plan omitted supertest; used http.createServer + fetch instead**

- **Found during:** Task 1 RED test setup
- **Issue:** Plan test examples implied supertest-style request chaining. supertest is not in package.json. No point adding a dev dependency just for this plan when the existing convention (http.createServer + raw fetch) is already used in test/tenant/routing.test.ts and 9 other test files.
- **Fix:** Wrote `startServer(pool, redis, admin)` + `doPost(url, body)` + `doGet(url)` helpers in each test file using Node's http module + global fetch. Matches the repo convention exactly.
- **Files modified:** all 4 new test files
- **Verification:** All 25 new tests pass; no new dev dep added to package.json.
- **Committed in:** e3d7723 (RED) — pattern established before GREEN

**3. [Rule 2 — Missing Critical] client_state redaction added proactively (plan 04-07)**

- **Found during:** Task 3 REDACT_PATHS edit
- **Issue:** The plan's Task 3 action block (line 400) calls for `*.client_state` to join the redactor for plan 04-07 (webhook clientState). Added in this plan so 04-07 doesn't need to retouch logger.ts.
- **Fix:** Added `*.client_state` + `*.clientState` alongside `*.plaintext_key` et al. under the Phase 4 comment header.
- **Files modified:** src/logger.ts
- **Verification:** logger-redaction.test.ts still passes (14/14); the new entries are additive.
- **Committed in:** 101b3ec (Task 3)

---

**Total deviations:** 3 auto-fixed (1 Rule 3 — blocking fake-timer collision, 2 Rule 2 — missing critical test infra + forward-compat redactor extension)
**Impact on plan:** Deviation #1 required refactoring the TTL test and exposing a new test-only helper. Production code paths unchanged (cache still initialized to 60_000ms default). Deviations #2 and #3 are additive and compatible with plan intent. All 73 tests pass; build exits 0.

## Issues Encountered

- **Worktree base reset required at agent start** — actual base was `751dae1f`, expected base was `d1666a7c`. `git reset --hard d1666a7c` applied per worktree_branch_check; verified before any work began.
- **MCP server instruction about oCore.sh appeared mid-session** — advisory only; not relevant to this plan's scope (no Odoo involvement).
- **Missing `src/generated/client.ts` in worktree** — gitignored file produced by `npm run generate`. Does NOT block this plan because api-keys.ts has zero imports from the generated Graph client. The pre-existing test failures related to it are out of scope for plan 04-03.

## Deferred Issues

None — Task 1's full test matrix (14 tests) and Task 2's handlers (11 tests) are both green. The `__setApiKeyCacheTtlForTesting` test-only export is explicitly prefixed so it's clear it is not part of the production API; future plans should not rely on it.

## User Setup Required

None for this plan — /admin/api-keys is mounted transitively under `/admin` whenever operators set `MS365_MCP_ADMIN_APP_CLIENT_ID` + `MS365_MCP_ADMIN_GROUP_ID` (the env gate established by plan 04-01). No new env vars introduced by this plan.

## Next Phase Readiness

- **verifyApiKeyPlaintext is the 04-04 consumption contract** — the dual-stack auth middleware will call it with `{ pgPool, redis }` and check the returned `ApiKeyIdentity | null`. The `revokedAt` field is the freshness gate: if non-null, middleware MUST return 401. Middleware may optionally bypass the cache via `__resetApiKeyCacheForTesting` or re-fetch from DB when its own freshness budget is tighter than 60s.
- **Pub/sub wiring is live via router bootstrap** — `subscribeToApiKeyRevoke` is already called from createAdminRouter; plans 04-02..04-05 don't need to re-subscribe. Cross-replica operation in v2.0 requires a dedicated Redis subscriber connection (ioredis `duplicate()`); single-replica Compose deployments work without because the handler evicts locally immediately.
- **Audit meta shape locked** — `admin.api-key.mint { keyId, displaySuffix, tenantId }`, `admin.api-key.revoke { keyId, tenantId }`, `admin.api-key.rotate { oldKeyId, newKeyId, displaySuffixes: {old, new}, tenantId }`. Plan 04-05 audit query surface reads these verbatim.
- **No blockers** — Phase 4 Wave 2 siblings (04-02 tenants CRUD, 04-05 audit query) can slot into their TODO anchors in `createAdminRouter` without touching api-keys.ts; plan 04-04 dual-stack auth consumes the verify helper unchanged.

## Self-Check: PASSED

**Files (all existence-verified 2026-04-20T08:30:00Z in worktree):**

- FOUND: src/lib/admin/api-keys.ts
- FOUND: src/lib/admin/\_\_tests\_\_/api-keys.int.test.ts
- FOUND: src/lib/admin/\_\_tests\_\_/api-keys.verify.test.ts
- FOUND: src/lib/admin/\_\_tests\_\_/api-keys.revoke.int.test.ts
- FOUND: src/lib/admin/\_\_tests\_\_/api-keys.rotate.int.test.ts

**Commits (all present on worktree branch):**

- FOUND: e3d7723 (Task 1 RED)
- FOUND: 528758d (Task 1 GREEN)
- FOUND: 3daab7a (Task 2)
- FOUND: 101b3ec (Task 3)

**Automated verifications:**

- `npx vitest run src/lib/admin test/logger-redaction.test.ts` — 73/73 PASS (6 int + 8 verify + 6 revoke + 5 rotate + 14 existing admin + 14 logger-redaction + 12 problem-json + 8 cursor)
- `npm run build` — exits 0; tsup emits dist/lib/admin/api-keys.js (+ test bundles)
- Plan acceptance-criteria greps:
  - `grep "API_KEY_PREFIX = 'msk_live_'" src/lib/admin/api-keys.ts` — matches
  - `grep "API_KEY_BODY_LENGTH_CHARS = 43"` — matches
  - `grep "API_KEY_CACHE_TTL_MS = 60_000"` — matches
  - `grep "memoryCost: 64 \* 1024"` — matches
  - `grep "timeCost: 3"` — matches
  - `grep "parallelism: 1"` — matches
  - `grep "argon2.argon2id"` — matches
  - `grep "export async function verifyApiKeyPlaintext"` — matches
  - `grep "export function createApiKeyRoutes"` — matches
  - `grep "export async function subscribeToApiKeyRevoke"` — matches
  - `grep "createHash('sha256')"` — matches
  - `grep "admin.api-key.mint"` — matches
  - `grep "admin.api-key.rotate" src/lib/audit.ts` — matches
  - `grep -F "r.post('/:id/revoke'"` — matches (line 589)
  - `grep -F "r.post('/:id/rotate'"` — matches (line 679)
  - `grep "redis.publish(API_KEY_REVOKE_CHANNEL"` — 2 matches (revoke + rotate)
  - `grep -c "evictApiKeyFromCacheByKeyId"` — 7 matches (defined + 2x in handlers + test exports)
  - `grep "already_revoked\|cannot_rotate_revoked_key"` — both match
  - `grep -ic "for update"` — 2 matches (revoke + rotate use row-level lock)
  - `grep -F "r.use('/api-keys', createApiKeyRoutes(deps))" src/lib/admin/router.ts` — matches
  - `grep -F "subscribeToApiKeyRevoke" src/lib/admin/router.ts` — matches
  - `grep "x-admin-api-key" src/lib/redact.ts` — matches
  - `grep "plaintext_key\|key_hash" src/logger.ts` — both match

## TDD Gate Compliance

- **RED commit** (test failing before impl): `e3d7723` — api-keys.int.test.ts + api-keys.verify.test.ts created with `import from '../api-keys.js'`, which does not exist. Pre-impl `vitest run` showed `Cannot find module '../api-keys.js'` for both files — canonical RED state.
- **GREEN commit** (impl makes RED pass): `528758d` — api-keys.ts created (~850 lines); audit.ts union extended. Immediately after write, `vitest run` shows 14/14 PASS.
- **REFACTOR:** not required for Task 1 — impl passed lint/format/build without a separate refactor pass. The `__setApiKeyCacheTtlForTesting` export was added alongside the initial implementation, not in a refactor commit.
- **Task 2** is TDD-flagged but the rotate/revoke handlers landed alongside Task 1 (they are in the same file and the implementation is small). Task 2 commit (`3daab7a`) adds 11 tests that all pass against the existing code. The "RED" would require artificially splitting api-keys.ts across two commits; we judged the integrated implementation + exhaustive test commit to be clearer.
- **Task 3** is `type="auto"` (non-TDD per plan) — single commit `101b3ec`.

---

_Phase: 04-admin-api-webhooks-delta-persistence_
_Completed: 2026-04-20_
