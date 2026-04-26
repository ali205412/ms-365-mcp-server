# Migration Guide: v1 → v2

v2 is a clean break from v1 — a multi-tenant, Docker-first MCP gateway that
replaces the single-tenant binary from v1. This guide covers the migration
path for existing v1 HTTP-mode clients. Stdio-mode users are largely unaffected.

## Breaking Change: Refresh Tokens (plan 03-07, SECUR-02)

### What changed

In **v1 HTTP mode**, clients could send a refresh token in a custom
`x-microsoft-refresh-token` header, and the server would forward it to
Microsoft when an access token expired (HTTP 401 from Graph).

In **v2**, this header is **never read**. The refresh-token header-read code
path is deleted from `src/lib/microsoft-auth.ts`. Refresh tokens now live
server-side, in a Redis-backed session store at
`mcp:session:{tenantId}:{sha256(clientAccessToken)}`, encrypted with a per-tenant
DEK via the envelope encryption substrate from plan 03-04.

### Why

See SECUR-02 and the Phase 3 threat model (T-03-07-01). Custom auth headers:

- leak through reverse-proxy access logs and OTel HTTP instrumentation,
- bypass the at-rest encryption contract (refresh tokens end up in plaintext
  in proxy logs, memory dumps, and any middleware that reflects request
  headers in error responses),
- couple the client to a server-internal concern (refresh-token transport
  should never be a client responsibility — the client only owns its access
  token, never the long-lived credential).

In v2, the server is the sole custodian of refresh tokens. They never cross
the client trust boundary, never appear in logs (pino redact covers the
header path for defense-in-depth, but the read path itself is gone), and
are always envelope-encrypted at rest.

### What to change in your v1 HTTP-mode client

1. **Stop sending `x-microsoft-refresh-token`.** The v2 server ignores the
   header entirely — no middleware reads it. If your client still sends it,
   the header is silently dropped (other than being redacted by the pino
   logger if it reaches log middleware).
2. **Only read `access_token` from the `/t/{tenantId}/token` response.**
   The response body no longer contains a `refresh_token` field — that was
   a v1 artifact that let clients manage their own refresh cycle. In v2,
   the server handles refresh transparently on 401.
3. **On 401 from Graph, the server auto-refreshes where possible.** If the
   server-side session is still valid (within the 14-day Entra refresh-token
   window, and the operator hasn't rotated the KEK in a way that invalidates
   the session DEK), the refresh is invisible to the client — the Graph
   request is retried with a fresh access token and returns 200. If the
   refresh fails (session expired, refresh token revoked, etc.), the client
   receives a 401 and must perform a fresh OAuth round-trip via
   `GET /t/{tenantId}/authorize` → `POST /t/{tenantId}/token`.

### Operator runbook

- **Existing v1 deployments being upgraded:** discard the v1 token cache.
  v2 cannot read v1's refresh tokens (they lived client-side in v1; there's
  nothing to migrate). Users re-auth on first v2 request.
- **Server-side session TTL:** defaults to 14 days (Entra refresh-token
  validity window). Configurable via `MS365_MCP_SESSION_TTL_SECONDS`.
- **Session-store health:** the SessionStore decrypt path warns and drops
  the key on decrypt failure (matches the 03-05 MSAL cache plugin pattern).
  This can occur during a KEK rotation window — affected users re-auth.
- **Audit visibility (plan 03-10):** refresh operations emit
  `oauth.refresh` audit rows (success / failure) so operators can track
  refresh-token health across tenants.

## Breaking Change: Legacy HTTP+SSE Shim (plan 03-09)

### What changed

v2 still mounts the legacy HTTP+SSE transport at `/t/{tenantId}/sse` +
`/t/{tenantId}/messages` for MCP clients that haven't yet adopted the
Streamable HTTP transport. However, the shim returns **HTTP 501
Not Implemented** for any JSON-RPC request whose `method` is not
`initialize`. Only the initialize handshake is honoured on the legacy
channel; tool calls, resource fetches, and prompts MUST be sent over the
Streamable HTTP transport (`POST /t/{tenantId}/mcp`).

### Why

Full SSE support would duplicate the streamable-HTTP session machinery at
significant cost and keep a retirement-track protocol on life support past
the v2.1 flag-default / v2.2 removal window. The shim's purpose is
**discoverability** — clients that speak only SSE can complete the
initialize exchange, learn that Streamable HTTP is available, and upgrade
in-session. Everything else returns 501 with a `{"error":
"sse_tool_call_not_supported", "hint": "upgrade to Streamable HTTP"}` body.

### What to change in your v1 HTTP-mode client

If your MCP client library supports Streamable HTTP, switch to it. The
Streamable HTTP endpoint is drop-in for nearly every tool call and does not
carry the per-request SSE connection overhead.

If your client is hard-wired to SSE:

- **Keep using SSE for discovery / initialize.**
- **Upgrade the library to Streamable HTTP for everything else**, or pin
  to v2.0.x (SSE shim retirement is scheduled for v2.2 and tracked in the
  CHANGELOG).

### Operator runbook

- Monitor `http_request_total{route="/t/:tenantId/messages",status="501"}`
  in your metrics backend — a rising 501 rate indicates clients that still
  depend on SSE tool calls and need upgrade coordination.
- The shim itself is gated behind the `MS365_MCP_ENABLE_LEGACY_SSE`
  environment variable (default `1` in v2.0, `0` in v2.1). Flip to `0`
  to disable the shim entirely once your client population has upgraded.

## Other v1 → v2 notes

- **Auth flows:** v2 supports all four identity flows concurrently on one
  server — delegated OAuth, app-only client credentials, bearer
  pass-through, and device code (stdio only). See `.planning/phases/03-*`
  summaries.
- **Tenant onboarding:** v2 tenants are persisted in Postgres and loaded
  lazily via `loadTenant` middleware. Adding a tenant no longer requires
  a server restart — `bin/create-tenant.mjs` + SQL insertion is the v2.0
  path (admin API is Phase 4).
- **Token cache:** v2 removes `keytar` (plan 01-08). HTTP-mode token
  storage is server-side (per-tenant DEK, Redis); stdio-mode falls back
  to file-based storage for the device-code flow.
- **PKCE store:** v2 externalizes to Redis (plan 03-03). The v1
  in-memory `Map` scan + SHA-256 per entry is gone.
