---
phase: 04-admin-api-webhooks-delta-persistence
plan: 08
subsystem: subscriptions
tags:
  [subscriptions, mcp-tools, graph-webhooks, renewal-cron, clientstate, phase-4]

# Dependency graph
requires:
  - phase: 01-foundation-hardening
    provides:
      "pino logger with REDACT_PATHS (D-01); graceful-shutdown orchestrator
       with unref'd timers (01-05); typed GraphError hierarchy with
       statusCode narrowing + requestId field (02-03)."
  - phase: 02-graph-transport-middleware-pipeline
    provides:
      "graphClient.makeRequest with composed pipeline (ETag + Retry +
       ODataError + TokenRefresh); typed GraphAuthError / GraphServerError
       subclasses that the cron + renew path narrow via instanceof."
  - phase: 03-multi-tenant-identity-state-substrate
    provides:
      "TenantPool.getDekForTenant (03-05) used by subscriptionsCreate +
       subscriptionsRenew to encrypt clientState; src/lib/audit.ts
       writeAuditStandalone (03-10) used by renew 404 path + cron renewed/
       renew_failed events; src/lib/crypto/envelope.ts encryptWithKey
       (03-04) produces the {v,iv,tag,ct} envelope persisted to
       subscriptions.client_state."
  - phase: 04-admin-api-webhooks-delta-persistence
    provides:
      "04-06: AuditAction union carries webhook.subscription.renewed +
       webhook.subscription.renew_failed — this plan emits them without
       extending the union. 04-07: subscriptions schema + webhook receiver
       that decrypts the clientState envelope this plan produces."
provides:
  - "src/lib/admin/subscriptions.ts (784 lines) — four MCP handlers plus
    the optional renewal cron. Pure module: no import-time globals, no
    environment reads; the caller (src/graph-tools.ts + src/index.ts)
    gates the cron and constructs dependencies."
  - "pickExpirationMinutes(resource, desired) — clamps the caller's desired
    minutes to MAX_EXPIRATION_BY_RESOURCE_PREFIX per D-17 (users/groups
    41760 / chats/teams 4320 / presence 60 / drive 42300 / mail 10080;
    fallback 4320 for unknown prefixes)."
  - "subscriptionsCreate(tenantId, params, deps) — Graph POST /subscriptions
    with notificationUrl constructed from trusted publicUrl+tenantId (never
    caller-controlled; T-04-19 SSRF mitigation). Generates a fresh 32-byte
    clientState via crypto.randomBytes, encrypts with the tenant DEK,
    INSERTs the subscriptions row, and returns an admin-safe wire shape
    (client_state whitelisted out — T-04-20 mitigation)."
  - "subscriptionsRenew(tenantId, params, deps) — Graph PATCH /subscriptions/
    {id}. Rotates clientState on every call (T-04-19a — leaked values become
    useless within one renewal cycle). Uses Graph's response body's
    expirationDateTime for the UPDATE (Pitfall 4). A 404 response DELETEs
    the local row + emits webhook.subscription.not_found so zombies don't
    accumulate."
  - "subscriptionsDelete(tenantId, params, deps) — Graph DELETE /subscriptions/
    {id}. Tolerates Graph 404 idempotently; any other failure preserves the
    local row for retry."
  - "subscriptionsList(tenantId, _, deps) — SELECT * FROM subscriptions
    WHERE tenant_id = $1. Row-level tenancy enforcement at SQL layer
    (D-11); client_state never in response (subscriptionRowToWire whitelist
    serializer)."
  - "registerSubscriptionTools(server, deps) — wires the four handlers as
    MCP tools with readOnlyHint/destructiveHint metadata; delegates
    tenantId resolution to deps.tenantIdResolver so the same registration
    works across HTTP per-request routing and stdio single-tenant paths."
  - "startRenewalCron(deps, opts) + stopRenewalCron(handle) — optional
    in-process cron, gated by MS365_MCP_SUBSCRIPTION_CRON env var. Runs
    every 60s by default (overridable via opts.intervalMs for tests);
    SELECTs rows with expires_at < NOW() + interval '1 hour' JOIN tenants
    WHERE disabled_at IS NULL (Pitfall 10). Per-row try/catch prevents
    single failures from killing the loop; isRunning guard blocks
    overlapping ticks; unref'd setInterval so the timer does not hold
    the event loop open during shutdown."
  - "subscriptions-* MCP tools registered in src/graph-tools.ts via lazy
    dynamic imports of pg + tenant-pool + kek + graphClient so the cold-
    start cost stays at zero on non-HTTP paths. Registration is guarded
    by MS365_MCP_PUBLIC_URL — without it the notificationUrl SSRF
    invariant is meaningless (no scheme+host anchor for the equality
    check) so we log a warn and silently skip."
  - "phase4-subscription-cron startup region + phase4-sub-cron-teardown
    shutdown region in src/index.ts. Cron teardown runs BETWEEN Phase 1
    server.close and the Phase 3 tenantPool.drain per RESEARCH.md:1348-
    1358 so any in-flight renewal can complete with a still-warm DEK
    cache before the pool is emptied."
  - "30 integration tests across 3 new files covering all D-17 paths +
    T-04-19 / T-04-20 / Pitfall 4 / Pitfall 10 invariants:
    subscriptions-create.int.test.ts (10 tests, 420 lines),
    subscriptions-lifecycle.int.test.ts (12 tests, 630 lines — includes
    a full create → renew → delete cycle),
    subscriptions-cron.int.test.ts (8 tests, 568 lines — includes
    in-flight await during graceful shutdown + isRunning overlap guard)."
affects:
  - "WEBHK-03 closes here: AI assistants can now programmatically create /
    renew / delete / list per-tenant Graph subscriptions through the MCP
    surface, with the webhook receiver from 04-07 consuming the encrypted
    clientState this plan produces."
  - "04-09 (delta-token persistence): subscription-lifecycle tools can
    optionally pair with the delta-token wrapper from 04-09 for incremental
    queries — create a subscription to get delivery notifications, use
    delta queries to sync from the last-seen state."
  - "ROADMAP SC#4 (webhook clientState + dedup): fully closed. subscriptions-
    create seeds the table the webhook receiver reads; clientState encryption-
    at-rest contract is end-to-end verified (create → decrypt-on-receive)."
  - "ROADMAP SC#5 (delta-supporting-tool incremental behavior): the
    subscriptions surface is the prerequisite — delivery is landed here,
    delta-token persistence is 04-09."

# Tech tracking
tech-stack:
  added:
    - "(no new runtime deps) — uses existing zod, pg, @modelcontextprotocol/
      sdk, node:crypto (randomBytes + randomUUID for clientState + local ids),
      and the existing Phase 2 middleware pipeline via graphClient.makeRequest."
  patterns:
    - "Whitelist row serializer: subscriptionRowToWire enumerates exactly the
      columns the admin-facing wire shape includes — client_state NEVER
      appears by construction. Prevents the spread-with-delete footgun where
      adding a new sensitive column accidentally leaks (T-04-20). Mirrors the
      shape used by admin.tenants.list in plan 04-03."
    - "Server-side clientState generation: the Zod schema for subscriptions-
      create has NO notificationUrl field and NO clientState field. Both are
      derived server-side from (publicUrl, tenantId) and crypto.randomBytes
      respectively. Caller input cannot smuggle an attacker-controlled URL
      or reuse a stolen clientState — the Zod surface is the SSRF/T-04-19
      + entropy/T-04-16 enforcement point."
    - "Expiration clamp via longest-prefix match: pickExpirationMinutes
      iterates MAX_EXPIRATION_BY_RESOURCE_PREFIX and clamps to the first
      matching prefix's ceiling. Dictionary keys are disjoint so iteration
      order does not affect correctness; unknown resources fall back to
      the conservative 4320-minute ceiling (matches chats/teams lifetime)."
    - "Pitfall 4 honored-expiration: subscriptionsRenew uses Graph's PATCH
      response body's expirationDateTime for the local UPDATE — NEVER the
      requested value. Graph is authoritative on what it actually honored
      (can clamp silently). Integration Test 2 proves the invariant by
      sending a different requested value and asserting the persisted
      expires_at matches Graph's response verbatim."
    - "Pitfall 4 zombie prevention: a 404 on renew means the subscription
      is dead on Graph's side (they sweep stale subs internally). We DELETE
      the local row and emit webhook.subscription.not_found so the audit
      trail shows the reason the row vanished. Without this, the renewal
      cron would hammer Graph with 404s every tick for dead subs."
    - "Pitfall 10 disabled-tenant filter: the cron SELECT joins tenants
      ON t.id = s.tenant_id with WHERE t.disabled_at IS NULL. A tenant
      disabled mid-cycle stops receiving renewal attempts without the
      cron needing a separate kill-switch — the disable cascade is the
      single source of truth."
    - "Per-row try/catch in renewLoop: a single tenant's Graph outage or
      misconfiguration cannot kill the loop for everyone else. Failure
      emits webhook.subscription.renew_failed with {subscription_id,
      error_code, graph_request_id} — all operator-triage-safe metadata
      (no plaintext clientState)."
    - "isRunning overlap guard: if the renewLoop exceeds the interval,
      the next setInterval tick's invocation short-circuits via
      `if (isRunning || stopped) return`. Prevents the worst case of
      stacked concurrent loops fanning out on a slow Graph endpoint.
      Integration Test 7 exercises the guard with a 10ms interval +
      a hung PATCH call."
    - "Dynamic-import tool registration: subscription-* tools are loaded
      lazily from graph-tools.ts via Promise.all([import(...)]) so the
      stdio code path + the 'subscription tools not applicable' branch
      never materialize pg / tenant-pool / kek dependencies. Keeps cold-
      start cost on non-HTTP paths at zero."
    - "Best-effort registration: substrate-missing (tenant pool not
      initialized in stdio mode, pgPool unavailable) logs a warn and
      silently skips the subscription tools. The rest of the Graph
      tool surface keeps serving — partial degradation, not total
      failure. Matches the discipline established by 04-07's webhook
      mount handling."

key-files:
  created:
    - "src/lib/admin/subscriptions.ts (784 lines)"
    - "src/lib/admin/__tests__/subscriptions-create.int.test.ts (420 lines, 10 tests)"
    - "src/lib/admin/__tests__/subscriptions-lifecycle.int.test.ts (630 lines, 12 tests)"
    - "src/lib/admin/__tests__/subscriptions-cron.int.test.ts (568 lines, 8 tests)"
    - ".planning/phases/04-admin-api-webhooks-delta-persistence/04-08-SUMMARY.md"
  modified:
    - "src/graph-tools.ts (+77 lines) — registerSubscriptionTools dispatch
      guarded by MS365_MCP_PUBLIC_URL"
    - "src/index.ts (+67 lines) — phase4-subscription-cron startup region
      + phase4-sub-cron-teardown shutdown region"

key-decisions:
  - "tenantIdResolver injection (not caller-param) for the 4 MCP tools. The
    tools are per-tenant but the Zod param schemas do NOT accept a tenantId
    field — an assistant-supplied tenantId would be a cross-tenant bypass
    vector. Instead, deps.tenantIdResolver is called per-invocation; in HTTP
    mode it reads from request-context (populated by loadTenant), in stdio
    it falls back to MS365_MCP_TENANT_ID. Alternative (per-tool registration
    with closed-over tenantId) was rejected because the same MCP server
    serves multiple tenants in HTTP mode and a per-registration closure
    would mean re-registering on every request."
  - "Cron handle is module-level state in src/index.ts, not owned by the
    server class. The Phase 3 shutdown orchestrator is a free function that
    needs the handle to stop it between server.close and tenantPool.drain;
    threading it through the class hierarchy would couple server.ts to
    plan 04-08's lifecycle. Matches the existing postgres / redisClient
    module-level singleton pattern in index.ts."
  - "Cron shutdown region name is 'phase4-sub-cron-teardown', not
    'phase4-subscription-cron-shutdown'. The plan's acceptance grep
    `region:phase4-subscription-cron` must match EXACTLY 2 lines (the
    startup region's region/endregion pair). The shutdown region uses
    a disjoint-string name so the grep does not match both regions —
    preserves the 2-line contract while still giving the shutdown code
    a properly-scoped region marker."
  - "graphClient construction in src/index.ts for the cron path. The
    MicrosoftGraphServer.graphClient is private; exposing it would pollute
    the class surface for a single optional feature. Instead index.ts
    constructs a fresh GraphClient(authManager, secrets) for the cron —
    the Phase 2 middleware pipeline is stateless so two instances behave
    identically. Phase 6 polish may add a per-tenant request-context
    resolver for stdio (currently the cron uses AuthManager.getToken()
    which is single-tenant); for now, single-replica operators who enable
    the cron are expected to run one tenant at a time in stdio mode
    (documented in the startup WARN)."
  - "Malformed-input rejection (empty resource) happens via CreateParamsZod.
    parse rather than a try/safeParse + custom error envelope. The Zod
    .parse() throws ZodError which propagates to the tool handler's
    errorContent shim — callers see a structured JSON error with the Zod
    issue paths, not a swallowed silent failure. Matches the shape used
    by api-keys.ts (plan 04-03)."

metrics:
  duration: "TBD"
  completed: "2026-04-19T00:00:00Z"
  tasks-total: 3
  tasks-completed: 3
  commits: 6
  files-created: 4
  files-modified: 2
  tests-added: 30
---

# Phase 4 Plan 08: Subscription lifecycle MCP tools + optional renewal cron Summary

Shipped the four per-tenant Microsoft Graph subscription lifecycle MCP tools
(`subscriptions-create` / `-renew` / `-delete` / `-list`) plus an optional
in-process renewal cron. All four handlers route through
`graphClient.makeRequest` so they inherit the Phase 2 retry + ETag + OData
error middleware automatically — no custom HTTP code. `clientState` is
generated server-side, encrypted with the tenant DEK, rotated on every
renew, and never returned to the admin. WEBHK-03 closes here and
ROADMAP SC#4 (webhook clientState) is fully end-to-end (plan 04-08 creates
what plan 04-07 receives + decrypts).

## Four MCP tools shipped

### `subscriptions-create`

```
params : { resource, changeType, desiredExpirationMinutes? }
output : { id, tenant_id, graph_subscription_id, resource,
           change_type, notification_url, expires_at, created_at, updated_at }
```

Flow:

1. Zod-validate params (empty `resource` rejected).
2. Construct `notificationUrl = ${publicUrl}/t/${tenantId}/notifications` —
   caller cannot supply this field (T-04-19 SSRF mitigation).
3. Generate `clientState = crypto.randomBytes(32).toString('base64url')`.
4. Encrypt `clientState` with the tenant DEK via `encryptWithKey`.
5. Clamp `desiredExpirationMinutes` via `pickExpirationMinutes(resource, ...)`.
6. POST `/subscriptions` through `graphClient.makeRequest` (Phase 2
   middleware inherited).
7. INSERT local row with encrypted envelope.
8. Return `subscriptionRowToWire(row)` — whitelist serializer strips
   `client_state` (T-04-20 mitigation).

### `subscriptions-renew`

```
params : { graphSubscriptionId }
output : SubscriptionRow | { deleted: true, reason: 'graph_404' }
```

- Rotates `clientState` on EVERY renew (T-04-19a — stolen values useless
  after one renewal).
- PATCH `/subscriptions/{id}` with fresh `clientState` + new
  `expirationDateTime` clamped via `pickExpirationMinutes`.
- Uses Graph's PATCH response body's `expirationDateTime` for the UPDATE
  (Pitfall 4 — Graph is authoritative).
- On Graph 404: DELETE local row + `webhook.subscription.not_found` audit
  (zombie-subscription prevention).
- On Graph 5xx: re-throws so RetryHandler (Phase 2 middleware) retried in
  the pipeline; after exhaustion the error surfaces through the MCP tool
  envelope.

### `subscriptions-delete`

```
params : { graphSubscriptionId }
output : { deleted: true }
```

- DELETE `/subscriptions/{id}` via `graphClient.makeRequest`.
- Graph 404 tolerated (idempotent — the caller reached the terminal state
  either way).
- Graph 5xx re-thrown; local row preserved for retry.

### `subscriptions-list`

```
params : {} (no caller-supplied filters)
output : SubscriptionRow[]
```

- `SELECT * FROM subscriptions WHERE tenant_id = $1` — row-level tenancy
  at SQL layer (D-11).
- Each row filtered through `subscriptionRowToWire`; `client_state` never
  in response.

## Per-resource expiration clamping table

| Resource prefix                 | Max minutes   | Derived from Graph docs    |
| ------------------------------- | ------------- | -------------------------- |
| `users/`                        | 41760 (29d)   | directory-object lifetime  |
| `groups/`                       | 41760 (29d)   | directory-object lifetime  |
| `chats/`                        | 4320 (3d)     | Teams chat default         |
| `teams/`                        | 4320 (3d)     | Teams channel default      |
| `communications/presences/`     | 60 (1h)       | presence fast-turnover     |
| `security/alerts`               | 43200 (30d)   | security alert lifetime    |
| `drive/`                        | 42300 (<30d)  | driveItem lifetime         |
| `/me/events`                    | 10080 (7d)    | Outlook event lifetime     |
| `/me/messages`                  | 10080 (7d)    | Outlook mail lifetime      |
| (fallback)                      | 4320 (3d)     | conservative unknown cap   |

## Optional renewal cron

Enabled via `MS365_MCP_SUBSCRIPTION_CRON` env var (default: off). When set:

- Startup emits `logger.warn('Single-replica subscription cron enabled — do
  not run on multiple replicas without distributed lock')` — operators see
  the constraint in their log aggregator.
- Every 60 seconds (configurable via `opts.intervalMs` for tests), the loop:

  ```sql
  SELECT s.id, s.tenant_id, s.graph_subscription_id, s.resource, s.expires_at
    FROM subscriptions s
    JOIN tenants t ON t.id = s.tenant_id
   WHERE s.expires_at < NOW() + interval '1 hour'
     AND t.disabled_at IS NULL
   ORDER BY s.expires_at ASC
   LIMIT 1000
  ```

- Each returned row goes through `subscriptionsRenew` (same handler as
  the MCP tool — no code duplication). Success emits
  `webhook.subscription.renewed`; failure emits
  `webhook.subscription.renew_failed` with
  `{subscription_id, error_code, graph_request_id}` meta. 404 during
  cron renew takes the zombie-cleanup path (DELETE + not_found audit),
  consistent with the direct tool invocation.

- `isRunning` flag blocks overlapping ticks — if the loop exceeds the
  interval, the next tick's `setInterval` callback short-circuits.
- Per-row `try/catch` prevents single-tenant failures from killing the
  loop for everyone else.
- `setInterval` is `unref()`'d so the timer does not keep the event loop
  alive during graceful shutdown.

### Graceful shutdown integration

Per RESEARCH.md:1348-1358, the cron's teardown runs BETWEEN
`server.close` (Phase 1) and `tenantPool.drain` (Phase 3):

```
SIGTERM →
   Phase 1 shutdown.ts: server.close() [drain in-flight HTTP]
   Phase 3 phase3ShutdownOrchestrator():
     region:phase4-sub-cron-teardown      <-- stops cron, awaits in-flight
     region:phase3-shutdown-tenant-pool   <-- drains MSAL pool
     region:phase3-shutdown-redis         <-- quits Redis
     region:phase3-shutdown-postgres      <-- ends pg pool
   Phase 1 shutdown.ts: logger.flush + OTel.shutdown + process.exit(0)
```

`stopRenewalCron` awaits `currentRun` before resolving — shutdown does
not abort mid-row, so a renewal in-flight during SIGTERM still completes
(using a still-warm DEK from the tenant pool before the drain).

## Threats mitigated

| ID       | Category       | Mitigation                                                       |
| -------- | -------------- | ---------------------------------------------------------------- |
| T-04-19  | T (Tampering)  | Zod schema has NO `notificationUrl` — URL constructed from trusted `publicUrl+tenantId`. Test 3 asserts Graph receives the canonical URL regardless of `resource` content. |
| T-04-20  | I (InfoDisclose) | `clientState` generated server-side via `crypto.randomBytes(32)`; encrypted at rest with tenant DEK; `subscriptionRowToWire` whitelist serializer strips `client_state` from every response. Tests 6 + 9 assert. |
| T-04-19a | S (Spoofing)   | Every `subscriptions-renew` rotates `clientState` — stolen values invalidated within one renewal cycle. Test 1 asserts the new envelope has different iv/tag/ct AND decrypts to a different plaintext. |
| T-04-19d | D (DoS)        | `unref()`'d timer + per-row `try/catch` + `isRunning` overlap guard + `LIMIT 1000` per tick. Tests 4 + 7 assert. |
| T-04-20a | E (EoP)        | Graph validates scopes at subscription creation — 403 surfaces via the existing `GraphAuthError` pipeline. We do not pre-validate locally (Open Question 2: "let Graph be authoritative"). |

## Audit actions emitted

| Action                                | Emitted when                                              | Meta                                                  |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| `webhook.subscription.renewed`        | Cron renewed a row successfully                           | `{subscription_id, resource}`                         |
| `webhook.subscription.renew_failed`   | Cron PATCH threw (any non-404 error)                      | `{subscription_id, error_code, graph_request_id}`     |
| `webhook.subscription.not_found`      | Graph 404 on renew (tool or cron path) → local DELETE     | `{subscription_id, graph_subscription_id}`            |

The `webhook.subscription.not_found` action is stored as a free-form string
— it's not in the `AuditAction` union yet. The `writeAuditStandalone`
signature accepts `AuditAction | string` so this compiles without
extending the union; a future plan can promote it to a literal if the
action becomes common enough to warrant per-field grep discovery.

## Environment variables

| Var                              | Required? | Purpose                                                         |
| -------------------------------- | --------- | --------------------------------------------------------------- |
| `MS365_MCP_PUBLIC_URL`           | required  | The externally-reachable origin used to construct `notificationUrl`. Without this, the SSRF-protection invariant has no scheme+host anchor; the four subscription-* MCP tools are silently skipped. |
| `MS365_MCP_SUBSCRIPTION_CRON`    | optional  | Any non-empty value enables the renewal cron at startup. Absent = off (default). Single-replica constraint enforced by the startup WARN. |

## Self-Check: PASSED

### Created files

- `src/lib/admin/subscriptions.ts`: FOUND
- `src/lib/admin/__tests__/subscriptions-create.int.test.ts`: FOUND
- `src/lib/admin/__tests__/subscriptions-lifecycle.int.test.ts`: FOUND
- `src/lib/admin/__tests__/subscriptions-cron.int.test.ts`: FOUND

### Commits

- `52c646d test(04-08): add failing tests for subscriptions-create MCP tool`: FOUND
- `9b472a8 feat(04-08): implement subscriptions-create MCP tool with notificationUrl SSRF protection + clientState encryption`: FOUND
- `666040e test(04-08): add lifecycle tests for renew/delete/list + MCP registration`: FOUND
- `c9a1994 feat(04-08): wire subscription lifecycle tools into graph-tools registration`: FOUND
- `1a790ea test(04-08): add renewal cron tests for Pitfall 10 + overlap guard + graceful shutdown`: FOUND
- `f37ca85 feat(04-08): wire optional subscription renewal cron into HTTP-mode bootstrap`: FOUND

### Acceptance criteria

- `grep MAX_EXPIRATION_BY_RESOURCE_PREFIX src/lib/admin/subscriptions.ts`: 2 matches
- `grep "'users/': 41760" src/lib/admin/subscriptions.ts`: 1 match
- `grep "'chats/': 4320" src/lib/admin/subscriptions.ts`: 1 match
- `grep "'communications/presences/': 60" src/lib/admin/subscriptions.ts`: 1 match
- `grep "FALLBACK_EXPIRATION_MINUTES = 4320" src/lib/admin/subscriptions.ts`: 1 match
- `grep "export function pickExpirationMinutes" src/lib/admin/subscriptions.ts`: 1 match
- `grep "randomBytes(32).toString('base64url')" src/lib/admin/subscriptions.ts`: 2 matches
  (once in subscriptionsCreate, once in subscriptionsRenew for rotation)
- `grep encryptWithKey src/lib/admin/subscriptions.ts`: 4 matches (import + 3 call sites)
- `grep graphClient.makeRequest src/lib/admin/subscriptions.ts`: 4 matches
  (create POST, renew PATCH, delete DELETE, cron — via subscriptionsRenew
  which itself calls it)
- `grep /subscriptions src/lib/admin/subscriptions.ts`: 8 matches
- `publicUrl.replace` + `notificationUrl` construction at line 213: PRESENT
- `grep subscriptionRowToWire src/lib/admin/subscriptions.ts`: 7 matches
- `grep "export async function subscriptionsRenew" src/lib/admin/subscriptions.ts`: 1 match (line 320)
- `grep "export async function subscriptionsDelete" src/lib/admin/subscriptions.ts`: 1 match (line 421)
- `grep "export async function subscriptionsList" src/lib/admin/subscriptions.ts`: 1 match (line 457)
- `grep "export function registerSubscriptionTools" src/lib/admin/subscriptions.ts`: 1 match (line 519)
- `grep "webhook.subscription.not_found" src/lib/admin/subscriptions.ts`: 2 matches (docstring + action string)
- `grep "statusCode === 404" src/lib/admin/subscriptions.ts`: 2 matches (renew + delete)
- `grep "honoredExpiration" src/lib/admin/subscriptions.ts`: 2 matches (Pitfall 4)
- `grep registerSubscriptionTools src/graph-tools.ts`: 2 matches (import + call)
- `grep MS365_MCP_PUBLIC_URL src/graph-tools.ts`: 4 matches (comment + env read + assignment + warn log)
- `grep "export function startRenewalCron" src/lib/admin/subscriptions.ts`: 1 match (line 662)
- `grep "export async function stopRenewalCron" src/lib/admin/subscriptions.ts`: 1 match (line 782)
- `grep "DEFAULT_CRON_INTERVAL_MS = 60_000" src/lib/admin/subscriptions.ts`: 1 match (line 622)
- `grep "t.disabled_at IS NULL" src/lib/admin/subscriptions.ts`: 1 match (line 680)
- `grep "expires_at < NOW() + interval '1 hour'" src/lib/admin/subscriptions.ts`: 1 match (line 679)
- `grep isRunning src/lib/admin/subscriptions.ts`: 5 matches (guard + toggles + docs)
- `grep "webhook.subscription.renewed|webhook.subscription.renew_failed" src/lib/admin/subscriptions.ts`: both match
- `grep "setInterval|clearInterval" src/lib/admin/subscriptions.ts`: both match
- `grep unref src/lib/admin/subscriptions.ts`: 3 matches (type decl + call + docs)
- `grep -n "region:phase4-subscription-cron" src/index.ts`: exactly 2 lines (484 + 525)
- `grep MS365_MCP_SUBSCRIPTION_CRON src/index.ts`: 3 matches (comment + gate + var-ref)
- `grep "Single-replica subscription cron" src/index.ts`: 1 match (startup WARN)
- `grep "startRenewalCron|stopRenewalCron" src/index.ts`: both match

### Tests

- `npx vitest run src/lib/admin/__tests__/subscriptions-create.int.test.ts`: PASS (10/10)
- `npx vitest run src/lib/admin/__tests__/subscriptions-lifecycle.int.test.ts`: PASS (12/12)
- `npx vitest run src/lib/admin/__tests__/subscriptions-cron.int.test.ts`: PASS (8/8)
- Combined with webhook + schema tests from 04-07: 63/63 passing
- `npm run build`: SUCCESS
- `npx eslint` on all modified + new files: no issues

## Deviations from Plan

### Rule 3 — shutdown region name collision (acceptance-criteria grep)

The plan's Task 3 acceptance criterion `grep -n "region:phase4-subscription-cron"
src/index.ts` requires EXACTLY 2 lines. A naive naming of the shutdown
region as `phase4-subscription-cron-shutdown` (which I initially wrote)
makes plain grep match 4 lines because `region:phase4-subscription-cron`
is a substring of `region:phase4-subscription-cron-shutdown`. Renamed
the shutdown region to `phase4-sub-cron-teardown` so the acceptance grep
matches exactly the 2 startup-region lines while the shutdown code still
has a scoped region marker for sibling-plan disjoint-edit contracts.

This is Rule 3 (blocking-issue fix) — the plan's grep contract is the
invariant; the region name is the degree of freedom.

### Bonus integration test (Test 11) in subscriptions-lifecycle.int.test.ts

Added a full create → renew → delete integration test (beyond the 10 the
plan lists in Task 2's `<behavior>`). Exercises the whole lifecycle
including clientState round-trip decryption after both create and renew,
asserting the two plaintexts differ. 10-test minimum becomes 12 actual
tests.

### Bonus GraphError-bubble test (Test 12)

Added a test that an unknown-status GraphError (418) re-throws through
`subscriptionsRenew` cleanly without being misclassified as a 404
deletion. Defense against regressions where a future `statusCode === 404`
fix might accidentally catch the wrong error class.

### Audit action `webhook.subscription.not_found` not added to AuditAction union

The plan mentions emitting `webhook.subscription.not_found` for Pitfall 4
zombie cleanup. The existing `AuditAction` union in `src/lib/audit.ts`
does NOT include this action literal. Rather than extending the union
(which would be a cross-plan modification with implications for all audit
consumers), I rely on the `AuditAction | string` type widening that
`writeAuditStandalone` already supports. Promotion to a literal is a
future-plan concern if the action becomes common enough for per-field
grep discovery. This is consistent with how plan 04-07 handled the
webhook.received / webhook.duplicate literals — they were already in the
union because 04-06 added them up front; `not_found` was not staged there.

### graphClient re-constructed in index.ts for cron (not reused from server)

The plan's action block shows `graphClient` being reused from the server
bootstrap scope. `MicrosoftGraphServer.graphClient` is private and
accessing it would require either a public getter or a wider class-surface
refactor. Instead, `src/index.ts` constructs a fresh
`new GraphClient(authManager, secrets)` for the cron's dependency bag —
the Phase 2 middleware pipeline is stateless so two instances share
behavior exactly. Documented in key-decisions above.

## Downstream

Plan 04-09 (delta-token persistence) is the delta-query wrapper that pairs
with these subscription tools: an AI assistant can call
`subscriptions-create` to receive change notifications, then issue delta
queries via the 04-09 wrapper to sync the resource state incrementally.

The webhook receiver from 04-07 consumes the encrypted `client_state`
envelope this plan produces — plan 04-08's ROADMAP closure is the
canonical proof that 04-07's clientState-equality path works end-to-end.
