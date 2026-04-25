# ms-365-mcp-server v2

[![build](https://github.com/ali205412/ms-365-mcp-server/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/ali205412/ms-365-mcp-server/actions/workflows/build.yml) [![integration](https://github.com/ali205412/ms-365-mcp-server/actions/workflows/integration.yml/badge.svg?branch=main)](https://github.com/ali205412/ms-365-mcp-server/actions/workflows/integration.yml) [![docker](https://github.com/ali205412/ms-365-mcp-server/actions/workflows/docker-image.yml/badge.svg?branch=main)](https://github.com/ali205412/ms-365-mcp-server/actions/workflows/docker-image.yml) [![codeql](https://github.com/ali205412/ms-365-mcp-server/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/ali205412/ms-365-mcp-server/actions/workflows/codeql.yml) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Maintained by **[Ali Abdelaal (@ali205412)](https://github.com/ali205412)** at [ali205412/ms-365-mcp-server](https://github.com/ali205412/ms-365-mcp-server). The v2 multi-tenant gateway runtime — Postgres + Redis substrate, all four identity flows, per-tenant rate limiting, OTel + Prometheus observability, 5,000+ Graph operations — is the work of this repo. Container image at `ghcr.io/ali205412/ms-365-mcp-server`. Issues + PRs belong [here](https://github.com/ali205412/ms-365-mcp-server/issues).

> Originally forked from [softeria/ms-365-mcp-server](https://github.com/softeria/ms-365-mcp-server), which owns the `@softeria/ms-365-mcp-server` npm name and the v1 single-user CLI. Upstream issues: [softeria tracker](https://github.com/softeria/ms-365-mcp-server/issues).

**Enterprise multi-tenant Microsoft 365 MCP gateway.** One Docker Compose deployment that gives AI assistants full, governed access to Microsoft Graph across many Azure AD tenants — with tenant isolation, resilient Graph transport, all four identity flows, and per-tenant observability + rate limiting.

v2 is a clean break from v1's single-user CLI model. Same project, new runtime: Postgres + Redis substrate, runtime tenant onboarding via admin REST API, 5,000+ Graph operations exposable per-tenant, AES-GCM token-at-rest, concurrent stdio + Streamable HTTP + legacy HTTP+SSE transports.

---

## Table of Contents

- [What's new in v2](#whats-new-in-v2)
- [When to use v2 vs v1](#when-to-use-v2-vs-v1)
- [Quickstart — Docker Compose (reference)](#quickstart--docker-compose-reference)
- [Quickstart — single user (stdio)](#quickstart--single-user-stdio)
- [Architecture](#architecture)
- [Identity flows](#identity-flows)
- [Multi-tenant onboarding (Admin API)](#multi-tenant-onboarding-admin-api)
- [Tool catalog & presets](#tool-catalog--presets)
- [Observability & rate limiting](#observability--rate-limiting)
- [Supported clouds](#supported-clouds)
- [CLI reference](#cli-reference)
- [Environment variables](#environment-variables)
- [Token storage (stdio mode)](#token-storage-stdio-mode)
- [Azure Key Vault (stdio mode)](#azure-key-vault-stdio-mode)
- [Migrating from v1](#migrating-from-v1)
- [Contributing](#contributing)
- [Support & license](#support--license)

---

## What's new in v2

| Capability               | v1                                   | v2                                                                                                                     |
| ------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Deployment**           | `npx` per user                       | Docker Compose with Postgres + Redis                                                                                   |
| **Tenancy**              | One user per process                 | Many tenants per gateway, onboarded at runtime                                                                         |
| **Identity**             | Device code + BYOT                   | Delegated OAuth + app-only client-credentials + bearer pass-through + device code, all concurrent, per-tenant isolated |
| **Token storage**        | OS keychain / file (plaintext)       | AES-GCM encrypted in Postgres with KEK rotation                                                                        |
| **Admin surface**        | None                                 | REST API dual-secured by Entra OAuth (group check) OR rotatable API keys                                               |
| **Rate limiting**        | None                                 | Per-tenant sliding-window Redis limiter (request count + Graph point budget)                                           |
| **Observability**        | Winston file logs                    | OTel traces via OTLP/HTTP + Prometheus `/metrics` on port 9464                                                         |
| **Graph coverage**       | ~200 tools                           | Full v1.0 + curated beta (5,000+ ops) with per-tenant enablement                                                       |
| **Transports**           | stdio OR HTTP (mutually exclusive)   | stdio + Streamable HTTP + legacy HTTP+SSE concurrently                                                                 |
| **Tool surface control** | `--enabled-tools` regex / `--preset` | Per-tenant enabled-tools stored in Postgres + ~150-op "essentials" preset                                              |

---

## When to use v2 vs v1

**Use v2 if you:**

- Run MCP as infrastructure for multiple users or tenants
- Need audit trails, rate limits, and observability
- Want a single deployment that serves Claude Desktop, Claude Code, Cursor, Continue, and bespoke integrations
- Need production-grade token security (encrypted at rest, per-tenant isolation)

**Use v1 (single-user CLI) if you:**

- Just want to hook one personal or work account into Claude Desktop
- Don't need Docker / Postgres / Redis
- Are happy with OS keychain token storage

v1 continues to work via the same `npx @softeria/ms-365-mcp-server` entry point described below. v2 is a deliberate superset; the stdio mode keeps v1 ergonomics intact.

---

## Quickstart — Docker Compose (reference)

v2's reference deployment is a single Docker Compose stack on one VM. No Kubernetes, no Azure-native services required.

```bash
git clone https://github.com/ali205412/ms-365-mcp-server.git
cd ms-365-mcp-server
cp .env.example .env
# Edit .env — set at minimum: MS365_MCP_ADMIN_GROUP_ID, MS365_MCP_KEK, database URL, Redis URL
docker compose up -d
```

Or pull the pre-built image directly:

```bash
docker pull ghcr.io/ali205412/ms-365-mcp-server:latest
```

Once up, the gateway exposes:

| Endpoint                                     | Purpose                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| `/mcp`, `/t/:tenantId/mcp` (Streamable HTTP) | Primary MCP transport for modern clients                  |
| `/t/:tenantId/sse` + `/t/:tenantId/messages` | Legacy MCP transport (older Claude Desktop, SSE clients)  |
| `/.well-known/oauth-authorization-server`    | OAuth 2.1 metadata (consumed by Claude connectors et al.) |
| `/authorize`, `/token`                       | OAuth PKCE flow endpoints                                 |
| `/admin/tenants`                             | Tenant CRUD (dual-secured)                                |
| `/admin/api-keys`                            | API-key rotation (dual-secured)                           |
| `/metrics` (port 9464)                       | Prometheus scrape target (optionally Bearer-gated)        |
| `/healthz`, `/readyz`                        | Liveness + readiness (Kubernetes conventions)             |

Full deployment guide with reverse-proxy (Caddy / nginx / Traefik) SSE buffering directives, TLS termination, and production hardening: **[docs/deployment.md](docs/deployment.md)** and **[docs/observability/](docs/observability/)**.

---

## Quickstart — single user (stdio)

v1-style usage still works unchanged:

```bash
npx @softeria/ms-365-mcp-server --login
# Follow the device code prompt
```

In Claude Desktop (`settings → Developer → Edit Config`):

```json
{
  "mcpServers": {
    "ms365": {
      "command": "npx",
      "args": ["-y", "@softeria/ms-365-mcp-server", "--org-mode"]
    }
  }
}
```

See the [CLI reference](#cli-reference) for the full stdio flag list.

---

## Quickstart — Claude connector (Claude.ai web / Claude Desktop OAuth)

Claude.ai's custom-connector feature speaks MCP over Streamable HTTP with OAuth 2.1. To plug this server in:

1. **Expose the gateway publicly.** `localhost` is not reachable from Claude.ai's browser origin. Use ngrok / Cloudflare Tunnel / your own reverse proxy.

   ```bash
   cloudflared tunnel --url http://localhost:3000
   # copy the resulting https://<name>.trycloudflare.com
   ```

2. **Set the public URL** in `.env` **and restart** — Claude reads this from `/.well-known/oauth-authorization-server`, so it must be the URL Claude will hit, not `localhost`.

   ```env
   MS365_MCP_PUBLIC_URL=https://<name>.trycloudflare.com
   MS365_MCP_CORS_ORIGINS=https://claude.ai,https://<name>.trycloudflare.com
   ```

3. **Add `https://<name>.trycloudflare.com/mcp` as a custom connector in Claude.** Claude will:
   - Fetch `/.well-known/oauth-authorization-server` (OAuth AS discovery)
   - Open a browser window to `/authorize` → Microsoft login
   - POST the returned code to `/token` and cache the bearer
   - Call `/mcp` with `Authorization: Bearer …` on every MCP request

4. **Verify** with the dev Inspector before trusting the connector:

   ```bash
   npx @modelcontextprotocol/inspector \
     --url https://<name>.trycloudflare.com/mcp \
     --transport streamable-http
   ```

Known limitations: Claude Desktop's native MCP stdio is simpler — no OAuth needed, just point it at the binary (see above). Reach for connectors when the server must be shared across browsers / users.

---

## Architecture

```
                  ┌─────────────────────────────────────────┐
                  │  AI Clients (Claude, Cursor, Continue)  │
                  └────────────────┬────────────────────────┘
                                   │ MCP (stdio | Streamable HTTP | HTTP+SSE)
                                   ▼
     ┌──────────────────────────────────────────────────────────┐
     │  ms-365-mcp-server (gateway)                             │
     │  ┌────────────────────────────────────────────────────┐  │
     │  │ Transports · Rate limit · Tenant resolver · Auth   │  │
     │  └───────┬────────────────────┬──────────────────┬────┘  │
     │          │                    │                  │       │
     │     Tool catalog        Graph transport     Observability│
     │   (per-tenant enabled   (retry + batch +    (OTel + Prom)│
     │     tools, ~5000 ops)    page + etag)                    │
     └──────┬────────────────────┬──────────────────────┬───────┘
            │                    │                      │
     ┌──────▼──────┐      ┌──────▼──────┐        ┌──────▼──────┐
     │  Postgres   │      │   Redis     │        │ OTel + Prom │
     │ (tenants,   │      │ (rate limit,│        │ (collectors,│
     │  tokens,    │      │  PKCE, pub/ │        │   Grafana)  │
     │  audit)     │      │  sub)       │        │             │
     └─────────────┘      └─────────────┘        └─────────────┘
                                   │
                                   ▼
                        ┌───────────────────────┐
                        │  Microsoft Graph API  │
                        └───────────────────────┘
```

Detailed architecture: **[CLAUDE.md](CLAUDE.md)** (codebase conventions) and **[.planning/PROJECT.md](.planning/PROJECT.md)** (requirements + decisions).

---

## Identity flows

All four flows run concurrently and are correctly isolated per tenant. The gateway picks the right one per incoming request.

| Flow                            | Who uses it                                          | How the gateway receives credentials                                                                        |
| ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Delegated OAuth 2.1 + PKCE**  | End-users authenticating through a modern MCP client | Client redirects through `/authorize` → `/token`; server stores refresh token AES-GCM-encrypted in Postgres |
| **App-only client credentials** | Daemons / background automation                      | Tenant registration supplies client secret or cert; gateway caches the access token per tenant              |
| **Bearer pass-through**         | Systems that already hold a Graph token              | `Authorization: Bearer <token>` on `/mcp` request; gateway validates `tid` claim matches the URL tenant     |
| **Device code**                 | Interactive CLI / stdio mode                         | `npx @softeria/ms-365-mcp-server --login`                                                                   |

Per-tenant isolation is the security foundation: token cache, PKCE state, rate-limit counters, and audit log are all keyed by `tenantId`. Cross-tenant leak is a P0 bug, not a feature.

---

## Multi-tenant onboarding (Admin API)

Tenants are onboarded at runtime via REST API. No restart needed.

```bash
# Register a new tenant
curl -X POST https://gateway.example.com/admin/tenants \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenant_id": "contoso.onmicrosoft.com",
    "client_id": "00000000-0000-0000-0000-000000000000",
    "client_secret": "...",
    "enabled_tools_preset": "essentials",
    "rate_limits": { "request_per_min": 1000, "graph_points_per_min": 50000 }
  }'
```

The Admin API is **dual-secured**:

- **Entra OAuth** (admin app registration + group membership check) for humans via the admin portal
- **Rotatable API keys** for automation (`Authorization: Bearer mcpk_...`)

Tenant disable triggers a cryptoshred cascade: MSAL cache evicted, Redis keys flushed, DEK destroyed. Tokens cannot be recovered post-disable.

Full admin API reference lives in the OpenAPI spec shipped with the server (generated doc: TODO).

---

## Tool catalog & presets

The generated catalog covers all of Microsoft Graph v1.0 plus a curated beta surface (~5,000 operations). MCP clients cannot display 5,000 tools in one catalog, so v2 ships **per-tenant enabled-tools**:

- **Default create-path preset: `discovery-v1`** (12 meta tools for search, schema lookup, execution, and tenant memory)
- **Static preset: `essentials-v1`** (~150 ops covering Mail, Calendar, Files, Users, Teams, SharePoint)
- **Regex filter** on the generated aliases via admin API
- **Workload presets**: `mail`, `calendar`, `files`, `personal`, `work`, `excel`, `contacts`, `tasks`, `onenote`, `search`, `users`, `powerbi`, `intune`, `exchange`, `sharepoint`, `teams-admin`, `all`

New tenants created through supported gateway/admin paths default to discovery mode. Existing tenants stay pinned to their stored `preset_version` and must opt in explicitly. See **[docs/discovery-mode.md](docs/discovery-mode.md)** for migration, rollback, and discovery-mode operator details.

For single-user stdio mode, use `--preset`, `--enabled-tools <regex>`, or `--discovery` (lazy load tools on demand):

```bash
npx @softeria/ms-365-mcp-server --preset mail
npx @softeria/ms-365-mcp-server --enabled-tools "excel|contact"
npx @softeria/ms-365-mcp-server --discovery     # LLM searches tools on-demand
```

Use `--list-presets` to see the full list.

---

## Observability & rate limiting

v2 ships production-grade observability out of the box:

### Traces (OTel)

Every Graph request emits a span with `{tenant.id, tool.name, tool.alias, http.status_code, retry.count, graph.request_id, duration_ms}`. Export via `OTEL_EXPORTER_OTLP_ENDPOINT`.

### Metrics (Prometheus)

Scrape `/metrics` on port 9464 (configurable via `MS365_MCP_METRICS_PORT`):

| Metric                         | Type      | Labels                                       |
| ------------------------------ | --------- | -------------------------------------------- |
| `mcp_tool_calls_total`         | Counter   | `tenant`, `tool` (workload prefix), `status` |
| `mcp_tool_duration_seconds`    | Histogram | `tenant`, `tool`                             |
| `mcp_graph_throttled_total`    | Counter   | `tenant`                                     |
| `mcp_rate_limit_blocked_total` | Counter   | `tenant`, `reason`                           |
| `mcp_oauth_pkce_store_size`    | Gauge     | —                                            |
| `mcp_token_cache_hit_ratio`    | Gauge     | `tenant`                                     |
| `mcp_active_streams`           | Gauge     | `tenant`                                     |

Label cardinality is bounded: the `tool` label is the **workload prefix** (~40 values), not the full alias (~14k values). Full aliases appear as span attributes only.

### Rate limits (Redis sliding window)

Per-tenant budgets are enforced **before** any Graph call is made:

- **Request rate**: `MS365_MCP_DEFAULT_REQ_PER_MIN` (default 1000, overridable per-tenant)
- **Graph point budget**: `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` (default 50000, observed from Graph's `x-ms-resource-unit` header)

Over-budget requests return `429` with `Retry-After` and increment `mcp_rate_limit_blocked_total`.

A starter Grafana dashboard (5 panels: request rate, p50/p95/p99 latency, 429 rate, token-cache hit ratio, PKCE store size) ships under **[docs/observability/grafana-starter.json](docs/observability/grafana-starter.json)**. Runbook with alert patterns and per-metric PromQL reference lives at **[docs/observability/runbook.md](docs/observability/runbook.md)**.

---

## Supported clouds

| Cloud                | Description                        | Auth endpoint               | Graph endpoint                    |
| -------------------- | ---------------------------------- | --------------------------- | --------------------------------- |
| **Global** (default) | Worldwide Microsoft 365            | `login.microsoftonline.com` | `graph.microsoft.com`             |
| **China** (21Vianet) | Microsoft 365 operated by 21Vianet | `login.chinacloudapi.cn`    | `microsoftgraph.chinacloudapi.cn` |

Set via `--cloud china` or `MS365_MCP_CLOUD_TYPE=china`. Per-tenant cloud override is supported via the admin API.

---

## CLI reference

For the single-user stdio path. (HTTP-mode flags are orthogonal; see [deployment.md](docs/deployment.md) for gateway config.)

```
--login                   Login via device code flow
--logout                  Log out and clear saved credentials
--verify-login            Verify login without starting the server
--list-permissions        List required Graph permissions and exit (respects --org-mode, --preset, --enabled-tools)
--list-accounts           List configured MSAL accounts
--list-presets            List tool presets and exit
--org-mode                Enable work/school scope set (Teams, SharePoint, etc.)
--cloud <type>            Microsoft cloud: global (default) or china
--read-only               Disable write operations
--http [port]             Streamable HTTP transport (default port 3000)
--enable-auth-tools       Enable login/logout tools in HTTP mode (off by default)
--no-dynamic-registration Disable OAuth DCR (on by default in HTTP mode)
--enabled-tools <regex>   Filter tools by regex (e.g. "excel|contact")
--preset <names>          Comma-separated preset list
--discovery               Lazy tool discovery — loads tools on demand
--toon                    (experimental) TOON output format for 30-60% token reduction
--public-url <url>        Public base URL for OAuth when behind a reverse proxy
-v                        Verbose logging
```

---

## Environment variables

### Identity + cloud

- `MS365_MCP_CLIENT_ID` — Custom Azure app client ID (defaults to built-in)
- `MS365_MCP_CLIENT_SECRET` — Enables confidential-client flow
- `MS365_MCP_TENANT_ID` — Tenant ID or `common` (default)
- `MS365_MCP_CLOUD_TYPE` — `global` (default) or `china`
- `MS365_MCP_OAUTH_TOKEN` — Pre-supplied bearer token (BYOT)
- `MS365_MCP_KEYVAULT_URL` — Switch secrets source to Azure Key Vault

### Gateway (Docker Compose)

- `MS365_MCP_DATABASE_URL` — Postgres connection string
- `MS365_MCP_REDIS_URL` — Redis connection string
- `MS365_MCP_KEK` — 32-byte base64 key-encryption key for token encryption at rest
- `MS365_MCP_ADMIN_GROUP_ID` — Entra group whose members may call the admin API
- `MS365_MCP_PUBLIC_URL` — Public base URL for browser-facing OAuth redirects (when behind a proxy)

### Observability (Phase 6)

- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP/HTTP collector endpoint for traces
- `MS365_MCP_PROMETHEUS_ENABLED` — Gate Prometheus exporter on/off (default on)
- `MS365_MCP_METRICS_PORT` — Dedicated port for `/metrics` (default `9464`)
- `MS365_MCP_METRICS_BEARER` — Optional Bearer token gating `/metrics`
- `MS365_MCP_DEFAULT_REQ_PER_MIN` — Default per-tenant request budget (default `1000`)
- `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` — Default per-tenant Graph point budget (default `50000`)

### Behaviour

- `READ_ONLY=true|1` — Disable write operations
- `ENABLED_TOOLS` — Regex filter
- `MS365_MCP_ORG_MODE=true|1` — Enable work/school scopes
- `MS365_MCP_OUTPUT_FORMAT=toon` — Switch to TOON output
- `MS365_MCP_MAX_TOP=<n>` — Cap Graph `$top` values
- `MS365_MCP_BODY_FORMAT=html|text` — Outlook body content type (default text)
- `LOG_LEVEL` — Winston level (default `info`)
- `SILENT=true|1` — Suppress console output

Full env reference with per-plan provenance: **[docs/observability/env-vars.md](docs/observability/env-vars.md)**.

---

## Token storage (stdio mode)

Stdio mode uses the OS credential store via `keytar` when available, with fallback to file storage (mode `0600`). To survive npm reinstalls, set custom paths outside the package dir:

```bash
export MS365_MCP_TOKEN_CACHE_PATH="$HOME/.config/ms365-mcp/.token-cache.json"
export MS365_MCP_SELECTED_ACCOUNT_PATH="$HOME/.config/ms365-mcp/.selected-account.json"
```

Parent directories are created automatically.

> **Gateway mode** stores tokens AES-GCM-encrypted in Postgres — not on disk. The stdio token storage documented here only applies to single-user CLI mode.

---

## Azure Key Vault (stdio mode)

For stdio deployments that need Key Vault instead of env vars:

```bash
az keyvault secret set --vault-name your-kv --name ms365-mcp-client-id --value "..."
az keyvault secret set --vault-name your-kv --name ms365-mcp-tenant-id --value "..."
az keyvault secret set --vault-name your-kv --name ms365-mcp-client-secret --value "..."   # optional

MS365_MCP_KEYVAULT_URL=https://your-kv.vault.azure.net npx @softeria/ms-365-mcp-server
```

Auth uses `DefaultAzureCredential` (env vars → managed identity → Azure CLI → VS Code → Azure PowerShell).

Gateway mode uses Postgres, not Key Vault; the KEK that encrypts tokens is supplied via `MS365_MCP_KEK`.

---

## Migrating from v1

v2 is a clean break. Upgrade path:

1. **Single user staying single user?** No change. `npx @softeria/ms-365-mcp-server` still works exactly as it did in v1.
2. **Moving to gateway?** Stand up a v2 Docker Compose stack alongside your v1 setup. Onboard tenants via admin API. Point each MCP client at the gateway `/mcp` endpoint. Retire v1 processes once all users are migrated.
3. **Tokens?** v1 OS-keychain tokens cannot be imported into v2's AES-GCM-encrypted Postgres store — users re-auth once via OAuth.
4. **Config?** `--enabled-tools` / `--preset` work the same at the CLI level but in gateway mode the per-tenant equivalents live on the tenant row.

Full migration guide (when the last v1 user has moved): **[docs/migration-v1-to-v2.md](docs/migration-v1-to-v2.md)**.

---

## Contributing

```bash
npm ci
npm run generate    # (re)generate src/generated/client.ts from Graph OpenAPI
npm run verify      # generate + lint + format:check + build + test
```

Before submitting a PR, `npm run verify` must pass. For a full developer workflow (GSD planning / TDD loops / code review agents), see **[CLAUDE.md](CLAUDE.md)**.

---

## Support & license

**This repo (v2 multi-tenant gateway — Ali Abdelaal / @ali205412):**

- Issues + PRs: https://github.com/ali205412/ms-365-mcp-server/issues
- Container image: `ghcr.io/ali205412/ms-365-mcp-server:latest`

**Upstream (v1 single-user CLI, npm package):**

- Issues: https://github.com/softeria/ms-365-mcp-server/issues
- Discussions: https://github.com/softeria/ms-365-mcp-server/discussions
- Discord: https://discord.gg/WvGVNScrAZ

MIT — original work © 2026 Softeria, v2 additions © 2026 Ali Abdelaal. See [LICENSE](./LICENSE).
