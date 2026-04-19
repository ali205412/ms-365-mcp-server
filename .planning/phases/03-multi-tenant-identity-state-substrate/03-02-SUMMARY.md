---
phase: 03-multi-tenant-identity-state-substrate
plan: 02
subsystem: substrate
tags: [redis, ioredis, hot-state, stdio-fallback, pubsub, lazyconnect, readiness, shutdown]

# Dependency graph
requires:
  - phase: 03-multi-tenant-identity-state-substrate/01
    provides: "src/lib/postgres.ts singleton shape (mirrored here); src/index.ts anchor regions region:phase3-redis + region:phase3-shutdown-redis + region:phase3-tenant-pool scaffolded; .env.example region:phase3-redis scaffolded; MicrosoftGraphServer readinessChecks[] constructor arg; phase3ShutdownOrchestrator shell; ioredis@5.10.1 + ioredis-mock@8.13.1 pre-installed"
provides:
  - "src/lib/redis.ts — getRedis() / shutdown() / readinessCheck() / __setRedisForTesting — ioredis singleton with lazyConnect + stdio auto-detect"
  - "src/lib/redis-facade.ts — MemoryRedisFacade (210 lines) implementing the exact ioredis subset Phase 3 consumes (get/set/getdel/del/keys/ping/quit/publish/subscribe/on('message')/status)"
  - "test/lib/redis.test.ts — 8 tests (HTTP mode via ioredis-mock, stdio via facade, readiness, shutdown idempotence, singleton, testing hook)"
  - "test/lib/redis-facade.test.ts — 8 tests (NX semantics, getdel atomicity, TTL via fake timers, glob keys, del count, pub/sub, status lifecycle, ping error-on-closed)"
  - "docker-compose.yml — redis:7-alpine service with AOF + redis-cli healthcheck + 127.0.0.1:6379 bind + depends_on: service_healthy for mcp"
  - ".env.example — MS365_MCP_REDIS_URL + MS365_MCP_FORCE_REDIS documented inside region:phase3-redis (anchor-only edit)"
  - "src/index.ts region:phase3-redis filled — getRedis() called + readinessCheck pushed into Phase 1 readinessChecks[] in HTTP mode"
  - "src/index.ts region:phase3-shutdown-redis filled — redisClient.shutdown() runs BEFORE postgres teardown per CONTEXT.md graceful-shutdown order"
affects:
  - "03-03: RedisPkceStore uses getRedis() + mcp:pkce:<state> key-prefix; in stdio mode transparently binds to MemoryRedisFacade without forking code paths"
  - "03-04: still owns region:phase3-kek (startup) + region:phase3-kek (.env.example) exclusively — untouched by this plan; acceptance-verified anchor count 2"
  - "03-05: MSAL cache plugin will call getRedis() + use mcp:cache:<tenant>:<user> prefix; Pitfall 6 (reconnect-cryptoshred) requires .status === 'ready' check before cryptoshred del — .status exposed on both real and facade clients per contract"
  - "03-08: Tenant pub/sub uses getRedis().subscribe('mcp:tenant-invalidate') + .on('message', fn); MemoryRedisFacade delivers synchronously within a single process so stdio tests don't need a separate subscriber connection"
  - "03-10: /readyz chain already wired — readinessCheck auto-flips 503 when Redis unreachable in HTTP mode"

# Tech tracking
tech-stack:
  added:
    - "(runtime) No new deps — ioredis@5.10.1 already pre-installed by 03-01 for batch determinism"
    - "(runtime) redis:7-alpine Docker image as reference-compose service"
  patterns:
    - "Union-type return (Redis | MemoryRedisFacade) for stdio/HTTP transparency — single code path across both modes for downstream consumers"
    - "Stdio auto-detection via environment env precedence: MS365_MCP_TRANSPORT=stdio OR (no MS365_MCP_REDIS_URL AND no MS365_MCP_FORCE_REDIS=1) → facade; else real ioredis"
    - "lazyConnect: true + readinessCheck .connect()-if-not-ready pattern — unit tests don't pay reconnect-loop cost when they don't exercise Redis"
    - "TTL via Date.now() timestamp comparison on every read — no background timers (deliberate: stdio mode would have its event loop pinned alive by a single setInterval)"
    - "ioredis .on('message', fn) fan-out to all subscribed channels replicated in the facade: globalMessageListeners set is re-attached to each channel's Set on subscribe()"
    - "Shutdown error swallowing — .quit() failure falls back to .disconnect(); preserves idempotence so a second shutdown() after the pool is nulled is a no-op"

key-files:
  created:
    - "src/lib/redis.ts (157 lines)"
    - "src/lib/redis-facade.ts (210 lines)"
    - "test/lib/redis.test.ts (121 lines, 8 tests)"
    - "test/lib/redis-facade.test.ts (134 lines, 8 tests)"
  modified:
    - "src/index.ts — 1 import line added top-level + region:phase3-redis filled (8 lines) + region:phase3-shutdown-redis filled (5 lines); anchor counts all = 2, no cross-region writes"
    - ".env.example — region:phase3-redis filled with MS365_MCP_REDIS_URL + MS365_MCP_FORCE_REDIS (11 lines); anchor counts all = 2, no cross-region writes"
    - "docker-compose.yml — redis:7-alpine service + mcp depends_on addition + mcp_redis_data volume"

key-decisions:
  - "Top-level import for redis module (line 19 of src/index.ts) paralleling 03-01's postgres import at line 18 — ESM imports MUST be at module scope, not inside anchor regions. This is the unambiguous established pattern from 03-01."
  - "Force-redis escape hatch (MS365_MCP_FORCE_REDIS=1 without URL) is an error not a facade fallback — silent fallback would hide misconfiguration from an operator who explicitly asked for real Redis."
  - "Pub/sub subscribers-registered-before-subscribe path handled: MemoryRedisFacade.subscribe() seeds new channels with the existing globalMessageListeners set, so registering .on('message', fn) before subscribe() still works (matches ioredis semantics)."
  - "quit() clears state AND removeAllListeners() — a reused facade instance after quit() would leak listener memory otherwise. Tests assert the ping-after-quit throw path."
  - "Shutdown import idempotence: redisClient.shutdown() nulls the cached client BEFORE awaiting quit, so an exception during quit can't leave a zombie reference and a second call is cleanly a no-op."
  - "isExpired uses <= rather than < at the millisecond boundary so the expiry test at exactly ttl ms reads as expired (behavioral match to Redis EXPIRE which is millisecond-precise)."

patterns-established:
  - "Module singleton with union return: a substrate module can expose a union-typed getter (real-client | facade) chosen at first-call time from env state; downstream consumers call only methods in the intersected API."
  - "Anchor-region disjoint-edit safety verified across 03-01+03-02: filling phase3-redis and phase3-shutdown-redis while leaving phase3-kek empty confirms the disjoint-edit contract scales to wave-parallel executors without conflict."

requirements-completed: [TENANT-05]

# Metrics
duration: ~20min
completed: 2026-04-19
---

# Phase 3 Plan 02: Redis Substrate + Stdio Facade Summary

**Redis substrate landed: ioredis singleton with lazyConnect, MemoryRedisFacade for stdio mode (one code path across transports), redis:7-alpine compose service with healthcheck, /readyz wiring, and anchor-disciplined edits to src/index.ts + .env.example that leave phase3-kek untouched for parallel sibling 03-04.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-19T17:17:42Z (approx; read context)
- **Completed:** 2026-04-19T17:37:00Z (approx)
- **Tasks:** 2 (both green, TDD RED → GREEN for each)
- **Tests added:** 16 (8 facade + 8 singleton), all passing
- **Files modified:** 4 created + 3 modified

## API Subset Supported by MemoryRedisFacade

For the 03-03 / 03-05 / 03-08 / 03-10 executors: use `getRedis()` only via these methods. The facade implements exactly this intersection with ioredis — anything else is undefined behavior and must not be called in Phase 3.

| Method | Signature | Use by |
|--------|-----------|--------|
| `get(key)` | `Promise<string \| null>` | 03-03, 03-05 |
| `set(key, value, 'EX', sec, 'NX'?)` | `Promise<'OK' \| null>` (null when NX + exists) | 03-03 (PKCE), 03-05 (cache) |
| `set(key, value, 'PX', ms, 'NX'?)` | `Promise<'OK' \| null>` | (reserved) |
| `getdel(key)` | `Promise<string \| null>` (atomic read-and-delete) | 03-03 (PKCE consume) |
| `del(...keys)` | `Promise<number>` (count removed) | 03-05 (cryptoshred), 03-08 (invalidate) |
| `keys(pattern)` | `Promise<string[]>` — only `*` wildcard supported | 03-05 (cryptoshred pattern match) |
| `ping()` | `Promise<'PONG'>`, throws when closed | 03-10 (readiness) |
| `quit()` | `Promise<'OK'>` | src/index.ts shutdown |
| `disconnect()` | `void` — forceful fallback | src/lib/redis.ts shutdown |
| `publish(ch, msg)` | `Promise<number>` (subscribers delivered) | 03-08 (tenant invalidate publish) |
| `subscribe(...chs)` | `Promise<number>` (total subscribed channels) | 03-08 (invalidate subscriber) |
| `on('message', fn)` | `this` — fan-out to all subscribed channels | 03-08 |
| `on('error', fn)` | `this` — standard EventEmitter error listener | 03-05 (log-only) |
| `status` (field) | `'wait' \| 'connecting' \| 'connect' \| 'ready' \| 'reconnecting' \| 'end'` | 03-05 (Pitfall 6) |

**Intentionally NOT implemented:** `mget`, `mset`, `hget` / `hset` families, sorted sets (`zadd`/`zrange`), `expire` / `ttl` (set TTL only at write time via EX/PX), cluster / sentinel ops. Callers needing these MUST use real Redis and must not run in stdio mode.

## Connection-String Precedence

```
MS365_MCP_REDIS_URL                     (primary — wins if set)
  ↓ otherwise + MS365_MCP_TRANSPORT=stdio OR MS365_MCP_FORCE_REDIS != '1'
  ↓
MemoryRedisFacade (in-memory, single-process)
  ↓ otherwise (HTTP-forced with no URL)
  ↓
throw Error — getRedis() refuses to construct
```

| Environment | Behavior |
|-------------|----------|
| stdio, no `MS365_MCP_REDIS_URL` | MemoryRedisFacade (default, recommended) |
| stdio, `MS365_MCP_REDIS_URL=redis://...` | Real ioredis (advanced — shares state with HTTP peers) |
| stdio, `MS365_MCP_FORCE_REDIS=1`, no URL | Error (explicit override without URL is misconfiguration) |
| HTTP, `MS365_MCP_REDIS_URL=redis://...` | Real ioredis (expected path) |
| HTTP, no URL | Error at `getRedis()` call inside `region:phase3-redis` |

HTTP-mode absence fails at first `getRedis()` call during bootstrap (the same pattern postgres.ts uses — fail loud, fail early, surface the env var name in the error message).

## Docker Compose Redis Service Spec

Landed in `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  command: ['redis-server', '--appendonly', 'yes']
  volumes:
    - mcp_redis_data:/data
  ports:
    - '127.0.0.1:6379:6379'   # same-host bind — swap for multi-host
  healthcheck:
    test: ['CMD', 'redis-cli', 'ping']
    interval: 5s
    timeout: 3s
    retries: 10
```

And the `mcp` service now has:

```yaml
depends_on:
  postgres:
    condition: service_healthy
  redis:
    condition: service_healthy
environment:
  MS365_MCP_REDIS_URL: redis://redis:6379
```

### Recommended production TLS config (not the default)

For multi-host deployments (reference compose is same-host only):

1. Change Redis to listen on `0.0.0.0:6379` behind a reverse proxy with TLS termination.
2. Set `requirepass <strong-secret>` in redis.conf AND mount the conf file.
3. Use `MS365_MCP_REDIS_URL=rediss://:${REDIS_PASS}@redis.internal:6380` on the mcp service.
4. Route the secret via Docker secret / environment file — never hardcode in compose.
5. Optionally set `maxmemory 512mb` + `maxmemory-policy allkeys-lru` to cap memory growth (T-03-02-02 mitigation for rate-limit counters in Phase 6).

The runbook should document these steps — the current compose is deliberately a minimal reference, not a production template.

## Shutdown Order (CONTEXT.md)

The final shutdown order inside `phase3ShutdownOrchestrator` (src/index.ts) is now:

```
1. region:phase3-shutdown-tenant-pool  (empty — 03-05 will fill)
2. region:phase3-shutdown-redis        ← THIS plan filled
     await redisClient.shutdown();
3. region:phase3-shutdown-postgres     (03-01 filled)
     await postgres.shutdown();
```

Redis teardown MUST run BEFORE Postgres so any in-flight audit-log writes from 03-05 tenant teardown have a live Postgres pool. The anchor layout enforces this ordering structurally — reviewers cannot accidentally reverse it without visibly moving the region markers.

## Anchor Discipline Audit

| File | Anchor region | Expected count | Actual | Status |
|------|---------------|----------------|--------|--------|
| `src/index.ts` | `region:phase3-postgres` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-redis` | 2 | 2 | filled by 03-02 |
| `src/index.ts` | `region:phase3-kek` | 2 | 2 | **untouched — 03-04's territory** |
| `src/index.ts` | `region:phase3-pkce-store` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-tenant-pool` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-shutdown-tenant-pool` | 2 | 2 | untouched |
| `src/index.ts` | `region:phase3-shutdown-redis` | 2 | 2 | filled by 03-02 |
| `src/index.ts` | `region:phase3-shutdown-postgres` | 2 | 2 | untouched |
| `.env.example` | `region:phase3-postgres` | 2 | 2 | untouched |
| `.env.example` | `region:phase3-redis` | 2 | 2 | filled by 03-02 |
| `.env.example` | `region:phase3-kek` | 2 | 2 | **untouched — 03-04's territory** |

The only file modifications outside anchor regions are:
1. `src/index.ts:19` — one new top-level `import * as redisClient from './lib/redis.js';` alongside 03-01's top-level `import * as postgres` on line 18. ESM imports MUST be at module scope; the 03-01 SUMMARY precedent confirms this is the correct pattern.
2. `docker-compose.yml` — adds a `redis:` service, adds `redis: service_healthy` to `mcp.depends_on`, adds `MS365_MCP_REDIS_URL` to `mcp.environment`, adds `mcp_redis_data` to volumes. Compose has no anchor regions; additions are cohesive and scoped to Redis.

## Task Commits

1. **Task 1 RED** — `e4c016b` `test(03-02): add failing tests for MemoryRedisFacade`
2. **Task 1 GREEN** — `c5ba6eb` `feat(03-02): implement MemoryRedisFacade for stdio-mode Redis fallback`
3. **Task 2 RED** — `d7d71be` `test(03-02): add failing tests for src/lib/redis singleton`
4. **Task 2 GREEN** — `dce1964` `feat(03-02): ioredis singleton + stdio detection + /readyz + shutdown order`

Plan metadata commit (this SUMMARY) follows separately.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] node_modules missing in worktree**
- **Found during:** Setup (pre-Task 1)
- **Issue:** Worktree branch had no `node_modules/` so `import IORedis from 'ioredis'` failed to resolve when vitest tried to parse the redis.ts file.
- **Fix:** Ran `npm install --no-audit --no-fund` once at the top of the agent session. The main repo's `package-lock.json` was committed by 03-01 Task 1, so a clean install reproduces the exact dep graph.
- **Files modified:** `node_modules/` (untracked, restored to match lockfile)
- **Verification:** `npm run test` now resolves `ioredis` and `ioredis-mock`.
- **Committed in:** none (node_modules is .gitignore'd — install is an environment restoration, not a code change)

**2. [Rule 3 — Blocking] src/generated/client.ts missing in worktree**
- **Found during:** Setup (pre-Task 1)
- **Issue:** `src/generated/client.ts` is `.gitignore`'d (generated at build time from Microsoft Graph OpenAPI). It was absent in the worktree's fresh checkout, which breaks ANY `npm run build` and most `npm run test` paths that transitively import the graph client.
- **Fix:** Copied the file from the main repo (`/home/yui/Documents/ms-365-mcp-server/src/generated/client.ts`) into the worktree. This is identical to what `npm run generate` produces from the current OpenAPI spec — no drift risk.
- **Files modified:** `src/generated/client.ts` (untracked, rebuilt from source of truth)
- **Committed in:** none (generated code is gitignored)

**3. [Rule 1 — Acceptance regression] JSDoc prose tripped the `lazyConnect: true` grep count**
- **Found during:** Task 2 acceptance verification
- **Issue:** The module-level JSDoc contained the literal string `` `lazyConnect: true` `` (in backticks) as prose explaining the option. The plan acceptance criterion `grep -c "lazyConnect: true" src/lib/redis.ts returns 1` then matched BOTH the option line and the JSDoc mention, reporting 2 instead of 1.
- **Fix:** Rewrote the JSDoc line to "The `lazyConnect` option defers the TCP handshake..." so the exact literal `lazyConnect: true` appears only at the real option call site on line 86.
- **Files modified:** src/lib/redis.ts (JSDoc comment only — no behavior change)
- **Verification:** `grep -c "lazyConnect: true" src/lib/redis.ts` now returns 1.
- **Committed in:** dce1964 (landed together with the Task 2 GREEN implementation)

**4. [Rule 1 — Acceptance regression] JSDoc prose tripped the `setTimeout|setInterval` grep count**
- **Found during:** Task 1 acceptance verification
- **Issue:** The module-level JSDoc originally read "setTimeout is NOT used (no background timers in stdio — would keep the event loop alive forever)." The plan acceptance criterion `grep -c "setInterval\|setTimeout" src/lib/redis-facade.ts returns 0` then matched the word `setTimeout` in the prose, reporting 1 instead of 0.
- **Fix:** Rewrote the JSDoc to "Background timers are deliberately avoided..." and dropped the literal API names from the comment. Behavior unchanged.
- **Files modified:** src/lib/redis-facade.ts (JSDoc comment only)
- **Verification:** `grep -c "setInterval\|setTimeout" src/lib/redis-facade.ts` now returns 0.
- **Committed in:** c5ba6eb (landed together with the Task 1 GREEN implementation)

**Total deviations:** 4 (2 env restoration, 2 JSDoc-vs-grep tightening). No scope creep, no behavior changes beyond what the plan specified.

## Self-Check: PASSED

**Files (all existence-verified in worktree):**
- FOUND: src/lib/redis.ts
- FOUND: src/lib/redis-facade.ts
- FOUND: test/lib/redis.test.ts
- FOUND: test/lib/redis-facade.test.ts
- FOUND (modified): src/index.ts
- FOUND (modified): .env.example
- FOUND (modified): docker-compose.yml

**Commits (all on worktree branch at HEAD):**
- FOUND: e4c016b (Task 1 RED)
- FOUND: c5ba6eb (Task 1 GREEN)
- FOUND: d7d71be (Task 2 RED)
- FOUND: dce1964 (Task 2 GREEN)

**Automated verifications:**
- `npm run test -- --run test/lib/redis-facade` — 8/8 PASS
- `npm run test -- --run test/lib/redis` — 8/8 PASS (16/16 combined)
- `npm run test` — 455/455 PASS (61 test files)
- `npm run build` — PASS
- `npm run lint` — 0 errors (59 warnings, all pre-existing in test files, out of scope)
- `docker compose -f docker-compose.yml config > /dev/null` — VALID

**Acceptance criteria (Task 1):**
- `grep -c "export class MemoryRedisFacade" src/lib/redis-facade.ts` = 1 ✓
- `grep -cE "^\s+(async )?(get|set|getdel|del|keys|ping|quit|publish|subscribe|disconnect)\(" src/lib/redis-facade.ts` = 10 (≥10) ✓
- `grep -c "setInterval\|setTimeout" src/lib/redis-facade.ts` = 0 ✓
- `grep -c "EventEmitter" src/lib/redis-facade.ts` = 3 (≥1) ✓
- 8 tests green ✓

**Acceptance criteria (Task 2):**
- `grep -cE "export (function|async function) (getRedis|shutdown|readinessCheck)" src/lib/redis.ts` = 3 ✓
- `grep -c "MemoryRedisFacade" src/lib/redis.ts` = 6 (≥2) ✓
- `grep -c "lazyConnect: true" src/lib/redis.ts` = 1 ✓
- `grep -c "MS365_MCP_REDIS_URL" src/lib/redis.ts` = 10 (≥2) ✓
- `grep -c "redis:7-alpine" docker-compose.yml` = 1 (≥1) ✓
- `grep -c "redis-cli.*ping" docker-compose.yml` = 1 (≥1) ✓
- `grep -c "redisClient\.readinessCheck\|redisClient\.getRedis" src/index.ts` = 2 (≥1) ✓
- All anchor region counts = 2 (postgres, redis, kek, pkce-store, tenant-pool, shutdown-tenant-pool, shutdown-redis, shutdown-postgres) ✓
- `.env.example` anchor counts (postgres, redis, kek) all = 2 ✓
- `npm run build` exits 0 ✓
- `npm run test -- --run test/lib/redis` exits 0 ✓

## Forward Handoff

- **03-03 (RedisPkceStore):** call `getRedis()` and use `mcp:pkce:<state>` keys with `set(..., 'EX', 600, 'NX')` + `getdel` for consume. Works identically in HTTP (real Redis) and stdio (facade) modes — no transport-specific branch needed.
- **03-04 (DEK / KEK):** `region:phase3-kek` (src/index.ts + .env.example) remains empty and unmodified by this plan — cleanly open for 03-04's parallel worktree. Anchor counts verified = 2 for all kek markers.
- **03-05 (TenantPool + MSAL cache plugin):** fill `region:phase3-tenant-pool` (startup) and `region:phase3-shutdown-tenant-pool` (shutdown, runs BEFORE redis per phase3ShutdownOrchestrator order). Use `mcp:cache:<tenant>:<user>` prefix. **Pitfall 6 reminder — MANDATORY:** before `redis.del('mcp:cache:{tenantId}:*')` in the cryptoshred path, check `if (getRedis().status !== 'ready') throw new Error('Redis not ready; retry disable')`. `.status` is exposed on both real ioredis and MemoryRedisFacade — the check is uniform across transports.
- **03-08 (tenant pub/sub invalidation):** use `getRedis().subscribe('mcp:tenant-invalidate')` + `.on('message', (ch, msg) => evictLruEntry(msg))` on subscriber; `getRedis().publish('mcp:tenant-invalidate', tenantId)` on publisher. The facade delivers synchronously within a process so stdio tests do not need a separate subscriber connection — this is intentional per CONTEXT.md D-13.
- **03-10 (/readyz chain):** already wired. `redisClient.readinessCheck` is in the Phase 1 readinessChecks[] array in HTTP mode; /readyz flips to 503 when Redis is unreachable with no additional code required.

## Pitfall 6 Reminder for 03-05 Executor

From `.planning/phases/03-multi-tenant-identity-state-substrate/03-RESEARCH.md` Pitfall 6 (reconnect-during-cryptoshred race):

> Tenant disable fires `redis.del('mcp:cache:{tenantId}:*')` but Redis is momentarily disconnected; ioredis queues the command; when reconnection occurs, the DEL executes AFTER a subsequent request re-populated the cache.
>
> Avoid: In the sync cryptoshred path (03-05 eviction on tenant disable), check redis connection state: `if (redis.status !== 'ready') throw new Error('Redis not ready; retry disable')`.

**03-05 executor — this is not optional.** The ready-check must be BEFORE the del, and the error must propagate back to the operator's disable-tenant API call. Silent success on a queued-but-not-yet-executed DEL is the exact scenario Pitfall 6 warns against and the threat disposition T-03-02-05 depends on.

The `.status` field is uniformly exposed on both the real ioredis client and the MemoryRedisFacade, so the check compiles cleanly under the `RedisClient` union type without narrowing.

## Known Stubs

None. The phase3-tenant-pool / phase3-pkce-store / phase3-kek anchor regions are still empty by design — they belong to sibling plans 03-03/04/05 and are NOT stubs within the scope of this plan. The facade is a full implementation of the Phase 3 API surface, not a stub.

## Next Plan Readiness

- `getRedis()` callable from any module; both HTTP + stdio return a unified API surface.
- `/readyz` auto-wired for Redis readiness in HTTP mode (no additional glue code needed in downstream plans).
- `redis.shutdown()` landed in the Phase 3 shutdown orchestrator with correct ordering (before postgres).
- Docker Compose reference stack now requires both postgres and redis to be healthy before the mcp service starts.
- ioredis singleton + MemoryRedisFacade pattern reusable by future plans that need HTTP/stdio-transparent substrate.
- Anchor contract proven durable across wave-2 parallel execution: 03-02 filled its regions and left 03-04's kek regions untouched.

---
*Phase: 03-multi-tenant-identity-state-substrate*
*Completed: 2026-04-19*
