---
phase: 01-foundation-hardening
plan: "04"
subsystem: health-endpoints
tags:
  - health
  - liveness
  - readiness
  - healthz
  - readyz
  - draining
  - docker-healthcheck
  - express
  - ops-03
  - ops-04

# Dependency graph
requires:
  - phase: 01-02
    provides: "pino-http autoLogging.ignore predicate covering /healthz + /readyz — zero access-log spam from Docker HEALTHCHECK"
  - phase: 01-03
    provides: "bin/check-health.cjs standalone Docker HEALTHCHECK probe; needs /healthz to respond"
provides:
  - "src/lib/health.ts: mountHealth(app, readinessChecks?) + setDraining(v) + isDraining() + ReadinessCheck type"
  - "/healthz liveness endpoint: always 200 { status: 'ok' } while process is alive (OPS-03)"
  - "/readyz readiness endpoint: 200 { status: 'ready' } by default; 503 { status: 'draining' } when draining; 503 { status: 'not_ready' } when any pushed check fails (OPS-04)"
  - "--health-check CLI flag: HTTP mode probes /healthz with 3s timeout; stdio mode short-circuits exit 0"
  - "parseHttpOption exported from src/server.ts so the short-circuit can reuse host:port parsing"
affects:
  - "01-05: setDraining(true) will be called from SIGTERM handler; otel.shutdown() integrates alongside"
  - "01-03 (retroactive): Docker HEALTHCHECK now reaches a live /healthz; the deferred behavioral smoke from 01-03 can now verify end-to-end"
  - "Phase 3: readinessChecks array will gain a pgReachable / redisReachable entry"
  - "Phase 6: readinessChecks array will gain 'at least one tenant loaded' entry"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mount-order contract: health endpoints BEFORE pino-http, CORS, body parsers, auth"
    - "Module-scoped mutable flag (draining) — documented exception to no-mutable-state rule; matches pino-http logger + auth.ts keytar singleton pattern"
    - "Factory-plus-registry pattern: mountHealth(app, readinessChecks?) accepts an extension array so later phases push checks without editing src/lib/health.ts"
    - "CLI short-circuit runs BEFORE AuthManager.create() / secrets loading — probes MUST NOT exercise side-effectful startup"
    - "Express-version-resilient test spy: capture handlers via fake app.get() rather than introspecting app._router.stack"

key-files:
  created:
    - "src/lib/health.ts (111 lines): mountHealth factory + setDraining/isDraining"
    - "test/health-endpoints.test.ts (201 lines): 8 behavior assertions covering /healthz + /readyz contract"
  modified:
    - "src/server.ts: added mountHealth import + call; exported parseHttpOption"
    - "src/cli.ts: added --health-check flag + CommandOptions.healthCheck?: boolean"
    - "src/index.ts: added runHealthCheck() helper + short-circuit at top of main()"

key-decisions:
  - "mountHealth(app) placement: FIRST middleware after app.set('trust proxy', true), BEFORE pino-http + CORS + body parsers + auth — defends against T-01-04a (log spam regression) and T-01-04b (auth failures propagating to liveness probe)"
  - "Module-scoped draining flag kept simple (let draining = false) over DI container — Phase 3 may refactor; Phase 1 values simplicity"
  - "No logger imports in src/lib/health.ts — /healthz + /readyz run every ~30s; logger.debug here produces noise with zero diagnostic value"
  - "No manual OTel spans — auto-instrumentations from @opentelemetry/sdk-node (plan 01-02) already wrap Express request handlers"
  - "parseHttpOption EXPORTED from server.ts over duplicated-inline to keep one source of truth for host:port parsing"
  - "--health-check short-circuit placed BEFORE AuthManager.create() in main() — probe must be cheap + cannot fail when auth config is broken"
  - "Fake-app spy test pattern over real Express port binding — Express 4→5 changed app._router shape; direct handler capture is version-resilient"

patterns-established:
  - "mount-first-before-auth ordering contract for any route that must survive auth/CORS regressions"
  - "readinessChecks extension-hook pattern: factories accept optional registry arrays for downstream phase contributions"
  - "CLI short-circuit helpers live in src/index.ts alongside main() — invariant: NO side-effectful imports triggered by the flag"

requirements-completed: [OPS-03, OPS-04]

# Metrics
duration: 5min
completed: 2026-04-18
---

# Phase 1 Plan 04: Health Endpoints (/healthz + /readyz) Summary

**Mounted /healthz (always-200 liveness) and /readyz (200 ready / 503 draining / 503 not_ready) on the Express app BEFORE auth+CORS+pino-http via a reusable src/lib/health.ts factory with a setDraining toggle and a readinessChecks extension hook that Phase 3 and Phase 6 will push into.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-18T19:15:25Z
- **Completed:** 2026-04-18T19:20:25Z
- **Tasks:** 3 executed
- **Files modified:** 5 (3 source modifications, 2 new files)

## Accomplishments

- New module `src/lib/health.ts` exports `mountHealth`, `setDraining`, `isDraining`, and `ReadinessCheck` — 111 lines, no logger/OTel imports, module-scoped draining flag
- Health endpoints mounted FIRST in the Express middleware chain so auth/CORS/body-parser regressions cannot break liveness probes
- `--health-check` CLI flag added with a 3s HTTP probe in HTTP mode and an immediate exit 0 in stdio mode; short-circuit runs BEFORE any secrets/MSAL initialization
- `parseHttpOption` exported from `src/server.ts` so the short-circuit reuses exactly the same `host:port` parser the server uses
- 8 new behavioral tests green, 225-total regression suite green (34 test files, 225 tests), `npm run build` succeeds with `dist/lib/health.js` emitted (741 bytes)
- The deferred Docker HEALTHCHECK smoke from plan 01-03 can now be exercised end-to-end — /healthz is live

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 RED tests for /healthz + /readyz** — `eea8780` (test)
2. **Task 2: src/lib/health.ts implementation (GREEN)** — `e0c241f` (feat)
3. **Task 3: Wire mountHealth + --health-check flag + short-circuit** — `4ea45d7` (feat)

## Files Created/Modified

### Created

- `src/lib/health.ts` (111 lines) — `mountHealth(app, readinessChecks?)` factory mounts `/healthz` (200 always) + `/readyz` (200 ready / 503 draining / 503 not_ready). Exports `setDraining(v)`, `isDraining()`, and the `ReadinessCheck` type alias. Documented in JSDoc with the rationale for the module-scoped mutable flag, the no-logger decision, and the T-01-04a/b/c threat dispositions.
- `test/health-endpoints.test.ts` (201 lines) — 8 behavior assertions: `/healthz` → 200 `{status:'ok'}`; `/readyz` default → 200 `{status:'ready'}`; draining → 503 `{status:'draining'}`; draining false again → 200; failing check → 503 `{status:'not_ready'}`; throwing async check → 503 (error swallowed); all-passing checks → 200; `isDraining()` reflects `setDraining()`. Uses an Express-version-resilient fake-app spy (captures handlers via `app.get` rather than introspecting `app._router.stack`).

### Modified

- `src/server.ts` — Two changes:
  1. Added `import { mountHealth } from './lib/health.js';`
  2. Called `mountHealth(app);` immediately after `app.set('trust proxy', true)` and BEFORE `pinoHttp(...)`, CORS middleware, body parsers, and any auth/router mounting. Included an inline comment documenting the three reasons for the ordering (T-01-04a log spam regression defense, T-01-04b auth-failure isolation, CORS preflight compatibility).
  3. Exported `parseHttpOption(...)` so `src/index.ts` can reuse it for the `--health-check` probe.
- `src/cli.ts` — Two changes:
  1. Added `.option('--health-check', '...')` between `--verify-login` and `--list-accounts` in the Commander chain.
  2. Added `healthCheck?: boolean` to the `CommandOptions` interface.
- `src/index.ts` — Three changes:
  1. Added `import http from 'node:http';` and `parseHttpOption` named-import from `./server.js`; added `type CommandOptions` type-only import from `./cli.js`.
  2. Added a new `runHealthCheck(args: CommandOptions): Promise<number>` helper (stdio returns 0, HTTP probes `/healthz` with 3s timeout, returns 0 on HTTP 200, 1 on non-200 / connection refused / timeout).
  3. Added a short-circuit block at the top of `main()` (after `parseArgs()`, before `AuthManager.create()`) that invokes `runHealthCheck(args)` and calls `process.exit(exitCode)` when `args.healthCheck` is set. Commented with the invariant "MUST NOT initialize MSAL or load secrets".

## Decisions Made

- **Mount order (`mountHealth` FIRST):** Health endpoints MUST be mounted BEFORE pino-http, CORS, body parsers, and auth. Three reasons: (1) T-01-04b — a broken auth config must not cause the liveness probe to fail; (2) T-01-04a — pino-http autoLogging.ignore is a belt-and-braces guard, mounting first means even a regression in that predicate cannot spam 2880 log lines/day; (3) OPTIONS preflight on `/healthz` must not hit CORS origin validation that might 403 in prod.
- **Module-scoped `draining` flag:** Chose `let draining = false` over a DI container or class-based state. Matches pino-http logger singleton + auth.ts keytar pattern; Phase 3 may refactor once the tenant pool lands.
- **No logger imports in src/lib/health.ts:** `/healthz` runs every ~30s from Docker; `logger.debug` here produces noise with zero diagnostic value. pino-http autoLogging.ignore already skips these paths (from plan 01-02).
- **No manual OTel spans:** `@opentelemetry/auto-instrumentations-node` (plan 01-02) already wraps every Express request. Manual spans would be redundant.
- **Export `parseHttpOption` over inline duplication:** Single source of truth for `host:port` parsing. Exporting is safer than duplicating — any future format extension (IPv6 `[::1]:3000`, UNIX sockets) lands in one place.
- **`--health-check` short-circuit BEFORE AuthManager.create():** The probe runs every 30s. It must be cheap and MUST NOT depend on secrets loading, MSAL initialization, or file IO. Exiting before those calls protects the liveness probe from configuration errors.
- **Fake-app spy test pattern:** Captures handlers via `app.get(path, handler)` interception rather than `app._router.stack` introspection. Express 5 changed that internal shape; the fake-app pattern stays stable across versions.
- **`res.resume()` in HTTP probe response handler:** Drains the response stream so the socket closes cleanly even though we only care about the status code. Prevents socket-leak warnings under repeated probes.
- **Default `probeHost = host ?? '127.0.0.1'`:** When `--http 3000` (no host) or `--http :3000`, parseHttpOption returns `host: undefined` which means "bind all interfaces" on the server side. For the PROBE we need a concrete hostname — loopback is the correct default since the probe runs inside the same container.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing functionality] Added `res.resume()` in HTTP probe response handler**

- **Found during:** Task 3 (dogfooding the probe logic)
- **Issue:** `http.get(...)` returns an `IncomingMessage` stream. If the response body is non-empty and never drained, the socket stays half-open and Node emits a warning on repeated probes (every 30s from Docker).
- **Fix:** Added `res.resume();` before `resolve(res.statusCode === 200 ? 0 : 1);` — drains the stream without buffering, letting the socket close cleanly.
- **Files modified:** `src/index.ts`
- **Commit:** 4ea45d7
- **Why Rule 2, not Rule 1:** The plan's example code omitted `.resume()`. Omitting it is a correctness gap — not a bug in the author's implementation, but essential for a probe that runs 2880 times/day.

**2. [Rule 3 — Blocking issue] Worktree missing `src/generated/client.ts`**

- **Found during:** Task 3 full regression run
- **Issue:** `src/generated/client.ts` is gitignored and regenerated by `npm run generate`. The worktree was missing it, causing 11 pre-existing tests to fail with "Cannot find module '../src/generated/client.js'". These failures were NOT caused by this plan's changes — they exist in any fresh worktree without a generate step.
- **Fix:** Copied the generated file from the main repo clone so the regression suite could run. This file is gitignored (`.gitignore:src/generated/client.ts`) and NOT committed. The main repo already carries it (via a prior `npm run generate` run); the orchestrator merge path will retain that state.
- **Files modified:** None committed (copied file is gitignored)
- **Commit:** N/A (no commit — file is gitignored)
- **Scope note:** This is out-of-scope for this plan's functional changes but was blocking Rule 3 verification of "`npm test -- --run` green".

### Plan-following deviations

**3. [Plan variance — ordering] `--health-check` short-circuit placed BEFORE `AuthManager.create()` rather than BEFORE `new MicrosoftGraphServer(...)` as the plan suggested.**

- **Why:** The plan's action text says "BEFORE `new MicrosoftGraphServer(...).start()`" but the plan's behavior contract says "MUST NOT initialize MSAL / load secrets / start the server". The only way to satisfy both is to short-circuit BEFORE `AuthManager.create()` (which loads secrets) — which is earlier than `new MicrosoftGraphServer(...)`. I followed the stricter behavior contract.
- **Commit:** 4ea45d7

## Cross-Plan Dependencies

- **01-02 provided:** `autoLogging.ignore` predicate covering `/healthz` + `/readyz` — zero access-log spam for 2880 probes/day.
- **01-03 provided:** `bin/check-health.cjs` standalone CJS probe and Dockerfile `HEALTHCHECK CMD ["node","/app/bin/check-health.cjs"]`. That probe targets `/healthz` which this plan now implements. The deferred behavioral smoke from 01-03 can now succeed end-to-end.
- **01-05 will consume:** `setDraining(true)` in the SIGTERM handler to make `/readyz` return 503 while in-flight requests finish. `otel.shutdown()` integrates alongside.
- **Phase 3 will push:** `pgReachable` / `redisReachable` readiness checks into the array passed to `mountHealth`.
- **Phase 6 will push:** "at least one tenant loaded" readiness check.

## Threat Model Compliance

From plan 01-04 `<threat_model>`:

| Threat ID | Category | Disposition | Mitigation Verified |
|-----------|----------|-------------|---------------------|
| T-01-04a | DoS (log spam) | mitigate | pino-http autoLogging.ignore from 01-02 skips `/healthz` + `/readyz`; `mountHealth` called BEFORE pino-http so even a regression in the ignore predicate cannot spam logs |
| T-01-04b | Availability (auth on health probe) | mitigate | `mountHealth(app)` called BEFORE any auth middleware in src/server.ts; Test 1 + Test 2 in test/health-endpoints.test.ts exercise handlers with no auth context |
| T-01-04c | Info Disclosure (readiness body leak) | accept | Responses limited to `{status:'ready'|'not_ready'|'draining'|'ok'}` — no database names, tenant counts, or internal details. Documented in src/lib/health.ts JSDoc + this summary. Phase 3 readiness checks MUST preserve the contract. |
| T-01-04d | Spoofing (version disclosure via /healthz) | accept | `/healthz` returns only `{status:'ok'}` — no version, no build info, no tenant IDs |

All four dispositions honored at the code level.

## Success Criteria Check

- [x] `src/lib/health.ts` exports `mountHealth`, `setDraining`, `isDraining`, `ReadinessCheck` type.
- [x] `/healthz` returns 200 `{status:'ok'}` always.
- [x] `/readyz` returns 200 `{status:'ready'}` by default.
- [x] `/readyz` returns 503 `{status:'draining'}` after `setDraining(true)`.
- [x] `/readyz` returns 503 `{status:'not_ready'}` when any readiness check fails.
- [x] `--health-check` CLI flag probes `/healthz` over HTTP and exits 0/1.
- [x] `--health-check` in stdio mode short-circuits to exit 0.
- [x] pino-http does NOT log `/healthz` or `/readyz` at info level (covered by autoLogging.ignore from 01-02; `mountHealth` called BEFORE pino-http as double defense).
- [x] Health endpoints mounted BEFORE auth/CORS/body parsers.
- [x] `npm test -- --run` green (225/225 tests pass).
- [x] `npm run build` green (emits `dist/lib/health.js`).

## Self-Check

Files exist:
- `src/lib/health.ts`: FOUND
- `test/health-endpoints.test.ts`: FOUND

Commits exist:
- `eea8780`: FOUND (test(01-04): add failing RED tests for /healthz + /readyz)
- `e0c241f`: FOUND (feat(01-04): implement src/lib/health.ts with mountHealth factory)
- `4ea45d7`: FOUND (feat(01-04): mount /healthz+/readyz before auth; add --health-check CLI flag)

Source assertions:
- `grep mountHealth src/server.ts`: FOUND (line 22 import, line 198 call)
- `grep health-check src/cli.ts`: FOUND (line 23 Commander option)
- `grep healthCheck src/index.ts`: FOUND (line 62 short-circuit guard)

TDD gate compliance:
- RED gate: `eea8780` test(01-04) — PRESENT
- GREEN gate: `e0c241f` feat(01-04) — PRESENT (after RED)
- REFACTOR gate: N/A (implementation was minimal; no refactor needed)

## Self-Check: PASSED

---

*Phase: 01-foundation-hardening*
*Completed: 2026-04-18*
