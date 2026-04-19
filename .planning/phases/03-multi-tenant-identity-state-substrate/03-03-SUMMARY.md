---
phase: 03-multi-tenant-identity-state-substrate
plan: 03
subsystem: pkce
tags: [pkce, oauth, redis, concurrency, o1-lookup, getdel, secur-03, tenant-05]

# Dependency graph
requires:
  - phase: 03-multi-tenant-identity-state-substrate/02
    provides: "src/lib/redis.ts getRedis() union-typed RedisClient; MemoryRedisFacade with set(EX,NX)+getdel API subset; region:phase3-pkce-store anchor scaffolded as empty markers"
provides:
  - "src/lib/pkce-store/pkce-store.ts — PkceEntry type + PkceStore interface (put + takeByChallenge)"
  - "src/lib/pkce-store/redis-store.ts — RedisPkceStore (SET NX EX 600 + GETDEL, O(1) lookup)"
  - "src/lib/pkce-store/memory-store.ts — MemoryPkceStore (stdio fallback; Date.now() TTL; no background timers)"
  - "src/server.ts — v1 in-memory pkceStore Map + opportunistic cleanup timer + capacity gate fully removed; /authorize calls pkceStore.put(tenantId, entry), /token computes sha256(client_verifier) + calls pkceStore.takeByChallenge(tenantId, challenge)"
  - "src/server.ts — PHASE3_TENANT_PLACEHOLDER='_' sentinel in both handlers; 03-08 replaces with req.params.tenantId"
  - "src/server.ts — MicrosoftGraphServer constructor now accepts 4th arg deps={ pkceStore? } defaulting to new MemoryPkceStore(); preserves backwards compat for non-HTTP/test callers"
  - "src/index.ts region:phase3-pkce-store filled — RedisPkceStore (HTTP) vs MemoryPkceStore (stdio) factory + constructor callsite wiring"
  - "test/pkce-store/redis-store.test.ts — 6 tests (put/take, NX duplicate, atomic GETDEL concurrent, cross-tenant isolation, TTL expiry)"
  - "test/pkce-store/memory-store.test.ts — 4 tests (put/take, NX, TTL via Date.now, cross-tenant isolation)"
  - "test/pkce-store/cross-replica.test.ts — ROADMAP SC#6 signal (two RedisPkceStore instances sharing one MemoryRedisFacade)"
  - "test/pkce-store/perf.test.ts — SECUR-03 p99 latency benchmark at 1000-entry store"
affects:
  - "03-06 (OAuth all-four-flows): /authorize and /token PKCE paths now go through pkceStore.put / pkceStore.takeByChallenge. 03-06 uses PHASE3_TENANT_PLACEHOLDER='_' sentinel verbatim until 03-08 swaps it."
  - "03-08 (URL-path tenant routing): ONE-LINE swap — replace `PHASE3_TENANT_PLACEHOLDER` in src/server.ts with `req.params.tenantId` at both call sites (PKCE put in /authorize, takeByChallenge in /token). Grep for the constant to find them; tenantId segment of Redis key `mcp:pkce:{tenantId}:{clientCodeChallenge}` already in place."
  - "03-05 (TenantPool): untouched by this plan — region:phase3-tenant-pool count=2, region:phase3-shutdown-tenant-pool count=2."
  - "Operator runbook: Redis `maxmemory` + `maxmemory-policy volatile-lru` recommended for PKCE + MSAL cache co-residency per T-03-03-03 DoS mitigation."

# Tech tracking
tech-stack:
  added:
    - "(runtime) No new deps — ioredis 5.10.1 GETDEL support already in place from 03-02"
    - "(shape) New src/lib/pkce-store/ module directory housing the three-file (type / redis / memory) split"
  patterns:
    - "Interface + two-implementation split (PkceStore interface with RedisPkceStore and MemoryPkceStore) mirrors the Redis substrate pattern established in 03-02 (ioredis vs MemoryRedisFacade)."
    - "Deps bag as 4th constructor arg — preserves existing 3-arg signature while adding a growable injection surface for Phase 3+ substrates (tenantPool in 03-05, secretsProvider in Phase 4)."
    - "Module-level constant PHASE3_TENANT_PLACEHOLDER='_' as a grep anchor — cross-plan handoff pattern: 03-08 swaps by searching for the literal, no hidden call-site surgery required."
    - "JSDoc prose that references forbidden greppable strings (pkceStore: Map, setInterval/setTimeout) is rewritten to avoid accidental acceptance-criteria regressions (per 03-02 precedent in its summary)."

key-files:
  created:
    - "src/lib/pkce-store/pkce-store.ts (53 lines — PkceEntry + PkceStore interface)"
    - "src/lib/pkce-store/redis-store.ts (63 lines — RedisPkceStore implementation)"
    - "src/lib/pkce-store/memory-store.ts (52 lines — MemoryPkceStore implementation)"
    - "test/pkce-store/redis-store.test.ts (137 lines, 6 tests)"
    - "test/pkce-store/memory-store.test.ts (103 lines, 4 tests)"
    - "test/pkce-store/cross-replica.test.ts (52 lines, 1 test)"
    - "test/pkce-store/perf.test.ts (59 lines, 1 test)"
  modified:
    - "src/server.ts — removed PkceStoreEntry + PkceStore type alias + v1 Map field + O(N) /token scan + /authorize cleanup+capacity block; added PHASE3_TENANT_PLACEHOLDER constant, pkceStore field, deps bag constructor arg, /authorize pkceStore.put call with collision handler, /token pkceStore.takeByChallenge call"
    - "src/index.ts — region:phase3-pkce-store filled (factory inside anchor); 3 top-level imports at module scope (RedisPkceStore / MemoryPkceStore / PkceStore type); MicrosoftGraphServer constructor callsite gains 4th arg { pkceStore }"
    - "test/token-endpoint.test.ts — Map() → new MemoryPkceStore() in createTokenHandler test setup; 3 existing SECUR-05 tests still green"

key-decisions:
  - "PKCE keying: `clientCodeChallenge` (not `state`) is the Redis key segment because /token receives a `code_verifier` (not `state`); hashing it with SHA-256 yields the same challenge recorded at /authorize, making the lookup O(1) by construction. State is retained inside the value for audit correlation but is NOT part of the lookup path."
  - "GETDEL over MULTI GET+DEL: ioredis 5.10 + Redis 6.2+ both support GETDEL natively; we assume the baseline (confirmed in 03-02 PATCH list) and do NOT provide a MULTI fallback — keeps the implementation to 6 lines and eliminates one class of race (MULTI EXEC is atomic but not strictly contended against a competing GETDEL)."
  - "NX on put (rather than plain SET): a colliding clientCodeChallenge across two concurrent /authorize calls MUST surface as a 400 pkce_challenge_collision rather than silently overwriting — silent overwrite would let an attacker hijack the legitimate client's staging state. NX prevents this at the Redis level; the handler emits a warn + 400 on collision so the caller can regenerate and retry."
  - "MemoryPkceStore separate from MemoryRedisFacade: even though MemoryRedisFacade already implements set(EX,NX)+getdel, keeping MemoryPkceStore as a standalone Map-backed class gives the handlers a tighter typed interface (put + takeByChallenge, not generic get/set) — defense-in-depth against accidental misuse (e.g., a future handler poking into raw keys and bypassing the tenant-isolation contract)."
  - "Deps bag vs positional arg: introduced `deps: { pkceStore?: PkceStore } = {}` as the 4th positional, defaulting to `new MemoryPkceStore()`. Keeps the existing 3-arg test callers (there are none in this codebase, but no forced breakage) and leaves room for 03-05 tenantPool, Phase 4 admin API deps, etc., to land in the same bag without further constructor surgery."
  - "Module-level PHASE3_TENANT_PLACEHOLDER constant (rather than inline literals): makes the 03-08 swap a literal grep-and-replace on a load-bearing identifier. The constant's JSDoc documents the cross-plan handoff so a reviewer stumbling on it during 03-06 review can immediately see the scaffold nature."
  - "4-commit plan cadence (RED/GREEN for each task) matches the 03-02 TDD pattern — the RED commit contains the failing tests (module-not-found); the GREEN commit adds the minimal implementation that turns them green. Perf + cross-replica tests were added after the core substrate existed because their RED shape is a subjective assertion (latency bound), not a module-missing error."

patterns-established:
  - "Disjoint anchor-edit safety scales to 4 wave-parallel plans (03-01/02/03/04) — this plan filled phase3-pkce-store without touching phase3-tenant-pool (03-05), and left the other plans' regions intact at count=2 each."
  - "The PkceStore shape becomes the template for subsequent Phase 3 substrates: one interface module, one Redis impl, one Memory impl, one test-per-impl plus one cross-replica proof + one perf bound. 03-05 MSAL cache plugin will mirror this with TokenCacheStore (Redis) + Map (stdio) + LRU-eviction proof + cryptoshred proof."

requirements-completed: [SECUR-03, TENANT-05]

# Metrics
duration: ~11min
completed: 2026-04-19
---

# Phase 3 Plan 03: PKCE Store Redis Externalization Summary

**PKCE state moved from an in-memory `Map<string, PkceStoreEntry>` + O(N) scan + per-entry SHA-256 at /token (v1) to a Redis-backed `PkceStore` interface keyed by `clientCodeChallenge` with atomic GETDEL — closing SECUR-03 (O(1) lookup) and enabling ROADMAP SC#6 (a second replica picks up PKCE state from Redis).**

## Before / After

| Aspect | v1 (removed) | v2 (this plan) |
|--------|-------------|----------------|
| Storage | `private pkceStore: Map<string, PkceStoreEntry>` on `MicrosoftGraphServer` | `pkceStore: PkceStore` interface injected via deps bag |
| /authorize write | `this.pkceStore.set(state, {...})` after manual cleanup loop + capacity gate | `await pkceStore.put(tenantId, entry)` — NX prevents overwrite, Redis EX=600s auto-evicts |
| /token lookup | `for (const [state, pkceData] of pkceStore) if (pkceData.clientCodeChallenge === sha256(verifier)) ...` — **O(N)** | `await pkceStore.takeByChallenge(tenantId, sha256(verifier))` — **O(1)** via Redis GETDEL |
| Replay protection | Map.delete inside the scan loop (non-atomic under concurrent /token) | Redis GETDEL is atomic — exactly one concurrent caller gets the entry |
| Eviction | `setInterval`-free opportunistic cleanup on every /authorize (O(N) per call) + 1000-entry capacity gate | Redis TTL handles expiry; no background timer; no capacity gate required (operator caps via `maxmemory`) |
| Cross-replica | Process-local Map — a second replica sees no state | Redis is the shared source of truth (ROADMAP SC#6) |
| Per-tenant isolation | Keyed only by OAuth `state` | Keyed by `(tenantId, clientCodeChallenge)` — T-03-03-02 closed |
| Stdio mode | Same Map (worked fine, but tangled with HTTP code path) | MemoryPkceStore — same interface, Map backing, Date.now() TTL, no timers |

## Redis Key Format

```
mcp:pkce:{tenantId}:{clientCodeChallenge}
         ↑            ↑
         │            └── raw client-supplied base64url challenge (43–128 chars)
         └── '_' in Phase 3 (PHASE3_TENANT_PLACEHOLDER), req.params.tenantId from 03-08 onward
```

- **TTL:** 600s (10 min) — OAuth 2.1 draft recommendation (D-13).
- **NX on write:** duplicate challenge = 400 `pkce_challenge_collision`, NOT silent overwrite.
- **GETDEL on read:** atomic read-and-delete — prevents replay (T-03-03-01).

## PHASE3_TENANT_PLACEHOLDER='_' Scaffold

The handlers pass `PHASE3_TENANT_PLACEHOLDER` (= `'_'`) as the `tenantId` argument to `pkceStore.put` and `pkceStore.takeByChallenge`. This is a **Phase 3 scaffold** — 03-08 adds URL-path tenant routing (`/t/:tenantId/*`) and a `loadTenant` middleware that attaches `req.params.tenantId`. The swap is two literal edits in `src/server.ts`:

```typescript
// Before (Phase 3, this plan):
const ok = await this.pkceStore.put(PHASE3_TENANT_PLACEHOLDER, { /* ... */ });
const pkceEntry = await pkceStore.takeByChallenge(PHASE3_TENANT_PLACEHOLDER, clientChallengeComputed);

// After (Phase 3 Plan 08, 03-08):
const ok = await this.pkceStore.put(req.params.tenantId, { /* ... */ });
const pkceEntry = await pkceStore.takeByChallenge(req.params.tenantId, clientChallengeComputed);
```

The Redis key format (`mcp:pkce:{tenantId}:{clientCodeChallenge}`) already accommodates the real tenantId — nothing in the store implementation needs to change. `grep -n PHASE3_TENANT_PLACEHOLDER src/server.ts` surfaces all call sites for the 03-08 executor.

## Anchor Discipline Audit

| File | Anchor region | Expected count | Actual | Status |
|------|---------------|----------------|--------|--------|
| `src/index.ts` | `region:phase3-postgres` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-redis` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-kek` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-pkce-store` | 2 | 2 | **filled by 03-03** |
| `src/index.ts` | `region:phase3-tenant-pool` | 2 | 2 | untouched — 03-05's territory |
| `src/index.ts` | `region:phase3-shutdown-tenant-pool` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-shutdown-redis` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-shutdown-postgres` | 2 | 2 | untouched |

File modifications outside anchor regions:

1. **`src/index.ts` lines 20–22** — three new top-level imports (`RedisPkceStore`, `MemoryPkceStore`, `type PkceStore`) alongside 03-01's `import * as postgres` (line 18) and 03-02's `import * as redisClient` (line 19). ESM imports MUST be at module scope; the 03-02 precedent sanctions this pattern.
2. **`src/index.ts` line 380** — the single-line `MicrosoftGraphServer` constructor invocation gains a 4th arg `{ pkceStore }`. This is the one permitted edit outside the Phase 3 regions per the plan text ("edit the existing constructor invocation minimally").
3. **`src/server.ts`** — larger diff (v1 removal + new wiring), but scoped to existing PKCE code paths; no new top-level regions introduced.
4. **`test/token-endpoint.test.ts`** — one-line swap from `new Map()` to `new MemoryPkceStore()` so existing SECUR-05 tests keep compiling under the new `PkceStore` interface signature on `TokenHandlerConfig`.

## Threat Register Outcomes

| Threat ID | Category | Disposition | Status |
|-----------|----------|-------------|--------|
| T-03-03-01 | T (Tampering — replay) | mitigate | CLOSED — GETDEL atomicity proven by redis-store.test.ts "two concurrent takeByChallenge → one entry, one null" |
| T-03-03-02 | S (Spoofing — cross-tenant reuse) | mitigate | CLOSED — Redis key includes `{tenantId}` segment; redis-store.test.ts and memory-store.test.ts both assert wrong-tenant returns null |
| T-03-03-03 | D (DoS — PKCE flood) | mitigate | CLOSED at substrate level — TTL 600s auto-evicts; operator caps via Redis `maxmemory`. Rate-limiting on /authorize lands in Phase 6. |
| T-03-03-04 | I (Info Disclosure) | accept | ACCEPTED — PkceEntry contains `serverCodeVerifier` (sensitive; what we send to Microsoft) + `clientCodeChallenge` (non-secret). REDACT_PATHS in 03-01 already covers these paths in logs. |
| T-03-03-05 | T (Redis key injection) | mitigate | DEFERRED to 03-08 — validates tenantId as GUID. clientCodeChallenge charset validation is NOT enforced by this plan; the OAuth spec requires base64url, but handlers do not currently reject colons/wildcards. Added to 03-08 scope in the forward-handoff section below. |

## Task Commits

1. **Task 1 RED** — `95f8979` — `test(03-03): add failing tests for RedisPkceStore and MemoryPkceStore`
2. **Task 1 GREEN** — `27dc310` — `feat(03-03): PkceStore interface + RedisPkceStore + MemoryPkceStore (SECUR-03)`
3. **Task 2 RED** — `e914f60` — `test(03-03): add cross-replica + perf tests for RedisPkceStore`
4. **Task 2 GREEN** — `7651f10` — `feat(03-03): wire PkceStore via DI — remove v1 Map scan + cleanup timer (SECUR-03)`

Plan metadata commit (this SUMMARY) follows separately.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Acceptance regression] JSDoc prose tripped the `pkceStore: Map` grep**
- **Found during:** Task 2 acceptance verification
- **Issue:** An explanatory comment near the /token PKCE block read "Replaces the v1 O(N) scan over `pkceStore: Map` + per-entry SHA-256 comparison." The plan acceptance criterion `grep -c "pkceStore: Map" src/server.ts returns 0` then matched the JSDoc prose, reporting 1 instead of 0.
- **Fix:** Rewrote the prose to "Replaces the v1 O(N) scan over the old in-memory store + per-entry SHA-256 comparison" (same semantic meaning, no greppable literal). Also trimmed another JSDoc line referencing `Map<string, PkceStoreEntry>` to "The v1 in-memory lookup map".
- **Files modified:** src/server.ts (comment only — no behavior change)
- **Verification:** `grep -c "pkceStore: Map" src/server.ts` now returns 0; `grep PkceStoreEntry src/server.ts` now returns 0.
- **Committed in:** 7651f10 (landed together with the Task 2 GREEN implementation)

**2. [Rule 1 — Acceptance regression] JSDoc prose tripped the `setInterval|setTimeout` grep in memory-store.ts**
- **Found during:** Task 1 acceptance verification (immediately after initial Write)
- **Issue:** The module-level JSDoc originally read "TTL via Date.now() comparison on read — no setInterval / setTimeout." The plan acceptance criterion `grep -c "setInterval\|setTimeout" src/lib/pkce-store/memory-store.ts returns 0` then matched the prose, reporting 1 instead of 0.
- **Fix:** Rewrote the JSDoc to "background timers are deliberately avoided" (wording mirrors the identical 03-02 redis-facade fix in that plan's summary). Behavior unchanged.
- **Files modified:** src/lib/pkce-store/memory-store.ts (JSDoc only)
- **Verification:** `grep -cE "setInterval|setTimeout" src/lib/pkce-store/memory-store.ts` now returns 0.
- **Committed in:** 27dc310 (landed together with the Task 1 GREEN implementation)

**3. [Rule 3 — Blocking] node_modules + src/generated/client.ts missing in worktree**
- **Found during:** Pre-Task 1 setup
- **Issue:** Fresh worktree checkout had no `node_modules/` and no `src/generated/client.ts` (both .gitignored). Vitest could not resolve `ioredis-mock`, and any build/test path transitively touching the graph client would fail to compile.
- **Fix:** Ran `npm install --no-audit --no-fund` once (restoring deps from the committed `package-lock.json`). Copied `src/generated/client.ts` from the main repo (identical to what `npm run generate` would emit from the current OpenAPI spec).
- **Files modified:** node_modules/ + src/generated/client.ts (both gitignored — not committed)
- **Verification:** `npm run test -- --run test/lib/redis-facade` sanity check passed 8/8 before starting plan work.
- **Committed in:** none (gitignored environment restoration, not code)

**4. [Rule 2 — Critical functionality] token-endpoint.test.ts broke under the new TokenHandlerConfig signature**
- **Found during:** Task 2 implementation
- **Issue:** The existing `test/token-endpoint.test.ts` (from plan 01-07) passed `pkceStore: new Map()` to `createTokenHandler`. Once the Task 2 refactor changed `TokenHandlerConfig.pkceStore` from `PkceStore = Map<...>` to the new `PkceStore` interface, the test no longer compiled (Map lacks `put` / `takeByChallenge`).
- **Fix:** Changed the one line in `test/token-endpoint.test.ts` from `pkceStore: new Map()` to `pkceStore: new MemoryPkceStore()`. All 3 SECUR-05 log-redaction tests still green — the handler behavior under empty-store test cases is identical.
- **Files modified:** test/token-endpoint.test.ts (1 line + 1 import)
- **Verification:** `npm run test -- --run test/token-endpoint` exits 0 with 3/3 tests green.
- **Committed in:** 7651f10 (landed together with the Task 2 GREEN implementation)

**Total deviations:** 4 (2 JSDoc-vs-grep tightening, 1 env restoration, 1 downstream test refactor). No scope creep, no behavior changes beyond what the plan specified.

## Self-Check: PASSED

**Files (all existence-verified in worktree):**
- FOUND: src/lib/pkce-store/pkce-store.ts
- FOUND: src/lib/pkce-store/redis-store.ts
- FOUND: src/lib/pkce-store/memory-store.ts
- FOUND: test/pkce-store/redis-store.test.ts
- FOUND: test/pkce-store/memory-store.test.ts
- FOUND: test/pkce-store/cross-replica.test.ts
- FOUND: test/pkce-store/perf.test.ts
- FOUND (modified): src/server.ts
- FOUND (modified): src/index.ts
- FOUND (modified): test/token-endpoint.test.ts

**Commits (all on worktree branch at HEAD):**
- FOUND: 95f8979 (Task 1 RED)
- FOUND: 27dc310 (Task 1 GREEN)
- FOUND: e914f60 (Task 2 RED)
- FOUND: 7651f10 (Task 2 GREEN)

**Automated verifications:**
- `npm run test -- --run test/pkce-store/redis-store` — 6/6 PASS
- `npm run test -- --run test/pkce-store/memory-store` — 4/4 PASS
- `npm run test -- --run test/pkce-store/cross-replica` — 1/1 PASS
- `npm run test -- --run test/pkce-store/perf` — 1/1 PASS (p99 well under 50ms bound)
- `npm run test -- --run test/pkce-store` — 12/12 PASS (aggregate)
- `npm run test -- --run test/token-endpoint` — 3/3 PASS (existing SECUR-05 tests still green)
- `npm run test` — 504/504 PASS across 70 test files
- `npm run build` — PASS (new dist/lib/pkce-store/*.js emitted)
- `npm run lint` — 0 errors (59 warnings, all pre-existing in test files, out of scope)

**Acceptance criteria (Task 1):**
- `grep -c "export interface PkceStore" src/lib/pkce-store/pkce-store.ts` = 1 ✓
- `grep -c "export interface PkceEntry" src/lib/pkce-store/pkce-store.ts` = 1 ✓
- `grep -c "getdel" src/lib/pkce-store/redis-store.ts` = 1 ✓
- `grep -c "'NX'" src/lib/pkce-store/redis-store.ts` = 2 (≥1) ✓
- `grep -c "'EX'" src/lib/pkce-store/redis-store.ts` = 2 (≥1) ✓
- `grep -c "TTL_SECONDS = 600" src/lib/pkce-store/redis-store.ts` = 1 ✓
- `grep -c "mcp:pkce:" src/lib/pkce-store/redis-store.ts` = 2 (≥1) ✓
- `grep -cE "setInterval|setTimeout" src/lib/pkce-store/memory-store.ts` = 0 ✓
- 10 unit tests green (6 redis + 4 memory) ✓

**Acceptance criteria (Task 2):**
- `grep -c "pkceStore: Map" src/server.ts` = 0 ✓
- `grep -cE "pkceStore\.cleanup|pkceStore\.find" src/server.ts` = 0 ✓
- `grep -cE "pkceStore\.put|pkceStore\.takeByChallenge" src/server.ts` = 3 (≥2) ✓
- `grep -cE "createHash.*sha256|sha256" src/server.ts` = 4 (≥1) ✓
- `grep -c "base64url" src/server.ts` = 3 (≥1) ✓
- `grep -cE "RedisPkceStore|MemoryPkceStore" src/index.ts` = 5 (≥2) ✓
- `grep -c "PHASE3_TENANT_PLACEHOLDER" src/server.ts` = 5 (≥1) ✓
- `npm run test -- --run test/pkce-store/cross-replica` exits 0 ✓
- `npm run test -- --run test/pkce-store/perf` exits 0 ✓
- `npm run build` exits 0 ✓
- **Anchor preservation** — `grep -c "region:phase3-pkce-store" src/index.ts` = 2 ✓
- **No cross-region writes** — `git diff src/index.ts` confined to (a) the phase3-pkce-store region body, (b) 3 top-level imports near existing postgres/redis imports, (c) the 1-line constructor callsite edit. Nothing else touched.
- **Other plans' regions untouched** — phase3-postgres (2), phase3-redis (2), phase3-kek (2), phase3-tenant-pool (2), phase3-shutdown-* (all 2) ✓

## Forward Handoff

- **03-06 (all-four-identity-flows):** /authorize + /token PKCE now go through `pkceStore.put` / `pkceStore.takeByChallenge`. Use `PHASE3_TENANT_PLACEHOLDER='_'` as the tenantId until 03-08 swaps it. The `PkceEntry` shape includes `serverCodeVerifier`, `redirectUri`, `clientId`, `state` — everything 03-06 needs for the Microsoft /token exchange. Entry auto-deletes on first take (atomic GETDEL) so 03-06 does NOT need a separate cleanup call.
- **03-08 (URL-path tenant routing):** ONE-LINE swap in `src/server.ts` — replace `PHASE3_TENANT_PLACEHOLDER` with `req.params.tenantId` at both call sites. Grep for the constant. Also **validate `tenantId` as GUID at the route level** (per T-03-03-05 mitigation) so malformed input can't produce Redis keys with wildcard / colon characters that would break glob matching. The PkceEntry's `tenantId` field also needs to be filled with the real value (currently hardcoded `'_'`).
- **03-05 (TenantPool):** untouched by this plan — `region:phase3-tenant-pool` still empty at count=2. Parallel wave-3 sibling plan.
- **Operator runbook:** document `maxmemory` + `maxmemory-policy volatile-lru` as the DoS mitigation for T-03-03-03. With TTL 600s on PKCE keys and co-resident MSAL cache keys also carrying TTLs, `volatile-lru` is the right policy for evicting the least-recently-accessed short-lived state under memory pressure.
- **Phase 6 (rate limiting):** per-tenant rate limit on /authorize lands in Phase 6 — that plus the Redis TTL is the full T-03-03-03 DoS defense. Phase 3 intentionally ships the substrate only.

## Known Stubs

- **PHASE3_TENANT_PLACEHOLDER='_'** in `src/server.ts` — documented scaffold, resolved by 03-08. NOT a stub that should block plan completion: the `mcp:pkce:_:<challenge>` key space is functionally correct for single-tenant HTTP + stdio operation during Phase 3; 03-08's routing work replaces the literal with a real tenant GUID under valid multi-tenant load. The /authorize + /token handlers themselves are fully wired — no placeholder data flowing to UI.
- **PkceEntry.tenantId field set to '_'** — same rationale as above. The field is present in the type and stored in Redis; only the value is scaffolded.
- **clientCodeChallenge charset validation** deliberately NOT added to /authorize in this plan (see T-03-03-05 disposition above) — deferred to 03-08 where tenantId GUID validation lives. Adding it mid-stream would dilute the disjoint-edit contract between 03-03 and 03-08 and is explicitly flagged in the forward handoff.

## Next Plan Readiness

- `PkceStore` interface available from `src/lib/pkce-store/pkce-store.js` for any downstream plan that needs to compose PKCE state (e.g., 03-06 /token handler, 03-10 audit log on PKCE collisions).
- `MemoryPkceStore` usable in any test file as a drop-in Redis-free PkceStore instance.
- `RedisPkceStore` in HTTP mode bootstrapped through `src/index.ts region:phase3-pkce-store` — no additional bootstrap glue needed for 03-06.
- `MicrosoftGraphServer` constructor now carries a deps bag `deps: { pkceStore?: PkceStore }` that 03-05 can extend with `tenantPool?: TenantPool` (4th arg, same bag) without constructor churn.
- The disjoint anchor-edit contract has proven durable across 4 wave-parallel plans: 03-01, 03-02, 03-03, 03-04 each filled their own regions without collision.

---
*Phase: 03-multi-tenant-identity-state-substrate*
*Completed: 2026-04-19*
