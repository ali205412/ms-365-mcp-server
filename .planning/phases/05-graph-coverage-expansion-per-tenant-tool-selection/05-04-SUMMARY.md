---
phase: 05-graph-coverage-expansion-per-tenant-tool-selection
plan: 04
subsystem: tool-selection
tags:
  [
    selector-ast,
    enabled-tools-parser,
    registry-validator,
    dispatch-guard,
    loadTenant,
    request-context,
    tenant-isolation,
    TENANT-08,
  ]

# Dependency graph
requires:
  - phase: 05-graph-coverage-expansion-per-tenant-tool-selection
    plan: 03
    provides: preset-loader.presetFor() + DEFAULT_PRESET_VERSION + PRESET_VERSIONS map —
      enabled-tools-parser.computeEnabledToolsSet() seeds additive selectors from
      presetFor(preset_version) per D-20; NULL input resolves via the same path

provides:
  - src/lib/tool-selection/selector-ast.ts — pure parseSelectorList with
    character-whitelist regex rejection (T-05-07); exports Selector +
    SelectorKind discriminated union
  - src/lib/tool-selection/enabled-tools-parser.ts — computeEnabledToolsSet
    (D-20 5-step construction) + ensureEnabledToolsSet (WeakMap<Request>
    per-request memoization)
  - src/lib/tool-selection/registry-validator.ts — validateSelectors with
    fastest-levenshtein suggestions (cap 3, distance ≤ 3); SelectorZod;
    getRegistryAliases() + getWorkloadPrefixes() exports
  - src/lib/tool-selection/dispatch-guard.ts — pure checkDispatch returning
    null on pass or CallToolResult rejection with D-20 envelope; globalThis-
    backed setStdioFallback / _getStdioFallbackForTest (Pitfall 8)
  - src/lib/tool-selection/tenant-context-middleware.ts —
    createSeedTenantContextMiddleware factory that wraps next() in
    requestContext.run() with the tenant triple for auth-middleware spread-
    copy propagation
  - src/request-context.ts — extended RequestContext with enabledToolsSet +
    presetVersion; new getRequestTenant() helper
  - src/lib/tenant/load-tenant.ts — attachTenantWithEnabledSet helper +
    TenantRowWithEnabledSet type; req.tenant.enabled_tools_set populated
    on both DB miss and cache hit paths
  - src/graph-tools.ts executeGraphTool — dispatch gate runs BEFORE
    account-token resolution; pino info log on __beta__* invocation
  - src/server.ts — seedTenantContext mounted BEFORE authSelector on
    /t/:tenantId/sse|messages|mcp routes
  - src/index.ts stdio bootstrap — setStdioFallback registered with
    tenant-row-computed set (--tenant-id mode) or permissive full-registry
    set (legacy mode, Pitfall 8)

affects:
  - 05-05 (tools/list filter — reads the same req.tenant.enabled_tools_set
    + requestContext for tool-list interception)
  - 05-06 (discovery BM25 cache keyed on sha256 of sorted enabled_tools_set)
  - 05-07 (admin PATCH — validateSelectors before persist; publish
    invalidation on mutation)
  - 05-08 (coverage harness reads full registry; unaffected by per-tenant
    dispatch gate)

# Tech tracking
tech-stack:
  added:
    - 'fastest-levenshtein@^1.0.16 — O(n*m/32) edit distance for selector
      typo suggestions in registry-validator.topSuggestions'
  patterns:
    - 'Module-load registry snapshot (REGISTRY_ALIASES / WORKLOAD_PREFIXES
      / PRESET_NAMES) frozen at import time; no runtime mutation'
    - 'Frozen Set<string> as the tenant-scoped dispatch surface; WeakMap<
      Request, ReadonlySet<string>> for per-request memoization'
    - "AsyncLocalStorage RequestContext extended with tenant triple
      (tenantId + enabledToolsSet + presetVersion); getRequestTenant()
      helper surfaces the triple for executeGraphTool without touching
      req.tenant directly (stdio mode has no Express request)"
    - 'globalThis-backed stdio fallback via Symbol.for() key — survives
      vi.resetModules() in tests that hot-reload graph-tools'
    - 'Tenant-context middleware layered BEFORE auth middlewares — spread-
      copy propagation through existing requestContext.run() frames means
      03-06 auth code path stays untouched'

key-files:
  created:
    - src/lib/tool-selection/selector-ast.ts
    - src/lib/tool-selection/enabled-tools-parser.ts
    - src/lib/tool-selection/registry-validator.ts
    - src/lib/tool-selection/dispatch-guard.ts
    - src/lib/tool-selection/tenant-context-middleware.ts
    - src/generated/client.ts (BOOTSTRAP STUB — gitignored; .gitignore at
      line 149 already covered, so no leak)
    - test/tool-selection/selector-parser.test.ts
    - test/tool-selection/enabled-tools-parser.test.ts
    - test/tool-selection/registry-validator.test.ts
    - test/tool-selection/dispatch-guard.test.ts
    - test/tool-selection/dispatch-enforcement.int.test.ts
    - test/tool-selection/dispatch-two-tenant.int.test.ts
    - test/tool-selection/load-tenant-enabled-tools-set.test.ts
  modified:
    - src/request-context.ts — RequestContext + getRequestTenant()
    - src/lib/tenant/load-tenant.ts — attachTenantWithEnabledSet helper
    - src/graph-tools.ts — dispatch gate + beta log in executeGraphTool
    - src/server.ts — seedTenantContext wire-up on 4 tenant routes
    - src/index.ts — stdio bootstrap setStdioFallback registration
    - package.json + package-lock.json — fastest-levenshtein dep
    - test/setup.ts — PermissiveSet fallback for legacy tests

key-decisions:
  - 'globalThis-backed stdio fallback via Symbol.for() key — module-level
    `let stdioFallback` was lost through vi.resetModules() in
    src/__tests__/graph-tools.test.ts, causing 13 pre-existing tests to
    start rejecting. Global store survives resets without polluting module
    internals.'
  - 'Permissive test fallback via PermissiveSet (extends Set, overrides
    .has()) rather than Proxy — Proxy on Set.prototype.size fails with
    "incompatible receiver" because the size getter is not installed on
    the Proxy. Subclass sidesteps the invariant while preserving every
    Set API the guard might consult.'
  - "Tenant-context middleware layered BEFORE authSelector — Plan 05-04
    could have extended the 03-06 auth middleware's own requestContext.run
    calls to include tenant fields, but that would spread the tenant-triple
    concern across bearer-middleware + auth-selector + legacy-HTTP paths.
    Seeding ONCE before authSelector lets the spread-copy pattern
    (`...existing, accessToken, ...`) propagate the triple automatically
    to every auth flow."
  - 'Workload classifier inlined in enabled-tools-parser.ts rather than
    imported from registry-validator.ts — the two modules would otherwise
    form a circular import (registry-validator imports selector-ast, but
    enabled-tools-parser imports both). Duplication is a stable 7-line
    function; a shared helper module adds more module graph surface than
    it removes.'
  - 'Legacy stdio mode (no --tenant-id) registers a PERMISSIVE fallback
    covering the full registered tool surface — this preserves v1
    backwards compatibility (the existing `--enabled-tools` regex filter at
    registerGraphTools time is the real gate in legacy mode). Dispatch-
    guard exists but does not enforce additional narrowing in legacy stdio.'
  - 'registry-validator parses malformed input (e.g. `<script>`) as INVALID
    with empty suggestions rather than running Levenshtein on the bad input
    — prevents the validator from accidentally auto-fixing an injection
    attempt with a "helpful" suggestion the admin might then copy.'

patterns-established:
  - 'PermissiveSet subclass pattern for test-only "allow everything"
    Sets — used in test/setup.ts to register a universal stdio fallback
    so legacy test files that predate Plan 05-04 continue to work without
    per-test requestContext seeding.'
  - 'globalThis + Symbol.for() pattern for module-state that must survive
    hot-reload — reuse for any future module that tests may reset via
    vi.resetModules() and still needs shared state.'
  - 'Seed-then-authenticate middleware layering — when existing middlewares
    own their own requestContext.run() calls with spread-copy, extend by
    adding a SEED middleware BEFORE them rather than modifying their
    internal context shape.'

requirements-completed: [TENANT-08]

# Metrics
duration: 32min
completed: 2026-04-20
---

# Phase 5 Plan 04: Selector Parser + enabled_tools_set + Dispatch Enforcement (TENANT-08) Summary

**Ships the per-tenant tool-selection substrate — a pure AST parser turning tenants.enabled_tools text into a frozen ReadonlySet<string>, a dispatch guard that rejects disabled tools with an MCP tool error (not HTTP 403), loadTenant middleware attachment, AsyncLocalStorage-backed tenant triple propagation, Levenshtein-ranked selector validation with fastest-levenshtein, and a globalThis-backed stdio fallback that survives vi.resetModules() — plumbed end-to-end through HTTP (server.ts seedTenantContext) and stdio (index.ts bootstrap) so executeGraphTool can enforce tenant isolation at every tool invocation.**

## Performance

- **Duration:** ~32 min (including two RED/GREEN cycles + Proxy→subclass fallback fix + globalThis persistence fix for vi.resetModules)
- **Started:** 2026-04-20T13:08:58Z (worktree base verified at f3fa8ed)
- **Completed:** 2026-04-20T13:41:00Z
- **Tasks:** 2 (each with RED + GREEN TDD commits)
- **Files created:** 13 (6 source + 7 test files; src/generated/client.ts stub gitignored)
- **Files modified:** 7 (5 source + 1 test/setup + package.json pair)

## Accomplishments

- **Selector AST (`src/lib/tool-selection/selector-ast.ts`, 95 lines):** `parseSelectorList(text)` emits a `Selector[]` discriminated union across 6 kinds (workload / op / preset × regular / additive). Character whitelist `/^[a-zA-Z0-9_\-:.*+]+$/` rejects every off-list char (HTML, SQL, shell operators, null bytes, unicode homoglyphs). Explicit `;` separator error message targets the most common operator mistake. Empty / whitespace-only input returns `[]`; empty-body selectors throw.
- **Enabled-tools parser (`src/lib/tool-selection/enabled-tools-parser.ts`, 154 lines):** `computeEnabledToolsSet(text, presetVersion)` implements the D-20 5-step construction order — empty Set → additive-preset-seed-if-any-"+" → selector-expand → freeze. `NULL` input resolves to `presetFor(preset_version)`; empty string resolves to a frozen empty Set. `ensureEnabledToolsSet(req, text, presetVersion)` adds WeakMap<Request> per-request memoization so the middleware chain never re-parses.
- **Registry validator (`src/lib/tool-selection/registry-validator.ts`, 158 lines):** `REGISTRY_ALIASES` + `WORKLOAD_PREFIXES` + `PRESET_NAMES` built ONCE at module load from the generated client + PRESET_VERSIONS map; all three are frozen. `validateSelectors(selectors)` walks the parsed AST; on any unknown selector, ranks up to 3 Levenshtein suggestions (distance ≤ 3) via `fastest-levenshtein@1.0.16`. Malformed input (charset / grammar violation) returns `{ok: false, invalid: original, suggestions: {}}` without Levenshtein — prevents auto-"fixing" injection attempts.
- **Dispatch guard (`src/lib/tool-selection/dispatch-guard.ts`, 163 lines):** Pure `checkDispatch(alias, set, tenantId, preset)` returns `null` on pass, or a `CallToolResult`-shaped rejection envelope with verbatim D-20 payload (`{error: 'tool_not_enabled_for_tenant', tool, tenantId, hint, enabled_preset_version}`). NEVER throws. globalThis-backed `setStdioFallback` / `_getStdioFallbackForTest` via `Symbol.for('ms-365-mcp-server.dispatch-guard.stdioFallback')` key persists through `vi.resetModules()`. Rejection `hint` auto-references the admin PATCH path (`/admin/tenants/{id}/enabled-tools`) so operators get self-service recovery guidance.
- **Tenant-context middleware (`src/lib/tool-selection/tenant-context-middleware.ts`, 53 lines):** `createSeedTenantContextMiddleware` wraps `next()` in `requestContext.run({...existing, tenantId, enabledToolsSet, presetVersion})`. Mounted on `/t/:tenantId/sse|messages|mcp` BEFORE `authSelector` so the Phase 3 auth middlewares' spread-copy pattern (`{...existing, accessToken, flow}`) propagates the tenant triple automatically without touching 03-06 code paths.
- **RequestContext + getRequestTenant:** `RequestContext` interface extended with `enabledToolsSet?: ReadonlySet<string>` + `presetVersion?: string` (Phase 5). New `getRequestTenant(): {id, enabledToolsSet, presetVersion}` helper surfaces the triple for executeGraphTool — stdio mode has no Express request, so ALS is the only common seam.
- **loadTenant extension:** `attachTenantWithEnabledSet(req, row)` calls `ensureEnabledToolsSet(req, row.enabled_tools, row.preset_version)` and attaches the frozen Set to `req.tenant.enabled_tools_set` on both DB-miss AND cache-hit paths. New `TenantRowWithEnabledSet` type for consumers.
- **executeGraphTool dispatch gate:** Added at the TOP of the function body (line 142-162) BEFORE the account-token resolution block. On rejection, returns the verbatim envelope AND logs a structured `{tool, tenantId, preset}` info entry with message `'dispatch-guard: tool not enabled for tenant'`. On `__beta__*` alias dispatch that PASSES the gate, logs a structured `{beta: true, toolAlias, tenantId}` info entry with message `'beta tool invoked'`.
- **stdio bootstrap (Pitfall 8):** `src/index.ts` registers `setStdioFallback(...)` BEFORE `server.start()`. With `--tenant-id`: loads the row from Postgres, computes enabled_tools_set via `computeEnabledToolsSet`, registers `{enabledToolsSet, tenantId, presetVersion}`. Without `--tenant-id` (legacy stdio): registers a permissive fallback covering the full registry + synthetic tools (parse-teams-url, graph-batch, graph-upload-large-file, search-tools, get-tool-schema, execute-tool, list-accounts) so the v1-era `--enabled-tools` regex filter remains the sole source of truth.

## Task Commits

Each task followed the RED → GREEN TDD discipline:

1. **Task 1 RED: failing tests for selector-ast + enabled-tools-parser + registry-validator** — `a4e59ae` (test)
2. **Task 1 GREEN: selector-ast + enabled-tools-parser + registry-validator** — `5c4e939` (feat)
3. **Task 2 RED: failing tests for dispatch-guard + two-tenant isolation + loadTenant enabled_tools_set** — `8a6450d` (test)
4. **Task 2 GREEN: dispatch-guard + loadTenant enabled_tools_set + executeGraphTool gate** — `924798c` (feat)

## Files Created/Modified

### Created

- `src/lib/tool-selection/selector-ast.ts` (+95 new) — pure parser with character whitelist + AST.
- `src/lib/tool-selection/enabled-tools-parser.ts` (+154 new) — compute + ensure + per-request memo.
- `src/lib/tool-selection/registry-validator.ts` (+158 new) — module-load frozen registries + Levenshtein suggestions.
- `src/lib/tool-selection/dispatch-guard.ts` (+163 new) — pure `checkDispatch` + globalThis stdio fallback.
- `src/lib/tool-selection/tenant-context-middleware.ts` (+53 new) — Express seedTenantContext middleware.
- `src/generated/client.ts` (+14 new, gitignored) — bootstrap stub so test mocks resolve; .gitignore:149 covers it.
- `test/tool-selection/selector-parser.test.ts` (+146 new) — 25 tests covering all 6 selector kinds + injection fuzz + grammar errors.
- `test/tool-selection/enabled-tools-parser.test.ts` (+205 new) — 17 tests covering the D-20 5-step order + WeakMap memoization.
- `test/tool-selection/registry-validator.test.ts` (+169 new) — 14 tests covering validation + typo suggestions + getters.
- `test/tool-selection/dispatch-guard.test.ts` (+185 new) — 14 tests covering pass/reject/fail-closed/stdio-fallback paths.
- `test/tool-selection/dispatch-enforcement.int.test.ts` (+225 new) — 4 integration tests (NULL preset dispatch, non-preset reject, beta log, stdio fallback).
- `test/tool-selection/dispatch-two-tenant.int.test.ts` (+205 new) — 3 isolation tests including 20-call concurrent interleaving.
- `test/tool-selection/load-tenant-enabled-tools-set.test.ts` (+197 new) — 4 middleware tests.

### Modified

- `src/request-context.ts` (+26) — RequestContext fields + getRequestTenant helper.
- `src/lib/tenant/load-tenant.ts` (+27) — attachTenantWithEnabledSet + TenantRowWithEnabledSet type.
- `src/graph-tools.ts` (+32) — dispatch gate + beta log inside executeGraphTool.
- `src/server.ts` (+8) — seedTenantContext mounted on 4 routes.
- `src/index.ts` (+87) — stdio bootstrap setStdioFallback registration (tenant-row-aware + legacy permissive).
- `test/setup.ts` (+14) — PermissiveSet fallback so legacy tests don't require per-test ALS seeding.
- `package.json` (+1) + `package-lock.json` (+22) — `fastest-levenshtein@^1.0.16`.

## Decisions Made

- **globalThis-backed stdio fallback (Symbol.for() key)** — `src/__tests__/graph-tools.test.ts` calls `vi.resetModules()` inside `loadModule()` which drops ALL module-level state, including `let stdioFallback` in dispatch-guard. The test's mock of `../generated/client.js` stays intact (vitest reinstalls mocks on reimport), but the fallback registration from test/setup.ts is lost. Migrating the fallback to `(globalThis as any)[Symbol.for('ms-365-mcp-server.dispatch-guard.stdioFallback')]` survives the reset. Symbol.for key prevents collisions in shared globals.
- **PermissiveSet subclass vs Proxy** — initially tried a Proxy around `new Set<string>()` that overrode `has` to return true. The Proxy approach breaks on `Set.prototype.size` (getter requires Set instance as receiver; Proxy fails the "incompatible receiver" check). Subclassing with `class PermissiveSet extends Set<string> { override has() { return true } }` preserves every other Set primitive correctly.
- **Seed-then-authenticate middleware layering** — Plan 05-04 PLAN suggested extending the existing `requestContext.run()` at server.ts line 1720/1771. But those are OLD legacy /mcp handlers, not the per-tenant /t/:tenantId/mcp path. The per-tenant path goes through `authSelector` (src/lib/auth-selector.ts) which internally calls `requestContext.run({...existing, accessToken, flow})`. Adding `tenantId, enabledToolsSet, presetVersion` to the spread-copy requires changes in 4 places (bearer middleware, app-only branch, legacy delegated, legacy bearer). A single `seedTenantContext` middleware BEFORE authSelector lets every auth flow pick up the triple for free.
- **Workload classifier inlined in enabled-tools-parser** — registry-validator's `extractWorkloadPrefix` function is a natural helper to share. But enabled-tools-parser already imports registry-validator (for `getRegistryAliases` / `getWorkloadPrefixes`), and a circular import via a shared helper would complicate the module graph. 7-line function duplicated; JSDoc points to the other copy.
- **Workload classifier = first-segment-after-**beta** strip** — tests initially expected `mail:*` to match `list-mail-messages`. That's not the plan's classifier: the plan says "first segment before `-` or `.`" which makes `list-mail-messages` → workload=`list`, not `mail`. Test fixtures updated to use the FULL_COVERAGE alias shape (`mail.messages.list`, `mail-send`, `users-list`) where workload IS the first segment.
- **registry-validator swallows parser errors → returns INVALID with empty suggestions** — if the parser throws on charset violation, the validator catches and returns the entire input as invalid WITHOUT running Levenshtein. This prevents the suggestion engine from proposing an auto-fix for `<script>alert()</script>` (which might then get copy-pasted into an admin PATCH). Admin handlers surface the parser's thrown message separately.
- **Legacy stdio mode falls permissive, --tenant-id mode enforces** — plan Task 2 step 6 called for "compute enabled_tools_set once via computeEnabledToolsSet and call requestContext.run around the MCP server connect". But `server.connect(transport)` returns after the handshake and subsequent tool calls are NOT inside that ALS frame. Instead, the stdio bootstrap registers `setStdioFallback(...)` at module-level — dispatch-guard reads it on every call when ALS is empty. Legacy mode (no --tenant-id) registers a permissive (full-registry) fallback to preserve v1 backwards compatibility; `--tenant-id` mode registers the tenant-specific triple.

## Deviations from Plan

### Rule 3 (blocking): vi.resetModules() in src/**tests**/graph-tools.test.ts dropped the setup fallback

- **Found during:** Task 2 GREEN — running `npx vitest run` showed 39 failures where 9 were tests that had been passing in baseline.
- **Affected files:** Most graph-tools-adjacent tests (calendar-view, path-encoding, tool-filtering, http-oauth-fix, multi-account, read-only, src/**tests**/graph-tools).
- **Root cause:** Test setup.ts calls `setStdioFallback(...)` once at module load. But graph-tools.test.ts internal helper `loadModule()` calls `vi.resetModules()` which invalidates all module-level state — including `let stdioFallback` in dispatch-guard. After reset, checkDispatch sees `stdioFallback === undefined` and rejects.
- **Fix:** Move `stdioFallback` from a module-level `let` to `globalThis[Symbol.for('ms-365-mcp-server.dispatch-guard.stdioFallback')]`. globalThis survives vi.resetModules() because vitest doesn't touch globals; Symbol.for() avoids collision.
- **Why Rule 3:** The dispatch-guard was functioning correctly; the test infrastructure interaction was a blocker for Task 2 success criteria (no regressions). Mechanical fix, no architectural implication.
- **Commit:** folded into the Task 2 GREEN commit (`924798c`).

### Rule 3 (blocking): Proxy-based PermissiveSet broke on Set.size access

- **Found during:** Task 2 GREEN — first permissive-fallback attempt used `new Proxy(new Set(), {get(t, p, r) { if (p === 'has') return () => true; return Reflect.get(t, p, r); }})`. This passed `_getStdioFallbackForTest()` but broke on `enabledToolsSet.size` (TypeError: "Method get Set.prototype.size called on incompatible receiver").
- **Root cause:** ES2019 spec requires `.size` getter to receive a Set instance as the `this` binding; `Reflect.get(target, 'size', receiver)` passes the Proxy as receiver, which is not a Set instance by internal-slot check.
- **Fix:** Replace Proxy with a class `PermissiveSet extends Set<string>` that overrides only `has()`. All other Set primitives (size, iterate, add, forEach) work natively because the instance IS a Set.
- **Why Rule 3:** Blocker for regression-free Task 2 completion. No architectural implication.
- **Commit:** folded into Task 2 GREEN (`924798c`).

### Tactical choice: test fixtures changed to FULL_COVERAGE alias shape

- Plan's test expectation (`mail:*` → `list-mail-messages` matches) was inconsistent with the workload classifier ("first segment before `-` or `.`"). `list-mail-messages` classifies as workload=`list`, not `mail`.
- Fixed by updating test fixtures to use FULL_COVERAGE-style aliases where the workload IS the first segment (`mail.messages.list`, `mail-send`). This matches the shape emitted by Plan 05-01's regenerated client.
- Test coverage assertions updated accordingly. The plan's behavior-test text still reads naturally ("mail workload → every mail-workload alias") but the fixtures make the classifier behavior concrete.

## Issues Encountered

- **vi.resetModules() dropping module state** (detailed above) — ~15 min to diagnose. The failure mode manifests as "spy called 0 times" in unrelated tests, which is misleading — the real fault is the dispatch-guard silently rejecting because the fallback got reset.
- **Proxy on Set.prototype.size** (detailed above) — the symptom message "incompatible receiver #<Set>" surfaces only when a downstream caller actually reads `.size`. Set members that just rebind on `.has` pass happily.
- **Test fixture vs classifier mismatch** — updated 5 workload-expansion tests to use aliases consistent with the plan's classifier (first-segment-after-**beta** strip).

## Threat Mitigation

| Threat ID                                                       | Status    | Evidence                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-05-07 (Tampering: selector injection)                         | Mitigated | `SELECTOR_CHAR` regex whitelist in selector-ast.ts rejects every off-list char. No dynamic `new RegExp(input)` in the module. Fuzz tests in selector-parser.test.ts cover SQL injection, XSS, null bytes, path traversal, unicode homoglyphs. Registry-validator catches parser throws and returns invalid+empty-suggestions rather than running Levenshtein on bad input. |
| T-05-07b (DoS: Levenshtein on long input)                       | Mitigated | `SelectorZod.max(256)` bounds each selector; admin PATCH (Plan 05-07) caps the array at 500. `fastest-levenshtein` is O(n*m/32) — well under the DoS ceiling even at 14k registry entries × 256-char query.                                                                                                                                                               |
| T-05-07c (Info disclosure: raw enabled_tools in logs)           | Mitigated | Dispatch-guard rejection log emits only `{tool, tenantId, preset}`; beta log emits only `{beta, toolAlias, tenantId}`. No path logs the raw `enabled_tools` string. 05-RESEARCH.md:467 anti-pattern respected.                                                                                                                                                            |
| T-05-08 (Cross-tenant tool leakage at dispatch)                 | Mitigated | `checkDispatch` reads from per-request AsyncLocalStorage frame (no shared global mutation in production paths). Frozen Set<string> is the only shared handle; the frame is created per-request inside `seedTenantContext` + `authSelector` combo. Two-tenant integration test (dispatch-two-tenant.int.test.ts) runs 20 interleaved concurrent calls and asserts zero cross-tenant leakage. |
| T-05-08b (WeakMap poisoning in enabled-tools-parser)            | Accept    | WeakMap key is the Express Request object; Express allocates a fresh Request per incoming connection. Cross-request poisoning is impossible by construction.                                                                                                                                                                                                              |
| T-05-09 (Elevation of privilege on missing context)             | Mitigated | `checkDispatch` returns a rejection envelope when `enabledSet === undefined` AND no stdio fallback is registered. Stdio bootstrap explicitly registers a fallback before `server.start()` — legacy mode gets permissive full-registry, tenant-id mode gets the tenant-specific set. Failing to register would fail every call closed.                                      |

## Assumptions

- **A1 (globalThis survives vitest isolation):** Vitest's thread pool isolates test FILES but shares globalThis within a file's execution. vi.resetModules() wipes the module cache, not globalThis. This assumption is load-bearing for the stdio fallback surviving through graph-tools test module reloads.
- **A2 (Symbol.for() collision-free):** The key `Symbol.for('ms-365-mcp-server.dispatch-guard.stdioFallback')` is assumed unique across the process. If the package name changes, update the key.
- **A3 (authSelector spread-copy preserves tenant fields):** The Phase 3 bearer + app-only middlewares call `requestContext.run({...existing, accessToken, flow, authClientId}, next)`. The tenant triple (tenantId, enabledToolsSet, presetVersion) lives in `existing` (seeded by seedTenantContext before authSelector runs), so the spread propagates it for free. This is verified by dispatch-enforcement.int.test.ts Test 1 passing — the test drives the full /mcp path and observes the gate working with ALS seeding.

## Known Stubs

- **`src/generated/client.ts` (bootstrap stub, gitignored):** Exports `api = new Zodios([])` — an empty endpoint array. Regenerated by `npm run generate` in FULL_COVERAGE mode. Present in this worktree ONLY so `vi.mock('../src/generated/client.js', ...)` in test files can resolve the module path before the mock intercepts. Running Plan 05-01 against a real OpenAPI spec overwrites this stub with the populated catalog. The 30 pre-existing test failures (`test/discovery-search.test.ts` 26 + `test/tool-schema.test.ts` 3 + `test/endpoints-validation.test.ts` 1) need the real registry — they will pass once `npm run generate:coverage` runs on CI or a snapshot fixture is committed.

## Threat Flags

| Flag                         | File                                         | Description                                                                                                                                                              |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| threat_flag: global-mutable  | src/lib/tool-selection/dispatch-guard.ts     | `globalThis[Symbol.for(...)]` stdio fallback is global mutable state. Testing pattern relies on explicit `setStdioFallback(undefined)` reset in strict-behavior tests.  |
| threat_flag: test-permissive | test/setup.ts                                | PermissiveSet always returns `true` from `.has()` — registered globally for legacy tests. Strict dispatch-guard tests MUST clear via `setStdioFallback(undefined)` in `beforeEach`. |

## User Setup Required

None — no external service configuration required.

Operators onboarding a multi-tenant deployment:

- New tenants created via POST /admin/tenants automatically pin `preset_version = 'essentials-v1'` (Plan 05-03) and leave `enabled_tools = NULL`, which Plan 05-04 resolves to the 150-op essentials preset.
- Custom per-tenant selection via:
  ```
  curl -X PATCH https://mcp.example.com/admin/tenants/{id}/enabled-tools \
    -H 'content-type: application/json' \
    -d '{"set": "+security:*,users.read"}'
  ```
  The admin endpoint (Plan 05-07) uses `validateSelectors` to reject typos before persistence.

## Self-Check: PASSED

Files verified (absolute paths):

- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/src/lib/tool-selection/selector-ast.ts` — FOUND (95 lines)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/src/lib/tool-selection/enabled-tools-parser.ts` — FOUND (154 lines)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/src/lib/tool-selection/registry-validator.ts` — FOUND (158 lines)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/src/lib/tool-selection/dispatch-guard.ts` — FOUND (163 lines)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/src/lib/tool-selection/tenant-context-middleware.ts` — FOUND (53 lines)
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/test/tool-selection/selector-parser.test.ts` — FOUND
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/test/tool-selection/enabled-tools-parser.test.ts` — FOUND
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/test/tool-selection/registry-validator.test.ts` — FOUND
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/test/tool-selection/dispatch-guard.test.ts` — FOUND
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/test/tool-selection/dispatch-enforcement.int.test.ts` — FOUND
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/test/tool-selection/dispatch-two-tenant.int.test.ts` — FOUND
- `/home/yui/Documents/ms-365-mcp-server/.claude/worktrees/agent-abca408c/test/tool-selection/load-tenant-enabled-tools-set.test.ts` — FOUND

Commits verified in `git log`:

- `a4e59ae` (test/05-04 Task 1 RED) — FOUND
- `5c4e939` (feat/05-04 Task 1 GREEN) — FOUND
- `8a6450d` (test/05-04 Task 2 RED) — FOUND
- `924798c` (feat/05-04 Task 2 GREEN) — FOUND

Test run evidence:

- `npx vitest run test/tool-selection/` → 77 PASS / 0 FAIL
- `npx vitest run test/tenant/ test/presets/ test/bin/ test/request-context.test.ts` → 135 PASS / 0 FAIL (no regressions)
- `npx vitest run` (full suite) → 1016 PASS / 30 FAIL (30 remaining are pre-existing `discovery-search` + `tool-schema` + `endpoints-validation` failures requiring live `src/generated/client.ts` — documented in Plan 05-03 Summary)

TDD gate compliance:

- Task 1: `test(05-04)` commit `a4e59ae` precedes `feat(05-04)` commit `5c4e939` → RED → GREEN respected.
- Task 2: `test(05-04)` commit `8a6450d` precedes `feat(05-04)` commit `924798c` → RED → GREEN respected.

## Preset Size Confirmation

ESSENTIALS_V1_OPS has **0 entries** in this worktree (bootstrap stub at `src/presets/generated-index.ts`). The full 150-op preset from Plan 05-03's `essentials-v1.json` only populates after `npm run generate:coverage` runs against a real OpenAPI spec. Tests that need preset content (Task 2 integration tests) mock `../src/lib/tool-selection/preset-loader.js` with small test-specific Sets.

## Two-Tenant Integration Test Runtime

`test/tool-selection/dispatch-two-tenant.int.test.ts` runs in **~150ms** (well under the 3s budget specified in the plan). The 20 concurrent interleaved calls each have a random 0-3ms delay inserted to force scheduler interleaving — total observed wall-clock ~100ms on the test thread.

## MCP SDK Request Context Notes

`requestContext.run(...)` extended cleanly to the tenant triple. The auth middlewares' existing spread-copy pattern (`{...existing, accessToken, flow, authClientId}`) naturally preserves the seedTenantContext triple because the seed runs BEFORE auth and the auth middlewares pull from `getRequestTokens() ?? {}`. No 03-06 code paths needed modification.

One surprise: `vi.resetModules()` in `src/__tests__/graph-tools.test.ts` drops module-level `let` state but NOT `globalThis` assignments. The initial attempt stored the stdio fallback in a module-level `let stdioFallback` which got zeroed on every `vi.resetModules()`, causing 9 pre-existing tests to start rejecting. Moving the fallback to `globalThis[Symbol.for(...)]` resolved it.

## Next Phase Readiness

Ready to spawn Plan 05-05 (tools/list filter). The filter will:

1. Read `req.tenant.enabled_tools_set` (populated by loadTenant).
2. Intercept JSON-RPC `tools/list` responses from the MCP SDK.
3. Filter the tool list array by `enabledToolsSet.has(tool.name)`.
4. Re-serialize and forward to the client.

Plans 05-06 (discovery BM25 cache) and 05-07 (admin PATCH) can consume the same `req.tenant.enabled_tools_set` + the Plan 05-04 exports (`validateSelectors`, `parseSelectorList`, `checkDispatch`) without additional plumbing.

Blockers: none. The 30 pre-existing test failures require `npm run generate:coverage` against a real Graph OpenAPI spec; they are independent of this plan.

---

_Phase: 05-graph-coverage-expansion-per-tenant-tool-selection_
_Completed: 2026-04-20_
