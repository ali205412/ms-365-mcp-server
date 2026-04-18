---
phase: 01-foundation-hardening
plan: "07"
subsystem: oauth-token-cors
tags:
  - oauth
  - token-endpoint
  - cors
  - public-url
  - fail-fast
  - security
  - pii-redaction
  - secur-04
  - secur-05
  - d-02
dependency_graph:
  requires:
    - "01-02"
    - "01-06"
  provides:
    - create-cors-middleware-factory
    - compute-cors-allowlist-helper
    - create-token-handler-factory
    - d02-prod-http-failfast
    - secur-05-token-log-scrub
    - secur-04-cors-mode-gate
  affects:
    - src/lib/cors.ts
    - src/server.ts
    - src/index.ts
    - src/lib/otel.ts
    - .env.example
tech_stack:
  added: []
  patterns:
    - Pure Express middleware factory — createCorsMiddleware({ mode, allowlist }) closure-captures the allowlist Set for O(1) per-request lookup
    - Exported handler factory — createTokenHandler({ secrets, pkceStore }) so the /token handler is testable without bootstrapping MicrosoftGraphServer (same pattern as createRegisterHandler from plan 01-06)
    - Pino-native meta-first arg order `logger.info(meta, message)` at every new log site (canonical post-plan-01-02 convention)
    - Sysexits EX_CONFIG (78) fail-fast — matches the sysexits.h convention; distinguishes config errors from generic exit-1 crashes for Docker restart policies and operator triage
    - Deprecated-env-var fallback pattern — MS365_MCP_CORS_ORIGIN and MS365_MCP_BASE_URL honored with a warn log, slated for v2.1 removal (tracked in CHANGELOG by plan 01-08)
    - Secondary `process.stderr.write` alongside `logger.error` for startup-config errors — ensures variable name is greppable from stderr even when pino routes JSON log records to stdout in prod
key_files:
  created:
    - src/lib/cors.ts
    - test/cors-mode-gate.test.ts
    - test/token-endpoint.test.ts
    - test/startup-validation.test.ts
    - test/public-url-failfast.test.ts
  modified:
    - src/server.ts
    - src/index.ts
    - src/lib/otel.ts
    - .env.example
decisions:
  - "createCorsMiddleware dev mode allows http(s)://localhost:* AND http(s)://127.0.0.1:* (both schemes) so self-signed HTTPS dev setups work; external origins denied in dev to stop a stray browser session from CSRF-preflighting the dev server"
  - "Allowlist exact-string match via Set.has — O(1) lookup, no wildcard bugs, explicit origins only per D-02"
  - "Access-Control-Allow-Origin NEVER emitted as `*` — always echoes the inbound origin when permitted, keeping ACAC: true compatible with the MCP OAuth credentialed-request flow"
  - "OPTIONS preflight on denied origin returns 403 rather than silent 200-without-ACAO; v1's silent failure produced inscrutable browser errors with no server-side breadcrumb"
  - "createTokenHandler factory dependency-injects the PKCE store so tests supply a fresh Map; production reuses the per-instance pkceStore on MicrosoftGraphServer. PkceStore + TokenHandlerSecrets + TokenHandlerConfig exported so Phase 3 per-tenant work can reuse them"
  - "Site B (grant_type missing) emits `grant_type: '[MISSING]'` marker + has_code / has_refresh_token / has_client_secret booleans — never a raw body reference; defense-in-depth: pino's REDACT_PATHS from plan 01-02 would catch a regression but the invariant holds at the call site"
  - "Site C (catch block) stringifies error.message + optional error.code — NEVER spreads the raw Error (fetch-failure wrappers carry `.response.body` which would leak refresh_token/code values); test asserts meta args are not Error instances"
  - "Fail-fast runs AFTER --health-check short-circuit (so Docker HEALTHCHECK stays cheap on healthy containers) but BEFORE MSAL/secrets/server bootstrapping (so misconfigured deployments exit cleanly without resource allocation)"
  - "MS365_MCP_BASE_URL (v1 name) honored as fallback for MS365_MCP_PUBLIC_URL in the fail-fast check — matches the existing fallback in server.ts publicBase resolution so upgrade-path deployments don't break"
  - "isProdMode + publicUrlHost computation moved BEFORE the CORS middleware block so the same two flags drive both createRegisterHandler (plan 01-06) and createCorsMiddleware (this plan). Phase 3 will extend this single computation point to per-tenant allowlists"
metrics:
  duration: "17 minutes"
  completed_date: "2026-04-18"
  tasks_completed: 3
  tests_added: 23
  files_created: 5
  files_modified: 4
---

# Phase 01 Plan 07: Token-Endpoint Body-Log Removal + CORS Split + Prod HTTP Fail-Fast Summary

**One-liner:** Factory-ized `/token` handler with three scrubbed log sites + `createCorsMiddleware` dev/prod split factory + prod HTTP + missing `MS365_MCP_PUBLIC_URL`/`MS365_MCP_CORS_ORIGINS` triggers `exit(78)` fail-fast at startup.

## What Was Built

### src/lib/cors.ts — CORS middleware factory (106 lines)

Zero project imports beyond Express types. Single exported function `createCorsMiddleware(config: CorsConfig): RequestHandler` with accompanying types:

```typescript
export type CorsMode = 'dev' | 'prod';
export interface CorsConfig {
  mode: CorsMode;
  allowlist: string[];
}
```

**Dev mode** — `DEV_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/`. Accepts loopback on any port, http or https. External origins denied (stops a stray browser session from CSRF-preflighting the dev server).

**Prod mode** — exact-string match against `config.allowlist` via `Set.has` (O(1) per-request lookup). No wildcards, no prefix rules, no `*` ACAO.

**Policy invariants preserved on every request:**
- `Vary: Origin` always set (even on deny) so browser caches differentiate allowed vs denied responses
- ACAO echoes the inbound origin when permitted — never `*` — keeping `Access-Control-Allow-Credentials: true` compatible with the MCP OAuth credentialed-request flow
- OPTIONS preflight: 204 on allowed, 403 on denied. A 403 is a loud operator-facing signal that the allowlist needs updating; v1's silent 200-without-ACAO produced inscrutable browser errors with no server-side breadcrumb
- Requests without an Origin header (curl, server-to-server, same-origin) pass through without ACAO; OPTIONS with no origin still returns 204 so CORS-unaware clients get a predictable answer

### src/server.ts — three call-site changes

#### Hunk 1: import createCorsMiddleware + CloudType

Added to the import block alongside the existing validateRedirectUri import (line 24-26):

```typescript
import { createCorsMiddleware, type CorsMode } from './lib/cors.js';
import type { CloudType } from './cloud-config.js';
```

#### Hunk 2: exported createTokenHandler factory + supporting types (before the class)

Three new exported types plus the factory docstring enumerate the scrubbed log-site invariant explicitly:

```typescript
export interface PkceStoreEntry { ... }
export type PkceStore = Map<string, PkceStoreEntry>;
export interface TokenHandlerSecrets {
  clientId: string;
  clientSecret?: string;
  tenantId?: string;
  cloudType: CloudType;
}
export interface TokenHandlerConfig {
  secrets: TokenHandlerSecrets;
  pkceStore: PkceStore;
}

export function createTokenHandler(config: TokenHandlerConfig) { ... }
```

Three log sites scrubbed inside the factory (before → after, with new line numbers in the committed file):

| Site | Before (v1)                                                                 | After (plan 01-07)                                                                                                                                                                                                                         | New line |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A    | `logger.info('Token endpoint called', { method, url, contentType, grant_type: req.body?.grant_type })` | `logger.info({ method, url, contentType, grant_type: body?.grant_type }, 'Token endpoint called')` — pino-native order; body never attached                                                                                                                                                          | src/server.ts:196 |
| B    | `logger.error('Token endpoint: grant_type is missing', { body })`           | `logger.error({ grant_type: '[MISSING]', has_code, has_refresh_token, has_client_secret }, 'Token endpoint: grant_type is missing')` — shape booleans only; `body` key NEVER attached                                                                                                                | src/server.ts:225 |
| C    | `logger.error('Token endpoint error:', error)`                              | `logger.error({ err: error.message, code: error.code }, 'Token endpoint error')` — stringify message only; raw Error NEVER spread (fetch-failure wrappers carry `.response.body` which would leak)                                                                                                   | src/server.ts:327 |

Additional log sites inside the factory — `authorization_code exchange` shape log (Site A', line 251), `Two-leg PKCE` match log (Site A'', line 278), and the two refresh-client mode markers (lines 303, 305) — all flipped to pino-native `(meta, message)` order while keeping the same safe fields.

#### Hunk 3: computeCorsAllowlist helper (module-level private)

```typescript
function computeCorsAllowlist(): string[] {
  const plural = process.env.MS365_MCP_CORS_ORIGINS;
  if (plural && plural.trim()) {
    return plural.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const singular = process.env.MS365_MCP_CORS_ORIGIN;
  if (singular && singular.trim()) {
    logger.warn('MS365_MCP_CORS_ORIGIN (singular) is deprecated — use MS365_MCP_CORS_ORIGINS (plural, comma-separated)');
    return [singular.trim()];
  }
  return [];
}
```

**Placement decision:** kept as a private (non-exported) helper in `src/server.ts` because it calls the `logger` singleton directly (warn on deprecated singular) and is single-use. Keeping it out of `src/lib/cors.ts` means `src/lib/cors.ts` remains project-import-free — the same isolation rule that `src/lib/redirect-uri.ts` follows.

#### Hunk 4: CORS block replacement (former lines 301-318)

```typescript
// BEFORE — v1:
const corsOrigin = process.env.MS365_MCP_CORS_ORIGIN || 'http://localhost:3000';
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', corsOrigin);
  // ...
});

// AFTER (src/server.ts:588-593):
const corsMode: CorsMode = isProdMode ? 'prod' : 'dev';
const corsAllowlist = computeCorsAllowlist();
app.use(createCorsMiddleware({ mode: corsMode, allowlist: corsAllowlist }));
```

`isProdMode` + `publicUrlHost` are now computed BEFORE the CORS middleware block (src/server.ts:585-586) so they drive both `createRegisterHandler` (plan 01-06) and `createCorsMiddleware` (this plan) from the same two constants.

#### Hunk 5: /token handler replacement (former lines 516-631)

```typescript
// src/server.ts:762-769:
app.post(
  '/token',
  createTokenHandler({
    secrets: this.secrets!,
    pkceStore: this.pkceStore,
  })
);
```

All 115 lines of inline v1 /token handler replaced by a single factory call. Behaviour preserved (authorization_code, refresh_token, unsupported_grant_type branches; two-leg PKCE lookup; exchangeCodeForToken + refreshAccessToken delegation). Only the log sites changed.

### src/index.ts — validateProdHttpConfig (before args.healthCheck short-circuit)

```typescript
const EX_CONFIG = 78; // sysexits EX_CONFIG

function validateProdHttpConfig(args: CommandOptions): void {
  if (!args.http) return;                                        // stdio tolerates missing
  if (process.env.NODE_ENV !== 'production') return;             // dev tolerates missing

  const hasPublicUrl =
    !!process.env.MS365_MCP_PUBLIC_URL?.trim() ||
    !!process.env.MS365_MCP_BASE_URL?.trim();
  if (!hasPublicUrl) {
    logger.error(message);
    process.stderr.write(`[STARTUP CONFIG ERROR] ${message}\n`);
    process.exit(EX_CONFIG); // process.exit(78)
  }

  const hasPluralCors = !!process.env.MS365_MCP_CORS_ORIGINS?.trim();
  const hasSingularCors = !!process.env.MS365_MCP_CORS_ORIGIN?.trim();
  if (!hasPluralCors && !hasSingularCors) {
    logger.error(message);
    process.stderr.write(`[STARTUP CONFIG ERROR] ${message}\n`);
    process.exit(EX_CONFIG); // process.exit(78)
  }
}
```

**Placement:** runs AFTER `args.healthCheck` short-circuit (so Docker HEALTHCHECK stays cheap on healthy containers) but BEFORE `registerShutdownHooks` / MSAL / secrets / server start (so a misconfigured deploy exits cleanly without resource allocation).

**Secondary `process.stderr.write`** alongside `logger.error` is deliberate: in prod mode, pino routes JSON log records to stdout (or to the file transport when `MS365_MCP_LOG_DIR` is set). The stderr write guarantees the variable name is greppable by operators and by the spawnSync-based tests regardless of pino's transport configuration.

**Trigger conditions (exit 78):**

| NODE_ENV    | --http | PUBLIC_URL + BASE_URL | CORS_ORIGINS + CORS_ORIGIN | Exit |
| ----------- | ------ | --------------------- | -------------------------- | ---- |
| production  | yes    | BOTH unset            | —                          | **78** |
| production  | yes    | set                   | BOTH unset                 | **78** |
| production  | yes    | set                   | set                        | — (passes) |
| production  | no     | any                   | any                        | — (stdio tolerates) |
| development | yes    | any                   | any                        | — (dev tolerates) |

### src/lib/otel.ts — Rule 3 blocking fix

The fail-fast tests spawn `src/index.ts` via `tsx` — a real Node process, not vitest's vi-node resolver. The spawn immediately crashed with `SyntaxError: The requested module '@opentelemetry/sdk-node' does not provide an export named 'PeriodicExportingMetricReader'` at src/lib/otel.ts:24.

`@opentelemetry/sdk-node` is a meta-package that aggregates metrics exports under its `metrics` namespace but does NOT re-export the reader as a top-level named export. Under ESM strict import semantics (Node 22) the direct named import from `sdk-node` fails. Vitest's vi-node resolver was silently tolerating the missing export; real Node was not.

**Fix:** change the import to the owning package `@opentelemetry/sdk-metrics`:

```typescript
// before:
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-node';
// after:
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
```

Runtime behaviour identical (same class, same API). This is tracked as a Rule 3 auto-fix in the Deviations section below.

### test/cors-mode-gate.test.ts — createCorsMiddleware contract (11 cases)

Pure middleware tests with a stubbed req/res/next. Covers:

| # | Contract                                                                      |
| - | ----------------------------------------------------------------------------- |
| 4 | Dev mode: `http://localhost:4200` gets ACAO + `Vary: Origin`                  |
| - | Dev mode: `http://127.0.0.1:51234` is accepted (arbitrary port)               |
| 5 | Dev mode: `https://evil.com` does NOT get ACAO (dev is loopback-only permissive) |
| 8 | OPTIONS preflight on allowed origin → 204 + ACAO + ACAM + ACAH                |
| - | No Origin header: passes through without ACAO (curl/server-to-server)         |
| 6 | Prod mode: allowlisted origin echoed                                          |
| 7 | Prod mode: non-allowlisted origin → no ACAO                                   |
| - | Prod mode: loopback NOT permitted (loopback is dev-only)                      |
| - | Prod mode: multi-entry allowlist exact match                                  |
| - | Prod mode: OPTIONS on denied origin → 403 (not silent 200)                    |
| - | Prod mode: `Vary: Origin` set even on deny (prevents browser cache poisoning) |

### test/token-endpoint.test.ts — SECUR-05 (3 cases)

Ephemeral-port Express app mounts `createTokenHandler` with a stubbed secrets + fresh Map. Mocks `../src/lib/microsoft-auth.js` so `exchangeCodeForToken` and `refreshAccessToken` throw controlled errors for the catch-block path without hitting the network.

Every test asserts that **three sensitive VALUES** (`REFRESH_TOKEN_VALUE_SECRET_abc123`, `AUTH_CODE_VALUE_SECRET_xyz789`, `CLIENT_SECRET_VALUE_SECRET_def456`) NEVER appear anywhere in the logger mock's `mock.calls` array — stringified at every level.

- **Test 1** (grant_type missing): POST with all three secrets in the body; asserts no value leaks AND no `body` property on the logger meta for the grant-type-missing call.
- **Test 2** (happy-path entry log): POST `grant_type: refresh_token`; asserts no refresh_token value appears in any info log AND no `body` key on any info log meta.
- **Test 3** (catch block): POST `grant_type: authorization_code` that triggers the mocked throw; asserts the catch-block log meta is not an Error instance, has no `body` property, and no `err` value is an Error.

### test/startup-validation.test.ts — SECUR-04 fail-fast (4 cases)

`spawnSync(tsx, src/index.ts, { env, timeout: 10000 })` — mirrors the existing `test/cli.test.ts` pattern. Inherited env is scrubbed to a controlled allowlist so the developer's local NODE_ENV / CORS vars never leak into the child.

- **Test 9**: prod HTTP + missing CORS_ORIGINS → status `78` + stdout/stderr matches `/MS365_MCP_CORS_ORIGINS/`.
- **Test 10**: prod stdio (`--health-check` without `--http`) + missing CORS → status `0` (healthcheck short-circuit; stdio tolerates missing CORS).
- **Test 11**: dev HTTP + missing CORS → status `!= 78` (dev mode tolerates; `--health-check` returns 1 from port-0 probe).
- Deprecated singular `MS365_MCP_CORS_ORIGIN` satisfies the gate.

### test/public-url-failfast.test.ts — D-02 PUBLIC_URL (5 cases)

Same spawnSync harness; the two test files split by gate responsibility so a single regression is easy to localise.

- **Test 12**: prod HTTP + missing PUBLIC_URL → status `78` + stdout/stderr matches `/MS365_MCP_PUBLIC_URL/`.
- **Test 13**: prod stdio + missing PUBLIC_URL → status `0` (healthcheck short-circuit).
- **Test 14**: prod HTTP + PUBLIC_URL + CORS set → status `!= 78` (both gates pass; healthcheck decides final exit).
- Dev HTTP + missing PUBLIC_URL → status `!= 78` (dev permissive).
- Deprecated `MS365_MCP_BASE_URL` satisfies the PUBLIC_URL gate.

### .env.example — new section

Added a "HTTP transport — production security posture" block documenting:
- `MS365_MCP_PUBLIC_URL` and `MS365_MCP_CORS_ORIGINS` as REQUIRED in prod HTTP mode (exit 78 otherwise)
- Deprecation notes for singular `MS365_MCP_CORS_ORIGIN` (removal target v2.1)
- Deprecation notes for `MS365_MCP_BASE_URL` (removal target v2.1)

## Commits

| Hash    | Description                                                                                                                                                                                                                                                                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 36b3647 | test(01-07): add failing RED tests for CORS mode gate, /token body redaction, PUBLIC_URL/CORS fail-fast                                                                                                                                                                    |
| 00fa680 | feat(01-07): implement createCorsMiddleware with dev/prod mode split (SECUR-04)                                                                                                                                                                                            |
| 4b33f8f | feat(01-07): scrub /token body logs, wire createCorsMiddleware, add prod HTTP fail-fast                                                                                                                                                                                    |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `PeriodicExportingMetricReader` missing export in `@opentelemetry/sdk-node`**

- **Found during:** Task 3 GREEN verification — `test/startup-validation.test.ts` and `test/public-url-failfast.test.ts` spawn `src/index.ts` via `tsx`. The child process immediately crashed with `SyntaxError: The requested module '@opentelemetry/sdk-node' does not provide an export named 'PeriodicExportingMetricReader'` at src/lib/otel.ts:24, causing every fail-fast test to observe exit code 1 instead of 78 or 0.
- **Issue:** `@opentelemetry/sdk-node` (the meta-package) aggregates metrics exports under its `metrics` namespace but does NOT re-export `PeriodicExportingMetricReader` as a top-level named export. Under ESM strict import semantics (Node 22), the direct named import fails at module-load. Vitest's vi-node resolver silently tolerated the missing export; real Node (the spawn) did not. This was a silent compile mismatch introduced by plan 01-02 that never fired in the test-runner path.
- **Fix:** changed the import source from `@opentelemetry/sdk-node` to `@opentelemetry/sdk-metrics` (the owning package). Runtime behaviour identical; same class, same API.
- **Files modified:** `src/lib/otel.ts`
- **Commit:** 4b33f8f

**2. [Rule 3 — Blocking] Missing `src/generated/client.ts`**

- **Found during:** worktree setup (before Task 1) — `src/generated/client.ts` is gitignored and the fresh worktree checkout did not have it. Every test that transitively imports from `src/server.ts` (which imports from `graph-tools.ts` which imports the generated client) would fail module resolution.
- **Issue:** Worktree reset to base commit `5e6aa53` left `src/generated/client.ts` unpopulated.
- **Fix:** copied the existing generated client from the main worktree (`/home/yui/Documents/ms-365-mcp-server/src/generated/client.ts`). File is `.gitignored` — not committed. Same workaround used by plan 01-06 (see 01-06-SUMMARY.md).
- **Files modified:** `src/generated/client.ts` (restored, not tracked)
- **Commit:** (none — gitignored asset)

### No Plan-Level Deviations

- No rule-4 architectural decisions were required.
- The plan's "commited approach" — keeping `main()` invocation unchanged in `src/index.ts` and using `spawnSync` for process-level fail-fast tests — was followed exactly.
- `createTokenHandler` factory decision was not in the plan's explicit output spec but followed the same pattern plan 01-06 established with `createRegisterHandler`. The factory is required to make tests observable at the logger-mock level; without it, the /token handler could only be tested by bootstrapping `MicrosoftGraphServer` with a full secrets stack.

## Package Changes

None. This plan adds zero dependencies.

## Verification Results

**Grep invariants (from plan `<verification>` block):**

| Check                                                                      | Result                                                                    |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `grep -q 'createCorsMiddleware' src/server.ts`                             | FOUND (3 import/comment sites + 1 call site)                              |
| `grep -q 'process\.exit(78)' src/index.ts`                                 | FOUND (two explicit comments `// process.exit(78) — sysexits EX_CONFIG`)  |
| `! grep -qE 'logger\.error\(.*Token endpoint.*,\s*\{\s*body' src/server.ts` | PASS (no `{ body }` spread pattern)                                       |
| `! grep -q "'http://localhost:3000'" src/server.ts`                        | PASS (v1 default CORS gone)                                               |
| `export function createTokenHandler`                                       | FOUND (src/server.ts:185)                                                 |

**Test suite:** 38 files / 283 tests / 283 passed (full regression; 260 baseline + 23 new).

**Plan-specific tests:** 23/23 passed — 11 createCorsMiddleware matrix + 3 token-endpoint + 4 startup-validation + 5 public-url-failfast.

**Build:** `npm run build` — success (36ms).

**Lint:** `npx eslint src/server.ts src/index.ts src/lib/otel.ts src/lib/cors.ts test/...test.ts` — 0 errors, 4 pre-existing `@typescript-eslint/no-explicit-any` warnings in `src/server.ts` at lines 797/797/851/851 (MCP SDK `req as any, res as any` bridge on `/mcp` GET/POST handlers; same warnings documented in 01-06-SUMMARY.md, NOT introduced by this plan).

**Format:** `npx prettier --check` — all files clean.

## Cross-references

- **Plan 01-02** — pino STRICT `REDACT_PATHS` includes `req.body` and `*.refresh_token`, providing defense-in-depth if any future regression reintroduces a body-spread log site. The call-site scrub in this plan holds the invariant first; the serialization-layer redact holds it second.
- **Plan 01-06** — `createRegisterHandler` established the factory pattern this plan follows for `createTokenHandler`. Both factories are called from the same HTTP-setup block in `src/server.ts start()` and share the same two closure-captured constants (`isProdMode`, `publicUrlHost`) — computed once per HTTP setup.
- **Plan 01-04** — the `--health-check` CLI flag is the bounded-exit mechanism for stdio-mode and dev-mode fail-fast tests (Tests 10, 11, 13, 14). Without it, those tests could only assert `status !== 78` via process timeouts, which would be flaky. Placement of `validateProdHttpConfig` is deliberately AFTER the health-check short-circuit so Docker HEALTHCHECK stays cheap on healthy containers.
- **Plan 01-05** — `registerShutdownHooks(null, logger)` runs AFTER `validateProdHttpConfig`. If fail-fast triggers, shutdown hooks never register — which is correct; there is nothing to gracefully drain at that point.
- **Phase 3 (TENANT-01)** — per-tenant CORS replaces single-tenant `createCorsMiddleware` with a per-request allowlist lookup keyed by tenantId. The exported `CorsMode` + `CorsConfig` types are the contract that Phase 3 will extend (likely grow `CorsConfig` with `perTenantAllowlist?: (tenantId: string) => string[]`). The current `createCorsMiddleware` is the LAST single-tenant Phase 1 form.
- **Phase 3 (TENANT-01) — `createTokenHandler`** — Phase 3 will pass a per-tenant secrets resolver instead of a static `TokenHandlerSecrets`. The factory's current shape (dependency-injected `secrets` + `pkceStore`) is compatible: the `pkceStore` becomes a per-tenant partition and the secrets resolver becomes an async lookup.
- **Phase 6 load tests** — both factories are already structured so env parsing, allowlist splitting, and PKCE-store map construction happen ONCE per HTTP setup, not per request — addresses the `<specifics>` performance concern about "1000 new URL() calls/minute".

## Known Stubs

None. Every factory is fully wired and exercised by tests; no placeholder branches, no TODO markers, no "coming soon" text.

## Threat Flags

No new trust boundaries introduced by this plan. The scope is entirely within the HTTP transport + OAuth proxy layer that the plan's `<threat_model>` already enumerated (T-01-07, T-01-07b, T-01-07c, T-01-07d, T-01-07e). All five threats mitigated as planned.

## Self-Check: PASSED

- [x] `src/lib/cors.ts` exists with `createCorsMiddleware`, `CorsMode`, `CorsConfig` exports
- [x] `src/server.ts` contains `createCorsMiddleware` call, `createTokenHandler` export, `computeCorsAllowlist` helper
- [x] `src/index.ts` contains `validateProdHttpConfig` + `process.exit(EX_CONFIG) // process.exit(78)` at both CORS + PUBLIC_URL fail-fast sites
- [x] `.env.example` documents `MS365_MCP_PUBLIC_URL` + `MS365_MCP_CORS_ORIGINS` + deprecated singular fallback
- [x] Commits 36b3647, 00fa680, 4b33f8f all exist and reachable from HEAD
- [x] Test files `test/cors-mode-gate.test.ts`, `test/token-endpoint.test.ts`, `test/startup-validation.test.ts`, `test/public-url-failfast.test.ts` all exist and tracked
- [x] All 283 regression tests pass (260 baseline + 23 new)
- [x] `npm run build` succeeds
- [x] Prettier + ESLint clean on all touched files (pre-existing 4 `any` warnings in `/mcp` SDK bridge untouched)
- [x] No stubs, no placeholder text, no "coming soon" in production code
- [x] No untracked files beyond `node_modules/` (symlink to main worktree) and `src/generated/client.ts` (gitignored, restored from main worktree)
- [x] Rule 3 blocking issue (`src/lib/otel.ts` named-export bug) surfaced, fixed, and documented as a deviation
