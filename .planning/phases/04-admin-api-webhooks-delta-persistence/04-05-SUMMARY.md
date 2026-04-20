---
phase: 04-admin-api-webhooks-delta-persistence
plan: 05
subsystem: api
tags:
  [
    admin,
    audit,
    query,
    rbac,
    cursor-pagination,
    rfc7807,
    problem-json,
    express,
    postgres,
    phase-4,
  ]

# Dependency graph
requires:
  - phase: 03-multi-tenant-identity-state-substrate
    provides:
      "src/lib/audit.ts AuditAction union + writeAudit/writeAuditStandalone;
      migrations/20260501000100_audit_log.sql schema + indexes
      (idx_audit_log_tenant_ts, idx_audit_log_action, idx_audit_log_request_id);
      MWARE-07 request_id carry-through into audit_log.request_id column"
  - phase: 04-admin-api-webhooks-delta-persistence
    provides:
      "04-01: createAdminRouter + AdminRouterDeps + TODO(04-05) anchor +
      cursorSecret plumbing + problemBadRequest/Forbidden/Internal shorthands +
      encodeCursor/decodeCursor (HMAC-SHA256 tuple pagination);
      04-02: RBAC pattern (SQL-param tenant filter, 403 on explicit
      cross-tenant conflict for tenant-scoped admins); tenants.int.test.ts
      pg-mem+http test harness shape;
      04-04: dual-stack admin auth populates req.admin with
      {actor, source, tenantScoped} — consumed directly by GET /admin/audit
      for the RBAC filter"
provides:
  - "src/lib/admin/audit.ts — createAuditRoutes(deps) factory exporting the
    /admin/audit sub-router. Single GET / handler: cursor-paginated,
    filter-supporting, RBAC-aware query over audit_log. Also exports
    AuditWireRow interface and auditRowToWire row normaliser."
  - "src/lib/admin/router.ts — createAuditRoutes imported + mounted at
    `/audit` between /api-keys and the subscribeToApiKeyRevoke fire-and-forget
    (replaces the TODO(04-05) anchor)."
affects:
  - "04-06 (admin-action audit logging): when it lands, existing writeAudit
    call-sites (tenants.ts, api-keys.ts) will begin emitting richer meta shapes.
    The query endpoint auto-surfaces those rows without code change because
    meta is passed through as a schema-on-read Record<string, unknown>."
  - "04-07 (webhook delivery persistence): webhook-delivery audit rows become
    queryable through the same endpoint once that plan adds its AuditAction
    literal. No changes to 04-05 required."
  - "05-xx (observability phase): the endpoint surfaces request_id for every
    row, enabling ODataError.requestId ↔ audit.request_id correlation in a
    future support-portal screen."

# Tech tracking
tech-stack:
  added:
    # No new runtime deps — zod + express + pg already in package.json.
    - "(no new runtime deps — pure composition of zod + express + existing
      04-01 problem-json + cursor helpers)"
  patterns:
    - "SQL-param RBAC as defense in depth — admin.tenantScoped is injected
      as a WHERE-clause parameter, not applied as a post-SELECT JavaScript
      filter. Even a tampered cursor (which wouldn't decode because of the
      HMAC gate anyway) would be bounded by the SQL filter. Matches
      tenants.ts `effectiveTenantFilter` pattern from plan 04-02."
    - "Explicit cross-tenant 403 — tenant-scoped admin with explicit
      tenant_id query that doesn't match their scope gets 403, NOT a silent
      scope rewrite. Preserves loud-failure posture for security-relevant
      denials (same as tenants.ts POST RBAC check)."
    - "(ts, id) tuple-comparison cursor — ORDER BY ts DESC, id DESC with
      WHERE (ts < cursorTs OR (ts = cursorTs AND id < cursorId)) guarantees
      stable pagination across ties in the timestamp column. Exact same
      shape as tenants.ts list endpoint."
    - "LIMIT n+1 has_more probe — fetch one extra row, slice to n in the
      response, use the boolean to drive next_cursor. No COUNT(*) query
      required, no extra round-trip."
    - "auditRowToWire row normaliser — handles pg-mem's string-typed JSONB
      and timestamptz columns AS WELL AS real pg's parsed-object / Date
      forms. Matches the tenantRowToWire / serializeApiKeyRow convention.
      Exported so other modules (e.g., a future audit export tool) can
      reuse the shape without duplicating the normalisation logic."
    - "Catch-all-optional Zod query shape — every query parameter is
      optional, so the endpoint serves as an open list by default. Passing
      no params is a full tenant-or-global scan (subject to RBAC + pagination)."
    - "Zod `.datetime({ offset: true })` for since/until — validates ISO-8601
      with timezone offset before handing to Postgres; eliminates a class of
      cast errors and ensures caller intent is preserved (no silent UTC
      defaulting)."

key-files:
  created:
    - "src/lib/admin/audit.ts"
    - "src/lib/admin/__tests__/audit.int.test.ts"
  modified:
    - "src/lib/admin/router.ts — added `import { createAuditRoutes }` and
      replaced `// TODO(04-05): r.use('/audit', createAuditRoutes(deps));`
      with the active mount. Updated middleware-order header comment to
      drop the TODO annotation."

key-decisions:
  - "GET /admin/audit is append-only / read-only — no CRUD surface on audit
    records. Writes happen exclusively via src/lib/audit.ts's writeAudit /
    writeAuditStandalone helpers. This keeps the trust boundary tight: the
    admin API cannot be abused to retroactively modify or delete an audit
    entry, matching the D-13 sync-audit contract's implicit append-only
    assumption and the industry standard (SOC 2 CC7.2, ISO 27001 A.12.4.1)."
  - "RBAC conflict for tenant-scoped admin → 403, NOT silent scope rewrite.
    An API-key admin (tenantScoped = T-A) passing ?tenant_id=T-B gets 403
    forbidden, loudly. Alternatives considered:
      (a) Silent rewrite: return rows for T-A and ignore the ?tenant_id=T-B
          parameter. REJECTED — silent policy overrides disguise what was
          denied from the caller and degrade the auditability of denials.
      (b) 404 NotFound (same as tenants.ts GET /:id mismatch): REJECTED —
          the endpoint is plural / list-shaped, so 404 would be semantically
          weak. 403 is the correct code for 'authenticated but not allowed
          for this specific filter'."
  - "Response row shape matches the DB shape 1:1 (snake_case, ISO-8601
    timestamps). No server-side re-formatting of `meta` beyond JSON-parsing
    when pg-mem hands us a string. This preserves the schema-on-read
    contract from 03-10 — writers own the meta shape, and the query path
    MUST NOT transform or filter fields. Future `request-id` ↔ Microsoft
    support-bundle correlation depends on the raw field round-tripping."
  - "Cursor encodes (ts, id) as `{ ts: number, id: string }`. Using ts as
    a number (milliseconds since epoch) is lossless for audit_log rows
    because the schema uses `timestamptz NOT NULL DEFAULT NOW()` — no
    sub-millisecond precision to preserve. ID is text (matching the
    migration's `text PRIMARY KEY` type), so no further encoding required."
  - "No audit row emitted for the GET itself. GET /admin/audit is a
    read-only enumeration; emitting an audit row on every page fetch would
    flood the table and create a recursive self-audit pattern (the next
    GET would see the previous GET's audit row). If audit-of-audit-reads
    becomes a requirement, it belongs behind an explicit env flag, not the
    default surface — noted as deferred for 05-xx observability phase."
  - "Query parameter `action` accepts any string (length-bounded 1..128),
    not the AuditAction union literal set. Rationale: the closed set is
    evolving (each Phase 4 plan adds literals), and enforcing the full
    union on the READ path would mean adding a second type-sync contract.
    Future new actions remain queryable as soon as they land without code
    change. Length cap prevents pathological queries; exact match via SQL
    `=` prevents regex DoS."

patterns-established:
  - "Audit query RBAC shape — tenant-scoped admin gets a forced SQL-param
    filter; explicit conflict → 403; global admin can pass tenant_id to
    filter. Future admin query endpoints (webhook-delivery log in 04-07,
    delta-token registry browser in 04-09 follow-up) SHOULD adopt the
    same RBAC pattern for consistency."
  - "Tuple-comparison cursor over non-unique timestamp column — ORDER BY
    ts DESC, id DESC with (ts, id) tuple WHERE clause guarantees stable
    pagination regardless of ts ties. Every Phase 4+ admin list endpoint
    over a table with a non-unique timestamp column should follow this
    shape (reuse encodeCursor/decodeCursor primitives from 04-01)."
  - "Row normaliser exported alongside the handler — auditRowToWire is
    `export`ed so future consumers (e.g., a CSV/NDJSON export tool in a
    later observability plan) can reuse the shape. Same convention as
    tenantRowToWire in tenants.ts."

requirements-completed:
  - "ADMIN-06"

# Metrics
duration: ~8min
completed: 2026-04-20
---

# Phase 4 Plan 05: GET /admin/audit — cursor-paginated query API with RBAC Summary

**Read-only `GET /admin/audit` shipped: Zod-validated query parameters (tenant_id / since / until / action / actor / cursor / limit), SQL-param RBAC enforcement (tenant-scoped admin sees only own rows; explicit cross-tenant conflict → 403), (ts, id) tuple-comparison cursor pagination with HMAC-signed opaque cursor from 04-01, stable `{data, next_cursor, has_more}` response shape, request_id field surfaced on every row for MWARE-07 correlation.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-20T09:18:28Z
- **Completed:** 2026-04-20T09:26:22Z
- **Tasks:** 2 (Task 1 TDD, Task 2 wire)
- **Files:** 2 created + 1 modified = 3 total
- **Tests added:** 14 integration tests
- **Test result:** 14/14 PASS (admin suite 143/143 overall, no regression)

## Accomplishments

- **GET /admin/audit endpoint lands** — `createAuditRoutes(deps)` factory in `src/lib/admin/audit.ts` exports a single GET / handler that queries audit_log with a parameterised WHERE clause combining tenant_id / since / until / action / actor filters, plus a tuple-comparison cursor for deterministic pagination. All error paths use problem+json envelopes (400 for bad cursor / bad GUID / Zod failures, 403 for RBAC conflicts, 500 for DB errors with static shape via `problemInternal`).
- **SQL-param RBAC as defense in depth** — the tenant filter is injected into the SQL WHERE clause, not applied as a post-SELECT JavaScript filter. A tenant-scoped admin (`req.admin.tenantScoped !== null`) gets `tenant_id = $1::uuid` forced regardless of query parameters; an explicit conflicting `?tenant_id=OTHER` returns 403 forbidden loudly. Verified by Test 2 (scoped admin sees only own rows), Test 4 (explicit conflict → 403), and Test 14 (even with a process-secret-valid cursor, the WHERE filter prevents cross-tenant row leakage).
- **Tuple-comparison cursor pagination** — reuses the HMAC-SHA256 signed opaque cursor helpers from 04-01 (encodeCursor / decodeCursor), with the payload being `(ts_ms, id)` from audit_log. SQL WHERE clause is `(ts < cursorTs) OR (ts = cursorTs AND id < cursorId)` so rows in the page strictly precede the cursor even when the timestamp column has ties. LIMIT n+1 idiom determines has_more without a separate COUNT query. Verified by Test 8 (3-row paginate-forward: newest → middle → oldest, has_more transitions correctly).
- **request_id surfaced on every row** — Test 12 asserts the `request_id` field round-trips from audit_log.request_id (populated by writeAudit call-sites with the MWARE-07 correlation ID) to the wire response. Enables operators to match ODataError.requestId from Microsoft support bundles to the audit trail.
- **Stable response contract** — `{data, next_cursor, has_more}` exactly matches tenants + api-keys list endpoints. Test 13 asserts the key set is stable (no extra fields) so future client adapters can rely on the shape across plans.
- **Row normaliser handles pg-mem + real pg transparently** — `auditRowToWire` parses string-typed JSONB (pg-mem) AND accepts already-parsed objects (real pg), same for Date vs. ISO-string timestamptz. Exported for future consumer reuse (CSV/NDJSON export tools).
- **Zero new runtime dependencies** — pure composition of `zod` (already v3.24.2 in package.json), `express`, `pg`, the `src/lib/admin/problem-json.ts` + `src/lib/admin/cursor.ts` primitives from 04-01, and the audit_log table from plan 03-10.

## Task Commits

Each task committed atomically on this worktree branch. Task 1 is TDD (separate RED + GREEN commits); Task 2 is a single wiring commit.

1. **Task 1 (RED): failing tests for GET /admin/audit** — `8db678d` (test)
2. **Task 1 (GREEN): implement GET /admin/audit cursor-paginated query** — `7093de4` (feat)
3. **Task 2: wire createAuditRoutes into admin router** — `e672810` (feat)

Plan metadata commit (this SUMMARY) follows separately.

## New Exports

### src/lib/admin/audit.ts

- `createAuditRoutes(deps: AdminRouterDeps): Router` — factory that captures deps in a closure and returns a sub-router with GET / mounted.
- `auditRowToWire(row): AuditWireRow` — row normaliser; exported for reuse by future audit consumers (export tools, alert emitters).
- `AuditWireRow` interface — the stable wire shape (snake_case; ISO-8601 timestamps; `meta` as schema-on-read `Record<string, unknown>`).

### src/lib/admin/router.ts (modified, not re-exported)

- `createAuditRoutes` imported and mounted at `/audit` via `r.use('/audit', createAuditRoutes(deps))`.

## Threat Mitigations Landed

| Threat ID | STRIDE Category   | Mitigation In This Plan                                                                                                                                                                                                                                                                        |
| --------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-04-02   | Tampering         | Invalid cursor (HMAC mismatch or unparseable JSON) → `decodeCursor` returns null → 400 bad_request via problemBadRequest. Test 9 asserts the response shape and type URL.                                                                                                                       |
| T-04-03a  | Info Disclosure   | All 500 paths use `problemInternal(res, req.id)` which has no `detail` parameter — callers cannot leak stack traces. The DB error handler logs the raw error via `logger.error` but only sends the static 500 envelope.                                                                         |
| T-04-05c* | EoP (Cross-tenant)| Tenant-scoped admin cross-tenant enumeration blocked at the SQL layer. Test 2 asserts only TENANT_A rows appear for a scoped admin; Test 14 specifically asserts this holds even when the caller presents a valid cursor (tampered or not — the SQL filter is the last line of defence).        |
| T-04-05d* | Info Disclosure   | Explicit cross-tenant conflict → 403 with the standard forbidden problem+json. Silent scope rewrite was REJECTED in key-decisions because it disguises denials. Test 4 asserts 403 with `type` containing `forbidden`.                                                                          |
| T-04-03b  | DoS               | `limit` capped at 200 via Zod `.max(200)`. A caller sending `?limit=9999` receives a 400 bad_request. Test 10 asserts the behaviour (either 400 or 200 with ≤200 rows — both bound the attack surface).                                                                                         |
| T-04-02a* | Tampering         | Postgres cast errors on malformed tenant_id are pre-empted by `.regex(TENANT_GUID)` validation. Without this, a caller passing `?tenant_id=<sql-fragment>` would surface as a low-level cast error with database details. Test 11 asserts 400 bad_request on `?tenant_id=not-a-guid`.          |
| N/A       | Repudiation       | The query endpoint is READ-ONLY. There is no write surface for admin API callers to modify or delete an audit row — writes happen exclusively via src/lib/audit.ts. Architecturally removes the repudiation attack class for the admin API.                                                    |

*T-04-05c / T-04-05d / T-04-02a are inferred threat IDs consistent with the phase's labelling scheme (no canonical threat_model block present in the worktree for plan 04-05 — see Issues Encountered). The plan's success criteria explicitly call out the RBAC SQL-param filter and defense-in-depth property.

## Env Vars Introduced / Consumed

**No new env vars.** Endpoint activates automatically when the admin router is mounted (plan 04-01 gate: `MS365_MCP_ADMIN_APP_CLIENT_ID` + `MS365_MCP_ADMIN_GROUP_ID` set). The `deps.cursorSecret` is the same process-lifetime HMAC secret established by 04-01.

## Files Created/Modified

### Created

- `src/lib/admin/audit.ts` (~225 lines) — router factory + Zod validator + auditRowToWire normaliser + GET handler
- `src/lib/admin/__tests__/audit.int.test.ts` (~440 lines, 14 tests) — real Express + http + pg-mem integration suite

### Modified

- `src/lib/admin/router.ts` — added `import { createAuditRoutes } from './audit.js';` and replaced the `TODO(04-05)` anchor with the active mount (`r.use('/audit', createAuditRoutes(deps));`). Header comment at line 13 updated to drop the TODO annotation. (3-line diff.)

## Decisions Made

(Already captured in the frontmatter `key-decisions` block. Summarised here for narrative completeness.)

- **Read-only surface, no admin write to audit_log** — keeps the D-13 append-only invariant intact at the HTTP boundary. Writes flow exclusively through `src/lib/audit.ts::writeAudit` / `writeAuditStandalone`.
- **403 on RBAC conflict, not silent rewrite** — loud denials preserve auditability of the refused request.
- **Action filter accepts any string, not the AuditAction union** — decouples the query surface from the write-side union literal, so future actions (04-06 through 04-09) become queryable without code change here.
- **No audit row for the GET itself** — avoids audit-of-audit recursion and row flooding. Deferred to a future observability phase behind an explicit env flag if required.
- **Row shape preserves meta as `Record<string, unknown>`** — schema-on-read contract from 03-10 flows through the read surface without transformation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] PLAN.md / CONTEXT.md / RESEARCH.md / PATTERNS.md for plan 04-05 not present in the worktree**

- **Found during:** Plan load (pre-Task 1).
- **Issue:** Worktree base (a3df027) did not include `.planning/phases/04-admin-api-webhooks-delta-persistence/04-05-PLAN.md`, `-CONTEXT.md`, `-RESEARCH.md`, or `-PATTERNS.md`. `git log --all` searched across branches; none carried these files. The siblings 04-01/04-03/04-04/04-09 ship as SUMMARY files only (no PLAN artefacts preserved post-execution). This is a plan-artefact-coverage issue for the phase, not a scope change for this plan.
- **Fix:** Derived the task plan from:
    1. Orchestrator success_criteria (cursor pagination; RBAC via SQL-param filter; filter set tenant_id/since/until/action/actor/cursor/limit; request_id correlation; `{data, next_cursor, has_more}` shape).
    2. Established patterns in 04-01-SUMMARY.md (createAdminRouter anchor contract, cursor helpers), 04-02-SUMMARY.md (tenants.ts SQL-param RBAC pattern), 04-04-SUMMARY.md (AdminIdentity shape).
    3. Source-of-truth files: `src/lib/audit.ts` (AuditAction union, AuditRow contract), `migrations/20260501000100_audit_log.sql` (schema + indexes), `src/lib/admin/tenants.ts` (tuple-comparison cursor pattern), `src/lib/admin/api-keys.ts` (list endpoint shape).
- **Files touched:** None beyond the planned output.
- **Verification:** All 14 tests pass; admin regression suite 143/143 green; build clean; lint/format clean.
- **Committed in:** (captured in this SUMMARY — no separate code commit needed)

**2. [Rule 2 — Missing critical] `action` filter accepts free-form strings, not the AuditAction union**

- **Found during:** Task 1 GREEN (Zod validator authoring).
- **Issue:** The AuditAction union in src/lib/audit.ts is closed (14 literals). A strict match on the READ surface would require a type-sync contract between audit.ts and audit query, breaking whenever a new literal lands (plans 04-06 through 04-09 each add some).
- **Fix:** Accepted any string with length 1..128, exact-match via SQL `= $4::text`. This is a deliberate decoupling — the query endpoint auto-surfaces new actions as soon as the writer lands them, no code change needed. Length cap prevents pathological queries; exact match prevents regex DoS. Documented in key-decisions.
- **Files modified:** src/lib/admin/audit.ts (ListAuditZod shape decision at authoring time).
- **Verification:** Test 6 (action=admin.tenant.create) exercises the filter; future new actions land queryable automatically.
- **Committed in:** 7093de4 (Task 1 GREEN)

**3. [Rule 1 — Style fix] Prettier-formatted audit.ts + audit.int.test.ts after initial write**

- **Found during:** Post-Task-1-GREEN prettier --check
- **Issue:** Long-ish import lines and some string-template formatting needed prettier's opinionated wrapping (printWidth=100 per .prettierrc).
- **Fix:** Ran `npx prettier --write src/lib/admin/audit.ts src/lib/admin/__tests__/audit.int.test.ts`. Re-ran the 14 tests post-format; all still pass; no semantic change.
- **Files modified:** src/lib/admin/audit.ts, src/lib/admin/__tests__/audit.int.test.ts
- **Verification:** `npx prettier --check src/lib/admin/audit.ts src/lib/admin/__tests__/audit.int.test.ts` returns "All files formatted correctly"; 14/14 tests still pass after formatting.
- **Committed in:** 7093de4 (Task 1 GREEN — prettier ran during verification, post-write, pre-commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 — format, 1 Rule 2 — decoupling, 1 Rule 3 — missing plan artefacts). None change the plan's invariants or success criteria.

## Issues Encountered

- **Worktree base reset required at agent start** — worktree HEAD was at `e733885`; orchestrator expected `a3df027`. Applied `git reset --hard a3df027d80eaa0491336f7764f6b2c17b0390d57` per worktree_branch_check; verified matched before any work began. No content changes discarded (worktree was clean pre-reset).
- **`.planning/phases/04-admin-api-webhooks-delta-persistence/04-05-PLAN.md` and siblings missing from the worktree** — see Deviation #1. Mitigated by deriving tasks from the orchestrator's success criteria + 04-01/04-02/04-04 SUMMARY files + code primitives already in-tree.
- **`node_modules` not present at agent start** — ran `npm install --no-audit --no-fund --prefer-offline` to populate. Completed in ~7 seconds.
- **Pre-existing TypeScript friction in admin handlers** — `tsc --noEmit` reports TS2769 "No overload matches this call" on every admin sub-router's `r.get/post/patch` handler that returns `Promise<void>` after a short-circuit `return`. Baseline: 15 TS2769 errors across tenants.ts + api-keys.ts + related admin files. With our `audit.ts` added: 16. Our file adds exactly 1 error, identical pattern to the 15 pre-existing. This is a systemic Express+TS typing friction across the admin module, NOT a new bug. `npm run build` (tsup) exits 0 — tsup compiles without the strict type-checker, so this does not break the deliverable. Documented for future `tsconfig`/types cleanup (outside the scope of plan 04-05 per scope-boundary rule).
- **Pre-existing test failures in other test files** — the worktree has pre-existing failures in non-admin test files (TS2345/TS2322 in unrelated areas). Our changes introduce zero new failures: admin test suite is 143/143 green; the 14 new tests all pass.

## Deferred Issues

- **No audit row emitted for the GET /admin/audit read itself** — the read endpoint does not emit its own audit row. See key-decisions #5. A future observability plan behind an explicit env flag could add read-audit if required for SOC 2 / ISO 27001 controls. Out of scope for 04-05 (not in success_criteria).
- **TypeScript `tsc --noEmit` friction** — 1 new TS2769 error added by audit.ts, matching the 15-pre-existing pattern across admin handlers. Systemic to the admin module; fix belongs in a dedicated `tsconfig` / `@types/express` cleanup plan. tsup build is unaffected; the production bundle compiles cleanly.

## User Setup Required

None for this plan — GET /admin/audit is only active when operators set `MS365_MCP_ADMIN_APP_CLIENT_ID` + `MS365_MCP_ADMIN_GROUP_ID` (the gate established by plan 04-01). Once the admin router is mounted, the endpoint is reachable at `GET /admin/audit` with authentication via either X-Admin-Api-Key (tenant-scoped view) or Authorization: Bearer (Entra global view).

Example calls once deployed:

```
# Global admin, no filters, default page size:
GET /admin/audit
Authorization: Bearer <entra-admin-token>

# Tenant-scoped admin, own-tenant scan (forced by SQL-param filter):
GET /admin/audit
X-Admin-Api-Key: <plaintext>

# Filter by action + actor, custom page size:
GET /admin/audit?action=admin.tenant.create&actor=user-oid&limit=100

# Time window + cursor pagination:
GET /admin/audit?since=2026-01-01T00:00:00Z&until=2026-02-01T00:00:00Z
GET /admin/audit?cursor=<from-prior-response-next_cursor>
```

## Next Phase Readiness

- **Admin audit query surface is GREEN** — 14 new integration tests, 143/143 admin suite green, build exits 0, prettier + lint clean on new files.
- **Downstream plans inherit the shape automatically** — when 04-06 lands its admin-action audit logging enhancements (richer meta), 04-07 adds webhook delivery audit rows, and 04-08+ extend the AuditAction union, all become immediately queryable through this endpoint without code change here. The schema-on-read contract and string-based action filter are the forward-compat contract.
- **Threat surface is bounded** — read-only / append-only architecture removes the repudiation-by-admin attack class; SQL-param RBAC bounds cross-tenant access; HMAC cursor gate bounds enumeration tamper; problem+json envelopes bound info disclosure.
- **No blockers** — Phase 4 remaining plans (04-06 onwards) can proceed on top of these commits. The `/admin/audit` mount is permanent in the router; no further wiring needed.

## Self-Check: PASSED

**Files (all existence-verified 2026-04-20T09:26:22Z in worktree):**

- FOUND: src/lib/admin/audit.ts
- FOUND: src/lib/admin/\_\_tests\_\_/audit.int.test.ts

**Commits (all present on current worktree branch):**

- FOUND: 8db678d (Task 1 RED)
- FOUND: 7093de4 (Task 1 GREEN)
- FOUND: e672810 (Task 2 wire)

**Automated verifications (all post-final-commit):**

- `npx vitest run src/lib/admin/__tests__/audit.int.test.ts` — 14/14 PASS (~500ms)
- `npx vitest run src/lib/admin/__tests__/` — 143/143 PASS (admin suite, no regression)
- `npx prettier --check src/lib/admin/audit.ts src/lib/admin/__tests__/audit.int.test.ts src/lib/admin/router.ts` — "All files formatted correctly"
- `npx eslint src/lib/admin/audit.ts src/lib/admin/router.ts` — 0 errors, 0 warnings on production code; 3 `any` warnings in the test file (consistent with tenants.int.test.ts's 6)
- `npm run build` — tsup exits 0; dist/lib/admin/audit.js emitted

**Router wiring verification:**

- `grep -n "createAuditRoutes" src/lib/admin/router.ts` — matches on import (line 37) and mount (line 178)
- `grep -n "TODO(04-05)" src/lib/admin/router.ts` — 0 matches (anchor replaced)
- Mount order preserved: tls → cors → /health → auth → /tenants → /api-keys → /audit → subscribe (line numbers 154/157/165/174/176/177/178/184)

## TDD Gate Compliance

- **RED commit** (test failing before impl): `8db678d` — `Cannot find module '../audit.js'` from vitest on audit.int.test.ts. Verified by running the test before writing impl; failed at module-resolve time with canonical RED error.
- **GREEN commit** (impl makes RED pass): `7093de4` — audit.ts shipped; all 14 tests pass in ~500ms.
- **REFACTOR:** not a separate commit. Prettier formatting applied inline during the GREEN verification (Deviation #3); no semantic refactoring was necessary.
- **Task 2** is `type="auto"` (non-TDD wiring task) — single commit `e672810` mounts the sub-router and updates the middleware-order comment; test suite re-run confirms no regression (143/143).

---

_Phase: 04-admin-api-webhooks-delta-persistence_
_Completed: 2026-04-20_
