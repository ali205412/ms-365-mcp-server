---
phase: 01-foundation-hardening
plan: "05"
subsystem: graceful-shutdown
tags:
  - shutdown
  - sigterm
  - sigint
  - drain
  - ops-09
  - otel
  - pino
  - idempotent
  - lifecycle

# Dependency graph
requires:
  - phase: 01-02
    provides: "pino logger (with .flush) + otel.shutdown (10s race in the SDK module itself) that this plan's handler calls"
  - phase: 01-03
    provides: "Dockerfile STOPSIGNAL SIGTERM so docker stop reaches this handler via tini PID 1 forwarding"
  - phase: 01-04
    provides: "setDraining / isDraining from src/lib/health.ts — flipped FIRST in the drain sequence so /readyz returns 503 while draining"
provides:
  - "src/lib/shutdown.ts: registerShutdownHooks(server, logger) with SIGTERM+SIGINT handlers, 25s grace, 10s OTel race, idempotent guard, removeAllListeners last-wins semantics"
  - "src/server.ts: binds app.listen return to httpServer + calls registerShutdownHooks after both listen branches"
  - "src/index.ts: registers null-server shutdown hooks after --health-check short-circuit for clean stdio Ctrl-C"
  - "MS365_MCP_SHUTDOWN_GRACE_MS env override (default 25000ms)"
  - "ShutdownLogger structural interface (info/error/flush?) accepting both pino.Logger and the Winston-to-pino adapter"
affects:
  - "Phase 3: per-tenant token-cache flush + MSAL pool drain will be added to this shutdown sequence"
  - "Phase 6: per-tenant rate-limit counter flush will be added here"
  - "01-03 (retroactive): deferred Docker-stop smoke can now exit cleanly within 25s — the drain sequence is real"
  - "01-04 (retroactive): the setDraining flag added for this plan's exclusive caller is now wired; /readyz 503 semantics are end-to-end"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Signal-handler registry pattern: process.on('SIGTERM'|'SIGINT') pointing at a single async shutdown function"
    - "Idempotency via module-level draining flag read at handler entry (isDraining()) — double-signal is a no-op"
    - "removeAllListeners last-wins double-registration guard — http-aware handler supersedes stdio-safety-net handler"
    - "Promise.race timeout pattern for bounded external-dependency shutdown (OTel collector hang defense)"
    - "unref()-ed failsafe setTimeout as exit(1) deadline — does not keep event loop alive if normal exit runs faster"
    - "Structural ShutdownLogger interface decoupling signatures from full pino.Logger (allows Winston-to-pino adapter)"

key-files:
  created:
    - "src/lib/shutdown.ts (131 lines): registerShutdownHooks + ShutdownLogger interface"
    - "test/graceful-shutdown.test.ts (253 lines): 8 behavior assertions covering OPS-09 + T-01-05a/b/c/d"
  modified:
    - "src/server.ts: added shutdown import + bound httpServer + registerShutdownHooks(httpServer, logger) call"
    - "src/index.ts: added shutdown import + registerShutdownHooks(null, logger) after --health-check"

key-decisions:
  - "GRACE_MS = 25000 default (plan D-claude-discretion); override via MS365_MCP_SHUTDOWN_GRACE_MS — chosen so Docker's 10s default stop-grace can safely be lifted to 30s operator-wide without ambiguity about who exits first"
  - "OTEL_SHUTDOWN_TIMEOUT_MS = 10_000 fixed (not env-overridable in Phase 1) — opinionated safety; any operator who wants something higher can rely on 01-02's wrap or re-open this decision in Phase 2+"
  - "Defense-in-depth OTel Promise.race inside shutdown.ts EVEN THOUGH 01-02's otel.ts wraps shutdown in a 10s race too — if someone removes 01-02's wrap, THIS module still enforces the deadline. Redundant but cheap."
  - "removeAllListeners last-wins over numeric priority or named-handler tagging — simplest correct approach; src/index.ts registers null-server variant early, src/server.ts re-registers with real http.Server when listening"
  - "ShutdownLogger structural interface over casting the Winston-to-pino adapter to pino.Logger — interface decouples shutdown.ts from pino-specific types and documents the actual contract the adapter must meet (info, error, optional flush)"
  - "register hooks AFTER --health-check short-circuit in index.ts — no point installing signal handlers when the process is about to exit from the probe anyway"
  - "Single shutdown async function (not separate SIGTERM vs SIGINT handlers) — identical drain sequence for both; the signal name flows into the info log line only"
  - "await server.close() via new Promise<void>((resolve) => server.close(() => resolve())) — server.close can run for seconds while in-flight requests complete; awaiting its callback is the correct drain semantics"
  - "logger.flush?() (optional chaining) over unconditional call — pino.Logger declares flush as optional; keeps logger mocks without .flush working in tests (Test 5 stdio-mode specifically)"

patterns-established:
  - "Cross-plan signal lifecycle: Dockerfile STOPSIGNAL SIGTERM (01-03) -> tini PID 1 forwarding -> process.on('SIGTERM') (this plan) -> setDraining(true) (01-04) -> /readyz 503 (01-04) -> server.close (this plan) -> logger.flush (01-02) -> otel.shutdown (01-02) -> exit(0). All five plans contribute to a single drain pipeline."
  - "unref()-ed deadline pattern for bounded-duration sequences that must not extend event loop lifetime"
  - "Structural typing of cross-cutting dependencies (logger) via minimal interfaces defined in the consumer — decouples the consumer from the full shape of the dependency's type while still documenting the contract"

requirements-completed: [OPS-09]

# Metrics
duration: "9m"
completed: 2026-04-18
tasks_completed: 3
tests_added: 8
files_created: 2
files_modified: 2
---

# Phase 1 Plan 05: Graceful Shutdown (SIGTERM/SIGINT drain + 10s OTel race + idempotent guard) Summary

**One-liner:** registerShutdownHooks wires SIGTERM/SIGINT to flip setDraining(true) (plan 01-04), await server.close, logger.flush, otel.shutdown (10s Promise.race), exit(0) within a 25s grace budget — closing the loop on Docker's STOPSIGNAL SIGTERM directive (plan 01-03) and giving the pino+OTel subsystems (plan 01-02) a clean flush path.

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-18T19:25:36Z
- **Completed:** 2026-04-18T19:34:25Z
- **Tasks:** 3 executed
- **Files modified:** 4 (2 created, 2 modified)

## What Was Built

### src/lib/shutdown.ts (131 lines) — registerShutdownHooks factory

Eager signal-handler registration with a single async `shutdown(signal)` function covering:

1. **Idempotency guard:** `if (isDraining()) return;` at handler entry — double-SIGTERM is a no-op (T-01-05d).
2. **setDraining(true):** flips plan 01-04's module-scoped flag so `/readyz` starts returning 503 (T-01-05a).
3. **Failsafe deadline:** `setTimeout(() => process.exit(1), GRACE_MS).unref()` — forces exit(1) if drain runs past 25s. unref() prevents the timer from keeping the event loop alive.
4. **server.close() await:** `new Promise<void>((resolve) => server.close(() => resolve()))` — only runs if server is non-null (null in stdio mode).
5. **logger.flush?.() try/catch:** pino v10 sync flush on stdout destination (T-01-05c); optional chaining for logger mocks without .flush.
6. **otel.shutdown with 10s Promise.race:** defense-in-depth over 01-02's 10s race inside otel.ts itself. Catches any rejection and logs-then-proceeds (T-01-05b).
7. **process.exit(0).**

**ShutdownLogger structural interface** (new export) — accepts both pino.Logger and the Winston-to-pino adapter:

```typescript
export interface ShutdownLogger {
  info: (arg1: unknown, arg2?: unknown) => void;
  error: (arg1: unknown, arg2?: unknown) => void;
  flush?: () => void;
}
```

**removeAllListeners guard** — the first statement inside `registerShutdownHooks` is `process.removeAllListeners('SIGTERM'); process.removeAllListeners('SIGINT');`. This means the LAST call to `registerShutdownHooks` wins. In HTTP mode, `src/index.ts` registers an early null-server variant; `src/server.ts` then re-registers with the real `http.Server` once `app.listen` returns, and that later registration supersedes.

**Env override:** `MS365_MCP_SHUTDOWN_GRACE_MS` — parsed with `Number.parseInt(..., 10)` + fallback `'25000'`. Documented in JSDoc.

### test/graceful-shutdown.test.ts (253 lines) — 8 behavior assertions

- **Test 1:** setDraining(true) flipped first.
- **Test 2:** logger.flush called.
- **Test 3:** otel.shutdown called exactly once.
- **Test 4:** server.close called once when non-null.
- **Test 5:** server.close skipped when null (stdio mode); otel.shutdown still runs.
- **Test 6:** double signal idempotent — server.close called only once (via mockReturnValueOnce(false).mockReturnValueOnce(true) on isDraining).
- **Test 7:** otel.shutdown hang past 10s still lets exit(0) run. Uses `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(11_000)` to skip the real wait.
- **Test 8:** SIGTERM + SIGINT both registered on process.

Tests spy `process.on`, `process.removeAllListeners`, and `process.exit` so the handler registrations are captured in a local `handlers` map and can be invoked directly without sending real signals.

### src/server.ts — HTTP-mode shutdown wiring

Added import + bound the `app.listen` return in BOTH branches (host-specified and all-interfaces):

```typescript
import { registerShutdownHooks } from './lib/shutdown.js';

let httpServer: import('node:http').Server;
if (host) {
  httpServer = app.listen(port, host, () => { /* existing logger.info lines */ });
} else {
  httpServer = app.listen(port, () => { /* existing logger.info lines */ });
}
registerShutdownHooks(httpServer, logger);
```

### src/index.ts — stdio-mode shutdown wiring

Added import + call after the `--health-check` short-circuit (no point installing signal handlers when `--health-check` is about to exit):

```typescript
import { registerShutdownHooks } from './lib/shutdown.js';

// ... --health-check short-circuit ...

registerShutdownHooks(null, logger);
```

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 RED tests for graceful shutdown** — `5a39b87` (test)
2. **Task 2: src/lib/shutdown.ts implementation (GREEN)** — `f115423` (feat)
3. **Task 3: Wire registerShutdownHooks in server.ts + index.ts** — `22ab859` (feat)

## Decisions Made

- **GRACE_MS = 25000 default (env-overridable via `MS365_MCP_SHUTDOWN_GRACE_MS`):** Gives operators a generous deadline while still staying comfortably under a `docker stop --time=30s`. An operator who bumps to `docker stop --time=45s` can also bump this env to match.
- **OTEL_SHUTDOWN_TIMEOUT_MS = 10_000 fixed:** Phase 1 opinionated safety; not env-overridable. A dead OTLP collector has never been worth blocking `process.exit`. If a deployment needs a longer exporter flush, that's a Phase 2+ conversation.
- **Defense-in-depth race in shutdown.ts alongside the one in otel.ts (plan 01-02):** If someone later unwraps the race in `src/lib/otel.ts`, this module still enforces the deadline. Redundant but cheap and independent.
- **removeAllListeners last-wins over explicit handler priority:** Simplest correct approach given the double-registration from stdio + HTTP code paths. Both `src/index.ts` (null-server early) and `src/server.ts` (real http.Server late) call `registerShutdownHooks`; the later call's `removeAllListeners` clears the earlier one.
- **ShutdownLogger structural interface over casting to pino.Logger:** The Winston-to-pino adapter exported from `src/logger.ts` is not a full `pino.Logger` (missing `fatal`, `trace`, `silent`, `msgPrefix`, `level` as a property). Defining a minimal interface in `shutdown.ts` documents the actual contract (info, error, optional flush) and avoids a `pino.Logger` type mismatch without casting.
- **Hooks registered AFTER `--health-check` short-circuit in index.ts:** The probe exits the process before doing anything else; registering signal handlers for a soon-dead process is wasted work.
- **Single async `shutdown(signal)` function driving both SIGTERM and SIGINT:** Identical drain sequence; the signal name flows into the audit log only. Easier to reason about than two parallel handlers.
- **`logger.flush?.()` optional chaining:** pino declares `flush` as optional on the base Logger; tests mock loggers with a simpler shape that may or may not include `.flush`. Optional chaining keeps all test shapes working (Test 5 stdio mode specifically passes a minimal logger).
- **`await new Promise<void>((resolve) => server.close(() => resolve()))`:** server.close fires its callback once all in-flight connections have closed. Awaiting it is how we guarantee the drain actually completes before we proceed to flush logs/OTel.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Narrowed logger type from `pino.Logger` to `ShutdownLogger` structural interface**

- **Found during:** Task 3 (integration with src/index.ts + src/server.ts)
- **Issue:** The plan's `<interfaces>` block specified `import type { Logger } from 'pino';` as the logger parameter type. However, `src/logger.ts` exports a Winston-to-pino adapter object that is NOT a full `pino.Logger` — it's missing `fatal`, `trace`, `silent`, and `msgPrefix`. Passing the adapter to `registerShutdownHooks(server, logger)` from both `src/index.ts(74)` and `src/server.ts(707)` produced `TS2345: Argument of type '...' is not assignable to parameter of type 'Logger'` errors. Both call sites are legitimate — we're just missing a type-system bridge between the adapter and pino's native type.
- **Fix:** Defined `ShutdownLogger` interface inside `src/lib/shutdown.ts` with the minimal contract we actually use (`info`, `error`, `flush?`). Arguments typed as `unknown` so both pino's native `(obj, msg)` and the adapter's overloaded `(arg1, arg2?)` shape validate. Export the interface so future callers can type-check their own logger shims.
- **Files modified:** `src/lib/shutdown.ts`
- **Commit:** 22ab859
- **Why Rule 1, not Rule 2:** The type annotation was a bug in the plan's example code that would have failed to compile at the call sites — not "missing functionality". Any plan with this example pasted verbatim would have produced the same error.

**2. [Rule 3 — Blocking issue] Worktree missing `src/generated/client.ts`**

- **Found during:** Task 3 full regression run (carrying over the same issue noted in plan 01-04's summary)
- **Issue:** `src/generated/client.ts` is gitignored and regenerated by `npm run generate`. The fresh worktree is missing it, causing 11 tests to fail with "Cannot find module '../src/generated/client.js'" (errors emerge from `src/graph-tools.ts:5` and `src/lib/tool-schema.ts:3`). These failures were NOT caused by this plan's changes — they exist in any fresh worktree without a generate step and are documented in plan 01-04's summary.
- **Fix:** Copied the generated file from the main repo clone (`cp /home/yui/Documents/ms-365-mcp-server/src/generated/client.ts ./src/generated/client.ts`) so the regression suite could run. This file is gitignored and NOT committed; the orchestrator merge retains main-repo state.
- **Files modified:** None committed (copied file is gitignored).
- **Commit:** N/A.
- **Scope note:** Out-of-scope for this plan's functional changes but was blocking Rule 3 verification of "full suite green".

### Plan-following deviations

None — plan executed as written (aside from the Rule 1 and Rule 3 items above).

## Cross-Plan Dependencies

- **01-02 provided:** pino logger with `.flush` method and `otel.shutdown()` with its own 10s Promise.race wrap. This plan's shutdown handler CALLS both.
- **01-03 provided:** Dockerfile `STOPSIGNAL SIGTERM` directive so `docker stop` routes through tini PID 1 to the Node process's SIGTERM handler. Without STOPSIGNAL, Docker defaults to SIGKILL, bypassing this handler entirely.
- **01-04 provided:** `setDraining`/`isDraining` from `src/lib/health.ts`. This plan's handler flips `setDraining(true)` FIRST so `/readyz` returns 503 while draining — the load-balancer-friendly signal that in-flight requests should finish but no new traffic should arrive.
- **Phase 3 will consume:** This shutdown handler will be extended to include per-tenant token-cache flush + MSAL pool drain. The current handler accepts a single `server` + single `logger`; Phase 3 may introduce a registry of drain hooks (one per tenant or one per subsystem).
- **Phase 6 will consume:** Per-tenant rate-limit counter flush will be added to the drain sequence.

## Threat Model Compliance

From plan 01-05 `<threat_model>`:

| Threat ID | Category | Disposition | Mitigation Verified |
|-----------|----------|-------------|---------------------|
| T-01-05a | DoS (Docker HEALTHCHECK restart mid-drain) | accept (by design) | /healthz stays 200 during drain (plan 01-04 Test 1); /readyz flips via setDraining (plan 01-04 Test 3). STOPSIGNAL SIGTERM present (plan 01-03 Test 6) so the handler actually runs. This plan's Test 1 asserts setDraining(true) is called. End-to-end cross-plan wiring verified. |
| T-01-05b | DoS (OTel exporter hang blocking exit) | mitigate | `Promise.race([otel.shutdown(), 10s timeout])` in shutdown.ts; on reject, logs the failure and proceeds to exit. Test 7 exercises the hanging-collector scenario with fake timers and asserts exit(0) still runs. |
| T-01-05c | Info Disclosure (incomplete log flush) | mitigate | `logger.flush?.()` wrapped in try/catch. pino v10 is synchronous for the stdout destination, so the flush completes before exit. File-transport flush deferred to Phase 3 (documented — multi-tenant deployments rarely use file logs). |
| T-01-05d | Tampering (double-signal re-entry) | mitigate | `if (isDraining()) return;` at handler entry. Test 6 asserts server.close is called only once across two consecutive SIGTERM invocations. |

All four dispositions honored at the code level.

## Cross-references

- **01-03 STOPSIGNAL SIGTERM** forwards Docker stop to this handler
- **01-04 setDraining** state flipped FIRST in the drain sequence
- **01-02 pino logger .flush + otel.shutdown** are the subsystems flushed
- **Plan 01-05 `<threat_model>` T-01-05a through T-01-05d** dispositions verified by Tests 1–7

## Deferred Items

- **File-transport flush on shutdown:** Phase 3 may add explicit flushSync for the file-transport path when `MS365_MCP_LOG_DIR` is set. The current default-level contract is stdout-only; file logs are an operator opt-in and, per plan 01-02, read-only rootfs containers may not have the directory at all.
- **Per-tenant shutdown hooks:** Phase 3 tenant pool will introduce a registry of drain hooks. This handler's `registerShutdownHooks(server, logger)` signature is stable enough to let Phase 3 add an optional third parameter or a side-registration API without breaking callers.
- **Operator-adjustable OTEL_SHUTDOWN_TIMEOUT_MS:** Phase 2+ can reopen the env-override question for the OTel race ceiling. Phase 1 keeps it fixed at 10s for opinionated safety.
- **Manual smoke tests:** `docker stop` + `kill -TERM` behavioral verification under a real container runtime is documented in `01-VALIDATION.md § Manual-Only Verifications` and stays deferred to Phase 1 end-of-phase smoke. Automated Vitest tests cover the in-process drain semantics; kernel-level signal delivery is outside the test scope.

## Success Criteria Check

- [x] `src/lib/shutdown.ts` exports `registerShutdownHooks`.
- [x] SIGTERM + SIGINT both registered.
- [x] `isDraining()` guard at handler entry ensures idempotency.
- [x] `server.close()` awaited (skipped if server is null).
- [x] `logger.flush?.()` runs in a try/catch.
- [x] `otel.shutdown()` wrapped in Promise.race with 10s timeout.
- [x] `process.exit(0)` on clean completion.
- [x] 25s failsafe deadline via `setTimeout.unref()` → `process.exit(1)` if exceeded.
- [x] `MS365_MCP_SHUTDOWN_GRACE_MS` env override honored.
- [x] `src/server.ts` binds `app.listen` return and calls `registerShutdownHooks(httpServer, logger)`.
- [x] `src/index.ts` calls `registerShutdownHooks(null, logger)` after --health-check short-circuit.
- [x] `removeAllListeners` guard prevents double-registration from stdio + HTTP paths.
- [x] All 8 tests in `test/graceful-shutdown.test.ts` pass.
- [x] Full regression suite (233/233) passes.
- [x] `npm run build` succeeds (dist/lib/shutdown.js emitted at 1.53KB).

## Package Changes

None — this plan uses only existing dependencies (pino v10 from 01-02, http from node builtins, health + otel modules from 01-04 + 01-02).

## Self-Check

Files exist (in worktree):
- `src/lib/shutdown.ts`: FOUND
- `test/graceful-shutdown.test.ts`: FOUND
- `.planning/phases/01-foundation-hardening/01-05-SUMMARY.md`: FOUND (this file)

Commits exist:
- `5a39b87`: FOUND (test(01-05): add failing RED tests for SIGTERM/SIGINT drain + 10s OTel race + idempotency)
- `f115423`: FOUND (feat(01-05): implement src/lib/shutdown.ts with 25s drain + 10s OTel race + idempotent guard)
- `22ab859`: FOUND (feat(01-05): wire registerShutdownHooks in server.ts (HTTP) and index.ts (stdio))

Source assertions:
- `grep registerShutdownHooks src/server.ts`: FOUND (line 23 import, line 707 call)
- `grep registerShutdownHooks src/index.ts`: FOUND (line 12 import, line 74 call)
- `grep removeAllListeners src/lib/shutdown.ts`: FOUND (lines 130, 131)

TDD gate compliance:
- RED gate: `5a39b87` test(01-05) — PRESENT
- GREEN gate: `f115423` feat(01-05) — PRESENT (after RED)
- REFACTOR gate: N/A (implementation was minimal; Task 3 wiring extended behavior to integration but did not refactor internal structure)

## Self-Check: PASSED

---

*Phase: 01-foundation-hardening*
*Completed: 2026-04-18*
