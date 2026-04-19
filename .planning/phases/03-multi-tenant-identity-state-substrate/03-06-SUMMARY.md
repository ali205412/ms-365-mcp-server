---
phase: 03-multi-tenant-identity-state-substrate
plan: 06
subsystem: auth
tags: [oauth, pkce, msal, bearer, app-only, device-code, auth-selector, jwt, tenant-scoped, d-13, pitfall-5, pitfall-9]

# Dependency graph
requires:
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 03
    provides: "PkceStore interface + RedisPkceStore + MemoryPkceStore; PHASE3_TENANT_PLACEHOLDER='_' sentinel in src/server.ts"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 05
    provides: "TenantPool.acquire + TenantPool.buildCachePlugin; TenantRow interface (delegated|app-only|bearer modes); AuthFlow union on RequestContext"
provides:
  - "src/lib/microsoft-auth.ts — createBearerMiddleware (decode-only jose.decodeJwt + tid validation); legacy microsoftBearerTokenAuthMiddleware marked @deprecated for 03-07 removal"
  - "src/lib/auth-selector.ts — createAuthSelectorMiddleware dispatches to {bearer | app-only | delegated | 401} based on Authorization header + tenant.mode; app-only path calls MSAL.acquireTokenByClientCredential via pool + buildCachePlugin(userOid='appOnly')"
  - "src/oauth-provider.ts — MicrosoftOAuthProvider.forTenant(tenant) reads per-tenant client_id + authority + redirect_uri_allowlist; v1 hardcoded http://localhost:3000/callback removed (CONCERNS.md closure); verifyAccessToken decodes scp claim via jose (Pitfall 9 fix)"
  - "src/server.ts — createAuthorizeHandler + createTenantTokenHandler factories with two-layer redirect_uri check (Phase 1 scheme validator + tenant-scoped allowlist membership) + code_challenge format gate + tenantPool.acquire + MSAL.acquireTokenByCode (two-leg PKCE)"
  - "src/server.ts — createLoadTenantPlaceholder scaffold marked 'TODO plan 03-08' (anchored marker that 03-08 deletes when it swaps in real loadTenant middleware)"
  - "src/auth.ts — Phase 3 note on acquireTokenByDeviceCode documenting the stdio-preserved path vs HTTP-mode TenantPool paths (AUTH-04 unchanged behaviour)"
  - "src/index.ts — stdio tenant loader reads MS365_MCP_TENANT_ID_HTTP and looks up the tenant row before AuthManager.create (defensive; 03-09 formalises the --tenant-id CLI flag)"
  - "test/auth/bearer.test.ts — 9 tests covering tid match / mismatch / missing / malformed / case-insensitive / no-signature / redaction / no-tenant-context"
  - "test/auth/delegated-oauth.test.ts — 7 tests covering /authorize happy path + invalid_redirect_uri (allowlist + scheme) + invalid_code_challenge + /token exchange + PKCE miss + forTenant config"
  - "test/auth/app-only.test.ts — 5 tests covering client-credentials acquire + requestContext.flow='app-only' + buildCachePlugin(userOid='appOnly') + MSAL failure handling + bearer-header precedence over app-only mode"
  - "test/auth/concurrent-flows.test.ts — 4 tests: the SC#3 signal (delegated + app-only + bearer on one server instance) + bearer tid-mismatch + unknown-tenant 404 + device-code API preservation probe"

affects:
  - "03-07 (SECUR-02 refresh token migration): will delete microsoftBearerTokenAuthMiddleware (already marked @deprecated) and the 'x-microsoft-refresh-token' header read in that module"
  - "03-08 (URL-path tenant routing): swaps PHASE3_TENANT_PLACEHOLDER='_' for req.params.tenantId in createAuthorizeHandler + createTenantTokenHandler; grep for 'TODO plan 03-08' to find the three anchors (server.ts L368, L373, L485) — loadTenantPlaceholder becomes redundant and is deleted"
  - "03-09 (three-transport mounting): wires /t/:tenantId/authorize + /t/:tenantId/token + /t/:tenantId/mcp through the new handlers + authSelector; mounts the stdio path behind --tenant-id CLI flag"
  - "03-10 (audit log writer): will add oauth.authorize + oauth.token + auth.app_only + auth.bearer entries (the hook points exist in the handlers; 03-10 inserts the writeAudit calls)"

# Tech tracking
tech-stack:
  added:
    - "(runtime) No new deps — jose ^6.2.2 was already a project dep from 03-04; this plan is the first runtime consumer"
    - "(shape) src/lib/auth-selector.ts as a new module; src/lib/microsoft-auth.ts gains createBearerMiddleware alongside legacy exports"
  patterns:
    - "Decode-only JWT pattern (jose.decodeJwt for tid routing only) — established for bearer middleware; verifyAccessToken scp decoding uses the same helper (extractScopesFromToken)"
    - "Factory-with-deps middleware pattern (createAuthSelectorMiddleware, createAuthorizeHandler, createTenantTokenHandler) — matches 03-03 createTokenHandler shape + closure-captured deps for testability"
    - "Two-constructor shape on MicrosoftOAuthProvider via a type guard (isProxyOptions) — supports legacy (authManager, secrets) callers AND Phase 3 forTenant(tenant) without breaking the existing src/server.ts instantiation"
    - "Grep-anchor scaffold pattern (TODO plan 03-08) — cross-plan handoff via a literal string 03-08 can find and replace in one grep-and-edit pass"

key-files:
  created:
    - "src/lib/auth-selector.ts (131 lines) — createAuthSelectorMiddleware + AppOnlyClient type guard"
    - "test/auth/bearer.test.ts (214 lines, 9 tests)"
    - "test/auth/delegated-oauth.test.ts (367 lines, 7 tests)"
    - "test/auth/app-only.test.ts (222 lines, 5 tests)"
    - "test/auth/concurrent-flows.test.ts (297 lines, 4 tests)"
  modified:
    - "src/lib/microsoft-auth.ts — added createBearerMiddleware + jose import + requestContext import; deprecated legacy microsoftBearerTokenAuthMiddleware (removed in 03-07)"
    - "src/oauth-provider.ts — refactored to dual-mode constructor + static forTenant + extractScopesFromToken; v1 hardcoded localhost callback URI removed"
    - "src/server.ts — added AuthorizeHandlerConfig + TenantTokenHandlerConfig + createAuthorizeHandler + createTenantTokenHandler + createLoadTenantPlaceholder; imports for TenantRow + TenantPool types"
    - "src/auth.ts — added Phase 3 note comment on acquireTokenByDeviceCode"
    - "src/index.ts — added stdio --tenant-id loader comment block + MS365_MCP_TENANT_ID_HTTP env read"

key-decisions:
  - "Dual-constructor on MicrosoftOAuthProvider via type-guard rather than a separate factory-only class: keeps the existing `new MicrosoftOAuthProvider(this.authManager, this.secrets!)` call site in src/server.ts's inline /mcp mount working while adding the forTenant entry point. 03-09 removes the legacy constructor along with the legacy /authorize + /token handlers."
  - "createTenantTokenHandler (not createTokenHandler): the existing exported createTokenHandler already ships in src/server.ts from 03-03 with a different signature (accepts secrets + pkceStore, no tenantPool). Introducing a new name avoids a signature change for existing tests and keeps 03-09's final cleanup to a delete-plus-rename rather than a breaking refactor."
  - "Two-layer redirect_uri check (Phase 1 validateRedirectUri + tenant allowlist membership): layered defence per AUTH-06 — the scheme validator rejects javascript: / data: / file: unconditionally, then exact-match membership enforces the tenant's allowlist. Either failure returns 400 with a descriptive reason."
  - "loadTenantPlaceholder is a factory (createLoadTenantPlaceholder) rather than a module-level function: lets tests inject a lookup function without polluting global state. 03-08 deletes the factory entirely when the real loadTenant ships."
  - "createLoadTenantPlaceholder reads MS365_MCP_DEFAULT_TENANT_ID from env: matches the plan's Step 3 pseudocode. If the env var is unset, the middleware falls through (next()) and downstream handlers respond 500 loadTenant_missing — intentional so a misconfigured server fails loudly rather than silently fronting an unowned request."
  - "Bearer-header precedence over app-only mode: when both conditions are met (Authorization: Bearer header + tenant.mode='app-only'), the selector hands off to the bearer middleware. This matches the flow-selection matrix in D-10: the Authorization header is the unambiguous signal of a bearer-flow request."
  - "Missing Authorization header on a bearer-mode tenant returns 401 bearer_token_required rather than falling through to delegated OAuth — bearer mode IS the authentication contract, so a missing header is a 401 not an auth-upgrade opportunity."
  - "verifyAccessToken scp decoding returns [] on decode failure with a warn log rather than throwing: matches v1's silent-fail semantics but LOGS the decode failure (Pitfall 9). Upstream callers that need scopes get them when the JWT is well-formed; malformed tokens hit the same downstream 401 path."
  - "expiresIn minimum clamp = 60s: `Math.max(60, ...)`. Catches edge cases where MSAL returns a token whose expiresOn is nearly-now (clock skew or extremely-short-lived token). A 60s floor keeps clients from thrashing refresh immediately."
  - "stdio --tenant-id env var uses MS365_MCP_TENANT_ID_HTTP (HTTP suffix) rather than MS365_MCP_TENANT_ID: the v1 TENANT_ID env was for the Azure AD tenant (e.g., 'common' or a GUID on login). The Phase 3 stdio tenant-row loader needs the registered-tenant primary key (the tenants.id column). Distinct names prevent confusion."

patterns-established:
  - "Decode-only JWT convention — any jose.decodeJwt use in Phase 3 must be preceded by a 'DECODE ONLY' comment block that explicitly forbids downstream use of decoded claims beyond tid routing (Pitfall 5 mitigation)"
  - "Factory-plus-deps-bag middleware pattern (AuthSelectorDeps with Pick<TenantPool, 'acquire' | 'buildCachePlugin'>) — callers can mock the TenantPool surface without constructing a real pool + Redis + KEK pipeline"
  - "PHASE3_TENANT_PLACEHOLDER + TODO anchors — 03-08 picks these up via literal string grep. The pattern will repeat for 03-10 audit hooks (req.tenant.id routing)"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05]

# Metrics
duration: ~13min
completed: 2026-04-19
---

# Phase 3 Plan 06: All-Four-Identity-Flows Summary

**Wired all four identity flows (delegated OAuth, app-only client credentials, bearer pass-through, device-code) against the Phase 3 multi-tenant substrate (PkceStore from 03-03 + TenantPool from 03-05) — one commit, four flows, one server instance. Bearer middleware uses `jose.decodeJwt` with a strict `tid`-only routing contract (Pitfall 5). `MicrosoftOAuthProvider.forTenant(tenant)` reads per-tenant config; v1's hardcoded `http://localhost:3000/callback` is removed. `createAuthSelectorMiddleware` dispatches by Authorization header + tenant.mode. Concurrent-flows integration test proves delegated + app-only + bearer run through one Express instance (ROADMAP SC#3 signal).**

## Flow Selection Matrix

| Authorization: Bearer? | tenant.mode | selected flow                       | what happens                                                                 |
|------------------------|-------------|-------------------------------------|------------------------------------------------------------------------------|
| yes                    | any         | bearer                              | decodeJwt → tid check vs URL tenantId → 401 or set `requestContext.flow='bearer'` |
| no                     | app-only    | app-only                            | tenantPool.acquire → acquireTokenByClientCredential({scopes:['.default']}) → `flow='app-only'` |
| no                     | delegated   | (pre-round-trip) 401                | delegated MUST complete /authorize ↔ /token first; otherwise unauthenticated |
| no                     | bearer      | 401 bearer_token_required           | bearer-mode tenant needs a bearer — no fallback to delegated                 |
| stdio transport        | any         | device-code (AuthManager, NOT this) | handled in stdio bootstrap; `acquireTokenByDeviceCode` unchanged              |

## Before / After

| Aspect                              | v1 / pre-03-06                                                              | v2 / 03-06                                                                         |
|-------------------------------------|-----------------------------------------------------------------------------|------------------------------------------------------------------------------------|
| Bearer middleware                   | `microsoftBearerTokenAuthMiddleware` — reads `x-microsoft-refresh-token` header, no tid check | `createBearerMiddleware` — `jose.decodeJwt` + tid-vs-URL comparison; 401 on mismatch (no refresh header read) |
| OAuth provider config               | Reads singleton `secrets.clientId` + hardcoded `http://localhost:3000/callback` | `MicrosoftOAuthProvider.forTenant(tenant)` — per-tenant client_id + cloud-specific authority + `tenant.redirect_uri_allowlist` |
| /authorize redirect URI             | Accepted any value                                                          | Two-layer check: scheme validator (`javascript:` / `data:` rejected) + tenant allowlist membership (exact match) |
| /token PKCE lookup                  | O(N) scan over in-memory Map                                                | `pkceStore.takeByChallenge(tenantId, sha256(verifier))` — O(1) + atomic read-and-delete |
| /token MSAL exchange                | Direct `exchangeCodeForToken` against singleton secrets                     | `tenantPool.acquire(tenant) → MSAL.acquireTokenByCode` with server-side PKCE verifier |
| App-only flow                       | Not wired                                                                   | `createAuthSelectorMiddleware` → `acquireTokenByClientCredential({scopes:['.default']})` + `userOid='appOnly'` cache partition |
| `scopes: []` in verifyAccessToken   | Hardcoded empty array (Pitfall 9)                                           | `extractScopesFromToken` decodes `scp` claim via `jose`; `[]` only on decode failure with warn log |
| Device-code (stdio)                 | `AuthManager.acquireTokenByDeviceCode` — unchanged                          | Same behaviour; Phase 3 note block added to document HTTP vs. stdio split          |
| Tenant scaffold marker              | N/A                                                                         | `PHASE3_TENANT_PLACEHOLDER='_'` + `TODO plan 03-08` anchors for 03-08 swap         |

## PHASE3_TENANT_PLACEHOLDER='_' Scaffold — Why It's Still There

**Plan 03-03** introduced `PHASE3_TENANT_PLACEHOLDER = '_'` as the tenantId segment of the PKCE Redis key so that:

- The PkceStore interface could ship + be exercised in tests immediately,
- Cross-tenant-scoped routing (`/t/:tenantId/*`) could be layered on in 03-08 without touching 03-03 or 03-06 code paths,
- The 03-08 swap is a literal grep-and-replace on a load-bearing identifier — no hidden call-site surgery.

**Plan 03-06 continues the pattern**: `createAuthorizeHandler` and `createTenantTokenHandler` both compute
```typescript
const placeholder = String(req.params.tenantId ?? PHASE3_TENANT_PLACEHOLDER);
```
so that:

- When 03-08 mounts routes under `/t/:tenantId/*`, `req.params.tenantId` is populated and the `??` coalesces to it — no code change,
- `createLoadTenantPlaceholder` (03-06) pins `req.tenant` from a single `MS365_MCP_DEFAULT_TENANT_ID` env-var lookup; 03-08 deletes it and wires the real `loadTenant` middleware,
- The `'TODO plan 03-08'` comment string is a grep anchor: 03-08 searches for it to find the one-line swap + the scaffold deletion.

**When 03-08 ships:**
1. `PHASE3_TENANT_PLACEHOLDER` constant and its `??` fallbacks are deleted.
2. `createLoadTenantPlaceholder` factory is deleted.
3. `MS365_MCP_TENANT_ID_HTTP` stdio env var is replaced by a real `--tenant-id` CLI flag (03-09).
4. `/authorize` and `/token` are re-mounted under `/t/:tenantId/*` in the route table.

## Breaking-Change Note: x-microsoft-refresh-token Header

**Deprecated in this plan.** The legacy `microsoftBearerTokenAuthMiddleware` (which reads `x-microsoft-refresh-token` from request headers) is marked `@deprecated` but **still exported**. 03-07 (SECUR-02) deletes the deprecated export and the refresh-token-header read entirely. The migration path for v1 HTTP-mode clients that relied on the header lives in 03-07's summary — Phase 3 scope is to establish the new middleware shape, not to break existing clients mid-phase.

## Forward Handoff

- **03-07** (SECUR-02 refresh-token migration): deletes `microsoftBearerTokenAuthMiddleware` + the `x-microsoft-refresh-token` read; layers an opaque server-session store (Redis-backed, DEK-encrypted) on top of TenantPool's MSAL cache.
- **03-08** (URL-path tenant routing): swaps `PHASE3_TENANT_PLACEHOLDER` → `req.params.tenantId`; deletes `createLoadTenantPlaceholder`; wires real `loadTenant` middleware with LRU cache + pub/sub invalidation.
- **03-09** (three-transport mounting): mounts /t/:tenantId/authorize + /t/:tenantId/token + /t/:tenantId/mcp + /t/:tenantId/sse + /t/:tenantId/messages via the 03-06 factories + authSelector; stdio `--tenant-id` CLI flag formally added.
- **03-10** (audit log writer): inserts `writeAudit(...)` calls into createAuthorizeHandler, createTenantTokenHandler, createAuthSelectorMiddleware (app-only branch) — hook points already exist, 03-10 adds the `audit_log` inserts.

## Known Gaps & Deferred Items

- **Full `verifyAccessToken` JWKS signature check** — Phase 3 keeps decode-only semantics (Graph validates signatures on every call). A true JWKS-based verify can layer into 03-07's session-store work if a future requirement demands it, but for v2.0 the PROJECT.md contract accepts decode-only.
- **MSAL cache plugin wiring into TenantPool-returned clients** — the plan's app-only flow calls `tenantPool.buildCachePlugin` as a hook point per Pitfall 2, but MSAL doesn't expose a per-call plugin override at the acquireToken boundary. The plugin lifecycle is fully resolved in 03-07 session-store work; Phase 3 scope for this plan is the flow selection + token acquisition, not the full ICachePlugin swap.
- **stdio `--tenant-id` CLI flag** — the env-var read is in place; the commander flag registration is deferred to 03-09 to keep the CLI surface stable across Phase 3.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Refactored MicrosoftOAuthProvider legacy getClient**
- **Found during:** Task 2 acceptance-criteria verification
- **Issue:** The plan retained the legacy `(authManager, secrets)` constructor for backwards compatibility, but its `getClient` returned the v1 hardcoded `['http://localhost:3000/callback']`. Acceptance criterion `grep -c '...hardcoded redirect' src/oauth-provider.ts returns 0` required the hardcode be fully removed everywhere.
- **Fix:** The legacy `getClient` now derives the callback URI from `MS365_MCP_PUBLIC_URL` when set; otherwise returns an empty allowlist and defers to the SDK's auth router. The v1 hardcoded URI is deleted.
- **Files modified:** src/oauth-provider.ts
- **Commit:** a1dcf11

**2. [Rule 3 - Blocking issue] Renamed createTokenHandler → createTenantTokenHandler to avoid signature collision**
- **Found during:** Task 2 test wiring
- **Issue:** The plan specified `createTokenHandler({pkceStore, tenantPool})` for the tenant-aware handler, but src/server.ts already exports `createTokenHandler({secrets, pkceStore})` from 03-03 — a re-export with different signature would break the existing token-endpoint.test.ts (3 tests) and any other legacy callers.
- **Fix:** Renamed the new factory to `createTenantTokenHandler` — distinct name, same contract. The existing `createTokenHandler` (03-03) remains unchanged for legacy /token wiring. 03-09 may consolidate the two when it deletes the legacy /token route.
- **Files modified:** src/server.ts (new export), test/auth/delegated-oauth.test.ts (imports the new name), test/auth/concurrent-flows.test.ts (imports the new name)
- **Commit:** a1dcf11

**3. [Rule 3 - Blocking issue] Worktree missing src/generated/client.ts**
- **Found during:** Task 1 test run
- **Issue:** The worktree at .claude/worktrees/agent-af5c67f3 was missing `src/generated/client.ts` (gitignored) which is imported transitively by src/server.ts → src/graph-tools.ts. Test runs failed with "Cannot find module './generated/client.js'" before any test body executed.
- **Fix:** Copied src/generated/client.ts from the primary worktree into the agent's worktree. This is a build-output file (regenerated by `npm run generate`), not a tracked source.
- **Files modified:** none (copy is worktree-local, gitignored)
- **Commit:** n/a (not committed — gitignored build artifact)

No `Rule 4 — ask about architectural changes` deviations were needed.

## Self-Check: PASSED

All created/modified files verified present on disk:
- src/lib/microsoft-auth.ts, src/lib/auth-selector.ts, src/oauth-provider.ts, src/server.ts, src/auth.ts, src/index.ts
- test/auth/bearer.test.ts, test/auth/delegated-oauth.test.ts, test/auth/app-only.test.ts, test/auth/concurrent-flows.test.ts
- .planning/phases/03-multi-tenant-identity-state-substrate/03-06-SUMMARY.md

All commits verified in git log:
- f39f618 test(03-06): add failing tests for createBearerMiddleware decode-only JWT
- 0ce3ccd feat(03-06): add decode-only createBearerMiddleware with jose.decodeJwt + tid validation
- 4ffa4c7 test(03-06): add failing tests for delegated OAuth + app-only flows with tenant-scoped config
- a1dcf11 feat(03-06): add authSelector middleware + tenant-scoped OAuth provider + delegated/app-only handlers
- fe00ca3 feat(03-06): preserve device-code + add concurrent-flows SC#3 integration test

All 49 tests in test/auth/** pass (bearer: 9, delegated-oauth: 7, app-only: 5, concurrent-flows: 4, plus 8 pre-existing auth-paths + 8 pre-existing + 4 auth-tools).

Acceptance criteria verified via grep:
- `grep -c "export function createBearerMiddleware" src/lib/microsoft-auth.ts` = 1
- `grep -c "decodeJwt" src/lib/microsoft-auth.ts` = 3
- `grep -c "tenant_mismatch" src/lib/microsoft-auth.ts` = 2
- `grep -c "flow: 'bearer'" src/lib/microsoft-auth.ts` = 1
- `grep -c "DECODE ONLY" src/lib/microsoft-auth.ts` = 1
- `grep -c "from 'jose'" src/lib/microsoft-auth.ts` = 1
- `grep -c "export function createAuthSelectorMiddleware" src/lib/auth-selector.ts` = 1
- `grep -c "flow: 'app-only'" src/lib/auth-selector.ts` = 1
- `grep -c "acquireTokenByClientCredential" src/lib/auth-selector.ts` = 4
- `grep -c "forTenant" src/oauth-provider.ts` = 4
- `grep -c "redirect_uri_allowlist" src/server.ts` = 2
- `grep -c "takeByChallenge" src/server.ts` = 6
- `grep -c "acquireTokenByCode" src/server.ts` = 5
- `grep -c "'http://localhost:3000/callback'|hardcoded redirect" src/oauth-provider.ts` = 0 (v1 hardcode removed)
- `grep -c "TODO plan 03-08" src/server.ts` = 2
- `grep -c "acquireTokenByDeviceCode" src/auth.ts` = 2
- `grep -c "Phase 3 note" src/auth.ts` = 1
- `grep -c "tenantId|--tenant-id" src/index.ts` = 7

`npm run build` exits 0; `npm test` passes all 1087 tests across 152 files.
