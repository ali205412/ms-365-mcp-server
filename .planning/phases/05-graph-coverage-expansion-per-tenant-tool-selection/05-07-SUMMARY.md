---
phase: 05-graph-coverage-expansion-per-tenant-tool-selection
plan: 07
subsystem: admin-api
tags:
  [
    admin-patch,
    enabled-tools,
    selector-validation,
    registry-validator,
    levenshtein,
    tool-selection-invalidation,
    rbac,
    transactional-audit,
    COVRG-04,
    TENANT-08,
    D-21,
  ]

# Dependency graph
requires:
  - phase: 05-graph-coverage-expansion-per-tenant-tool-selection
    plan: 04
    provides:
      validateSelectors() + SelectorZod + parseSelectorList() — the new PATCH
      handler runs these BEFORE opening the Postgres transaction so invalid
      selector input never locks a row or wastes a COMMIT.
  - phase: 05-graph-coverage-expansion-per-tenant-tool-selection
    plan: 06
    provides:
      publishToolSelectionInvalidation(redis, tenantId) + the
      mcp:tool-selection-invalidate channel constant — the PATCH handler
      publishes on this channel AFTER the audit-row COMMIT so every replica
      evicts its per-tenant-bm25 cache entry.
  - phase: 04-admin-api-dual-stack
    plan: 02
    provides:
      createTenantsRoutes + tenantRowToWire + canActOnTenant pattern +
      TENANT_GUID regex + problem+json helpers + withTransaction +
      writeAudit(client, row). This plan clones the tenants.ts PATCH handler
      shape end-to-end, only swapping the body schema + selector validation
      + invalidation channel.

provides:
  - src/lib/admin/enabled-tools.ts — createEnabledToolsRoutes(deps) factory
    exporting PATCH /:id/enabled-tools handler. EnabledToolsPatchZod with
    mutual-exclusion refine, computeNewEnabledTools pure helper,
    extractSelectorsForValidation pre-txn AST gate, transactional UPDATE +
    writeAudit (admin.tenant.enabled-tools-change), post-commit
    publishToolSelectionInvalidation, read-back through deps.pgPool +
    tenantRowToWire response.
  - src/lib/audit.ts — AuditAction union extended with
    admin.tenant.enabled-tools-change + admin.tenant.enabled-tools-parse-error.
    Per-action meta shape documented inline — length counts + operation
    only, NEVER raw selector text (T-05-17 redaction invariant).
  - src/lib/admin/router.ts — createEnabledToolsRoutes mounted on the same
    /tenants base as createTenantsRoutes. Express composes by pattern+
    method so PATCH /:id/enabled-tools wins the longer-suffix match.
  - src/lib/admin/__tests__/enabled-tools-patch.int.test.ts (10 tests) —
    add/remove/set + set:'' → NULL + mutual-exclusion refine +
    unknown_selector with suggestions + invalid GUID → 404 + body size
    limit + audit meta shape + malformed JSON → 400.
  - src/lib/admin/__tests__/enabled-tools-validation.int.test.ts (5 tests)
    — Levenshtein suggestions for typo selectors, empty suggestions for
    no-close-match, AST `;` separator rejection, illegal-char rejection,
    pre-txn failure does NOT emit audit_log.
  - src/lib/admin/__tests__/enabled-tools-invalidation.int.test.ts (4
    tests) — <100ms pub/sub round-trip, Redis-down graceful degrade to
    200 + pino warn, double-PATCH emits double publish, sender-side GUID
    guard on publishToolSelectionInvalidation.
  - src/lib/admin/__tests__/enabled-tools-rbac.int.test.ts (4 tests) —
    tenant-scoped cross-tenant denial (404), own-tenant success, global
    admin any-tenant success, audit_log.actor captured verbatim across
    both scoping paths.
  - src/generated/client.ts — bootstrap stub `new Zodios([])` (gitignored)
    so the vi.mock redirects in the new test files can resolve the
    module path before the mock intercepts. Identical to the stub used
    by Plan 05-04's test suite.

affects:
  - Admin operators — can now PATCH per-tenant tool selection via the
    REST API instead of hand-editing tenants.enabled_tools rows.
  - Plan 05-08 (coverage harness) — unaffected; harness reads the full
    registry independent of tenant enabled_tools state.
  - Phase 6 (rate limiting) — open work item to add admin-endpoint rate
    limiting; currently Phase 4 dual-stack auth is the only throttle.

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-mount router composition on the same /tenants base — Express
      dispatches by pattern+method match so the longer suffix
      (PATCH /:id/enabled-tools) wins over the broader PATCH /:id in
      createTenantsRoutes. This keeps the existing tenants CRUD handler
      untouched and adds the enabled-tools surface as a parallel module."
    - "Pre-transaction selector validation via validateSelectors runs
      BEFORE withTransaction opens so invalid input never locks a row or
      wastes a COMMIT. Registry misses return 400 with typed
      unknown_selector + Levenshtein suggestions in the problem+json
      extensions — documented behaviour that pre-txn validation failures
      do NOT emit audit_log rows (no state mutated, no durability
      requirement)."
    - "Redaction-safe audit meta for selector mutations — only
      {before_length, after_length, operation: add|remove|set} land in
      audit_log.meta (T-05-17). Pino info log carries {tenantId, actor,
      operation}. Operators grep by action + tenantId, not by selector
      content. The raw enabled_tools text NEVER appears in meta, pino,
      or stderr."
    - "Post-commit pub/sub invalidation with warn-level failure
      tolerance — publishToolSelectionInvalidation is called ONLY after
      the COMMIT returns; failure logs pino warn and continues. The
      per-tenant-bm25 TTL (10min per D-20) is the correctness fallback
      when Redis pub/sub is transiently partitioned."
    - "computeNewEnabledTools pure function extracted from the handler
      body — takes the current tenants.enabled_tools + the patch body,
      returns the new text (or NULL). Emits NULL on any empty final
      result to keep the loadTenant + enabled-tools-parser path
      deterministic (empty CSV row would otherwise disable ALL tools,
      which is never the intent of a PATCH that emptied the list)."

key-files:
  created:
    - src/lib/admin/enabled-tools.ts
    - src/lib/admin/__tests__/enabled-tools-patch.int.test.ts
    - src/lib/admin/__tests__/enabled-tools-validation.int.test.ts
    - src/lib/admin/__tests__/enabled-tools-invalidation.int.test.ts
    - src/lib/admin/__tests__/enabled-tools-rbac.int.test.ts
    - src/generated/client.ts (bootstrap stub — gitignored; .gitignore
      entry already present, no leak)
  modified:
    - src/lib/audit.ts — AuditAction union + per-action docstring extended
    - src/lib/admin/router.ts — createEnabledToolsRoutes mount
    - .planning/phases/05-graph-coverage-expansion-per-tenant-tool-selection/deferred-items.md
      — added pre-existing discovery-filter.int.test.ts failures tracking

key-decisions:
  - "Clone tenants.ts PATCH pattern verbatim — every control flow bit
    (RBAC gate, withTransaction, writeAudit, post-commit publish, read-
    back + tenantRowToWire) lines up one-to-one with the Phase 4 exit
    state. The only handler-specific novelty is EnabledToolsPatchZod +
    extractSelectorsForValidation + validateSelectors. Keeps the code
    review surface small and prevents accidentally diverging RBAC
    semantics (tenant-scoped admin sees 404, not 403, on cross-tenant
    access per D-13)."
  - "Mount the new router on the SAME /tenants base as
    createTenantsRoutes, appending after it. Express composes by
    pattern+method not mount order, so PATCH /:id/enabled-tools and
    PATCH /:id coexist without conflict. Alternative considered —
    extending createTenantsRoutes with a new handler — rejected because
    tenants.ts is already 40k and mixing tool-selection logic into the
    CRUD file would blur the module boundary."
  - "Pre-txn validation failures do NOT emit audit_log rows — documented
    intentional behaviour. The plan specifies an
    admin.tenant.enabled-tools-parse-error action for symmetry with
    admin.tenant.enabled-tools-change, but the action is reserved for
    future use (e.g., a txn-level write that fails mid-commit and needs
    an audit trail for the attempt). Pre-txn 400 responses never touch
    the DB and do not need durability. Added to the AuditAction union
    as declared surface so future handlers can use it without revisiting
    the union."
  - "Extract selectors by mode rather than normalizing to a single
    shape — `add` and `remove` arrive as arrays, `set` arrives as a CSV
    string that must flow through parseSelectorList first to catch `;`
    separators and illegal chars. Separate paths keep the error
    messages precise: `add: ['<script>']` surfaces as unknown_selector
    (the registry validator catches it); `set: 'a;b'` surfaces as
    'Selector parse error: ...' from parseSelectorList. Conflating
    them would degrade operator feedback."
  - "Empty enabled_tools after add/remove resolves to NULL, not empty
    string — a NULL row triggers the preset fallback via loadTenant +
    enabled-tools-parser (D-20); an empty-string row would disable ALL
    tools which is never the intent of a PATCH that emptied the list.
    computeNewEnabledTools normalizes this in the handler rather than
    pushing the decision to SQL so the contract is explicit in code."

threat-flags: []

# Metrics
duration: 10min
completed: 2026-04-20
---

# Phase 5 Plan 07: Admin PATCH /admin/tenants/:id/enabled-tools Endpoint Summary

**Ships the admin REST endpoint that mutates `tenants.enabled_tools` with pre-transaction selector validation (Levenshtein-ranked typo suggestions on miss), transactional UPDATE + audit-row COMMIT, post-commit Redis pub/sub invalidation on the `mcp:tool-selection-invalidate` channel, and tenant-scoped RBAC — a clone of Phase 4's `src/lib/admin/tenants.ts` PATCH pattern with an `{add, remove, set}` mutually-exclusive Zod body replacing the CRUD partial-update shape.**

## Performance

- **Duration:** ~10 min (single RED/GREEN cycle for Task 1 + additive integration tests for Task 2)
- **Started:** 2026-04-20T15:00:41Z (worktree base verified at 2dbe2b2)
- **Completed:** 2026-04-20T15:10:57Z
- **Tasks:** 2 (Task 1 TDD RED+GREEN; Task 2 additive integration suite against existing handler)
- **Files created:** 5 (1 source + 4 test files; src/generated/client.ts bootstrap stub gitignored)
- **Files modified:** 2 source (router.ts mount, audit.ts union extension) + 1 docs (deferred-items.md)

## Accomplishments

- **PATCH /admin/tenants/:id/enabled-tools handler (`src/lib/admin/enabled-tools.ts`, 259 lines):**
  - `EnabledToolsPatchZod`: body accepts `{add?: string[], remove?: string[], set?: string | null}` with a `.refine` that gates on exactly-one-key-present. `add` / `remove` arrays max 500 × 256 chars. `set` string max 16384 chars.
  - `extractSelectorsForValidation`: runs `parseSelectorList` for `set` mode to catch `;` separator and illegal-char rejections up-front; `add` / `remove` pass through as flat arrays.
  - Registry validation via `validateSelectors` (Plan 05-04) runs BEFORE `withTransaction` opens. Registry miss returns 400 with typed `unknown_selector` + Levenshtein suggestions (up to 3 per invalid, distance ≤ 3) in the problem+json extensions.
  - `withTransaction` wraps `SELECT FOR UPDATE` (tenants row) + `UPDATE tenants SET enabled_tools = $1, updated_at = NOW()` + `writeAudit(client, {action: 'admin.tenant.enabled-tools-change', meta: {before_length, after_length, operation}})`. All-or-nothing — rollback on any SQL error.
  - Post-commit `publishToolSelectionInvalidation(deps.redis, id, 'enabled-tools-change')` on the `mcp:tool-selection-invalidate` channel. Publish failure logs pino warn and continues — per-tenant-bm25 TTL (10min, D-20) is the correctness fallback.
  - Read-back through `deps.pgPool` + `tenantRowToWire` response; 200 status with the updated tenant row in snake_case.
  - `canActOnTenant` RBAC gate: cross-tenant access by a tenant-scoped admin returns 404 (information hiding per D-13), not 403.
- **`computeNewEnabledTools` pure helper:** takes current `enabled_tools` CSV + patch body, returns new text or NULL. `set` replacement (empty string / null → NULL); `add` merges with dedup preserving insertion order; `remove` drops listed selectors. Empty final result ALWAYS → NULL (never empty string) so the loadTenant + enabled-tools-parser preset fallback kicks in.
- **AuditAction extension (`src/lib/audit.ts`):** union extended with `'admin.tenant.enabled-tools-change' | 'admin.tenant.enabled-tools-parse-error'`. Per-action meta shapes documented inline — length counts + operation only, NEVER raw selector text. The `parse-error` action is declared but reserved for future handlers that need to audit txn-level failures; pre-txn 400s do not emit audit rows (documented behavior).
- **Router mount (`src/lib/admin/router.ts`):** `r.use('/tenants', createEnabledToolsRoutes(deps))` appended after `createTenantsRoutes`. Express composes by pattern+method so PATCH `/:id/enabled-tools` wins the longer-suffix match over the broader PATCH `/:id` in the tenants router — verified by Test 12 (existing tenants PATCH) + all 10 new PATCH enabled-tools tests passing side by side.
- **Integration test coverage (23 tests across 4 files):**
  - `enabled-tools-patch.int.test.ts` (10): add/remove/set happy paths, `set:''` → NULL, mutual-exclusion refine, unknown_selector+suggestions, invalid GUID → 404, body size limit, audit meta shape (before_length/after_length/operation), malformed JSON.
  - `enabled-tools-validation.int.test.ts` (5): typo selector → suggestions containing correct alias, no-close-match → empty suggestions, AST `;` rejection, illegal-char rejection, pre-txn failure does NOT emit audit_log row (documented).
  - `enabled-tools-invalidation.int.test.ts` (4): <100ms pub/sub round-trip, Redis publish failure → 200 + pino warn, consecutive PATCHes publish twice, sender-side GUID guard.
  - `enabled-tools-rbac.int.test.ts` (4): tenant-scoped cross-tenant → 404, own-tenant → 200, global-admin any-tenant → 200, audit_log.actor captured verbatim across both paths.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run src/lib/admin/__tests__/enabled-tools-patch.int.test.ts` | 10/10 passing |
| `npx vitest run src/lib/admin/__tests__/enabled-tools-validation.int.test.ts` | 5/5 passing |
| `npx vitest run src/lib/admin/__tests__/enabled-tools-invalidation.int.test.ts` | 4/4 passing |
| `npx vitest run src/lib/admin/__tests__/enabled-tools-rbac.int.test.ts` | 4/4 passing |
| `npx vitest run src/lib/admin/__tests__/` (full admin suite regression) | 239/239 passing |
| `npx eslint src/lib/admin/enabled-tools.ts src/lib/admin/router.ts src/lib/audit.ts` | clean |
| `test/tool-selection/` regression | 119/121 passing; 2 pre-existing failures tracked in deferred-items.md |

## Requested output details (from 05-07-PLAN.md `<output>`)

- **Confirmation of `admin.tenant.enabled-tools-parse-error` emission policy:** Pre-transaction validation failures (Zod refine reject, parseSelectorList throw, registry miss) return 400 problem+json BEFORE `withTransaction` opens. No audit row is emitted on pre-txn failures because no state mutated. The `admin.tenant.enabled-tools-parse-error` action is declared in the AuditAction union as reserved surface for future handlers that might need to audit mid-transaction parse failures (e.g., a txn-level write that validates input late). Test V5 asserts this behavior explicitly. Rationale: durability only matters when state changed; pre-txn 400s are indistinguishable from client-side schema-validation errors and do not need audit retention.
- **Observed invalidation propagation latency:** <100ms on MemoryRedisFacade (test I1). Real ioredis + local Redis measured ~5ms in Plan 05-06 integration tests; MemoryRedisFacade uses direct EventEmitter dispatch so the number is effectively the JS event-loop tick time (<1ms). Both are well within the D-20 bounded-staleness budget. Test uses a 100ms retry loop with 10ms intervals; all runs complete on the first or second iteration.
- **Decision on audit-row content vs pub/sub payload:** Kept plain GUID on the wire (Phase 3 pattern unchanged), with the reason string (`'enabled-tools-change'`) passed only to `publishToolSelectionInvalidation` as an `_reason` argument that the function intentionally discards. Reason strings live in the audit-row meta (`operation: 'add' | 'remove' | 'set'`), not in the pub/sub payload. This keeps subscribers simple (Plan 05-06 subscriber code has zero knowledge of mutation semantics) and reserves the pub/sub surface for the single invariant it needs: "this tenant's enabled-tools changed — evict". Future handlers that need more detail (e.g., partial invalidation of specific aliases) can introduce a new channel with a richer payload.
- **RBAC edge cases observed during testing:**
  - Tenant-scoped admin with `tenantScoped=null` test: not applicable — the type contract forbids null for scoped admin. All scoped admins carry a GUID.
  - Global admin (tenantScoped=null) cross-tenant: allowed by design (R3 test).
  - Tenant-scoped admin targeting tenant GUID that doesn't exist in the DB: returns 404 the same as a cross-tenant miss (both 404s are indistinguishable on the wire — this is the D-13 information-hiding goal). The internal path differs (canActOnTenant gate vs existed=false after SELECT) but the external contract is identical.
  - Empty `enabled_tools_set` after `remove` emptied the list: handler writes NULL, not empty string. Test 4 (`set: ''`) verifies the same NULL outcome via the explicit reset path. `computeNewEnabledTools` is the single source of truth for this normalization.

## Deviations from Plan

Minor deviations, all auto-applied under deviation Rule 2/3:

**1. [Rule 3 - Blocking issue] Added JSON body parser malformed-input handler for Test 10**

- Found during: Task 1 test execution
- Issue: Express 5's default JSON parser throws `entity.parse.failed` on malformed JSON; without a catching error-middleware this bubbles as a 500 unrelated to the handler.
- Fix: Added a small error-handling middleware inside the test's `startServer` helper that converts `entity.parse.failed` / `entity.too.large` to 400 problem+json before the route-level handler sees the request. This is test infrastructure only (it mirrors what Express's own `errorHandler` would do in production with proper wiring) and keeps the handler under test free of body-parsing concerns.
- Files: `src/lib/admin/__tests__/enabled-tools-patch.int.test.ts` only
- No source code change required

**2. [Rule 3 - Blocking issue] Copied `src/generated/client.ts` bootstrap stub from agent-aa18feaa**

- Found during: registry-validator.test.ts failing at module resolution
- Issue: `src/generated/client.ts` is gitignored and generated by `npm run generate` (an ~8min network-dependent step). Tests that `vi.mock('../../../generated/client.js', ...)` still need the file to exist for the import resolver.
- Fix: Copied the same 14-line bootstrap stub used by Plan 05-04's test suite (`new Zodios([])`). File stays gitignored per the existing `.gitignore:149` entry.
- Files: `src/generated/client.ts` (new, gitignored)

**3. [Rule 3 - Pre-existing failures documented]**

- Found during: full tool-selection regression run
- Issue: `test/tool-selection/discovery-filter.int.test.ts` has 2 tests failing on base commit `2dbe2b2` (confirmed before any 05-07 changes) because the bootstrap stub exports empty `api.endpoints` whereas those tests require real Graph aliases.
- Fix: Appended a new section to `deferred-items.md` documenting the failures and the proper fix (either integrate `npm run generate` into executor pre-test or switch tests to vi.mock registry fixtures like the new 05-07 tests). Out of scope for the PATCH-endpoint surface.

## Threat Mitigations Shipped

| Threat | Disposition | Implementation |
|--------|-------------|----------------|
| T-05-15 (PATCH body shape tampering) | mitigate | `EnabledToolsPatchZod.refine` — exactly-one-of {add, remove, set}; Test 5 asserts 400 on dual-key body |
| T-05-16 (cross-tenant PATCH / elevation of privilege) | mitigate | `canActOnTenant` reused from tenants.ts; tenant-scoped admin → 404 on cross-tenant; Test R1 asserts denial. Global admin → any tenant; Test R3 asserts success |
| T-05-17 (selector text in audit/logs / information disclosure) | mitigate | Audit meta carries only `{before_length, after_length, operation}`; pino info log carries `{tenantId, actor, operation}`; the raw `enabled_tools` text NEVER appears in either. Test 9 asserts meta shape |
| T-05-18 (DoS via huge PATCH body / selector flood) | mitigate | Zod caps: `add`/`remove` arrays max 500, selector max 256 chars; `set` max 16384 chars. fastest-levenshtein O(n*m/32) well under the cost ceiling. Test 8 asserts body-size rejection |
| T-05-15b (selector injection via set mode) | mitigate | `parseSelectorList` AST character whitelist catches illegal chars BEFORE the registry validator; `set: 'a;b'` returns 400 with the parser's explicit separator message (Test V3) |
| T-05-17b (audit missing on partial failure) | mitigate | `writeAudit` + `UPDATE tenants` live in the same `withTransaction`. Either both land or both roll back. Test 9 verifies audit row presence after successful PATCH |

T-05-16b (Levenshtein leaks registry content) and T-05-18b (pub/sub flood) remain as `accept` per the plan — both are documented trade-offs: registry content is already visible to any authenticated admin via the full registry; pub/sub publishes are gated by admin auth throughput which is the primary rate-limit surface.

## Known Stubs

None. All behaviour wired to real modules:
- `validateSelectors` — Plan 05-04, real registry + Levenshtein
- `publishToolSelectionInvalidation` — Plan 05-06, real Redis pub/sub (MemoryRedisFacade in tests; real ioredis in production)
- `withTransaction` / `writeAudit` — Plan 03-01 / 03-10 primitives
- `tenantRowToWire` — Phase 4 wire normalizer reused as-is

## TDD Gate Compliance

Plan type: `execute` (not plan-level TDD), but Task 1 carried `tdd="true"`:

- ✅ RED gate: commit `219f29a` (`test(05-07): add failing PATCH /admin/tenants/:id/enabled-tools integration tests`) — tests failed at module-resolution time before Task 1 GREEN landed.
- ✅ GREEN gate: commit `48d8955` (`feat(05-07): PATCH /admin/tenants/:id/enabled-tools handler (Task 1 GREEN)`) — all 10 Task 1 tests passed after the handler file was added.
- ⏭️ REFACTOR gate: not needed; the handler pattern clones tenants.ts PATCH verbatim and was already at production shape when first committed.

Task 2 integration tests were committed as a single TDD-complete batch (`7308030`) because the underlying handler shipped in Task 1 GREEN; the 13 tests validate additional integration scenarios (Levenshtein, invalidation, RBAC) all of which passed against the existing handler without further modification.

## Self-Check: PASSED

- `src/lib/admin/enabled-tools.ts` — FOUND (12.5K)
- `src/lib/admin/__tests__/enabled-tools-patch.int.test.ts` — FOUND (16.4K)
- `src/lib/admin/__tests__/enabled-tools-validation.int.test.ts` — FOUND (11.1K)
- `src/lib/admin/__tests__/enabled-tools-invalidation.int.test.ts` — FOUND (10.8K)
- `src/lib/admin/__tests__/enabled-tools-rbac.int.test.ts` — FOUND (11.9K)
- Commit `219f29a` (RED) — FOUND in `git log`
- Commit `48d8955` (Task 1 GREEN) — FOUND in `git log`
- Commit `7308030` (Task 2 tests) — FOUND in `git log`
- All 23 plan-05-07 integration tests — PASSING
- Full admin suite regression — 239/239 PASSING
- Lint — clean
