---
phase: 01-foundation-hardening
plan: "01"
subsystem: infra
tags: [node22, platform, ci, dockerfile, typescript, vitest]

requires: []
provides:
  - Node 22 LTS baseline: package.json engines.node ">=20 <23"
  - CI matrix narrowed to Node 20 + 22 (Node 18 dropped)
  - Dockerfile builder + release stages unified on node:22-alpine
  - tsconfig target bumped to ES2022
  - test/setup.ts Node 18 File/Blob polyfill removed
  - Wave 0 RED/GREEN test stubs: test/node22-baseline.test.ts + test/engines.test.ts
affects:
  - 01-02 (pino/OTel — assumes Node 22 streams API)
  - 01-03 (Dockerfile hardening — layers on top of node:22-alpine)
  - 01-05 (graceful shutdown — native AbortSignal.timeout from Node 22)
  - all downstream plans that assumed Node 22 built-ins (File, Blob, structuredClone)

tech-stack:
  added: []
  patterns:
    - "Wave 0 TDD: write RED test stubs before implementation, then GREEN"
    - "Static-grep test pattern: read source file via fs.readFileSync inside test, assert absence of banned patterns"

key-files:
  created:
    - test/node22-baseline.test.ts
    - test/engines.test.ts
  modified:
    - package.json
    - .github/workflows/build.yml
    - Dockerfile
    - tsconfig.json
    - README.md
    - test/setup.ts
    - package-lock.json

key-decisions:
  - "engines.node set to >=20 <23 (explicit upper bound avoids accidental Node 24+ installs before v2 tests that range)"
  - "Dockerfile uses floating node:22-alpine tag (not pinned patch) — plan 01-03 may tighten to digest if needed"
  - "tsconfig target ES2022 chosen over ES2023 (conservative; matches eslint ecmaVersion: 2022)"
  - "Pre-existing test failures in src/__tests__/graph-tools.test.ts are out of scope — caused by missing src/generated/client.js (needs npm run generate)"

patterns-established:
  - "Static-grep test pattern: assert source-text absence of banned code patterns via fs.readFileSync inside vitest"
  - "Wave 0 RED before implementation: test stubs committed first (fail), then implementation makes them GREEN"

requirements-completed:
  - FOUND-01

duration: 15min
completed: 2026-04-18
---

# Phase 1 Plan 01: Node 22 LTS Baseline Migration Summary

**package.json engines.node `>=18` -> `>=20 <23`; CI matrix `[18.x,20.x,22.x]` -> `[20.x,22.x]`; Dockerfile builder+release unified on `node:22-alpine`; tsconfig target `ES2020` -> `ES2022`; Node 18 File/Blob polyfill removed from test/setup.ts**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-18T16:17:00Z
- **Completed:** 2026-04-18T16:23:23Z
- **Tasks:** 4
- **Files modified:** 8 (test/node22-baseline.test.ts, test/engines.test.ts, package.json, .github/workflows/build.yml, Dockerfile, tsconfig.json, README.md, test/setup.ts + package-lock.json)

## Accomplishments

- Node 22 LTS baseline consistently declared across package.json, CI, Dockerfile, and tsconfig
- Node 18 EOL supply-chain risk resolved (T-01-09 threat mitigated)
- Wave 0 RED/GREEN test stubs established for FOUND-01 verification (both files green post-implementation)
- test/setup.ts cleaned of the Node 18 File/Blob polyfill; vitest setupFiles hook retained for future use
- tsconfig target bumped to ES2022 (enables private class fields, top-level await, error.cause, Object.hasOwn)

## Task Commits

1. **Task 1: Wave 0 RED test stubs** — `f67fe54` (test)
2. **Task 2: Remove Node 18 polyfill from test/setup.ts** — `1476bd1` (feat)
3. **Task 3: Bump engines/CI/Dockerfile/tsconfig/README** — `09f2376` (feat)
4. **Task 4: Smoke-test + lockfile normalization** — `5837bfd` (chore)

## Files Created/Modified

- `test/node22-baseline.test.ts` — Wave 0: asserts File/Blob native globals + no polyfill in setup.ts
- `test/engines.test.ts` — Wave 0: asserts engines.node regex matches `>=20 <23`, process.version >= 20
- `test/setup.ts` — Removed Node 18 File/Blob polyfill; body is now comment-only
- `package.json` — `engines.node`: `>=18` → `>=20 <23`
- `.github/workflows/build.yml` — `node-version`: `[18.x, 20.x, 22.x]` → `[20.x, 22.x]`
- `Dockerfile` — builder: `node:24-alpine` → `node:22-alpine`; release: `node:20-alpine` → `node:22-alpine`
- `tsconfig.json` — `target`: `ES2020` → `ES2022`
- `README.md` — Prerequisites: "Node.js >= 20 (recommended) / 14+" → "Node.js 20 LTS or Node.js 22 LTS (recommended)"
- `package-lock.json` — Normalized: added `zod-to-json-schema` to packages metadata, removed stale `tsup/node_modules/yaml` entry

## Decisions Made

- **engines upper bound `<23`**: Explicit upper bound prevents accidental Node 24+ installs until v2 is tested against Node 24. The `>=20 <23` pin follows the plan's ">=20 <23" exact string requirement.
- **Floating `node:22-alpine` tag**: Plan 01-03 owns Dockerfile hardening (USER, tini, HEALTHCHECK, OCI labels). Keeping a floating tag means security patches flow in automatically; 01-03 can tighten to a digest if desired.
- **ES2022 target**: Conservative choice vs ES2023 — matches existing `eslint ecmaVersion: 2022` setting; enables `Error.cause`, `Object.hasOwn`, `at()`, private fields without introducing any Node 22-only ES2023 features that could surprise.
- **Pre-existing test failures are out of scope**: `src/__tests__/graph-tools.test.ts` and several integration tests fail because `src/generated/client.js` is absent (must run `npm run generate`). These failures predate this plan and are not caused by any of our changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated RED test regex to catch TypeScript cast polyfill pattern**
- **Found during:** Task 1 (Wave 0 RED test stubs)
- **Issue:** Initial regex `globalThis\.File\s*=` did not match the TypeScript cast form `(globalThis as { File?: unknown }).File = class File {}` present in setup.ts. The test passed (false GREEN) instead of failing RED.
- **Fix:** Changed regex to `\bFile\s*=\s*class\s+File` which matches the actual assignment expression in the source.
- **Files modified:** test/node22-baseline.test.ts
- **Verification:** Test failed RED (found 1 match) before Task 2 removed the polyfill; passed GREEN after.
- **Committed in:** f67fe54 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test regex)
**Impact on plan:** Necessary for correct RED/GREEN TDD gate. The regex fix is load-bearing for the test's assertion. No scope creep.

## Issues Encountered

- **node_modules absent in worktree**: The git worktree had no `node_modules`. Ran `npm install` before executing any vitest commands. Lockfile drift from this install was committed in Task 4.
- **Node version mismatch**: Running on Node v25.5.0 (not Node 22). The `process.version >= 20` test still passes (25 >= 20). Full Node 22 CI coverage will be provided by the GitHub Actions matrix (`[20.x, 22.x]`).

## Deferred Items

- `src/__tests__/graph-tools.test.ts` and 9 other integration tests fail due to missing `src/generated/client.js` (requires `npm run generate`). Pre-existing condition, not caused by this plan. Will be resolved when the build pipeline runs `npm run generate`.

## Threat Model Coverage

| Threat ID | Mitigation | Status |
|-----------|-----------|--------|
| T-01-09 (DoS/EoP — Node 18 EOL supply chain) | engines.node `>=20 <23`, CI matrix `[20.x,22.x]`, Dockerfile `node:22-alpine` | Mitigated |

## Next Phase Readiness

- Plan 01-02 (pino/OTel stack) can now assume Node 22 stream semantics, native `File`/`Blob`, and `structuredClone` without feature-detecting at runtime.
- Plan 01-03 (Dockerfile hardening) has a stable `node:22-alpine` base to layer USER/tini/HEALTHCHECK on top of.
- Plan 01-05 (graceful shutdown) can use `AbortSignal.timeout()` (Node 17.3+, stable in Node 22).
- All downstream plans: no Node 18 compatibility shims needed going forward.

---
*Phase: 01-foundation-hardening*
*Completed: 2026-04-18*
