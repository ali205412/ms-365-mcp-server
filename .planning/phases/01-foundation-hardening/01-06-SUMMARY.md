---
phase: 01-foundation-hardening
plan: "06"
subsystem: oauth-registration
tags:
  - oauth
  - dynamic-registration
  - redirect-uri
  - crypto-random
  - client-id
  - allowlist
  - pii-redaction
dependency_graph:
  requires:
    - "01-01"
    - "01-02"
  provides:
    - d02-redirect-uri-validator
    - crypto-random-client-id
    - scrubbed-register-log
    - create-register-handler-factory
  affects:
    - src/lib/redirect-uri.ts
    - src/server.ts
tech_stack:
  added: []
  patterns:
    - Pure validator (zero project imports) — same shape as src/lib/teams-url-parser.ts
    - Exported handler factory — createRegisterHandler(policy) so the handler is testable without bootstrapping MicrosoftGraphServer
    - Closure-captured policy computed once per HTTP setup (not recomputed per request)
    - pino-native meta-first arg order `logger.info(meta, message)` for scrubbed payload log
    - LOOPBACK_HOSTS set accepts both bracketed (`[::1]`) and unbracketed (`::1`) IPv6 literals for cross-implementation safety
key_files:
  created:
    - src/lib/redirect-uri.ts
    - test/oauth-register.test.ts
    - test/oauth-register-hardening.test.ts
  modified:
    - src/server.ts
decisions:
  - "validateRedirectUri exposed as a pure function (no project imports, no side effects) so Phase 3 can inject a per-tenant publicUrlHost into the same pipeline"
  - "LOOPBACK_HOSTS includes `[::1]` in addition to `::1` — Node's URL parser preserves brackets on IPv6 literals in `hostname`, so accepting both forms avoids a surprise rejection when different URL parsers normalise differently"
  - "createRegisterHandler factory exported from src/server.ts so tests mount it on a minimal Express app (ephemeral port via listen(0)) rather than spinning up MicrosoftGraphServer with secrets+auth"
  - "isProdMode + publicUrlHost computed once per HTTP setup, closure-captured by the factory — avoids re-parsing PUBLIC_URL on every request"
  - "Empty `redirect_uris` array is accepted (201) per RFC 7591 — the OAuth flow fails later if an unregistered redirect comes in, which is the right layer for that check"
  - "Scrubbed log uses pino-native `(meta, message)` arg order — canonical for all new code written post-plan 01-02"
metrics:
  duration: "7 minutes"
  completed_date: "2026-04-18"
  tasks_completed: 3
  tests_added: 27
  files_created: 3
  files_modified: 1
---

# Phase 01 Plan 06: `/register` Hardening — D-02 Redirect URI Allowlist + Crypto Client IDs + Scrubbed Log Summary

**One-liner:** Pure `validateRedirectUri` validator + exported `createRegisterHandler` factory replaces the v1 `/register` hunk that accepted `javascript:` URIs, collided client IDs under concurrency, and leaked the raw payload into info logs.

## What Was Built

### src/lib/redirect-uri.ts — pure allowlist validator (71 lines)

Zero project imports. Single exported function `validateRedirectUri(raw, policy)` returning a discriminated union `{ ok: true } | { ok: false; reason: string }`. Accompanying types:

```typescript
export type RedirectUriMode = 'dev' | 'prod';

export interface RedirectUriPolicy {
  mode: RedirectUriMode;
  publicUrlHost: string | null; // parsed host of MS365_MCP_PUBLIC_URL
}
```

**D-02 rules (evaluated in order):**

1. Malformed URL → reject with `'not a valid URL'`.
2. `javascript:`, `data:`, `file:`, `about:`, `vbscript:` → reject (regardless of mode).
3. Non-`http(s)` scheme → reject (e.g., `ftp://`).
4. `http://` + hostname ∈ {`localhost`, `127.0.0.1`, `::1`, `[::1]`} → accept.
5. `https://` + hostname === `policy.publicUrlHost` → accept.
6. `mode === 'dev'` + `https://` → accept.
7. Everything else → reject with `host not in allowlist (mode=...)`.

**LOOPBACK_HOSTS design note:** Node's URL parser preserves brackets on IPv6 hostnames (`new URL('http://[::1]:3000/cb').hostname === '[::1]'`), while the WHATWG spec and some other implementations strip them. The set accepts both forms for cross-implementation safety. The RED test matrix caught this: the original single-form set failed the `http://[::1]:3000/cb` case.

### src/server.ts — `createRegisterHandler` factory (export) + call-site rewrite

**New top-level export** `createRegisterHandler(policy: RedirectUriPolicy)` returning an Express `(req, res)` handler. The factory bundles the three AUTH-06/07/T-01-06c hardenings at a single code site:

1. **Scrubbed info log** — pino-native order `logger.info({ client_name, grant_types, redirect_uri_count }, 'Client registration request')`. The raw body is NEVER attached to the log record.
2. **Allowlist validation** — iterate every entry in `body.redirect_uris ?? []`; string-check + `validateRedirectUri` per entry; first failure short-circuits `res.status(400).json({ error: 'invalid_redirect_uri', redirect_uri, reason })` so the MCP client can fix configuration.
3. **Crypto-random client ID** — `` `mcp-client-${crypto.randomBytes(8).toString('hex')}` `` (16 hex chars = 64 bits entropy). Replaces `mcp-client-${Date.now()}`.

**Response shape preserved:** `client_id`, `client_id_issued_at`, `redirect_uris`, `grant_types`, `response_types`, `token_endpoint_auth_method`, `client_name`. Only the client_id VALUE format changes (hex suffix instead of millisecond timestamp).

**HTTP setup block additions (close to existing `publicBase` computation):**

```typescript
const publicUrlHost = publicBase ? new URL(publicBase).hostname : null;
const isProdMode = process.env.NODE_ENV === 'production';
```

Both are read by the factory via closure capture — NOT recomputed per request.

**Call-site rewrite:**

```typescript
if (this.options.enableDynamicRegistration) {
  app.post(
    '/register',
    createRegisterHandler({
      mode: isProdMode ? 'prod' : 'dev',
      publicUrlHost,
    })
  );
}
```

### test/oauth-register.test.ts — validateRedirectUri matrix (19 cases)

Pure-function tests across four describe blocks:

- **forbidden schemes (D-02, always rejected):** `javascript:`, `data:`, `file:`, `about:`, `vbscript:`, `javascript:` in dev mode.
- **loopback (always permitted):** `http://localhost:3000/cb` in prod, arbitrary port, `127.0.0.1`, `[::1]`, `localhost` in dev.
- **https host allowlist:** rejects `evil.com` in prod with null publicUrlHost, accepts it in dev, accepts `mcp.example.com` when publicUrlHost matches, accepts it on port 8443, rejects other hosts when host mismatches.
- **malformed input:** `not a url`, empty string, `ftp://`.

### test/oauth-register-hardening.test.ts — handler integration tests (8 cases)

Real HTTP requests against an ephemeral-port Express server (`http.createServer(app).listen(0)`). Mocks `../src/logger.js` so Test D can assert the scrubbed shape.

- **Test A:** `javascript:alert(1)` returns 400 with `{ error: 'invalid_redirect_uri', redirect_uri, reason: /javascript/i }`.
- **Test B:** `http://localhost:3000/cb` returns 201 with `client_id` matching `^mcp-client-[0-9a-f]{16}$`.
- **Test C:** 50 sequential registrations yield 50 distinct `client_id` values (proves crypto.randomBytes, not Date.now).
- **external host in prod** rejected, **external host in dev** accepted, **publicUrlHost-matching host in prod** accepted, **empty redirect_uris array** accepted (RFC 7591).
- **Test D:** `logger.info` called with meta containing `client_name`, `grant_types`, `redirect_uri_count` — NOT `body`, `redirect_uris`, or `token_endpoint_auth_method`.

## Commits

| Hash    | Description                                                                                                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| acd665e | test(01-06): add failing RED tests for redirect_uri allowlist + crypto client_id + scrubbed log                                                                                                                                                                                                        |
| 010c6bc | feat(01-06): implement validateRedirectUri pure validator (D-02 policy)                                                                                                                                                                                                                                |
| 282f5bc | feat(01-06): harden /register with validateRedirectUri + crypto client_id + scrubbed log                                                                                                                                                                                                               |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] LOOPBACK_HOSTS missed bracketed IPv6 form**

- **Found during:** Task 2 (GREEN) — `http://[::1]:3000/cb` test failed because `new URL(...).hostname` returned `'[::1]'` (with brackets) while the set only contained `'::1'`.
- **Issue:** The plan's `interfaces` hunk at line 115 asserted "URL parser strips brackets from `url.hostname`". Node 22's URL parser preserves the brackets; the set needed to accept both forms.
- **Fix:** Extended the set from `new Set(['localhost', '127.0.0.1', '::1'])` to `new Set(['localhost', '127.0.0.1', '::1', '[::1]'])` with an explanatory comment about cross-implementation differences.
- **Files modified:** `src/lib/redirect-uri.ts`
- **Commit:** 010c6bc

**2. [Rule 3 - Blocking] Missing `src/generated/client.ts`**

- **Found during:** Task 1 (RED verification) — test harness imports from `src/server.ts` which transitively imports `src/graph-tools.ts`, which imports the generated client. That file is gitignored and was not present in the worktree.
- **Issue:** Worktree reset to `a4b9ce8` left `src/generated/client.ts` unpopulated; test collection failed with "Cannot find module './generated/client.js'".
- **Fix:** Copied the existing generated client from the main worktree (`/home/yui/Documents/ms-365-mcp-server/src/generated/client.ts`). File is `.gitignored` — not committed.
- **Files modified:** `src/generated/client.ts` (restored, not tracked)
- **Commit:** (none — gitignored asset)

## Verification Results

**Grep invariants (from plan `<verification>` block):**

| Check                                                                      | Result                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `grep -q 'validateRedirectUri' src/server.ts`                              | FOUND                                                                            |
| `grep -qE 'crypto\.randomBytes\(8\)' src/server.ts`                        | FOUND                                                                            |
| `! grep -qE "logger\.info\('Client registration request', \{ body \}\)"`   | OLD PATTERN REMOVED                                                              |
| `! grep -qF 'client_id = \`mcp-client-${Date.now'`                         | OLD PATTERN REMOVED (only reference is in the docstring describing the old bug)  |

**Test suite:** 37 files / 260 tests / 260 passed (full regression).

**Plan-specific tests:** 27/27 passed — 19 pure-function matrix + 8 integration (A/B/C + 4 supplementary + D).

**Build:** `npm run build` — success (37ms).

**Lint:** `npx eslint src/server.ts src/lib/redirect-uri.ts test/oauth-register*.test.ts` — 0 errors. 4 pre-existing `@typescript-eslint/no-explicit-any` warnings in src/server.ts at lines 661/715 — both from the existing `/mcp` GET/POST `req as any, res as any` casts (MCP SDK type bridge); NOT introduced by this plan.

**Format:** `npx prettier --check` — all files clean.

## Cross-references

- **Plan 01-02** — pino STRICT redaction + `req.body` in `REDACT_PATHS` means the `/register` info log is redacted a second time at the serialization layer as defense-in-depth (T-01-06c mitigation has two layers).
- **Plan 01-07** — token-endpoint body-log removal is the analogous `/token` hardening; uses the same pino-native meta-first arg order pattern established here.
- **Phase 3 (TENANT-01)** — the exported `RedirectUriPolicy` type already takes `publicUrlHost: string | null`; Phase 3 will grow it to include `extraAllowedHosts: string[]` (per-tenant allowlist) without rewriting the pure function.
- **Phase 6 load tests** — `createRegisterHandler` factory is already structured so the entire `publicBase`/`publicUrlHost`/`isProdMode` pipeline runs once per HTTP setup, not per request; this avoids the ~1000 `new URL()` calls/minute that the plan's `<specifics>` flagged.

## Self-Check: PASSED

- [x] `src/lib/redirect-uri.ts` exists with `validateRedirectUri`, `RedirectUriMode`, `RedirectUriPolicy` exports
- [x] `src/server.ts` contains `createRegisterHandler` export, `validateRedirectUri` import, `crypto.randomBytes(8)` call
- [x] Commits acd665e, 010c6bc, 282f5bc all exist and reachable from HEAD
- [x] Test files `test/oauth-register.test.ts`, `test/oauth-register-hardening.test.ts` exist and are tracked
- [x] All 260 regression tests pass
- [x] `npm run build` succeeds
- [x] Prettier + ESLint clean on all touched files
- [x] No stubs, no placeholder text, no "coming soon" in production code
- [x] No untracked files
