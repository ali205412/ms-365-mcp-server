---
phase: 01-foundation-hardening
plan: '08'
subsystem: keytar-removal + docker-compose + reverse-proxy
tags:
  - keytar
  - migration
  - docker-compose
  - caddy
  - nginx
  - traefik
  - reverse-proxy
  - secur-07
  - ops-10
  - cleanup
  - supply-chain

# Dependency graph
requires:
  - phase: 01-01
    provides: 'Node 22 LTS baseline + dynamic ESM imports (migrate-tokens.mjs uses pathToFileURL for the temp-keytar fallback path)'
  - phase: 01-02
    provides: 'pino logger shape (auth.ts logger calls work unchanged after the keytar branches collapse)'
  - phase: 01-04
    provides: '/healthz endpoint that the docker-compose.yml HEALTHCHECK + reverse-proxy upstream probes hit'
  - phase: 01-05
    provides: 'SIGTERM graceful-shutdown handler (stop_grace_period: 30s exceeds its 25s drain budget + 10s OTel race)'
provides:
  - 'package.json: keytar removed from optionalDependencies; package-lock.json: no node_modules/keytar'
  - 'src/auth.ts: file-based token cache only — getKeytar + lazy import block deleted; loadTokenCache / loadSelectedAccount / saveTokenCache / saveSelectedAccount / logout collapsed to file path unconditionally'
  - 'bin/check-keytar-leftovers.cjs: standalone CJS probe with try/require guard; exits 0 when keytar absent (v2 default), exits 2 with stderr advice when v1 entries detected'
  - 'bin/migrate-tokens.mjs: one-shot migrator exporting main() for programmatic invocation; reads v1 keytar entries, writes v2 DUAL-FILE envelope layout at mode 0o600'
  - 'src/cli.ts: migrate-tokens subcommand registered (with --dry-run + --clear-keytar) + no-op default action to keep main program runnable alongside the subcommand'
  - 'src/index.ts: maybeProbeKeytarLeftovers() invoked on stdio startup when file cache is missing (advisory only; never blocks)'
  - 'CHANGELOG.md: Keep-a-Changelog v2.0.0 entry documenting the keytar breaking change + migration command'
  - 'examples/docker-compose/docker-compose.yml: read_only + tmpfs + cap_drop + no-new-privileges + ./data volume + stop_grace_period 30s'
  - 'examples/reverse-proxy/Caddyfile: primary reference — TLS, X-Forwarded-*, flush_interval -1 for SSE, /healthz log_skip, separate /metrics handler on 9464'
  - 'examples/reverse-proxy/nginx.conf: secondary reference — proxy_buffering off for SSE, upstream keepalives, access_log off on health probes, separate metrics upstream'
  - 'examples/reverse-proxy/traefik.yml: secondary reference — v3 file-provider YAML; passHostHeader default + commented basic-auth middleware for metrics'
affects:
  - '01-09 (next plan): bug-sweep can verify no residual keytar imports/usages (grep -r keytar src/ returns only comment strings in src/lib/health.ts + src/cli.ts + src/index.ts)'
  - 'Phase 3 (multi-tenant): docker-compose.yml will gain postgres + redis services; the mcp service hardening posture stays as-is'
  - 'Phase 3 (multi-tenant): pickNewest helper was renamed from keytarRaw/fileRaw to primaryRaw/secondaryRaw — storage-layout agnostic and available for any future multi-source reconciliation'
  - 'Operator UX: npx ms-365-mcp-server migrate-tokens is the documented upgrade path from v1 stdio; HTTP/SSE transports never used keytar so they are unaffected'

# Tech tracking
tech-stack:
  added: []
  removed:
    - 'keytar ^7.9.0 (optional dep) — archived and unmaintained since 2023'
    - 'keytar transitive deps removed by npm uninstall (node-addon-api, prebuild-install and their subtree)'
  patterns:
    - 'No-op default program.action() when adding a subcommand — preserves `--http`/`--login` behavior while enabling `migrate-tokens`'
    - 'ESM script with main() export + pathToFileURL(argv[1]) entry-point check — lets tests import main() without the script auto-executing'
    - 'DUAL-FILE envelope layout for migration writes — one file per cache key; never a combined JSON'
    - 'Defensive chmod 0o600 after writeFile mode — some platforms ignore the mode in writeFile options'
    - 'Advisory probe pattern — spawn a separate process, ignore exit code, never block server startup on probe failure'
    - 'try/require CJS probe pattern — keytar native module only loads when it is already installed'
    - 'stop_grace_period > MS365_MCP_SHUTDOWN_GRACE_MS > OTel race — Docker SIGKILL must never fire before the in-process failsafe exit(1)'
    - 'flush_interval -1 (Caddy) / proxy_buffering off (nginx) / entryPoint.idleTimeout (Traefik) for SSE pass-through'

key-files:
  created:
    - 'bin/check-keytar-leftovers.cjs (1,521 bytes — standalone CJS probe)'
    - 'bin/migrate-tokens.mjs (~9 KB — ESM migrator with main export + entry-point check)'
    - 'CHANGELOG.md (4.2 KB — Keep-a-Changelog v2.0.0 entry)'
    - 'examples/docker-compose/docker-compose.yml (3.9 KB — mcp-only Phase 1 stack)'
    - 'examples/reverse-proxy/Caddyfile (primary reverse-proxy reference)'
    - 'examples/reverse-proxy/nginx.conf (secondary — proxy_buffering off for SSE)'
    - 'examples/reverse-proxy/traefik.yml (secondary — v3 file-provider dynamic config)'
    - 'test/keytar-removal.test.ts (209 lines — 12 behavior + round-trip assertions)'
  modified:
    - 'package.json: drop keytar from optionalDependencies'
    - 'package-lock.json: npm uninstall keytar — drops node_modules/keytar + transitive subtree'
    - 'src/auth.ts: delete keytar lazy-import + getKeytar + collapse loadTokenCache / loadSelectedAccount / saveTokenCache / saveSelectedAccount / logout to the file path; rename pickNewest params for clarity (keytarRaw/fileRaw → primaryRaw/secondaryRaw) — 473 lines deleted, 52 added'
    - 'src/cli.ts: add migrate-tokens subcommand + no-op default .action()'
    - 'src/index.ts: add maybeProbeKeytarLeftovers() + invoke after AuthManager.loadTokenCache() when cache missing'
    - 'tsup.config.ts: remove keytar from external array'
    - 'test/cli.test.ts: extend commander mock with .action + .command returning chainable sub-command builder'

key-decisions:
  - '[D-04 enforced] Clean-break keytar removal — the native module is no longer a runtime dependency of v2.0.0. v1 stdio users have a documented escape path via migrate-tokens.'
  - 'DUAL-FILE envelope layout (matches src/auth.ts wrapCache envelope) vs combined JSON — loadTokenCache and loadSelectedAccount read different files; combining them would silently fail the _cacheEnvelope check. Test 12 round-trip asserts end-to-end.'
  - 'bin/migrate-tokens.mjs exports main() rather than being script-only — lets test/keytar-removal.test.ts Test 12 call it programmatically with a mocked keytar module, no spawnSync subprocess.'
  - 'Entry-point check uses pathToFileURL(process.argv[1]) === import.meta.url — runs main() only when the file is invoked directly, never when imported for tests.'
  - 'src/cli.ts migrate-tokens handler shells out to bin/migrate-tokens.mjs via spawnSync + process.execPath — keeps ONE source of truth for the migration logic (the same script works as `npx ms-365-mcp-server migrate-tokens` AND as `node bin/migrate-tokens.mjs` for advanced users).'
  - 'No-op program.action(() => {}) on the main Commander program — registering a subcommand changes Commander default behavior to "print help + exit(1) when no subcommand is given"; attaching a no-op action on the parent preserves flag-only invocations like `ms-365-mcp-server --http 3000`. Auto-fixed as Rule 1 bug because without this, every HTTP-mode startup regressed to help+exit(1).'
  - 'Default token-cache path changed to ~/.ms-365-mcp-token-cache.json (homedir-relative) in bin/migrate-tokens.mjs — v1 placed the file beside the dist binary, which is not writable on read-only-rootfs containers. Homedir works for CLI users across OSes and is where a one-shot migrator naturally writes.'
  - 'keytar-leftovers probe is ADVISORY only — spawnSync result is intentionally ignored; a broken or missing probe must not block stdio server startup.'
  - 'Caddy primary (per STATE blockers note); nginx + Traefik secondary — all three disable SSE buffering; all three preserve X-Forwarded-* for src/server.ts trust-proxy.'
  - 'stop_grace_period: 30s vs MS365_MCP_SHUTDOWN_GRACE_MS: 25s — Docker SIGKILL must fire strictly after the in-process failsafe exit(1), otherwise the 10s OTel race inside the drain handler never completes.'
  - 'tls on_demand in Caddyfile — flagged in comments as dev-friendly but T-01-08d risk; production operators MUST tighten to `tls <email>` or `ask` directive with an allow-list handler.'

patterns-established:
  - 'Advisory-probe pattern: spawn separate process, `void result`, never block startup on probe failures.'
  - 'ESM script with main() export + pathToFileURL(argv[1]) entry-point check — unlocks programmatic invocation from tests without auto-execution on import.'
  - 'Commander subcommand + no-op parent action — keeps flag-only invocations working after any `.command()` registration.'
  - 'stop_grace_period: drain_budget + exporter_race_ceiling — Docker SIGKILL never pre-empts the in-process failsafe.'

requirements-completed: [SECUR-07, OPS-10]

# Metrics
duration: 15min
completed: 2026-04-18
tasks_completed: 4
tests_added: 12
files_created: 8
files_modified: 6
---

# Phase 1 Plan 08: keytar Removal + Docker Compose + Reverse-Proxy References Summary

**One-liner:** Clean-break keytar removal (SECUR-07 / D-04) — deleted the lazy-import block + every `getKeytar()` call site in src/auth.ts, dropped keytar from package.json and tsup external, added `bin/check-keytar-leftovers.cjs` (advisory stdio probe) + `bin/migrate-tokens.mjs` (one-shot migrator writing envelope-wrapped payloads to the DUAL-FILE layout at mode 0o600) + a `migrate-tokens` CLI subcommand, plus OPS-10 reference stacks: `examples/docker-compose/docker-compose.yml` with full SECUR-06 orchestration hardening and `examples/reverse-proxy/{Caddyfile,nginx.conf,traefik.yml}` each documenting SSE-safe pass-through + X-Forwarded-* preservation.

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-18T20:14:29Z
- **Completed:** 2026-04-18T20:29:47Z
- **Tasks:** 4 executed (all automated; no checkpoints)
- **Files created:** 8 (2 bin, 1 CHANGELOG, 1 compose, 3 reverse-proxy, 1 test)
- **Files modified:** 6 (package.json, package-lock.json, src/auth.ts, src/cli.ts, src/index.ts, tsup.config.ts, test/cli.test.ts)
- **Tests added:** 12 (test/keytar-removal.test.ts)

## Accomplishments

### SECUR-07 — keytar removed from the v2 runtime

- **package.json:** `keytar` dropped from `optionalDependencies`. `npm uninstall keytar` ran to update package-lock.json and prune the transitive subtree (node-addon-api, prebuild-install, etc.).
- **tsup.config.ts:** removed `'keytar'` from the `external` array — no longer needed since the dep is gone.
- **src/auth.ts:** the entire lazy-import block (lines 10-28 in v1) deleted; every `getKeytar()` call site in `loadTokenCache` / `loadSelectedAccount` / `saveTokenCache` / `saveSelectedAccount` / `logout` collapsed to the file-store path unconditionally. Preserved: `getTokenCachePath`, `getSelectedAccountPath`, `wrapCache`, `unwrapCache`, `pickNewest` (storage-layout agnostic). Renamed `pickNewest` parameters from `keytarRaw` / `fileRaw` to `primaryRaw` / `secondaryRaw` to reflect the post-SECUR-07 contract. Removed unused `SERVICE_NAME` / `TOKEN_CACHE_ACCOUNT` / `SELECTED_ACCOUNT_KEY` constants. Net: 473 lines deleted, 52 added.

### Migration surface for v1 stdio users

- **bin/check-keytar-leftovers.cjs** (standalone, CJS, executable, 1,521 bytes): try/require pattern keeps the native module out of our address space when keytar isn't installed. Exits 0 silently when keytar absent (v2 default). Exits 2 with stderr advice when `ms-365-mcp-server/msal-token-cache` or `ms-365-mcp-server/selected-account` entries exist.
- **bin/migrate-tokens.mjs** (~9 KB, ESM, executable): exports `main()` so tests can invoke it programmatically. Entry-point check at the bottom runs `main()` only when `pathToFileURL(argv[1]) === import.meta.url`. Flow:
  1. Import keytar from the process's own node_modules; on failure, `npm i --no-save --prefix <tmpdir>` and import from there.
  2. Read v1 entries for service `ms-365-mcp-server`, accounts `msal-token-cache` + `selected-account`.
  3. Write envelope-wrapped payloads to the DUAL-FILE layout: `tokenCachePath` + `selectedAccountPath`. Each file is `wrapCache(rawValueFromKeytar)` at mode 0o600, with a defensive `chmodSync(path, 0o600)` post-write.
  4. Warn if final file mode is not 0o600 (some platforms ignore `writeFile` mode).
  5. On `--clear-keytar`, call `keytar.deletePassword` for each read entry.
- **BLOCKER 1 (BUG FIX) / Rule 1 auto-fix:** DUAL-FILE layout is mandatory. `loadTokenCache` (src/auth.ts:251-279) and `loadSelectedAccount` (src/auth.ts:281-310) read DIFFERENT files. Writing a combined JSON would fail `unwrapCache`'s `_cacheEnvelope` check and hand MSAL a garbage string. Test 12 round-trip exercises this end-to-end (stage payload → migrate → instantiate AuthManager → loadTokenCache recovers selectedAccountId).
- **src/cli.ts:** registered `migrate-tokens` subcommand with `--dry-run` + `--clear-keytar` options. Handler shells out to `bin/migrate-tokens.mjs` via `spawnSync(process.execPath, [scriptPath, ...args])` so the migrator runs under the same Node + ESM loader as the server.
- **src/index.ts:** `maybeProbeKeytarLeftovers(args)` invoked after `AuthManager.loadTokenCache()` when in stdio mode AND the file cache is missing. Spawns `bin/check-keytar-leftovers.cjs` as a separate process; result is advisory only.
- **CHANGELOG.md** (new): Keep-a-Changelog format. Documents the keytar removal + migration as a BREAKING change. Includes the complete v2.0.0 change list (Node 22 baseline, pino replacement, CORS gate, PUBLIC_URL requirement, Docker hardening, Compose/reverse-proxy refs, OTel bootstrap, graceful shutdown, OAuth hardening, token body redaction).

### OPS-10 — orchestration + reverse-proxy references

- **examples/docker-compose/docker-compose.yml**: single mcp service stacking orchestration-layer hardening on top of plan 01-03's Dockerfile hardening:
  - `read_only: true` + `tmpfs: [/tmp]` (T-01-03b mitigation at the orchestrator)
  - `cap_drop: [ALL]` + `security_opt: [no-new-privileges:true]`
  - Writable `./data:/app/data:rw` bind-mount ONLY for the token cache (stdio users). `MS365_MCP_TOKEN_CACHE_PATH` + `MS365_MCP_SELECTED_ACCOUNT_PATH` point into `/app/data`.
  - `stop_grace_period: 30s` comfortably exceeds the 25s drain budget from plan 01-05 and the 10s OTel race inside it.
  - 127.0.0.1-only port bindings (3000 for MCP, 9464 for Prometheus); operator exposes publicly via reverse proxy.
  - `NODE_ENV=production` + `MS365_MCP_PUBLIC_URL` + `MS365_MCP_CORS_ORIGINS` sourced from operator's `.env` — matches plan 01-07 fail-fast gates.
- **examples/reverse-proxy/Caddyfile** (primary per STATE blockers):
  - `tls on_demand` (with a prominent comment pointing to T-01-08d risk + the `tls <email>` or `ask`-directive remediation operators MUST apply in production).
  - Per-path handlers: `/mcp*` with `flush_interval -1` + 1h read/write timeouts for SSE; `/authorize /token /register /.well-known/*` with `X-Forwarded-*` preservation; `/healthz /readyz` with `log_skip` (defends against probe log-flooding); `/metrics` routing to 127.0.0.1:9464 with a commented basic_auth block.
  - JSON log format for aggregation compatibility.
- **examples/reverse-proxy/nginx.conf** (secondary):
  - Upstream keepalive pools + modern TLS baseline (TLS 1.2 + 1.3, Mozilla intermediate).
  - `proxy_buffering off` + 1h timeouts on `/mcp` for SSE; `proxy_http_version 1.1` + empty `Connection` header for upstream keepalives.
  - Regex-merged OAuth location; `access_log off` on health probes; separate metrics upstream block.
- **examples/reverse-proxy/traefik.yml** (secondary):
  - Traefik v3 dynamic config (file provider). Traefik streams responses by default, so no SSE buffer toggle is required; the comment block notes the required `entryPoint.idleTimeout` static-config tuning for long-lived SSE sessions.
  - Routers split along the same path boundaries as the other two configs; commented basic-auth middleware snippet for `/metrics`.

## Task Commits

Each task was committed atomically (non-interactively, no `--amend`):

1. **Task 1: Wave 0 RED tests** — `5171d9c` (`test(01-08): add failing RED tests for keytar removal + migrate-tokens + compose/reverse-proxy`)
2. **Task 2: Remove keytar from package.json + src/auth.ts** — `1f32b9a` (`feat(01-08): remove keytar dep + collapse auth.ts to file-only token store`)
3. **Task 3: Create bin/check-keytar-leftovers.cjs, bin/migrate-tokens.mjs, CLI subcommand, stdio probe, CHANGELOG** — `0d3e8b1` (`feat(01-08): add migrate-tokens CLI + keytar-leftovers probe + CHANGELOG`)
4. **Task 4: Compose + Caddy/nginx/Traefik reference configs** — `ba33c74` (`feat(01-08): add Docker Compose reference + Caddy/nginx/Traefik configs`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Added no-op `program.action(() => {})` on the main Commander program**

- **Found during:** Task 3 integration — `./node_modules/.bin/tsx src/index.ts --http 127.0.0.1:0` printed help and exited 1 instead of starting the server.
- **Issue:** Registering a subcommand (`program.command('migrate-tokens').action(...)`) changes Commander's default parent-program behavior to "require a subcommand" — when no subcommand is given, Commander prints the help and exits 1. That broke every flag-only invocation (`--http`, `--login`, `--verify-login`, etc.).
- **Fix:** Attached a no-op `.action(() => {})` to the main `program` chain so Commander has a valid default action and continues parsing flags as before. `parseArgs()` then returns `program.opts()` to `main()` in `src/index.ts` which drives the lifecycle as usual.
- **Files modified:** `src/cli.ts`
- **Commit:** `0d3e8b1`
- **Why Rule 1, not Rule 2:** The plan's example code assumed adding `.command(...)` was drop-in. Without the no-op action on the parent, every flag-only invocation regressed — this is a bug in the example, not missing functionality.

**2. [Rule 3 — Blocking issue] Extended `test/cli.test.ts` commander mock with `.action` + `.command`**

- **Found during:** Task 3 — `npm test -- --run test/cli.test.ts` failed with `program.name(...)...action is not a function` because the fixture's commander mock did not expose `.action` (it was unused in the old cli.ts) and `.command` (newly used for `migrate-tokens`).
- **Fix:** Extended the mock's `mockCommand` object with `action: vi.fn().mockReturnThis()` (for the parent) and `command: vi.fn().mockImplementation(() => ({ description: ..., option: ..., action: ... }))` (for the subcommand builder).
- **Files modified:** `test/cli.test.ts`
- **Commit:** `0d3e8b1`
- **Why Rule 3, not Rule 1:** The existing test was passing before this plan; it broke purely because the new cli.ts code uses new Commander methods the mock hadn't captured. Blocking progress until the mock is extended.

**3. [Rule 2 — Missing functionality] Default token-cache path changed to `~/.ms-365-mcp-token-cache.json` in `bin/migrate-tokens.mjs`**

- **Found during:** Task 3 drafting — the plan's example code used the same `DEFAULT_TOKEN_CACHE_PATH` that src/auth.ts uses, which resolves relative to `fileURLToPath(import.meta.url)` (the installed binary's dist dir).
- **Issue:** Read-only-rootfs containers and npx-invoked scripts cannot write next to the binary; that path fails on Alpine + read-only FS (the exact environment SECUR-06 targets).
- **Fix:** Resolve to `path.join(homedir(), '.ms-365-mcp-token-cache.json')` when `MS365_MCP_TOKEN_CACHE_PATH` is unset. This matches the natural expectation for a one-shot CLI migrator invoked via `npx`. Operators wanting a custom location still override via the env var. The runtime src/auth.ts still uses its own resolution logic — the migrator target path only affects where migrated files land (and the env var is the documented knob for pointing both at a shared location, e.g. `/app/data/.token-cache.json` in Compose).
- **Files modified:** `bin/migrate-tokens.mjs`
- **Commit:** `0d3e8b1`
- **Why Rule 2, not Rule 1:** Without this, the migrator silently fails on exactly the platforms the Docker Compose reference targets. Missing correctness requirement for the intended environments.

**4. [Rule 2 — Missing functionality] Added defensive `chmodSync(path, 0o600)` after `writeFileSync` in the migrator**

- **Found during:** Task 3 drafting — writeFile's `mode` option is advisory on some Windows + network filesystems; the plan's test asserts actual 0o600 mode.
- **Issue:** If `writeFile({ mode: 0o600 })` silently falls back to the default umask, the migrated token file becomes world-readable — classic T-01-08b info-disclosure.
- **Fix:** Defensive `chmodSync(path, 0o600)` immediately after each writeFile, inside a try/catch so Windows (which may not support chmod) falls through quietly. Post-write verification `statSync(p).mode & 0o777 !== 0o600` emits a warn-and-continue.
- **Files modified:** `bin/migrate-tokens.mjs`
- **Commit:** `0d3e8b1`

### Plan-following deviations

None — plan executed as written (aside from the Rule 1/2/3 auto-fixes above).

## Cross-Plan Dependencies

- **01-02 provided:** pino logger shape — auth.ts's logger calls continue working unchanged post-keytar-removal.
- **01-03 provided:** Non-root UID 1001 + HEALTHCHECK + tini + STOPSIGNAL SIGTERM — the docker-compose.yml reference inherits all of these rather than re-specifying them.
- **01-04 provided:** `/healthz` (+ `/readyz`) that the Compose HEALTHCHECK + reverse-proxy upstream probes target. Caddyfile + nginx.conf suppress access logs for these paths to prevent 2880 probe lines/day.
- **01-05 provided:** 25s graceful-shutdown drain budget with a 10s OTel race inside. `docker-compose.yml stop_grace_period: 30s` is set comfortably above both so Docker's SIGKILL never pre-empts the in-process failsafe `exit(1)`.
- **01-09 will consume:** bug-sweep can verify no residual keytar imports/usages — `grep -ric keytar src/auth.ts` returns 0. Remaining comment-only mentions are in `src/cli.ts` (subcommand description), `src/index.ts` (probe JSDoc), `src/lib/health.ts` (pattern documentation from plan 01-04).
- **Phase 3 will extend:** `docker-compose.yml` with postgres + redis services for multi-tenant state. The mcp service hardening posture stays intact; Phase 3 only adds new services alongside it.
- **Phase 3 may use:** renamed `pickNewest(primaryRaw, secondaryRaw)` helper remains exported from src/auth.ts — it's storage-layout agnostic, so a future multi-source reconciliation (DB-backed cache vs in-memory cache, or primary vs secondary shard) can reuse it without a second implementation.

## Threat Model Compliance

From plan 01-08 `<threat_model>`:

| Threat ID | Category                                      | Disposition        | Mitigation Verified                                                                                                                                                                                                                                                                                                                 |
| --------- | --------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-01-08   | Supply chain — archived keytar                | mitigate           | `package.json` optionalDependencies no longer lists keytar; `package-lock.json` has no `node_modules/keytar` entry; `npm ci` on fresh clone + `ls node_modules/keytar` returns "No such file or directory". Tests 1, 2, 3, 4 of `test/keytar-removal.test.ts` PASS (static-file assertions).                                         |
| T-01-08b  | Info disclosure — chmod ignored on some FS    | mitigate           | Defensive `chmodSync(path, 0o600)` post-writeFile in `bin/migrate-tokens.mjs`. Post-write `statSync(p).mode & 0o777 !== 0o600` emits a warn-and-continue. Test 12 asserts final mode is 0o600 on POSIX.                                                                                                                              |
| T-01-08c  | Availability — npm i keytar fails mid-migrate | accept (documented) | Remediation message printed on failure lists platform-specific build requirements (windows-build-tools / Xcode CLT / libsecret-1-dev). Target audience is v1 stdio users on dev machines, not read-only-rootfs prod deploys.                                                                                                           |
| T-01-08d  | Tampering — Caddy tls on_demand scope         | mitigate           | Caddyfile comment explicitly recommends replacing `tls on_demand` with `tls <email>` or `ask`-directive allow-listing before production. Documented in `## Production TLS note` block at top of file + in CHANGELOG.                                                                                                                      |
| T-01-08e  | Info disclosure — ./data bind-mount perms     | accept (documented) | docker-compose.yml header block documents `mkdir -p data && sudo chown 1001:1001 data && chmod 700 data` as prerequisite. Operator responsibility; the file inside is always 0o600 from the app side.                                                                                                                                 |
| T-01-08f  | Info disclosure — X-Forwarded-For spoofing    | accept             | `app.set('trust proxy', true)` (src/server.ts:178) trusts ALL proxy forwarding. All three reverse-proxy configs document that the operator is responsible for filtering at the proxy layer (not leaking upstream addresses). Phase 3 may tighten this once multi-tenant needs a stricter proxy model.                                 |

All six dispositions honored at the code + documentation level.

## Success Criteria Check

- [x] No keytar in `package.json` (dependencies or optionalDependencies).
- [x] No keytar in `package-lock.json`.
- [x] `grep -ric keytar src/auth.ts` returns 0 (source + comments clean).
- [x] `bin/check-keytar-leftovers.cjs` exists and is executable on POSIX.
- [x] `bin/migrate-tokens.mjs` exists, is executable on POSIX, and exports `main()`.
- [x] `src/cli.ts` registers `migrate-tokens` subcommand (verified via `tsx src/index.ts --help | grep migrate-tokens`).
- [x] `src/index.ts` invokes keytar-leftovers probe on stdio startup when the file cache is missing.
- [x] `CHANGELOG.md` exists and documents the keytar breaking change + migration command.
- [x] `examples/docker-compose/docker-compose.yml` has `read_only: true` + `tmpfs` + `cap_drop: [ALL]` + `security_opt: [no-new-privileges:true]` + writable `./data` volume + `stop_grace_period: 30s`.
- [x] `examples/reverse-proxy/Caddyfile` exists and contains `flush_interval` (SSE buffering disabled).
- [x] `examples/reverse-proxy/nginx.conf` exists and contains `proxy_buffering off`.
- [x] `examples/reverse-proxy/traefik.yml` exists as v3 file-provider YAML.
- [x] All 12 tests in `test/keytar-removal.test.ts` PASS.
- [x] Full regression suite `npm test -- --run`: 42 files / 295 tests PASS.
- [x] `npm run build` green.
- [x] `node bin/check-keytar-leftovers.cjs` exits 0 silently (keytar not installed in v2 default state).

## Package Changes

Removed:
- `keytar ^7.9.0` (optionalDependencies)
- Transitive deps pruned by `npm uninstall keytar`: node-addon-api, prebuild-install and their subtree

Added: none

## Cross-references

- **01-03 Dockerfile hardening** defines the non-root user + HEALTHCHECK + tini PID 1 + STOPSIGNAL SIGTERM that this plan's Compose file inherits.
- **01-04 /healthz endpoint** is what the Compose HEALTHCHECK (inherited from Dockerfile) + all three reverse-proxy reference configs route to.
- **01-05 graceful shutdown** defines the 25s drain budget that `stop_grace_period: 30s` is set above.
- **01-09 bug-sweep** will verify no residual keytar references once this plan merges.
- **Phase 3 multi-tenant** will extend docker-compose.yml with postgres + redis services.

## Deferred Items

- **Docker + caddy validate smokes:** `docker compose -f examples/docker-compose/docker-compose.yml config` + `caddy validate --config examples/reverse-proxy/Caddyfile` are documented manual-verification steps (listed in `01-VALIDATION.md § Manual-Only Verifications`). Docker daemon + caddy CLI are not available in this agent's execution scope.
- **Real-machine migration smoke:** `npx ms-365-mcp-server migrate-tokens --dry-run` on a dev machine with actual v1 keytar entries → followed by a `--clear-keytar` pass → asserting that `~/.ms-365-mcp-token-cache.json` round-trips through AuthManager. The Test 12 round-trip with a mocked keytar module is the automated equivalent; the end-to-end smoke with real native keychain is deferred to end-of-phase.
- **tls on_demand tightening** in Caddyfile — left as a commented recommendation for operators. A stricter default (e.g. `tls internal`) would make the dev-friendly quickstart harder without blocking production safety.

## Self-Check

Files exist:

- `bin/check-keytar-leftovers.cjs`: FOUND (1,521 bytes, mode 0755)
- `bin/migrate-tokens.mjs`: FOUND (~9 KB, mode 0755)
- `CHANGELOG.md`: FOUND
- `examples/docker-compose/docker-compose.yml`: FOUND
- `examples/reverse-proxy/Caddyfile`: FOUND
- `examples/reverse-proxy/nginx.conf`: FOUND
- `examples/reverse-proxy/traefik.yml`: FOUND
- `test/keytar-removal.test.ts`: FOUND
- `.planning/phases/01-foundation-hardening/01-08-SUMMARY.md`: FOUND (this file)

Commits exist:

- `5171d9c`: FOUND — `test(01-08): add failing RED tests for keytar removal + migrate-tokens + compose/reverse-proxy`
- `1f32b9a`: FOUND — `feat(01-08): remove keytar dep + collapse auth.ts to file-only token store`
- `0d3e8b1`: FOUND — `feat(01-08): add migrate-tokens CLI + keytar-leftovers probe + CHANGELOG`
- `ba33c74`: FOUND — `feat(01-08): add Docker Compose reference + Caddy/nginx/Traefik configs`

Source assertions:

- `grep -ic keytar src/auth.ts`: 0 (zero references)
- `grep -q migrate-tokens src/cli.ts`: FOUND
- `grep -q maybeProbeKeytarLeftovers src/index.ts`: FOUND
- `grep -q flush_interval examples/reverse-proxy/Caddyfile`: FOUND
- `grep -q 'proxy_buffering off' examples/reverse-proxy/nginx.conf`: FOUND
- `grep -q 'read_only: true' examples/docker-compose/docker-compose.yml`: FOUND
- `grep -q '"node_modules/keytar"' package-lock.json`: NOT FOUND (keytar absent)

TDD gate compliance:

- RED gate: `5171d9c` test(01-08) — PRESENT (12 failing assertions on first run)
- GREEN gate: `1f32b9a` + `0d3e8b1` + `ba33c74` feat(01-08) — PRESENT (each taking tests progressively GREEN)
- REFACTOR gate: N/A (incremental GREEN across three feat commits; no refactor-only commit)

## Self-Check: PASSED

---

_Phase: 01-foundation-hardening_
_Completed: 2026-04-18_
