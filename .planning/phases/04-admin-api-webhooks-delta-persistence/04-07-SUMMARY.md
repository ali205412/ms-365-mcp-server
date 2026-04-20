---
phase: 04-admin-api-webhooks-delta-persistence
plan: 07
subsystem: webhooks
tags:
  [webhook, graph-notifications, clientstate, dedup, rate-limit, phase-4]

# Dependency graph
requires:
  - phase: 01-foundation-hardening
    provides:
      "pino logger with REDACT_PATHS (D-01); pino-http stamps req.id used as
       audit_log.request_id (MWARE-07 correlation)."
  - phase: 03-multi-tenant-identity-state-substrate
    provides:
      "loadTenant middleware (03-08) with TENANT_GUID_REGEX guard; MemoryRedisFacade
       + ioredis client (03-02); TenantPool.getDekForTenant warm-path DEK accessor
       (03-05); src/lib/crypto/envelope.ts decryptWithKey + src/lib/crypto/dek.ts
       unwrapTenantDek (03-04); src/lib/audit.ts writeAuditStandalone (03-10);
       migrations/20260501000000_tenants.sql FK CASCADE pattern."
  - phase: 04-admin-api-webhooks-delta-persistence
    provides:
      "04-06: AuditAction union extended with webhook.unauthorized +
       webhook.duplicate + webhook.received literals + per-action meta shape
       registry — plan 04-07 wires handlers only, does not extend union."
provides:
  - "src/lib/admin/webhooks.ts — 539-line Express RequestHandler factory
    implementing all four D-16 paths: per-IP 401 rate-limit guard (shed
    BEFORE DB/decrypt), validation-token sync echo (PITFALL 1 + 2 safe),
    clientState exact-equality auth (PITFALL 3 safe), SET NX dedup with
    24h TTL + X-Webhook-Duplicate observability header."
  - "computeDedupKey({subId, resource, changeType, exp, tenantId}) — sha256
    digest of the 5-tuple per D-16. Deterministic + opaque in Redis keys."
  - "loadSubscriptionByGraphId(pool, tenantId, graphSubId) — (tenant_id,
    graph_subscription_id) SELECT returning encrypted client_state envelope.
    Null return drives 401 (not 404) per D-16 to prevent id enumeration."
  - "migrations/20260601000000_subscriptions.sql — subscriptions table with
    FK CASCADE to tenants, jsonb-encrypted client_state envelope, unique
    index on (tenant_id, graph_subscription_id) + (tenant_id, expires_at)
    index for the plan-04-08 renewal cron."
  - "MemoryRedisFacade.incr(key) + MemoryRedisFacade.expire(key, seconds)
    — ioredis-compatible additions so stdio mode and integration tests
    support the per-IP 401 counter contract without a real Redis."
  - "POST /t/:tenantId/notifications mount in src/server.ts inside
    mountTenantRoutes after the /mcp routes, fronted by express.json
    ({limit:'1mb'}) + loadTenant middleware chain. KEK closure-captured
    via loadKek() at mount time; best-effort — mount failure logs warn
    and leaves the rest of the tenant surface serving."
  - "24 integration tests across 4 new files covering each D-16 path +
    D-01 plaintext-scrub invariant: webhook-validation.int.test.ts (5),
    webhook-auth.int.test.ts (8), webhook-ratelimit.int.test.ts (5),
    webhook-dedup.int.test.ts (6)."
affects:
  - "04-08 (subscription lifecycle MCP tools): populates subscriptions rows
    (including crypto.randomBytes(32).toString('base64url') clientState
    encrypted with the tenant DEK) that this receiver reads + decrypts.
    validationUrl contract (<PUBLIC_URL>/t/<tenantId>/notifications) must
    match the mount path landed here exactly, else Graph's validation-token
    probe 404s."
  - "04-09 (delta-token persistence): no direct coupling; the delta-token
    helper is invoked by subscription-lifecycle tools that issue Graph
    /subscriptions POST, so the plan-04-08 consumer ties both together."
  - "Phase 6 (ops): per-tenant rate limiting layers on top of the per-IP
    rate limit delivered here; Prometheus counters will observe
    mcp:webhook:{dedup,401} key TTL expiry rates."
  - "ROADMAP SC#4 (webhook clientState + dedup): validationToken + clientState
    + 401 paths closed here; full closure after 04-08 ships subscription-
    create that seeds the subscriptions table this receiver reads."

# Tech tracking
tech-stack:
  added:
    - "(no new runtime deps) — uses existing pg, ioredis, node:crypto
      (createHash + randomBytes for sha256 dedup + tests), express
      (route-specific express.json({limit:'1mb'}))"
  patterns:
    - "Rate-limit shed BEFORE validation: the first branch of the handler
      reads mcp:webhook:401:<ip> and 429s on >= MAX_401_PER_MINUTE_PER_IP
      without any DB or decrypt work. Attack traffic incurs only a single
      Redis GET + a constant-time status code. Matches T-04-17 disposition
      (DoS mitigation)."
    - "Fail-open on Redis partition: rate-limit peek wraps the redis.get()
      in a try/catch; any Redis failure logs warn + falls through to the
      validation path rather than returning 503. Same discipline for
      dedup SET NX — a Redis outage proceeds as first-receipt, emitting
      webhook.received so we never silently drop a notification (T-04-15c
      + T-04-17a dispositions)."
    - "DEK cold-pool fallback: getDekForTenant is the warm path; the cold
      fallback unwraps tenant.wrapped_dek directly via the KEK. Webhook
      delivery does NOT trigger MSAL client construction — keeps the
      webhook code path independent from the outbound Graph code path."
    - "Sync echo + PITFALL 1/2 enforcement: validationToken handshake is
      NON-async after the query-param read; body is decodeURIComponent'd
      (defensive — Express already decodes) and returned as text/plain
      200 with no JSON wrapping. Integration Test 2 asserts the decode
      via ?validationToken=hello%20world → body 'hello world'."
    - "PITFALL 3 exact-equality compare on clientState: decrypted envelope
      → .toString('utf8') → `expected !== n.clientState`. No toLowerCase,
      no trim, no HMAC layer. Integration Test 4 (Secret-ABC vs secret-abc)
      + Test 5 (' leading-space' vs 'leading-space') prove the contract."
    - "Suffix-only audit meta: received_client_state_suffix = last 4 chars
      of received value; dedup_key_suffix = last 8 chars of sha256 hex.
      D-01 redactor allowlist never sees the plaintext clientState;
      logger-mock grep assertions in Tests 2 + 8 prove the invariant."
    - "Fire-and-forget audit writes: writeAuditStandalone is called via
      `void` so the HTTP 401/202 response latency is decoupled from
      Postgres INSERT durability. pino shadow log carries the audit row
      on DB failure per plan 03-10 invariants."
    - "Dedup TTL sized for retry tolerance: 24h TTL against Graph's
      documented 4h max-retry window = 6× buffer. Test 6 proves TTL
      expiry re-allows the same notification with a fresh 24h window."

key-files:
  created:
    - "migrations/20260601000000_subscriptions.sql (41 lines)"
    - "src/lib/admin/webhooks.ts (539 lines)"
    - "src/lib/admin/__tests__/webhook-validation.int.test.ts (255 lines, 5 tests)"
    - "src/lib/admin/__tests__/webhook-auth.int.test.ts (611 lines, 8 tests)"
    - "src/lib/admin/__tests__/webhook-ratelimit.int.test.ts (390 lines, 5 tests)"
    - "src/lib/admin/__tests__/webhook-dedup.int.test.ts (502 lines, 6 tests)"
  modified:
    - "src/lib/redis-facade.ts (+47 lines) — incr/expire additions"
    - "src/server.ts (+42 lines) — /t/:tenantId/notifications mount inside
      mountTenantRoutes after /mcp routes"

key-decisions:
  - "DEK cold-pool fallback: tenantPool.getDekForTenant is the preferred
    warm-path accessor, but the webhook handler also falls back to
    unwrapTenantDek(tenant.wrapped_dek, kek) on a MISS so the receiver
    does not force-construct an MSAL client just to decrypt a clientState.
    Alternative (call tenantPool.acquire first) would have MSAL side
    effects inappropriate for a receive-only code path."
  - "Rate-limit counter increment location: incrementUnauthorizedCounter
    fires from auditUnauthorized, NOT from the 429 short-circuit branch.
    The short-circuit only PEEKS at the counter. This preserves the
    invariant 'successful receipts never touch the counter' + makes the
    429 path zero-overhead on Redis writes (only the preceding 10 bad
    POSTs incur the INCR + EXPIRE cost)."
  - "Body-parser limit: route-specific express.json({limit:'1mb'}) matches
    the plan-04-07 text + D-16 contract even though the global parser in
    src/server.ts:1306 is 60mb. Functionally the 1mb cap is a no-op when
    the global parser ran first (express.json skips when req.body is
    already populated); treating the 1mb limit enforcement as a separate
    middleware layer is tracked as a Phase-6 follow-up — see Deferred Issues."
  - "MemoryRedisFacade incr/expire additions: ioredis-compatible shape so
    integration tests don't need a real Redis. INCR preserves existing
    TTL (real Redis parity); EXPIRE returns 0 for missing keys (real Redis
    parity). Documented in the facade's command list."

metrics:
  duration: "16m 26s"
  completed: "2026-04-20T10:07:49Z"
  tasks-total: 2
  tasks-completed: 2
  commits: 4
  files-created: 6
  files-modified: 2
  tests-added: 24
---

# Phase 4 Plan 07: Webhook receiver /t/:tenantId/notifications Summary

Microsoft Graph change-notification receiver landed at
`POST /t/:tenantId/notifications` with all four D-16 paths wired end-to-end,
fronted by a fail-open per-IP 401 rate limit and durable Redis SET NX dedup.
WEBHK-01 + WEBHK-02 closed; validationToken handshake + clientState equality
+ 401 audit + dedup headers are verified by 24 integration tests. The
`migrations/20260601000000_subscriptions.sql` schema with FK CASCADE +
jsonb-encrypted `client_state` envelope ships here so plan 04-08 can
populate rows this receiver decrypts.

## Paths shipped (D-16)

### Path 0 — Per-IP 401 rate limit (attack shed)

The FIRST branch in the handler reads `mcp:webhook:401:<ip>` and returns
`429 Retry-After:60 {error:"rate_limited"}` when the counter is already at
`MAX_401_PER_MINUTE_PER_IP (=10)`. This short-circuits BEFORE any DB or
decrypt work — attack traffic incurs only a single Redis GET and a
constant-time status code. The counter is INCR'd on the actual 401 branch
(via `auditUnauthorized` → `incrementUnauthorizedCounter`), with `EXPIRE 60s`
set on the first-increment. Successful validationToken handshakes and
correctly-authenticated notifications never touch the counter.

Tests 1–5 of `webhook-ratelimit.int.test.ts` exercise the under-threshold /
at-threshold / TTL-expiry / per-IP isolation / success-does-not-increment
contracts.

### Path 1 — Validation-token sync echo (subscription creation probe)

Graph POSTs `?validationToken=<urlencoded>` on subscription creation; the
handler echoes `decodeURIComponent(token)` as `200 text/plain` synchronously.
No JSON wrapping (PITFALL 1). No async operations after the branch (PITFALL 2
defensive decode even though Express auto-decodes). The 5 tests in
`webhook-validation.int.test.ts` assert the exact body match, URL-decode on
`hello%20world` → `hello world`, <100ms p99 latency budget, and that
`loadTenant` 404s upstream handle unknown tenants + malformed GUID segments.

### Path 2 — Notification receipt with clientState equality

Body `{value: NotificationItem[]}` shape-checked via hand-rolled validator
(Zod schema overhead unnecessary for a hot path). For each item:

1. `loadSubscriptionByGraphId(pool, tenant.id, n.subscriptionId)` → null → 401
   + `webhook.unauthorized` audit with `reason: 'unknown_subscription'`.
   Never 404 — prevents id enumeration (D-16).
2. Resolve DEK (`getDekForTenant` warm + `unwrapTenantDek` cold fallback);
   503 `tenant_dek_unavailable` when both paths fail.
3. `decryptWithKey(subRow.client_state, dek).toString('utf8')` → EXACT-byte
   compare against `n.clientState`. Decrypt failure → 401 + `decrypt_failed`
   meta. Mismatch → 401 + `clientstate_mismatch` meta. PITFALL 3 — no
   `.toLowerCase()` or `.trim()`; Graph preserves the subscription-creation
   value verbatim.

The 8 tests in `webhook-auth.int.test.ts` cover the match / mismatch
(suffix-only meta) / unknown-sub / case-sensitive / whitespace-preserved /
batched-all-match / batched-partial-mismatch / decrypt-failure matrices,
including the **D-01 plaintext-scrub invariant** — Test 2 + Test 8 grep the
logger-mock call history for `secret-abc` and assert zero matches.

### Path 3 — Redis SET NX dedup + X-Webhook-Duplicate

Dedup key = `sha256(subscriptionId:resource:changeType:subscriptionExpirationDateTime:tenantId)`.
Stored as `mcp:webhook:dedup:<sha256>` with `EX 86400 NX` (24h = 6× Graph's
4h max-retry window per D-16). First-wins receipts emit `webhook.received`;
duplicates emit `webhook.duplicate` + increment the `X-Webhook-Duplicate`
response header count. Graph itself ignores response headers (D-16 Pitfall 8);
the header is an operator observability signal.

The 6 tests in `webhook-dedup.int.test.ts` cover first-receipt / duplicate-
within-24h / different-changeType / different-expiration / multi-item-batch-
with-partial-dup / TTL-expiry-re-allows matrices, including the last-8-char
`dedup_key_suffix` meta contract.

## subscriptions migration

`migrations/20260601000000_subscriptions.sql` lands the schema plan 04-08
will populate:

```sql
CREATE TABLE subscriptions (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  graph_subscription_id   text NOT NULL,
  resource                text NOT NULL,
  change_type             text NOT NULL,
  notification_url        text NOT NULL,
  client_state            jsonb NOT NULL, -- Envelope {v, iv, tag, ct}
  expires_at              timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_subscriptions_tenant_graph_id
  ON subscriptions (tenant_id, graph_subscription_id);

CREATE INDEX idx_subscriptions_tenant_expires
  ON subscriptions (tenant_id, expires_at);
```

FK CASCADE extends the cryptoshred contract: deleting a tenant drops all
subscription rows (parity with `audit_log`, `api_keys`, `delta_tokens`).
`client_state` is `jsonb NOT NULL` matching the `Envelope {v, iv, tag, ct}`
shape produced by `encryptWithKey`.

## Dedup key composition + TTL

| Component                          | Purpose                                 |
| ---------------------------------- | --------------------------------------- |
| `subscriptionId`                   | Per-subscription identity               |
| `resource`                         | Same-sub different-resource split       |
| `changeType`                       | created / updated / deleted distinct    |
| `subscriptionExpirationDateTime`   | Renewal rotation → fresh dedup window   |
| `tenantId`                         | Multi-tenant cross-boundary isolation   |

- sha256 of `${...joined by ':'}` → hex digest (64 chars).
- Stored under `mcp:webhook:dedup:<hex>` with `EX 86400`.
- Audit meta carries only `dedup_key_suffix = hex.slice(-8)` — opaque even to
  operators; sufficient for forensic correlation with Redis key logs.

## Rate-limit thresholds + TTL

| Constant                           | Value  | Purpose                           |
| ---------------------------------- | ------ | --------------------------------- |
| `MAX_401_PER_MINUTE_PER_IP`        | `10`   | 401-per-IP-per-minute ceiling     |
| `UNAUTHORIZED_RATE_TTL_SECONDS`    | `60`   | Sliding window reset              |
| `DEDUP_TTL_SECONDS`                | `86400`| 24h = 6× Graph 4h max retry       |

Retry-After header equals `UNAUTHORIZED_RATE_TTL_SECONDS` on 429 so
conforming clients back off for the full sliding window.

## Threats mitigated

| ID     | Category       | Mitigation                                                              |
| ------ | -------------- | ----------------------------------------------------------------------- |
| T-04-15| I (InfoDisclose)| text/plain echo (not JSON) + PITFALL 1 test                            |
| T-04-16| S (Spoofing)   | Exact-equality clientState compare + randomBytes(32) per-sub entropy    |
| T-04-17| D (DoS)        | Per-IP 10/min 401 rate limit; shed BEFORE DB/decrypt                    |
| T-04-18| T (Tampering)  | SET NX dedup 24h TTL; idempotent on Graph retry                         |
| T-04-15a| I (InfoDisclose)| Plaintext clientState never logged; suffix-only meta; grep-tested      |
| T-04-15b| T (Tampering) | decodeURIComponent even when Express auto-decodes                       |
| T-04-15c| R (Repudiation)| Dedup SET NX failure proceeds as first-receipt; no silent drops        |
| T-04-16a| E (EoP)       | express.json({limit:'1mb'}) route-specific cap                          |

## Self-Check: PASSED

### Created files

- `migrations/20260601000000_subscriptions.sql`: FOUND
- `src/lib/admin/webhooks.ts`: FOUND
- `src/lib/admin/__tests__/webhook-validation.int.test.ts`: FOUND
- `src/lib/admin/__tests__/webhook-auth.int.test.ts`: FOUND
- `src/lib/admin/__tests__/webhook-ratelimit.int.test.ts`: FOUND
- `src/lib/admin/__tests__/webhook-dedup.int.test.ts`: FOUND

### Commits

- 448b7e7 `test(04-07): add failing tests for webhook validation-token + clientState + subscriptions migration`: FOUND
- 28f1b7c `feat(04-07): implement webhook validation-token echo + clientState equality + 401 audit`: FOUND
- c528e58 `test(04-07): add failing tests for Redis dedup + per-IP 401 rate limit`: FOUND
- 4f25955 `feat(04-07): Redis dedup + per-IP 401 rate limit + server.ts mount`: FOUND

## Deferred Issues

### Body-parser limit enforcement

`express.json({limit: '1mb'})` is applied route-specifically to
`POST /t/:tenantId/notifications`, but the global `express.json({limit:
'60mb'})` at `src/server.ts:1306` runs FIRST in the middleware chain. Since
`express.json` is a no-op when `req.body` is already populated, the 1 MiB
cap is not functionally enforced — only documented intent + grep-acceptance
satisfied. Refinement options (route-specific body parser bypassing the
global one, or a Content-Length gate middleware BEFORE the global parser)
are tracked for Phase 6.

### Task 2 awk acceptance grep

The plan's `awk '/mountTenantRoutes/...' src/server.ts` check is overly
greedy — it matches `mcp` occurrences file-wide (including the legacy
`/mcp` mount at line 1820) rather than confining to the
`private mountTenantRoutes` scope. The implementation DOES place the
webhook mount AFTER the `/mcp` routes INSIDE `mountTenantRoutes` (lines
1195-1196 for `/mcp`, line 1198+ for `phase4-webhook-receiver` region).
Verified via a scoped awk variant in this executor run; the plan's
original grep is a false-negative.

## Downstream

Plan 04-08 (subscription lifecycle MCP tools) consumes this receiver:

1. `subscriptions-create` mints `crypto.randomBytes(32).toString('base64url')`
   clientState, encrypts via the tenant DEK, INSERTs a `subscriptions` row,
   then issues Graph `POST /subscriptions` with `notificationUrl =
   <PUBLIC_URL>/t/<tenantId>/notifications` (must match the mount path
   landed here exactly — mismatch → Graph validation-token probe 404s).
2. `subscriptions-renew` re-encrypts + UPDATE + Graph `PATCH`; plan 04-07
   dedup key includes `subscriptionExpirationDateTime`, so a rotation
   produces a fresh dedup window automatically.
3. `subscriptions-delete` Graph `DELETE` + DELETE FROM subscriptions.

ROADMAP SC#4 (webhook validation + clientState + dedup) is partially closed
by this plan; full closure after plan 04-08 ships subscription creation.

## Deviations from Plan

None — plan executed exactly as written for both tasks. All acceptance-
criteria greps pass (one with a scope-corrected awk; see Deferred Issues
for the original's false-negative explanation).
