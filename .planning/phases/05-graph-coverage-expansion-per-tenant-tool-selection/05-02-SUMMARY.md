---
phase: 05-graph-coverage-expansion-per-tenant-tool-selection
plan: 02
subsystem: infra
tags: [openapi, codegen, graph-beta, __beta__-prefix, churn-guard, snapshot, mcp-sep-986]

# Dependency graph
requires:
  - phase: 05-graph-coverage-expansion-per-tenant-tool-selection
    plan: 01
    provides: Full-surface simplifier + MS365_MCP_FULL_COVERAGE branch + MS365_MCP_USE_SNAPSHOT download policy + deps-injected main() orchestrator
provides:
  - runBetaPipeline async driver (download -> simplify -> codegen -> prefix-inject -> merge -> churn-guard)
  - __beta__ alias prefix on every beta-sourced tool alias (CONTEXT D-18)
  - bin/.last-beta-snapshot.json baseline + churn-guard (MS365_MCP_ACCEPT_BETA_CHURN opt-in)
  - mergeBetaFragmentIntoClient helper (regex-append against makeApi([...]) anchor)
  - runChurnGuard helper (exported for Plan 05-08 coverage-check reuse + direct unit tests)
  - mini-graph-beta.yaml fixture (8 ops incl. one v1 overlap; longest op hits exactly 64-char MCP boundary after prefix)
affects:
  - 05-04 (per-tenant dispatch sees __beta__-prefixed aliases; emits info-level beta log on invocation)
  - 05-05 (tools/list filter sees full alias surface including beta)
  - 05-06 (per-tenant BM25 cache against ~14k-op corpus including beta)
  - 05-07 (admin API selector validation accepts __beta__*:* patterns)
  - 05-08 (coverage harness appends AFTER runBetaPipeline; ordering documented in orchestrator JSDoc)

# Tech tracking
tech-stack:
  added: []   # No new runtime dependencies -- reuses existing js-yaml, fs, child_process, openapi-zod-client via npx
  patterns:
    - "Beta codegen as separate pipeline step invoked only under MS365_MCP_FULL_COVERAGE=1"
    - "Temp fragment file (.client-beta-fragment.ts) + regex-merge into main client.ts; temp unlinked on success"
    - "Post-prefix alias collision guard (new Set().size === arr.length) across v1 + beta combined set"
    - "Length-capped removal preview (<= 10 names) in churn-guard error (T-05-04 bounded output)"
    - "Committed empty baseline shape ({beta_ops:[]}) seeds fresh-checkout runs without a missing-file throw"

key-files:
  created:
    - bin/modules/beta.mjs
    - bin/.last-beta-snapshot.json
    - test/bin/beta.test.mjs
    - test/bin/beta-churn-guard.test.mjs
    - test/fixtures/mini-graph-beta.yaml
  modified:
    - bin/generate-graph-client.mjs
    - test/bin/generate-graph-client.test.mjs

key-decisions:
  - "opts.useSnapshot accepted as first-class option on runBetaPipeline for test-friendly control; propagates to downloadGraphOpenAPI via a scoped env mutation that restores prior value in a finally block -- no stubbing required from callers"
  - "runChurnGuard exported alongside runBetaPipeline so Task 2's unit tests can exercise snapshot-diff semantics without running the full beta codegen; Plan 05-08 can also reuse runChurnGuard for coverage-check thresholds"
  - "Merge anchor regex is `const\\s+endpoints\\s*=\\s*makeApi\\(\\s*\\[...\\]\\s*\\)\\s*;` -- the trailing `;` disambiguates the single makeApi call emitted by openapi-zod-client from any future ref to makeApi inside the schemas block. Verified on real fixture output."
  - "Prefix regex anchored to `[a-z]` first character -- leaves numerics, uppercase, and already-prefixed aliases untouched. Defense-in-depth against upstream casing tricks (T-05-03)."
  - "Rule-3 deviation: updated Plan 05-01 Tests 2 + 3 (test/bin/generate-graph-client.test.mjs) to inject a runBetaPipeline stub. Without the stub, those tests invoke the real defaultRunBetaPipeline (introduced by Task 2 wiring) which triggers a real beta-spec download attempt and would fail with a 64-char limit violation on real devicemanagement ops."

patterns-established:
  - "runBetaPipeline driver shape: async (openapiDir, generatedDir, opts) => { betaCount, aliases } -- testable deps bag + metadata return"
  - "Scoped env mutation pattern: save prev, set, try { run }, finally { restore } -- matches Plan 05-01's vi.stubEnv test pattern for runtime cooperation"
  - "Snapshot baseline convention: committed JSON with beta_ops:[] sentinel so fresh-checkout runs have a diff-target rather than a missing-file throw path"

requirements-completed: [FOUND-02, COVRG-02]

# Metrics
duration: 24min
completed: 2026-04-20
---

# Phase 5 Plan 02: Full Beta Pipeline Module with __beta__ Prefix + Churn Guard Summary

**Beta codegen driver emitting every Microsoft Graph beta tool with a `__beta__` alias prefix (grep-scannable marker), merged into the v1 catalog under MS365_MCP_FULL_COVERAGE=1, with a committed snapshot + opt-in churn guard (MS365_MCP_ACCEPT_BETA_CHURN) that fails the build loudly on silent upstream shrinkage.**

## Performance

- **Duration:** ~24 min
- **Started:** 2026-04-20T12:08:34Z
- **Completed:** 2026-04-20T12:32:53Z
- **Tasks:** 2 (each with RED + GREEN TDD commits)
- **Files modified:** 7 (5 created + 2 modified)

## Accomplishments

- Added `bin/modules/beta.mjs` — `runBetaPipeline(openapiDir, generatedDir, opts?)` driver with the exact 8-step contract from the plan (download, simplify, codegen, post-process + prefix, invariants, merge, churn, write-snapshot).
- `__beta__` alias prefix applied via the pattern-defined regex `(alias:\s*["'])([a-z][^"']*)` → `$1__beta__$2`. Anchored to `[a-z]` so numerics, uppercase, and already-prefixed aliases are never double-prefixed.
- Enforced MCP SEP-986 (64-char tool name limit) and post-prefix collision guards at codegen time; either violation throws with a bounded preview for operator triage.
- Added a committed empty baseline snapshot (`bin/.last-beta-snapshot.json`) so fresh-checkout runs succeed without a "missing file" error; the first CI/dev regen populates it.
- Wired `runBetaPipeline` into `bin/generate-graph-client.mjs` main() under `MS365_MCP_FULL_COVERAGE=1`; documented the Plan 05-08 ordering dependency (runCoverageCheck runs AFTER beta) in the orchestrator's top-of-file comment.
- Authored `mini-graph-beta.yaml` fixture (8 ops covering Copilot, Security Defender, Purview eDiscovery, Intune device mgmt, Entra Governance, plus a /me/messages overlap with the v1 fixture to exercise the collision-resolution path). The `devicemanagement.configurations.getassignedrolescopetags` op was deliberately sized so `__beta__` + base = exactly 64 chars, giving the SEP-986 boundary test a hard assertion without a synthetic string hack.
- 13 new tests across 2 files (5 Task 1, 8 Task 2). `test/bin/` suite: 34/34 green (21 baseline + 13 new).

## Task Commits

Each task followed the RED → GREEN TDD discipline:

1. **Task 1 RED: failing tests for runBetaPipeline + mini beta fixture** — `8c9eb31` (test)
2. **Task 1 GREEN: add runBetaPipeline module + committed snapshot baseline** — `8988ad1` (feat)
3. **Task 2 RED: add churn-guard + orchestrator wiring tests** — `c0b5ba9` (test)
4. **Task 2 GREEN: wire runBetaPipeline into generator orchestrator** — `98bca24` (feat)

## Files Created/Modified

- `bin/modules/beta.mjs` (+243 new) — `runBetaPipeline` (async main driver), `mergeBetaFragmentIntoClient` (regex-append merge), `runChurnGuard` (snapshot-diff + opt-in acceptance). Three exports; internal `writeSnapshot` helper not exported.
- `bin/.last-beta-snapshot.json` (+5 new) — Empty baseline shape `{generated_at:null, beta_count:0, beta_ops:[]}`. First real regen overwrites; subsequent runs diff against it.
- `bin/generate-graph-client.mjs` (+27 / -4) — Import `defaultRunBetaPipeline`; accept `deps.runBetaPipeline`; add Step 4 invocation after `generateMcpTools`; update JSDoc to document `MS365_MCP_ACCEPT_BETA_CHURN` + Plan 05-08 ordering.
- `test/fixtures/mini-graph-beta.yaml` (+180 new) — 8 beta ops + 6 schemas; deliberate 64-char boundary op included.
- `test/bin/beta.test.mjs` (+195 new) — 5 tests exercising the full runBetaPipeline end-to-end against real openapi-zod-client output.
- `test/bin/beta-churn-guard.test.mjs` (+228 new) — 8 tests split into two suites: 6 runChurnGuard direct unit tests + 2 orchestrator wiring tests.
- `test/bin/generate-graph-client.test.mjs` (+9 / -0) — Added `runBetaPipeline: async () => ({betaCount:0, aliases:[]})` stub to Plan 05-01 Tests 2 + 3 so they exercise the upstream orchestrator changes without triggering the real beta codegen (Rule-3 deviation; see below).

## Decisions Made

- **`opts.useSnapshot` as an explicit runBetaPipeline option** — added alongside the env-var pathway so tests can scope snapshot-mode to a single invocation without polluting process.env across describe blocks. Implementation uses a try/finally to save-and-restore the original env value, which is robust against vitest's `vi.stubEnv` too.
- **Merge anchor includes the trailing `;`** — `const endpoints = makeApi([ ... ]);`. The `;` is critical: without it, the regex could theoretically match an intermediate `makeApi` reference (none today, but defensive). Verified against real `openapi-zod-client` 1.18.3 output on both the mini-v1 and mini-beta fixtures.
- **runChurnGuard exported** — the plan noted this could be internal; I exported it anyway because (a) Task 2's unit tests exercise it without running the full pipeline, avoiding brittle end-to-end spawn tests, and (b) Plan 05-08 (coverage harness) will reuse the same snapshot-diff pattern for v1 regression tolerance.
- **Prefix regex left unchanged from 05-PATTERNS.md line 491** — `(alias:\s*["'])([a-z][^"']*)`. The `[a-z]` anchor is deliberate — it avoids double-prefixing if a future version of `openapi-zod-client` emits aliases like `"MyUpperCaseAlias"` (the regex would skip them, which is correct — they don't match any Graph operationId pattern the beta pipeline would touch).
- **`MS365_MCP_USE_SNAPSHOT` honored for beta too** — beta download uses the same helper (`downloadGraphOpenAPI`) as v1; the snapshot-first policy applies uniformly. This was implicit in the plan but important because a CI environment that has `openapi-beta.yaml` cached can skip the 65MB network fetch.

## Deviations from Plan

### Rule 3 (blocking issue): Plan 05-01 Tests 2 + 3 broke after Task 2 wiring

- **Found during:** Running full `test/bin/` suite after Task 2 GREEN commit.
- **Issue:** Adding the Step-4 `runBetaPipeline` invocation to `main()` meant any caller passing `FULL_COVERAGE=1` without a `deps.runBetaPipeline` stub now triggers the REAL `defaultRunBetaPipeline`. Plan 05-01 Tests 2 + 3 only stubbed `generateMcpTools` and `simplifiers` — so the test tried to download the real 65MB beta spec (or, with `MS365_MCP_USE_SNAPSHOT=1` active, tried to run `openapi-zod-client` against the v1 fixture copied into `openapi-beta.yaml` path, producing aliases far exceeding the 64-char MCP limit).
- **Fix:** Added `runBetaPipeline: async () => ({ betaCount: 0, aliases: [] })` to the deps bag in both Test 2 and Test 3. No assertion changes.
- **Files modified:** `test/bin/generate-graph-client.test.mjs`
- **Commit:** `98bca24` (folded into Task 2 GREEN since the wiring change and the test fix are inseparable).
- **Why Rule 3:** This is a "blocking issue" — my own Task 2 change caused the previously-passing Plan 05-01 tests to fail. No architectural change required; the fix is mechanical (add a stub to match the expanded deps contract).

### Observations / minor tactical choices (not deviations per se)

1. **Added an extra Test 4b** to `beta-churn-guard.test.mjs` to cover the "preview capped at 10 names" T-05-04 mitigation explicitly. The plan called this out in the threat register but didn't enumerate it as a distinct test; I added it because the bounded-output property is exactly what keeps operator triage tractable when Microsoft does a large upstream cleanup.
2. **Added Test 4c** for the "missing snapshot file" fresh-checkout path. The plan's Task 1 Test 5 covered this via `runBetaPipeline`, but the standalone `runChurnGuard` test is faster and isolates the branch for future refactors.
3. **Fixture's longest op** sized to hit exactly 64 chars post-prefix — this is a deliberate test-asset design choice. It gives Test 2 a concrete boundary assertion (`boundary.length).toBeLessThanOrEqual(64)` specifically on the known-long op) rather than a statistical "all aliases under 64" without a witness.

## Issues Encountered

- **Vitest runtime quiet-noise:** `createAndSaveSimplifiedOpenAPIFullSurface` logs `console.log` calls extensively during its allOf/anyOf flattening pass. Running the full `test/bin/` suite produces ~1MB of console output. Tests still pass; the noise just obscures failures in the terminal. Used `--silent` flag for verification runs. No code changes needed — this is existing simplifier behavior that Plan 05-01 inherited.
- **Full-repo baseline regressions:** The broader `npx vitest run` shows ~70 pre-existing failures in auth/oauth/audit/graph-batch/tool-filtering/etc. test files. I verified with a `git stash` + re-run that these failures exist WITHOUT my changes (70 baseline → 69 with my changes; net zero new regressions and one non-reproducible flake). All `test/bin/` tests pass (34/34).

## Threat Mitigation

| Threat ID | Status | Evidence |
|-----------|--------|----------|
| T-05-03 (Tampering: upstream bait-and-switch alias collision) | Mitigated | Prefix regex anchored to `[a-z]` leaves non-lowercase aliases untouched; Set-size invariant + combined v1/beta uniqueness check throw on any post-prefix collision. Task 1 Tests 1, 3, 4 cover the three legs (prefix application, no-dup invariant, expected-overlap resolution). |
| T-05-03c (Tool-name 64-char violation) | Mitigated | `MCP_TOOL_NAME_MAX = 64` enforced in `runBetaPipeline`; violation throws with bounded preview (up to 5 names + count). Task 1 Test 2 pins the 64-char boundary using the deliberately-long fixture op. |
| T-05-04 (DoS: silent feature loss via upstream shrinkage) | Mitigated | `runChurnGuard` throws on ANY removal unless `MS365_MCP_ACCEPT_BETA_CHURN=1`. Exit message lists up to 10 aliases + "and N more" tail; only committed snapshot aliases (not raw upstream content) appear in stderr. Task 2 Tests 1, 2, 4b cover fail-closed, accept-pathway, and bounded-preview. |
| T-05-03b (Info disclosure: beta feature exposure at runtime) | Accept-transfer | Handled in Plan 05-04 (per-tenant enabled_tools opt-in) + Plan 05-07 (admin API validation). This plan's contribution: the `__beta__` prefix makes such tools grep-scannable in logs/audit rows, and info-level pino logs in Plan 05-04 dispatch key on the prefix. |

## Assumptions

- **A1 (openapi-zod-client on real beta spec):** The mini fixture exercises the prefix regex and merge logic, but the plan's success-truth "14,000 ops in client.ts when real specs staged" depends on `openapi-zod-client` completing on the ~65MB beta YAML within the heap budget. Operator-verified at first real regen; if A1 fails, the mitigation is the same as Plan 05-01 (raise `NODE_OPTIONS=--max-old-space-size=8192` or chunk by workload). Plan 05-01 A1 reference applies.
- **A2 (real beta spec has no alias collisions post-prefix):** The fixture's `/me/messages` overlap exercises the collision-resolution happy path. On real data, the invariant is `no two __beta__X identical AND no X matches v1 Y where __beta__X == __beta__Y`. The former is automatically satisfied (the prefix is injected uniformly); the latter is guaranteed because stripping `__beta__` from a beta alias cannot produce `__beta__Y` without introducing a `__beta__` into the stripped form, which is impossible given the regex anchor.
- **A3 (MCP SEP-986 on real ops):** The longest known Microsoft Graph beta operationId I could find via msgraph-metadata grep is ~55-60 chars; `__beta__` adds 8. If an upstream op exceeds 64 post-prefix, the pipeline fails loudly with the offending alias list — operators must either wait for Microsoft to shorten (unlikely) OR the plan author ships a per-workload shortening policy (scoped to Plan 05-02 follow-up work, not today).

## User Setup Required

None — no external service configuration required. The churn-guard acceptance env var is documented in `.env.example` (region:phase5-codegen, added by Plan 05-01). Operators running the full-coverage regen should set:

```
NODE_OPTIONS=--max-old-space-size=8192 \
MS365_MCP_FULL_COVERAGE=1 \
npm run generate
```

After reviewing the generated `bin/.last-beta-snapshot.json` diff, if previously-known ops have disappeared and the drop is expected, re-run with:

```
MS365_MCP_ACCEPT_BETA_CHURN=1 \
MS365_MCP_FULL_COVERAGE=1 \
npm run generate
```

## Self-Check: PASSED

Files verified (all present in worktree and tracked by git):
- `bin/modules/beta.mjs` (created, `runBetaPipeline` + `mergeBetaFragmentIntoClient` + `runChurnGuard` exported — grep-verified all three `export` tokens).
- `bin/.last-beta-snapshot.json` (created, empty baseline `{beta_count:0, beta_ops:[]}` committed).
- `bin/generate-graph-client.mjs` (modified, `defaultRunBetaPipeline` import at line 59, Step-4 invocation at lines 136-141 — grep-verified).
- `test/fixtures/mini-graph-beta.yaml` (created, 8 paths verified via manual count: /me/messages, /copilot/chats, /security/alerts_v2, /compliance/ediscovery/cases, /deviceManagement/deviceConfigurations, /deviceManagement/deviceConfigurations/{id}, /identityGovernance/accessReviews/definitions, /deviceManagement/deviceConfigurations/{id}/assignedRoleScopeTags = 8).
- `test/bin/beta.test.mjs` (created, 5 tests).
- `test/bin/beta-churn-guard.test.mjs` (created, 8 tests).
- `test/bin/generate-graph-client.test.mjs` (modified, 2 tests got runBetaPipeline stub).

Commits verified in `git log`:
- `8c9eb31` (test/05-02 Task 1 RED)
- `8988ad1` (feat/05-02 Task 1 GREEN)
- `c0b5ba9` (test/05-02 Task 2 RED)
- `98bca24` (feat/05-02 Task 2 GREEN)

Test run evidence: `npx vitest run test/bin/ --silent` → 34 PASS, 0 FAIL (10.4s).
Plan 05-02 subset: 13 new tests across 2 files, all green.

TDD gate compliance:
- `test(05-02)` commits precede `feat(05-02)` commits for both tasks → RED → GREEN discipline respected.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns at trust boundaries, or schema changes beyond what the plan's `<threat_model>` captured. The bin/ layer is build-time-only and does not introduce runtime attack surface.

## TDD Gate Compliance

Each task has matched test→feat commit pairs:
- Task 1: `8c9eb31` (test) → `8988ad1` (feat)
- Task 2: `c0b5ba9` (test) → `98bca24` (feat)

No refactor commits were needed — both GREEN implementations passed invariants in their first iteration after RED was confirmed failing.

## Next Phase Readiness

Ready to spawn Plan 05-03 (default essentials preset). The generated `client.ts` will carry both v1 and `__beta__`-prefixed aliases when full-coverage is enabled; Plan 05-03's preset compiler can match against the full alias surface. The orchestrator's ordering contract (generateMcpTools → runBetaPipeline → [future] runCoverageCheck) is documented in the top-of-file JSDoc.

Blockers: none. A1 (openapi-zod-client on real ~65MB beta spec) is operator-verified at first regen; if heap exhaustion occurs, the mitigation is the same NODE_OPTIONS flag documented for Plan 05-01.

---
*Phase: 05-graph-coverage-expansion-per-tenant-tool-selection*
*Completed: 2026-04-20*
