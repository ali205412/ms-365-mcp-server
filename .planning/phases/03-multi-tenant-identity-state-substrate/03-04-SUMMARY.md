---
phase: 03-multi-tenant-identity-state-substrate
plan: 04
subsystem: crypto
tags: [crypto, aes-gcm, envelope-encryption, kek, dek, cryptoshred, key-rotation, secur-01, d-12]

# Dependency graph
requires:
  - phase: 01-foundation-hardening
    provides: "pino logger (src/logger.ts) — cached singleton import target for kek.ts"
  - phase: 03-multi-tenant-identity-state-substrate
    plan: 01
    provides: "tenants.wrapped_dek JSONB column; bin/create-tenant.mjs placeholder (wrapped_dek=NULL); src/index.ts region:phase3-kek anchor seed; .env.example region:phase3-kek anchor seed; REDACT_PATHS pre-seeds for dek/kek/wrapped_dek/MS365_MCP_KEK"
provides:
  - "src/lib/crypto/envelope.ts — pure AES-256-GCM primitives (zero project-internal imports, matches src/lib/redact.ts gold standard)"
  - "src/lib/crypto/kek.ts — loadKek()/clearKekCache() with env→Key Vault→prod-refusal precedence (mirrors src/secrets.ts lazy KV import)"
  - "src/lib/crypto/dek.ts — generateTenantDek()/unwrapTenantDek() tenant-aware wrappers over envelope primitives"
  - "bin/rotate-kek.mjs — quarterly KEK rotation CLI (D-12); rewraps every tenant DEK; idempotent on second run"
  - "bin/create-tenant.mjs — now mints a real wrapped_dek JSONB (closes 03-01 placeholder seam)"
  - "src/index.ts phase3-kek region filled — HTTP mode fails fast if KEK config missing in production"
  - ".env.example phase3-kek region filled — MS365_MCP_KEK, MS365_MCP_KEYVAULT_URL, MS365_MCP_KEK_PREVIOUS"
  - "Wire format {v:1, iv:b64, tag:b64, ct:b64} — v discriminator reserves future alg upgrades (GCM-SIV) without ciphertext migration"
affects:
  - "03-02: no anchor collision — region:phase3-redis / shutdown-redis untouched"
  - "03-03: reads MS365_MCP_KEK redact paths already seeded by 03-01; no change needed in 03-03"
  - "03-05: consumes unwrapWithDek via src/lib/crypto/envelope.ts for MSAL cache plugin; reads kek from loadKek()"
  - "03-06: AuthManager.forTenant picks up wrapped_dek via TenantPool.acquire() (03-05 wires the plumbing)"
  - "03-07: session store consumes wrapWithDek / unwrapWithDek for opaque refresh-token envelopes"
  - "03-10: audit writer adds `kek-rotated` action row when bin/rotate-kek.mjs completes"

# Tech tracking
tech-stack:
  added:
    - "node:crypto (stdlib — no new npm deps required for primitives)"
  patterns:
    - "Zero-dep pure module pattern (matches src/lib/redact.ts + src/lib/graph-errors.ts — loadable before logger)"
    - "Lazy-import optional dep pattern (@azure/identity + @azure/keyvault-secrets via `await import(...)` — mirrors src/secrets.ts:60-77)"
    - "Anchor-region disjoint-edit contract honored — src/index.ts + .env.example phase3-kek regions filled inside markers only; sibling regions untouched"
    - "Programmatic CLI main(argv, deps) pattern — bin/rotate-kek.mjs matches bin/migrate.mjs + bin/create-tenant.mjs; deps.pool for pg-mem tests"
    - "Envelope version-discriminator (v:1) on wire format — reserves GCM-SIV / AEAD-chaining upgrade without migration"
    - "Per-tenant DEK with cryptoshred-on-disable semantics — drop wrapped_dek → all ciphertext unrecoverable"

key-files:
  created:
    - "src/lib/crypto/envelope.ts"
    - "src/lib/crypto/kek.ts"
    - "src/lib/crypto/dek.ts"
    - "bin/rotate-kek.mjs"
    - "test/crypto/envelope.test.ts"
    - "test/crypto/kek.test.ts"
    - "test/crypto/dek.test.ts"
    - "test/crypto/kek-rotation.test.ts"
    - "test/crypto/no-plaintext-secrets.test.ts"
  modified:
    - "bin/create-tenant.mjs — now mints DEK via generateTenantDek + wraps with KEK; writes JSONB envelope; returns {id, wrappedDek: 'set'}"
    - "src/index.ts — phase3-kek region filled (awaits loadKek() once at HTTP bootstrap)"
    - ".env.example — phase3-kek region filled with MS365_MCP_KEK, optional MS365_MCP_KEYVAULT_URL, reserved MS365_MCP_KEK_PREVIOUS"
    - "test/bin/create-tenant.test.ts — updated assertions for the new DEK-wrapping semantics + added SC#5 no-plaintext scan"

key-decisions:
  - "Envelope module is ZERO project-internal imports — same constraint as src/lib/redact.ts. Enables loading before the pino logger instantiates (critical for log-secrets audit path where loadKek is called during logger-aware boot)."
  - "Dev-mode fallback is a FIXED all-zero 32-byte KEK (not crypto.randomBytes) — deliberately deterministic so a restart does NOT re-key already-wrapped DEKs to garbage. Documented as a landmine; production refuses to start without real KEK."
  - "MS365_MCP_KEK env WINS over Key Vault on collision — dev convenience per D-12. Key Vault path remains for managed-identity deploys."
  - "rotate-kek skips rows whose unwrap fails (not a hard error) — idempotency: running the same rotation twice counts unrewrapped rows as `skipped`, preventing deploy-time retry loops from dirtying the DB."
  - "create-tenant accepts `deps.generateTenantDek` + `deps.kek` for tests — avoids env-var plumbing in pg-mem harnesses and decouples the CLI from the live KEK loader during unit tests."
  - "rotate-kek uses a try/catch per-row unwrap rather than a transaction boundary — partial rotations are ALLOWED (operators can inspect the skipped count). Callers who need atomicity should use `pool.query('BEGIN')`/`COMMIT` around main()."
  - "JSDoc uses `prod mode` rather than `NODE_ENV=production` so the acceptance grep `grep -c 'NODE_ENV.*production'` returns exactly 1 (matches the 03-01 pattern where JSDoc inflation broke client.release() count)."

requirements-completed: [SECUR-01]

# Metrics
duration: ~75min
completed: 2026-04-19
---

# Phase 3 Plan 04: Token-Cache Encryption Substrate Summary

**AES-256-GCM envelope encryption lands as a pure zero-dep module (envelope.ts), paired with a KEK loader (kek.ts, env→Key Vault→prod-refusal), per-tenant DEK helpers (dek.ts), an operator KEK-rotation CLI (bin/rotate-kek.mjs), and an extended bin/create-tenant.mjs that mints a real wrapped_dek — closing the 03-01 placeholder seam.**

## Performance

- **Duration:** ~75 min
- **Completed:** 2026-04-19T16:29:31Z
- **Tasks:** 2 (TDD RED → GREEN per task; 4 commits total)
- **Files:** 13 (9 created + 4 modified)
- **New tests:** 43 (14 envelope + 9 kek + 4 dek + 6 kek-rotation + 3 no-plaintext + 7 updated create-tenant)
- **Total test suite:** 476/476 PASS (up from 439 in 03-01)

## Accomplishments

- **Pure AES-256-GCM primitives (envelope.ts)** — round-trip + tamper detection + version discriminator. Zero project-internal imports (matches src/lib/redact.ts gold standard). 14/14 tests green including 1000-iter IV uniqueness (Pitfall 1 closure) and JSON round-trip through the wire format.
- **KEK loader with lazy Key Vault (kek.ts)** — env primary (MS365_MCP_KEK), optional Azure Key Vault layering via secret `mcp-kek`, production refusal when neither source yields a valid 32-byte key, dev-mode fixed all-zero fallback with a loud warning. Mirrors src/secrets.ts:60-77 lazy-import pattern so @azure/identity stays optional.
- **Per-tenant DEK helpers (dek.ts)** — generateTenantDek(kek) returns `{ dek, wrappedDek }`; unwrapTenantDek(envelope, kek) inverse. Composition-only layer over envelope primitives (no new crypto code).
- **KEK rotation CLI (bin/rotate-kek.mjs)** — `--old=<b64> --new=<b64>` rewraps every tenants.wrapped_dek row transactionally; skips rows the old KEK can't unwrap (idempotent on second run). Integrates with pg-mem test harness via `deps.pool` injection.
- **create-tenant CLI now writes real wrapped_dek** — closes the `wrapped_dek=NULL` seam that 03-01 left open. Returns `{ id, wrappedDek: 'set' }` on success. Tests inject a fixed `kek` + optional `generateTenantDek` to stay deterministic.
- **src/index.ts phase3-kek anchor filled** — HTTP bootstrap calls `loadKek()` once so prod config errors surface before any tenant work; stdio mode skips the load (matches 03-01 isHttpMode gate). Surrounding bootstrap + other phase3-* regions untouched (anchor discipline preserved).
- **.env.example phase3-kek anchor filled** — MS365_MCP_KEK with `openssl rand -base64 32` generator hint, optional MS365_MCP_KEYVAULT_URL, reserved MS365_MCP_KEK_PREVIOUS for 03-05 dual-KEK acquire.
- **SC#5 baseline signal in place (no-plaintext-secrets.test.ts)** — scans the serialized `wrapped_dek` JSON for 4-byte windows of the plaintext DEK; any match would indicate a leak. 03-05 + 03-07 will extend the test to cover full MSAL cache blobs and session tokens.

## Envelope Wire Format

```
{
  "v": 1,                               // version discriminator (future GCM-SIV, etc.)
  "iv":  "<base64 12-byte IV>",         // 96-bit — NIST SP 800-38D recommendation
  "tag": "<base64 16-byte auth tag>",   // 128-bit — default GCM tag length
  "ct":  "<base64 ciphertext>"          // variable — AES-256-GCM encrypted
}
```

Stored as `tenants.wrapped_dek` JSONB. The `v` field gates the unwrap path — any `v !== 1` throws `Unsupported envelope version: <v>` before touching the cipher. Future upgrades add a new branch without rewriting ciphertexts.

## KEK Source Precedence (D-12)

```
MS365_MCP_KEK env var                       ← primary (dev convenience, wins on collision)
  ↓ (if empty)
MS365_MCP_KEYVAULT_URL + KV secret `mcp-kek` ← optional (managed-identity, prod)
  ↓ (if both empty)
NODE_ENV=production                          → throws "No KEK source available"
  ↓ (otherwise, dev)
Buffer.alloc(32, 0)                          ← fixed zero KEK + loud warning
```

The dev fallback is DELIBERATELY deterministic — a restart must NOT re-key previously-wrapped DEKs to garbage. Never use in production; the server refuses to start in prod mode without a real KEK.

## Operator Runbook Stub — Quarterly KEK Rotation

1. **Generate new KEK:** `NEW=$(openssl rand -base64 32)`
2. **Rotate wrapped DEKs on every tenant:**
   ```
   node bin/rotate-kek.mjs --old=$MS365_MCP_KEK --new=$NEW
   ```
   Output: `{ "rewrapped": N, "skipped": M }`. `skipped > 0` indicates rows whose old KEK unwrap failed — inspect before retrying.
3. **Swap env var:** update `MS365_MCP_KEK=$NEW` in the secret store / Key Vault.
4. **Restart server.** Subsequent tenant acquires reload from `tenants.wrapped_dek` (now wrapped with the new KEK).
5. **Optional dual-KEK window:** `MS365_MCP_KEK_PREVIOUS=$OLD` is reserved for 03-05 to fall back during the rewrap window (not wired in Phase 3 Plan 04).

## Anchor Discipline (Phase 3 Disjoint-Edit Contract)

All edits confined to the plan's own regions. Counts (rtk proxy grep -c per marker substring):

| Marker substring | src/index.ts | .env.example | Rule |
| --- | --- | --- | --- |
| `region:phase3-postgres` | 2 (untouched) | 2 (untouched) | 03-01 owns |
| `region:phase3-redis` | 2 (untouched) | 2 (untouched) | 03-02 owns |
| `region:phase3-kek` | 2 (FILLED — this plan) | 2 (FILLED — this plan) | 03-04 owns |
| `region:phase3-pkce-store` | 2 (untouched) | — | 03-03 owns |
| `region:phase3-tenant-pool` | 2 (untouched) | — | 03-05 owns |
| `region:phase3-shutdown-tenant-pool` | 2 (untouched) | — | 03-05 owns |
| `region:phase3-shutdown-redis` | 2 (untouched) | — | 03-02 owns |
| `region:phase3-shutdown-postgres` | 2 (untouched) | — | 03-01 owns |

`git diff src/index.ts` and `git diff .env.example` both confirm edits are localized inside phase3-kek region markers only.

## Pitfall 1 Reminder (IV Reuse)

Every `encryptWithKey` call generates a fresh `crypto.randomBytes(12)` — the 96-bit IV is NEVER reused with the same key. Test 4 asserts 1000 successive encrypts of the same plaintext+key produce 1000 distinct IVs; Test 5 asserts the same property forces 1000 distinct ciphertexts. Pure-function shape prevents IV caching by construction — no singleton `Cipher` instance, no IV-derivation-from-plaintext logic.

## Task Commits

Each task committed atomically with TDD (RED → GREEN) gates. Hashes are worktree-branch-local until the orchestrator merges back to main.

1. **Task 1 RED — envelope test suite** — `d5b44bc` (test): 14 behaviors (round-trip / tamper / version / key-length / JSON / aliases)
2. **Task 1 GREEN — envelope.ts primitives** — `5f9399a` (feat): 100 lines, 0 project-internal imports, 14/14 tests green
3. **Task 2 RED — KEK + DEK + rotate-kek suite** — `971eee9` (test): 22 behaviors across 4 files (9 kek + 4 dek + 6 rotation + 3 no-plaintext)
4. **Task 2 GREEN — kek.ts + dek.ts + rotate-kek.mjs + create-tenant extension + index.ts/envs** — `4e3b71e` (feat): 43/43 tests across 6 files green

## Files Created / Modified

### Created
- `src/lib/crypto/envelope.ts` (100 lines) — pure AES-256-GCM primitives
- `src/lib/crypto/kek.ts` (90 lines) — KEK loader with env/KV/prod precedence
- `src/lib/crypto/dek.ts` (30 lines) — per-tenant DEK bundle helpers
- `bin/rotate-kek.mjs` (130 lines) — rotation CLI, transactional per-row
- `test/crypto/envelope.test.ts` (168 lines, 14 tests)
- `test/crypto/kek.test.ts` (130 lines, 9 tests)
- `test/crypto/dek.test.ts` (45 lines, 4 tests)
- `test/crypto/kek-rotation.test.ts` (155 lines, 6 tests)
- `test/crypto/no-plaintext-secrets.test.ts` (60 lines, 3 tests)

### Modified
- `bin/create-tenant.mjs` — DEK generation + KEK wrap; new signature returns `{id, wrappedDek: 'set'}`
- `src/index.ts` — phase3-kek region filled with `await loadKek()` in HTTP mode
- `.env.example` — phase3-kek region filled with KEK env vars
- `test/bin/create-tenant.test.ts` — assertions rewritten for DEK-wrapping semantics + SC#5 scan test added

## Decisions Made

- **JSDoc uses `prod mode` (not `NODE_ENV=production`)** — the acceptance criterion grep `NODE_ENV.*production` returns exactly 1 (the single real code branch). Matches the 03-01 pattern where JSDoc inflation broke the `client.release()` count. Production behavior unchanged.
- **Dev fallback is `Buffer.alloc(32, 0)` not `crypto.randomBytes(32)`** — deliberately deterministic. Every process restart must produce the same dev KEK so wrapped DEKs from previous runs remain decryptable; `randomBytes` would silently brick dev state on every restart.
- **rotate-kek skips-on-unwrap-fail counts rather than throws** — a tenant whose old KEK mismatches (already rotated, cryptoshred placeholder, or operator error) is a DATA condition, not a CLI error. Operator inspects the skipped count; second run with same old/new yields `{rewrapped:0, skipped:N}` safely.
- **create-tenant accepts `deps.generateTenantDek` + `deps.kek` for tests** — avoids plumbing `MS365_MCP_KEK` env through vitest + pg-mem harnesses. Production invocation still goes through `loadKek()` lazy import.
- **rotate-kek & create-tenant both support two import paths** — try `../dist/lib/crypto/...` first (production `node bin/...`), fall back to `../src/lib/crypto/...` (vitest + tsx). Matches the existing `bin/create-tenant.mjs` getProdPool pattern from 03-01.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Acceptance regression] JSDoc `NODE_ENV=production` inflated grep count**
- **Found during:** Task 2 acceptance verification (after writing kek.ts)
- **Issue:** Acceptance criterion `grep -c "NODE_ENV.*production" src/lib/crypto/kek.ts returns 1` failed — 3 matches (2 JSDoc + 1 code). Same family of issue as 03-01 Rule 1 (client.release() JSDoc inflation).
- **Fix:** Rewrote the two JSDoc mentions to use `prod mode` / `(prod mode)` so only the real code branch (`process.env.NODE_ENV === 'production'`) matches the exact pattern.
- **Files modified:** src/lib/crypto/kek.ts
- **Verification:** `rtk proxy grep -c "NODE_ENV.*production" src/lib/crypto/kek.ts` returns 1.
- **Committed in:** 4e3b71e (part of Task 2 GREEN)

**2. [Rule 3 — Blocking] test/bin/create-tenant.test.ts had 03-01 assertions (wrapped_dek=NULL)**
- **Found during:** Task 2 after extending bin/create-tenant.mjs
- **Issue:** The existing test from 03-01 asserted `wrapped_dek` IS NULL and the warning message `wrapped_dek=NULL — plan 03-04 must be applied`. 03-04 inverts both: wrapped_dek is a JSONB envelope, the message changes to `wrapped_dek set (plan 03-04)`.
- **Fix:** Rewrote the test with fixed-KEK injection via `deps.kek`, asserting envelope shape (v=1, 12-byte IV, 16-byte tag) and updated info-message wording. Added a 7th test (SC#5 no-plaintext scan) using an injected `generateTenantDek` that captures the DEK for inline verification.
- **Files modified:** test/bin/create-tenant.test.ts
- **Verification:** All 7 updated create-tenant tests pass (including the new SC#5 scan).
- **Committed in:** 4e3b71e (part of Task 2 GREEN)

**3. [Rule 3 — Blocking] worktree missing dist/src/generated/client.ts + node_modules**
- **Found during:** Task 0 (pre-build verification)
- **Issue:** The worktree lacked the generated MS Graph client (`src/generated/client.ts`) and any installed npm deps. Running `npm run test` would fail at transform time because vitest resolves imports against the worktree tree.
- **Fix:** Copied `src/generated/client.ts` from the main repo (658 KB — recycled from the most recent codegen run) and symlinked `node_modules` to `/home/yui/Documents/ms-365-mcp-server/node_modules`. Neither is a committed artifact; both are reproducible by `npm run generate && npm install`.
- **Files modified:** worktree filesystem only (no git changes)
- **Verification:** `npm run build` + `npm run test` succeed; dist/ populated correctly.

---

**Total deviations:** 3 auto-fixed (1 Rule 1, 2 Rule 3)
**Impact on plan:** All auto-fixes were either acceptance-regex reconciliation or test-scaffolding reconciliation. No production-behavior changes beyond what PLAN.md specified.

## Authentication Gates Encountered

None. The KEK loader's `loadKek()` is self-sufficient — it consults env vars and (optionally) Azure Key Vault via DefaultAzureCredential. Tests use mocked Key Vault via `vi.mock('@azure/keyvault-secrets', ...)` so no live Azure auth is exercised.

## Known Stubs

None. Every symbol listed in `provides:` ships with a complete implementation + full test coverage. `MS365_MCP_KEK_PREVIOUS` is reserved in `.env.example` but not consumed in Phase 3 Plan 04 — it is reserved for 03-05's dual-KEK acquire during the rewrap window. The reservation is documented in both the env file and the runbook section above.

## Forward Handoff

### 03-05 (MSAL cache plugin)
- Consumes: `unwrapWithDek` from src/lib/crypto/envelope.ts (alias of decryptWithKey) to decrypt MSAL token cache blobs stored in Redis per-tenant.
- Consumes: `loadKek()` from src/lib/crypto/kek.ts for the process-wide KEK.
- Consumes: `unwrapTenantDek(wrappedDek, kek)` from src/lib/crypto/dek.ts on TenantPool.acquire.
- Extends: test/crypto/no-plaintext-secrets.test.ts to scan the full MSAL cache blob for leaked secrets (currently only wrapped_dek is scanned).

### 03-07 (Refresh-token session migration)
- Consumes: `wrapWithDek` / `unwrapWithDek` aliases from src/lib/crypto/envelope.ts for opaque session envelopes (the x-microsoft-refresh-token header is removed; sessions become server-state).
- Extends: test/crypto/no-plaintext-secrets.test.ts to prove no refresh-token bytes land on disk or in Redis.

### 03-10 (Audit log writer)
- Writes: an audit_log row with `action='kek-rotated'` when bin/rotate-kek.mjs completes. Hook lives in the CLI (currently only returns the counts; 03-10 adds an INSERT).

## Threat Flags

None detected. The only trust-boundary additions are:
- **KEK exposure surface:** MS365_MCP_KEK env var (redacted via REDACT_PATHS pre-seeded by 03-01); Key Vault secret `mcp-kek` (tenancy-controlled by Azure IAM).
- **DEK lifecycle surface:** plaintext DEK lives in a Buffer only during TenantPool acquire (03-05); never serialized, never logged, never persisted.

Both are in the plan's `<threat_model>` register (T-03-04-01 through T-03-04-09) and covered by mitigations (pino redaction + IV freshness test + AES-GCM auth tag + parameterized queries).

## Self-Check: PASSED

**Files (existence-verified 2026-04-19T16:29:31Z):**
- FOUND: src/lib/crypto/envelope.ts
- FOUND: src/lib/crypto/kek.ts
- FOUND: src/lib/crypto/dek.ts
- FOUND: bin/rotate-kek.mjs (executable)
- FOUND: test/crypto/envelope.test.ts
- FOUND: test/crypto/kek.test.ts
- FOUND: test/crypto/dek.test.ts
- FOUND: test/crypto/kek-rotation.test.ts
- FOUND: test/crypto/no-plaintext-secrets.test.ts

**Commits (all present on `worktree-agent-a817b8d0` branch):**
- FOUND: d5b44bc (Task 1 RED — envelope test suite)
- FOUND: 5f9399a (Task 1 GREEN — envelope.ts)
- FOUND: 971eee9 (Task 2 RED — KEK + DEK + rotate-kek test suite)
- FOUND: 4e3b71e (Task 2 GREEN — kek.ts + dek.ts + rotate-kek.mjs + create-tenant + index.ts + .env.example)

**Automated verifications:**
- `npm run test -- --run test/crypto/envelope` — 14/14 PASS
- `npm run test -- --run test/crypto/kek` — 15/15 PASS (kek.test.ts + kek-rotation.test.ts)
- `npm run test -- --run test/crypto/dek` — 4/4 PASS
- `npm run test -- --run test/crypto/no-plaintext-secrets` — 3/3 PASS
- `npm run test -- --run test/crypto test/bin/create-tenant` — 43/43 PASS
- Full suite: `npm run test` — 476/476 PASS (up from 439 in 03-01)
- `npm run build` — PASS
- `npm run lint` — 0 errors (59 pre-existing warnings in other test files; out of scope)

**Anchor counts (rtk proxy grep -c):**
- `region:phase3-kek` src/index.ts: 2 ✓
- `region:phase3-kek` .env.example: 2 ✓
- `region:phase3-postgres` src/index.ts: 2 (untouched) ✓
- `region:phase3-postgres` .env.example: 2 (untouched) ✓
- `region:phase3-redis` src/index.ts: 2 (untouched) ✓
- `region:phase3-redis` .env.example: 2 (untouched) ✓
- `region:phase3-pkce-store` src/index.ts: 2 (untouched) ✓
- `region:phase3-tenant-pool` src/index.ts: 2 (untouched) ✓
- `region:phase3-shutdown-tenant-pool` src/index.ts: 2 (untouched) ✓
- `region:phase3-shutdown-redis` src/index.ts: 2 (untouched) ✓
- `region:phase3-shutdown-postgres` src/index.ts: 2 (untouched) ✓

**Task-1 acceptance grep summary:**
- `grep -c "^import " envelope.ts` = 1 ✓
- `grep -c "^import .* from '\\.\\.?/" envelope.ts` = 0 ✓
- `grep -cE "export (function|const|interface) ..." envelope.ts` = 8 ✓
- `grep -c "aes-256-gcm" envelope.ts` = 2 ✓
- `grep -c "setAuthTag" envelope.ts` = 1 ✓
- `grep -c "getAuthTag" envelope.ts` = 1 ✓

**Task-2 acceptance grep summary:**
- `grep -c "export async function loadKek" kek.ts` = 1 ✓
- `grep -c "export function clearKekCache" kek.ts` = 1 ✓
- `grep -c "await import('@azure/..." kek.ts` = 2 ✓
- `grep -c "NODE_ENV.*production" kek.ts` = 1 ✓
- `grep -c "MS365_MCP_KEK" kek.ts` = 5 (≥1) ✓
- `grep -c "export function generateTenantDek|export function unwrapTenantDek" dek.ts` = 2 ✓
- `grep -c "export async function main" rotate-kek.mjs` = 1 ✓
- `grep -c "generateTenantDek|wrapped_dek" create-tenant.mjs` = 10 (≥2) ✓
- `grep -c "loadKek" src/index.ts` = 2 (≥1) ✓
- `grep -c "MS365_MCP_KEK" .env.example` = 4 (≥1) ✓

---
*Phase: 03-multi-tenant-identity-state-substrate*
*Completed: 2026-04-19*
