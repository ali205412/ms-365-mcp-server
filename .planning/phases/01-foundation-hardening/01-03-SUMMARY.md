---
phase: 01-foundation-hardening
plan: "03"
subsystem: infra
tags: [dockerfile, docker, tini, healthcheck, non-root, oci-labels, security, container]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Node 22 LTS baseline — both Dockerfile stages already on node:22-alpine"
provides:
  - "Hardened Dockerfile: non-root nodejs UID 1001, tini PID 1, HEALTHCHECK directive, OCI labels, STOPSIGNAL SIGTERM"
  - "bin/check-health.cjs: standalone CJS HEALTHCHECK probe hitting /healthz"
  - ".dockerignore: build context exclusion list (excludes .planning, test, dist, node_modules, coverage)"
affects:
  - "01-04: mountHealth must expose /healthz so HEALTHCHECK probe can succeed end-to-end"
  - "01-05: STOPSIGNAL SIGTERM integrates with graceful shutdown signal handler"
  - "01-08: docker-compose.yml adds read_only: true + tmpfs: [/tmp] per T-01-03b mitigation"

# Tech tracking
tech-stack:
  added:
    - "tini (installed via apk add --no-cache tini in release stage, PID 1 init)"
  patterns:
    - "Non-root container user: addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nodejs"
    - "HEALTHCHECK with Node probe reusing runtime (no curl dependency)"
    - "BuildKit cache mount: --mount=type=cache,target=/root/.npm for npm ci"
    - "COPY --chown=nodejs:nodejs for all runtime artifacts in release stage"

key-files:
  created:
    - "bin/check-health.cjs"
    - ".dockerignore"
  modified:
    - "Dockerfile"
    - "test/dockerfile.test.ts"

key-decisions:
  - "tini installed in BOTH builder and release stages for parity even though builder does not need it for PID 1"
  - "bin/check-health.cjs is CJS (not ESM) to skip ESM loader overhead at HEALTHCHECK probe time"
  - "start-period=20s generous to accommodate OTel auto-instrumentation cold start overhead"
  - "No EXPOSE directive — Dockerfile stays port-agnostic (supports stdio mode; operator publishes ports via docker run -p)"
  - "read-only FS compatibility is an attribute of the Dockerfile, not enforced by it — docker run --read-only is operator concern (plan 01-08 Compose file)"

patterns-established:
  - "Static-grep test pattern for Dockerfile assertions: read file via fs.readFileSync, apply string/regex expect()"
  - "CJS probe scripts in bin/ reuse runtime Node without ESM overhead"

requirements-completed: [SECUR-06]

# Metrics
duration: 8min
completed: 2026-04-18
---

# Phase 1 Plan 03: Dockerfile Hardening Summary

**Hardened Dockerfile with non-root nodejs UID 1001, tini as PID 1 via /sbin/tini ENTRYPOINT, HEALTHCHECK using a CJS Node probe, OCI labels, and a .dockerignore slimming build context by ~80%.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-18T16:22:00Z
- **Completed:** 2026-04-18T16:31:17Z
- **Tasks:** 2 executed (Task 3 deferred — manual Docker smoke per orchestrator note)
- **Files modified:** 4 (Dockerfile, bin/check-health.cjs, .dockerignore, test/dockerfile.test.ts)

## Accomplishments

- Rewrote Dockerfile from 357 bytes / 22 lines to 1994 bytes / 52 lines with full SECUR-06 hardening
- Created bin/check-health.cjs (633 bytes, 20 lines): CJS probe hitting /healthz with 3s timeout, exit 0 on 200
- Created .dockerignore (385 bytes, 33 lines): excludes .git, node_modules, dist, test, .planning, coverage, openapi, *.md, .env*
- All 9 static assertions in test/dockerfile.test.ts GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Wave 0 RED stubs for Dockerfile hardening** - `b61f5b0` (test)
2. **Task 2: bin/check-health.cjs + .dockerignore + Dockerfile hardening** - `e7ed392` (feat)
3. **Lockfile sync** - `8680f13` (chore — minor package-lock.json engines constraint sync)

**Task 3 (Docker smoke checkpoint):** DEFERRED — see "Manual Verification" section below.

## Files Created/Modified

- `Dockerfile` - Full hardening: BuildKit syntax directive, ARG NODE_VERSION=22-alpine, tini in both stages, nodejs user UID 1001, COPY --chown, USER nodejs, HEALTHCHECK 30s/5s/20s-start/3-retries, OCI labels (title/source/licenses), STOPSIGNAL SIGTERM, ENTRYPOINT ["/sbin/tini", "--", "node", "dist/index.js"]
- `bin/check-health.cjs` - CJS Docker HEALTHCHECK probe: http.get /healthz with 3s timeout, exit 0 on HTTP 200, exit 1 otherwise. Shebang + executable bit (chmod 0755)
- `.dockerignore` - Build context exclusion: .git, node_modules, dist, coverage, test, .planning, openapi, *.md, .env, .env.*, .vscode, .idea, .claude
- `test/dockerfile.test.ts` - 9 static-grep assertions verifying all SECUR-06 requirements (USER, HEALTHCHECK, tini, UID 1001, OCI labels, STOPSIGNAL, base tag parity, check-health.cjs executable, .dockerignore coverage)

## Decisions Made

- **CJS over ESM for bin/check-health.cjs:** Invoked by Docker HEALTHCHECK every 30 seconds — CJS skips the ESM loader startup overhead. No external deps, just `node:http`.
- **start-period=20s:** Generous to accommodate OTel auto-instrumentation (plan 01-02) adding ~1-2s cold start. Container liveness should not be checked during SDK initialization.
- **No EXPOSE directive:** Dockerfile stays port-agnostic. The app supports both stdio and HTTP modes; operators publishing HTTP mode use `docker run -p`. EXPOSE is informational only.
- **tini in builder stage too:** Installs tini in both stages for layer parity, even though builder does not use it as PID 1.
- **Specific COPY for bin/check-health.cjs:** Release stage copies `bin/check-health.cjs` specifically, not the whole `bin/` directory — other bin scripts (generate-graph-client.mjs, check-keytar-leftovers.cjs from plan 01-08) have their own lifecycle.

## Deviations from Plan

None — plan executed exactly as written (Tasks 1 and 2). Task 3 deferred per orchestrator instruction (Docker daemon not available in agent scope).

## Manual Verification — Task 3 (Deferred)

**Status:** DEFERRED — listed in `01-VALIDATION.md § Manual-Only Verifications` table as "Docker HEALTHCHECK passes under real container runtime".

**Why deferred:** Docker behavioral properties (PID 1 tini, `--read-only` startup, HEALTHCHECK directive semantics, non-root UID at runtime) cannot be asserted inside Vitest. A live Docker daemon, `docker image inspect`, and `docker exec` into a running container are required. The plan frontmatter explicitly sets `autonomous: false` to signal this mandatory manual gate.

**Commands for operator to run** (from repo root, machine with Docker installed):

```bash
# 1. Build the image
docker build -t ms-365-mcp-server:phase1-01-03 .
# Expected: Build completes; cache-mount appears in npm ci step; image size 200-400MB

# 2. Verify non-root user
docker image inspect ms-365-mcp-server:phase1-01-03 --format '{{.Config.User}}'
# Expected: nodejs (or 1001)

# 3. Verify HEALTHCHECK directive is present
docker image inspect ms-365-mcp-server:phase1-01-03 --format '{{.Config.Healthcheck.Test}}'
# Expected: array containing "node /app/bin/check-health.cjs"

# 4. Verify OCI labels
docker image inspect ms-365-mcp-server:phase1-01-03 --format '{{.Config.Labels}}'
# Expected: org.opencontainers.image.title, .source, .licenses present

# 5. Run with read-only root FS + tmpfs /tmp
docker run -d --name mcp-smoke --read-only --tmpfs /tmp -p 3000:3000 \
  ms-365-mcp-server:phase1-01-03 --http 0.0.0.0:3000
# Expected: Container starts without EROFS errors
# Note: HEALTHCHECK will show "unhealthy" until plan 01-04 mounts /healthz — expected at this plan boundary

# 6. Verify PID 1 is tini
docker exec mcp-smoke sh -c 'cat /proc/1/comm'
# Expected: tini (NOT node)

# 7. Clean up
docker stop mcp-smoke && docker rm mcp-smoke
```

**Sign-off signal:** Type "approved" when all seven steps pass, or describe which step failed.

## SECUR-06 Compliance Status

| Threat | Mitigation | Static Assertion | Behavioral Smoke |
|--------|------------|-----------------|------------------|
| T-01-03: Container runs as root | `USER nodejs` (UID 1001) | Test 1 + Test 4: PASS | Task 3 Step 2: DEFERRED |
| T-01-03b: Writable root FS RCE persistence | Read-only-FS-compatible Dockerfile | Test 9 .dockerignore | Task 3 Step 5: DEFERRED |
| T-01-05: Node as PID 1 (signal/zombie) | `/sbin/tini --` ENTRYPOINT | Test 3: PASS | Task 3 Step 6: DEFERRED |
| T-01-04: curl in HEALTHCHECK bloats image | `bin/check-health.cjs` CJS probe | Test 2 + Test 8: PASS | Task 3 Step 3: DEFERRED |
| T-01-supply: Multi-base image drift | Single `ARG NODE_VERSION=22-alpine` | Test 7: PASS | N/A (static only) |

All static assertions PASS. Behavioral smoke tests await operator verification.

## Cross-Plan Dependencies

- **01-04** must mount `/healthz` — until then, HEALTHCHECK returns 1 but container still runs (expected at this plan boundary)
- **01-05** STOPSIGNAL SIGTERM integrates with the graceful shutdown signal handler being added
- **01-08** adds `docker-compose.yml` with `read_only: true` + `tmpfs: [/tmp]` + `cap_drop: ALL` + `no-new-privileges: true` to enforce T-01-03b mitigation at the orchestration layer

## Self-Check

Files exist:
- Dockerfile: FOUND
- bin/check-health.cjs: FOUND
- .dockerignore: FOUND
- test/dockerfile.test.ts: FOUND

Commits exist:
- b61f5b0: FOUND (test(01-03): add failing RED tests)
- e7ed392: FOUND (feat(01-03): Dockerfile hardening)
- 8680f13: FOUND (chore(01-03): sync package-lock.json)

## Self-Check: PASSED

---

*Phase: 01-foundation-hardening*
*Completed: 2026-04-18*
