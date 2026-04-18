# Changelog

All notable changes to ms-365-mcp-server are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — v2.0.0 (in progress)

### Breaking changes

- **`keytar` dependency removed** (SECUR-07, D-04). v1 users storing tokens
  in the OS keychain must run `npx ms-365-mcp-server migrate-tokens` once
  to move those tokens to the file-based cache at
  `~/.ms-365-mcp-token-cache.json` + `~/.selected-account.json` (each at
  mode `0600`). After verifying the file cache works, re-run with
  `--clear-keytar` to delete the OS-keychain entries.
  - HTTP / SSE / Streamable-HTTP transports never used keytar, so only
    stdio CLI users are affected by the migration.
  - On stdio startup, if the file-based token cache is missing, the
    server writes an advisory stderr message pointing to
    `npx ms-365-mcp-server migrate-tokens` when it detects leftover
    v1 OS-keychain entries.
  - The migrator supports `--dry-run` (reports what would be migrated
    without writing) and `--clear-keytar` (deletes OS-keychain entries
    after a successful migration).
  - Rationale: keytar has been archived and unmaintained since 2023
    (CONCERNS.md MED). Carrying the native module into v2 means
    shipping a dep that receives no security updates AND forces
    native-module build pain on Alpine, read-only-rootfs containers,
    and Windows without build tools.
- **Node.js 20 LTS minimum** (Node 18 reached EOL April 2025). CI
  matrix covers Node 20 and 22. See plan 01-01.
- **Winston logger replaced with pino** (FOUND-03). Log line formats
  change but the `logger` module's default export shape is preserved so
  existing callers are unaffected. pino-http streams access logs and a
  strict PII-redaction policy (D-01) scrubs Authorization, cookies,
  refresh tokens, and request/response bodies at default `info` level.
- **Default CORS behavior in production mode** (SECUR-04).
  `NODE_ENV=production` now requires `MS365_MCP_CORS_ORIGINS` (plural,
  comma-separated) to be set; the server exits with sysexits `EX_CONFIG`
  (78) if it is empty. The v1 singular `MS365_MCP_CORS_ORIGIN` is still
  accepted as a one-release-cycle fallback with a deprecation warning.
- **`MS365_MCP_PUBLIC_URL` required in production HTTP mode** (D-02).
  Deprecated `MS365_MCP_BASE_URL` is accepted as a fallback. Dev mode
  is unchanged.

### Added

- `migrate-tokens` CLI subcommand with `--dry-run` and `--clear-keytar`
  flags (SECUR-07).
- `bin/check-keytar-leftovers.cjs` — standalone probe invoked by stdio
  startup to advise v1 users of the migration path.
- `bin/migrate-tokens.mjs` — one-shot migrator that reads v1 keytar
  entries and writes envelope-wrapped payloads to the v2 dual-file
  layout.
- `/healthz` (always-200 liveness) and `/readyz` (ready / draining /
  not_ready) endpoints (OPS-03, OPS-04).
- `--health-check` CLI flag for Docker HEALTHCHECK compatibility
  (OPS-03). In HTTP mode, probes `/healthz` with a 3s timeout and exits
  0 on 200. In stdio mode, short-circuits exit 0.
- Hardened `Dockerfile` (SECUR-06): non-root `nodejs` user (UID 1001),
  tini as PID 1, `HEALTHCHECK` directive, OCI labels, STOPSIGNAL
  SIGTERM, read-only-rootfs-compatible layout.
- `bin/check-health.cjs` — CJS Docker HEALTHCHECK probe.
- Reference `examples/docker-compose/docker-compose.yml` with
  `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`,
  `security_opt: [no-new-privileges]`, writable `./data` bind mount
  for the token cache, and a `MS365_MCP_TOKEN_CACHE_PATH` env var
  pointing at that mount.
- Reverse-proxy reference configs (OPS-10): `Caddyfile` (primary),
  `nginx.conf`, `traefik.yml`. All three preserve X-Forwarded-\*
  headers and disable buffering so SSE streams pass through cleanly.
- OpenTelemetry SDK bootstrap with OTLP + Prometheus exporters
  (FOUND-04). Silent when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.
- Graceful shutdown with 25s deadline (OPS-09). `SIGTERM`/`SIGINT`
  drain sequence: `setDraining(true)` → `server.close()` →
  `logger.flush()` → `otel.shutdown()` with a 10s race → `exit(0)`.
  Overridable via `MS365_MCP_SHUTDOWN_GRACE_MS`.
- Hardened OAuth dynamic client registration (SECUR-05): `redirect_uris`
  allowlist, `javascript:` / `data:` scheme rejection, crypto-random
  client IDs.
- Token endpoint body redaction: the `/token` 400 error path no longer
  logs the request body (which could contain `client_secret` or
  `code`) per CONCERNS.md "Token endpoint logs body on missing
  grant_type".

### Fixed

- `dynamic client ID collision` under concurrent registration — client
  IDs are now `mcp-client-<16-char-urlsafe-rand>` rather than
  `mcp-client-${Date.now()}`.

## [v1.x]

See https://github.com/softeria/ms-365-mcp-server/releases for the v1
release history. v1 remains on the `1.x` branch for critical security
patches; no new features land there.
