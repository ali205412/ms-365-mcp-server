---
phase: 04-admin-api-webhooks-delta-persistence
plan: 06
subsystem: api
tags:
  [admin, audit, transactional, rollback, shadow-log, adr-06, phase-4]

# Dependency graph
requires:
  - phase: 01-foundation-hardening
    provides:
      "pino logger with REDACT_PATHS; pino-http stamping req.id used as
       audit_log.request_id (MWARE-07 correlation)"
  - phase: 03-multi-tenant-identity-state-substrate
    provides:
      "src/lib/audit.ts writeAudit + writeAuditStandalone + AuditAction union
       (plan 03-10); src/lib/postgres.ts withTransaction; audit_log table
       (migrations/20260501000100_audit_log.sql) with NOT NULL tenant_id
       FK + request_id + JSONB meta; pg-mem test harness pattern from
       test/audit/audit-writer.test.ts"
  - phase: 04-admin-api-webhooks-delta-persistence
    provides:
      "04-02: admin.tenant.{create,update,disable,delete,rotate-secret}
       writeAudit / writeAuditStandalone call sites (src/lib/admin/tenants.ts)
       with meta shapes. 04-03: admin.api-key.{mint,revoke,rotate} writeAudit
       call sites in src/lib/admin/api-keys.ts. 04-04: req.admin {actor,
       source, tenantScoped} populated by dual-stack middleware. 04-05:
       GET /admin/audit cursor query endpoint"
provides:
  - "AuditAction union extended from 13 → 22 members with Phase-4 coverage
    (5 admin.tenant.* + 3 admin.api-key.* + 1 admin.audit.query + 3
    webhook.* + 2 webhook.subscription.* staged for plans 04-07 / 04-08)"
  - "Per-action meta shape registry documented inline as JSDoc in
    src/lib/audit.ts — 22 action literals, 19 with explicit meta shape
    blocks (the oauth.* + kek.rotate + session.* + tenant.disable
    + graph.error shapes were already documented from plan 03-10)"
  - "admin.audit.query self-audit emission in GET /admin/audit handler —
    tenant-scoped queries persist an audit_log row via writeAuditStandalone;
    cross-tenant global queries emit a pino info log (audit_log.tenant_id
    is NOT NULL FK to tenants so zero-GUID forgery is not viable)"
  - "Integration guardrails verifying that every /admin/* mutation emits
    an audit row with admin identity + IP + request_id + correct meta shape
    (ADMIN-06 coverage)"
  - "Rollback invariant proved end-to-end: primary mutation failure inside
    withTransaction rolls back both the primary write and the audit row —
    no orphan admin.tenant.create for a never-happened mutation"
  - "Shadow-log contract tested end-to-end for admin cascade audits —
    pool.query outage on writeAuditStandalone does NOT affect HTTP response
    and emits pino error with {audit_shadow:true, audit_row, err}"
affects:
  - "04-07 (webhook receiver): webhook.unauthorized / webhook.duplicate /
    webhook.received action literals + meta shape registry staged in
    audit.ts — plan only needs to wire handlers, not extend union"
  - "04-08 (subscription lifecycle): webhook.subscription.renewed /
    webhook.subscription.renew_failed staged in union; per-action meta
    shapes documented so renewal cron drops in cleanly"
  - "Downstream admin handlers: call-site discipline enforced by grep-
    based secret scan in Task 1 Test 11 — regression guard against future
    handlers that accidentally inline plaintext_key / wrapped_dek /
    key_hash / refresh_token in meta"

# Tech tracking
tech-stack:
  added:
    - "(no new runtime deps)"
  patterns:
    - "Transactional audit via writeAudit(client, row): audit INSERT runs
      on the same PoolClient as the primary mutation inside withTransaction
      — a single ROLLBACK reverts BOTH rows. Used for admin.tenant.create,
      admin.tenant.update, admin.tenant.rotate-secret, admin.tenant.delete,
      admin.api-key.mint / revoke / rotate. Absolute invariant: no audit
      row ever survives a rolled-back primary mutation."
    - "Standalone / shadow audit via writeAuditStandalone(pool, row): audit
      INSERT runs against the pool directly; DB error is caught and emitted
      via pino at error level with audit_shadow:true. Used when the audit
      event lands AFTER the primary COMMIT (admin.tenant.disable cascade
      counters, admin.audit.query self-audit). Never throws — the primary
      200 response is never affected by audit durability failures."
    - "Test technique: client.query wrapper to inject simulated errors on
      specific SQL patterns inside withTransaction. The audit INSERT (which
      runs on the same client) lands inside the BEGIN; when we throw on
      the primary INSERT, the harness's ROLLBACK reverts both rows together.
      This mirrors the tenants.rotate.int.test.ts txFailMode pattern."
    - "Test technique: pool.query wrapper to intercept audit INSERTs fired
      by writeAuditStandalone specifically — it uses pool.query directly,
      while transactional writes go through pool.connect() + client.query
      and are unaffected. This cleanly isolates the shadow-log path for
      testing without running a separate mock Pool fixture."
    - "Call-site redaction scan: every audit_log row across all admin.*
      actions is grepped for plaintext_key, client_secret, wrapped_dek
      (field name), key_hash, $argon2, msk_live_<43chars>, refresh_token,
      Bearer ey. ZERO matches across 5+ rows. This is the regression guard
      that future admin handlers don't silently embed secrets in meta."

key-files:
  created:
    - "src/lib/admin/__tests__/audit-writer.int.test.ts (777 lines, 13 tests)
      — per-action audit shape + secret scan + request_id + ip correlation
      + actor-source tracking"
    - "src/lib/admin/__tests__/audit-rollback.int.test.ts (524 lines, 6 tests)
      — transactional rollback invariant + shadow-log invariant + secret-free
      shadow payload + Zod 400 no-audit contract"
    - ".planning/phases/04-admin-api-webhooks-delta-persistence/04-06-SUMMARY.md
      — this document"
  modified:
    - "src/lib/audit.ts — AuditAction union extended from 13 to 22 members;
      per-action meta shape JSDoc registry extended and split into Phase-3 /
      Phase-4 admin.* / Phase-4 webhook.* sections; redaction discipline
      re-stated inline"
    - "src/lib/admin/audit.ts — GET /admin/audit handler now emits
      admin.audit.query self-audit row via writeAuditStandalone for tenant-
      scoped queries; cross-tenant global queries emit a pino info log
      (deferred to writeAudit-requires-FK-tenant constraint; see Deviations
      section below)"

key-decisions:
  - id: D-04-06-a
    decision: "admin.audit.query self-audit is tenant-scoped ONLY — cross-
      tenant global queries fall back to pino info log"
    rationale: "audit_log.tenant_id is NOT NULL with an ON DELETE CASCADE FK
      to tenants. Global admin queries (tenant_id filter omitted) have no
      valid tenants row to hang an audit_log row on. A sentinel / zero-GUID
      would violate the FK and silently fail OR require seeding a platform
      tenant. Deferred per ADMIN-06 tenant-centric scope: global-admin
      observability is served by pino info logs that OTel export upstream."
    alternatives_considered:
      - "Seed a PLATFORM_TENANT row and point global-admin audit rows at
        its id — rejected as adds a magic row with no real tenant meaning
        and widens the blast radius if its GUID leaks into other queries"
      - "Make audit_log.tenant_id NULLable — rejected because the (tenant_id,
        ts DESC) primary index + the FK CASCADE cryptoshred contract both
        rely on every row belonging to exactly one tenant"
  - id: D-04-06-b
    decision: "Test harness uses pg-mem with per-test mock of postgres.js
      rather than testcontainers — shadow-log path is tested via a
      pool.query wrapper that selectively throws"
    rationale: "The tenants.rotate.int.test.ts + audit.int.test.ts + existing
      03-10 test/audit/audit-writer.test.ts all use pg-mem; introducing
      testcontainers for a single file's worth of tests would add ~30s of
      startup latency to every vitest run and create a parallel harness
      style. pg-mem's BEGIN/COMMIT/ROLLBACK semantics are sufficient for
      testing transactional audit (verified in 03-10 + reused here) and
      the shadow-log path depends only on the writer's catch-and-log logic,
      not any Postgres-specific behaviour."
    alternatives_considered:
      - "testcontainers-pg for full fidelity — deferred to Phase 6 polish
        once the harness overhead becomes the bottleneck"

# Threats mitigated
threats_mitigated:
  - id: T-04-14
    category: Repudiation
    description: "Admin mutation succeeds but audit row silently fails"
    disposition: mitigate
    evidence: "Test 1 (audit-rollback.int.test.ts): primary INSERT throws
      → withTransaction ROLLBACKs → audit row ALSO reverted. Test 2-3
      (shadow log): writeAuditStandalone DB outage → pino error with
      audit_shadow:true + full audit_row payload → operators grep logs
      to reconstruct. Either path leaves a durable record."
  - id: T-04-14a
    category: Info Disclosure
    description: "Shadow log leaks secrets that the original meta already omitted"
    disposition: mitigate
    evidence: "Test 4 (audit-rollback.int.test.ts): shadow log JSON payload
      scanned for plaintext_key / client_secret / wrapped_dek / key_hash /
      $argon2 / msk_live_ / refresh_token / Bearer ey — ZERO matches.
      Redaction happens at the AuditRow.meta construction site; the shadow
      log path is a pass-through that cannot add secrets."
  - id: T-04-14b
    category: Tampering
    description: "Audit row for NEVER-HAPPENED mutation (rollback race)"
    disposition: mitigate
    evidence: "Test 1 + Test 5 (audit-rollback.int.test.ts): forced primary
      failure inside withTransaction → 500 response + ZERO audit_log rows
      for admin.tenant.create + ZERO tenants rows. Transactional contract
      preserved atomically."
  - id: T-04-14c
    category: Repudiation
    description: "Validation failure (400) not audited"
    disposition: accept
    evidence: "Test 6 (audit-rollback.int.test.ts): POST /admin/tenants
      missing client_id → 400 + ZERO audit_log rows. Current D-13 contract:
      successful mutations only. Attempted-mutation audit deferred to
      Phase 6+ once operator demand emerges."
  - id: T-04-14d
    category: DoS
    description: "Audit INSERT flooding saturates PG"
    disposition: mitigate
    evidence: "Inherited from Phase 3: idx_audit_log_tenant_ts +
      parametrised INSERT. Phase 6 per-tenant rate limit caps admin request
      rate. Not re-verified in this plan because no new audit-insert path
      was added that changes the throughput envelope."

# Metrics
metrics:
  duration_min: "~10"
  completed_date: "2026-04-19"
  task_count: 2
  test_count: 19
  file_count: 4
---

# Phase 4 Plan 06: Admin-action audit writer integration — transactional audit + rollback invariant + shadow log

**One-liner:** Proves every `/admin/*` mutation lands an audit row inside the
same transaction as the primary write (or shadow-logs to pino on DB outage),
via 19 integration tests spanning every Phase-4 admin action + rollback +
redaction scans.

## What shipped

This plan delivers **integration verification for ADMIN-06** — every `/admin/*`
mutation now has a red/green guardrail proving it writes `audit_log` with the
correct shape, stays transactional on failure, and falls back to the pino
shadow log on DB outage. No handler code changed in `src/lib/admin/tenants.ts`
or `api-keys.ts` — plans 04-02 and 04-03 already correctly call `writeAudit` /
`writeAuditStandalone`. The two adjustments this plan made to production code
were (a) adding missing `AuditAction` union members that 04-02/03/05 had
bypassed via string casts, and (b) adding a self-audit to `GET /admin/audit`
so the query itself becomes traceable in the admin audit trail.

## Artefacts

| Path | Purpose | Size |
|------|---------|------|
| `src/lib/audit.ts` | Extended `AuditAction` union (13→22 members) + meta-shape registry | +45/-14 lines |
| `src/lib/admin/audit.ts` | Added `admin.audit.query` self-audit emission in GET handler | +41 lines |
| `src/lib/admin/__tests__/audit-writer.int.test.ts` | 13-test integration guardrail for admin.* audit shape | 777 lines |
| `src/lib/admin/__tests__/audit-rollback.int.test.ts` | 6-test integration guardrail for rollback + shadow log | 524 lines |

## The AuditAction union (14 new Phase-4 members)

```typescript
export type AuditAction =
  // Phase 3 (existing):
  | 'oauth.authorize' | 'oauth.token.exchange' | 'oauth.refresh'
  | 'graph.error'     | 'tenant.disable'       | 'kek.rotate'
  | 'session.put'     | 'session.delete'
  // Phase 4 admin.* (ADMIN-01..06):
  | 'admin.tenant.create'        | 'admin.tenant.update'
  | 'admin.tenant.disable'       | 'admin.tenant.delete'
  | 'admin.tenant.rotate-secret'
  | 'admin.api-key.mint'         | 'admin.api-key.revoke'
  | 'admin.api-key.rotate'       | 'admin.audit.query'
  // Phase 4 webhook.* (WEBHK-01..03 — plans 04-07 / 04-08):
  | 'webhook.unauthorized'       | 'webhook.duplicate'
  | 'webhook.received'
  | 'webhook.subscription.renewed'
  | 'webhook.subscription.renew_failed';
```

The webhook.* entries are staged now so downstream plans need only wire
handlers — no more union extensions in this phase.

## Per-action meta shape registry

Every Phase-4 action is documented inline as a JSDoc block in `src/lib/audit.ts`:

| Action | Meta shape |
|--------|-----------|
| `admin.tenant.create` | `{tenantId, clientId, mode, cloudType}` |
| `admin.tenant.update` | `{tenantId, fieldsChanged: string[]}` |
| `admin.tenant.disable` | `{tenantId, cacheKeysDeleted, pkceKeysDeleted, apiKeysRevoked}` |
| `admin.tenant.delete` | `{tenantId, apiKeysRevoked}` (row CASCADE-deleted with tenant — pino log is durable) |
| `admin.tenant.rotate-secret` | `{tenantId, oldWrappedDekHash, newWrappedDekHash}` (16-char sha256 slices) |
| `admin.api-key.mint` | `{keyId, displaySuffix, tenantId}` |
| `admin.api-key.revoke` | `{keyId, tenantId}` |
| `admin.api-key.rotate` | `{oldKeyId, newKeyId, displaySuffixes: {old, new}, tenantId}` |
| `admin.audit.query` | `{tenantIdFilter, sinceFilter, untilFilter, actionFilter, actorFilter, rowsReturned}` |
| `webhook.unauthorized` | `{change_type, resource, received_client_state_suffix}` (staged) |
| `webhook.duplicate` | `{dedup_key_suffix}` (staged) |
| `webhook.received` | `{subscription_id, change_type}` (staged) |
| `webhook.subscription.renewed` | `{subscription_id, expires_at}` (staged) |
| `webhook.subscription.renew_failed` | `{subscription_id, error_code, graph_request_id}` (staged) |

## Transactional vs shadow-log invariants

**Transactional invariant** (tested in `audit-rollback.int.test.ts` Test 1 + 5):

```text
withTransaction(client => {
  // The audit INSERT lands INSIDE the same BEGIN as the primary write.
  await writeAudit(client, auditRow);
  // Primary mutation — if it throws, withTransaction ROLLBACKs everything.
  await client.query('INSERT INTO tenants ...');
});
```

If `INSERT INTO tenants` throws, the `INSERT INTO audit_log` is also reverted.
Test 1 forces `INSERT INTO tenants` to throw via a wrapper on `client.query`;
the post-response audit count is 0 and the tenants count is 0 — clean atomicity.

**Shadow-log invariant** (tested in Tests 2-4):

```text
// Post-COMMIT cascade audit. writeAuditStandalone uses pool.query directly.
await writeAuditStandalone(pool, auditRow);   // throws internally, returns OK
// On DB error: logger.error({audit_shadow: true, audit_row, err}, ...)
```

The handler's HTTP response is never affected. Test 2 forces `pool.query` to
throw on `INSERT INTO audit_log`, asserts the PATCH /disable response is 200,
asserts ZERO persisted audit rows, and asserts `logger.error` fired with
`audit_shadow: true` and the full `audit_row` payload.

## Test matrix

### `audit-writer.int.test.ts` (13 tests)
1. `admin.tenant.create` — full row shape + meta {tenantId, mode, cloudType, clientId}
2. `admin.tenant.update` — meta.fieldsChanged includes patched field
3. `admin.tenant.disable` — meta carries cryptoshred counters (all 0 for fresh tenant)
4. `admin.tenant.delete` — row CASCADE-deletes with tenant; pino info log is durable record
5. `admin.tenant.rotate-secret` — meta {oldWrappedDekHash, newWrappedDekHash}; hashes differ and don't leak envelope bytes
6. `admin.api-key.mint` — meta {keyId, displaySuffix, tenantId}; zero leakage of plaintext/hash/argon2
7. `admin.api-key.revoke` — meta {keyId, tenantId}
8. `admin.api-key.rotate` — meta carries old+new keyId + display suffixes; new plaintext never in meta
9. `admin.audit.query` — tenant-scoped self-audit row persisted with filter summary
10. source tracking — entra → UPN actor; api-key → api-key:<id> actor
11. NO secrets in meta — full surface grepped for plaintext_key / client_secret / wrapped_dek / key_hash / $argon2 / msk_live_ / refresh_token / Bearer ey
12. request_id correlation — every row carries non-empty request_id matching req.id
13. IP correlation — every row has ip populated

### `audit-rollback.int.test.ts` (6 tests)
1. Transactional rollback — forced primary failure → ZERO admin.tenant.create rows
2. Shadow-log path — pool.query outage → 200 response + audit_shadow:true pino error
3. Shadow-log payload shape — audit_row has {tenantId, actor, action, target, ip, requestId, result, meta}
4. Shadow-log redaction — payload scanned for secret patterns; ZERO matches
5. DB consistency after rollback — neither tenants nor audit_log rows persist
6. Zod 400 contract — validation failure writes ZERO audit rows

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan's `oldWrappedDekSuffix`/`newWrappedDekSuffix` meta names don't match implementation**

- **Found during:** Task 1 Test 5 design
- **Issue:** Plan's `<behavior>` block for `admin.tenant.rotate-secret` says "meta={oldWrappedDekSuffix, newWrappedDekSuffix}; suffixes are 8-char strings". But `src/lib/admin/tenants.ts:802` (plan 04-02 — already merged) emits `{oldWrappedDekHash, newWrappedDekHash}` with 16-char sha256 slices via `wrappedDekHash()` helper. Using the plan's names would produce a guaranteed failing test against correctly-shipped code.
- **Fix:** Test asserts the actual field names + lengths. Meta shape registry in `src/lib/audit.ts` updated to match the implementation. Both oldWrappedDekHash and newWrappedDekHash are documented as 16-char sha256 slices.
- **Files modified:** src/lib/audit.ts, src/lib/admin/__tests__/audit-writer.int.test.ts
- **Commit:** `1e66c0a`

**2. [Rule 2 - Missing critical functionality] `admin.audit.query` handler wasn't self-auditing**

- **Found during:** Task 1 Test 9 design
- **Issue:** Plan Test 9 expects GET /admin/audit to emit an `admin.audit.query` audit row with {tenantIdFilter, sinceFilter, untilFilter, actionFilter, actorFilter, rowsReturned}. But `src/lib/admin/audit.ts` (plan 04-05) did not call writeAudit — the endpoint was entirely read-only. Without this, the `admin.audit.query` literal in the AuditAction union was dead code and ADMIN-06's "every admin endpoint writes audit" promise was false.
- **Fix:** Added `writeAuditStandalone(deps.pgPool, {...})` to the handler after the successful response, covering tenant-scoped queries. Cross-tenant global queries (tenant_id filter omitted) fall back to a pino info log because `audit_log.tenant_id` is NOT NULL FK to tenants — see D-04-06-a above.
- **Files modified:** src/lib/admin/audit.ts
- **Commit:** `1e66c0a`

**3. [Rule 3 - Blocking] Plan test harness spec assumed writeAuditStandalone for `admin.tenant.delete`; code uses writeAudit inside txn**

- **Found during:** Task 1 Test 4 design
- **Issue:** Plan Test 4 said "admin.tenant.delete DELETE → audit row with action='admin.tenant.delete', meta contains deleted_subscription_ids + skipped_subscription_ids arrays". But `src/lib/admin/tenants.ts:1051` writes the audit row via `writeAudit(client, ...)` INSIDE the txn that then runs `DELETE FROM tenants`, which FK-CASCADES the audit_log row away. The durable record is a pino info log with event='admin.tenant.delete' (T-04-05f trade-off documented in 04-02). The plan's expected meta fields (subscription_ids) don't exist on the current code path — they would have needed a subscriptions registry (plan 04-08). Instead, meta carries `{tenantId, apiKeysRevoked}`.
- **Fix:** Test asserts the actual behaviour: 0 `admin.tenant.delete` rows in audit_log post-response + a pino info log with event='admin.tenant.delete' + correct fields. The plan's subscription_ids are deferred to 04-08 when subscriptions registry lands.
- **Files modified:** src/lib/admin/__tests__/audit-writer.int.test.ts
- **Commit:** `1e66c0a`

No other deviations. `AuditAction` extension, meta registry, and test harness all match the plan's `must_haves` block.

## Authentication Gates

None. All tests run entirely against the pg-mem harness with a stub admin middleware.

## Verification

```bash
npm test -- src/lib/admin/__tests__/audit-writer.int.test.ts --run
# ✓ 13 tests passed

npm test -- src/lib/admin/__tests__/audit-rollback.int.test.ts --run
# ✓ 6 tests passed

npm test -- src/lib/admin/__tests__/ --run
# ✓ 729 tests passed across 74 files (full admin suite, no regressions)

npm run build
# ✓ tsup exits 0

npx eslint src/lib/audit.ts src/lib/admin/audit.ts \
           src/lib/admin/__tests__/audit-writer.int.test.ts \
           src/lib/admin/__tests__/audit-rollback.int.test.ts
# ✓ 0 errors (4 any-warnings matching repo convention for JSON body parsing)
```

## Downstream Consumers

- **04-07 (webhook receiver):** `webhook.unauthorized` / `webhook.duplicate` /
  `webhook.received` already in `AuditAction` union; per-action meta shapes
  already in the JSDoc registry. Plan's work is writing the handlers, not
  extending audit.ts.
- **04-08 (subscription lifecycle):** `webhook.subscription.renewed` /
  `webhook.subscription.renew_failed` already staged; renewal cron calls
  `writeAuditStandalone` (post-Graph-PATCH cascade audit — not inside a
  primary pg txn). Meta shape `{subscription_id, expires_at}` and
  `{subscription_id, error_code, graph_request_id}` already documented.
- **Phase 5-6 admin hardening:** Call-site redaction scan in Task 1 Test 11
  is the regression guard for any new admin.* action added in later phases.

## Self-Check: PASSED

- [x] `src/lib/audit.ts` — `AuditAction` union has all 22 members (verified via grep in acceptance criteria)
- [x] `src/lib/admin/audit.ts` — writeAuditStandalone emission for admin.audit.query
- [x] `src/lib/admin/__tests__/audit-writer.int.test.ts` — 777 lines, 13 tests all passing
- [x] `src/lib/admin/__tests__/audit-rollback.int.test.ts` — 524 lines, 6 tests all passing
- [x] Commit `1e66c0a` (feat(04-06)) — Task 1 implementation + primary test
- [x] Commit `43713bf` (test(04-06)) — Task 2 rollback / shadow log test
- [x] Commit `docs(04-06)` on `worktree-agent-a8564df5` branch — this SUMMARY.md
- [x] No regressions — full admin suite (729 tests) green
- [x] Build exits 0
- [x] My files lint clean (0 errors; warnings match repo convention)
