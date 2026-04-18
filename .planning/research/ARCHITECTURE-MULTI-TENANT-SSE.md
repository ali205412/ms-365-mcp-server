# Architecture: Dockerized Multi-Tenant MCP Server with OAuth (v2)

**Research date:** 2026-04-18
**Author:** Architecture research pass
**Status:** Recommendations for v2 roadmap. Open questions at end.

---

## Executive Summary

**Recommendation: ship Streamable HTTP only (do not add a separate SSE transport).**
The MCP spec replaced HTTP+SSE with Streamable HTTP in revision `2025-03-26`; the
deprecated transport stops being accepted by clients on **April 1, 2026**. Streamable
HTTP already uses SSE *inside* its POST/GET responses, so we get streaming "for free"
without owning a second transport. Where the brief says "SSE-transport server," the
production-correct interpretation in 2026 is **Streamable HTTP with SSE responses**,
not the legacy `/sse` + `/messages` endpoints. Sources: [MCP spec 2025-06-18 §
Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http),
[Keboola SSE deprecation notice](https://changelog.keboola.com/deprecation-of-sse-transport-in-mcp-server-upgrade-to-streamable-http/).

**Recommendation: hybrid Azure AD model.**
Use one **multi-tenant** Microsoft Entra app registration as the OIDC default for
self-service onboarding, plus an optional **per-tenant override** for customers that
require their own client ID/secret (compliance, branding, custom token lifetime
policies). Tenant-scoped configuration is loaded from a database (Postgres) with
hot-reload, keyed by tenant ID. Sources: [Convert app to multi-tenant](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant),
[Multitenant SaaS patterns](https://learn.microsoft.com/en-us/azure/architecture/example-scenario/multi-saas/multitenant-saas).

**Recommendation: tenant routing by URL path** — `/t/{tenantId}/mcp` and
`/t/{tenantId}/.well-known/*`. Subdomain routing is rejected for MVP (DNS + cert
operations cost) and JWT-`iss`-only routing is rejected (resolves tenant *after*
PKCE state is needed). Subdomains can be added later as a layer-7 rewrite without
breaking the path-based contract.

**Recommendation: Redis as the operational substrate.**
Externalize PKCE state, MSAL token cache, idempotency keys, and rate-limit counters
to Redis (encrypted at rest, with envelope encryption for refresh tokens using a
KMS-held DEK). Postgres holds long-term tenant config + audit. Source: [MSAL Node
distributed cache pattern](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching).

**Recommendation: deploy as a stateless replicated service** behind Azure Container
Apps (or AKS) with Azure Front Door (or Caddy) terminating TLS and disabling
buffering for the MCP path. Secrets via **Azure Key Vault CSI driver** on AKS, or
Container Apps' built-in secret reference on ACA. Health: `/healthz` (liveness) +
`/readyz` (deep — Redis ping, Graph reachability, Key Vault reachability).

**Migration path (high level):** behind a feature flag, externalize PKCE → introduce
tenant resolver middleware → swap MSAL cache for distributed plugin → harden
Dockerfile + secrets → wire OTel + Prometheus → cut over.

---

## 1) MCP Transport — Streamable HTTP, not legacy SSE

### What the current MCP spec actually says

Per [MCP spec 2025-06-18 § Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports):

> "The protocol currently defines two standard transport mechanisms for client-server
> communication: stdio … and Streamable HTTP."

Section "Streamable HTTP" opens with:

> "This replaces the HTTP+SSE transport from protocol version 2024-11-05."

Streamable HTTP is **a single MCP endpoint** (`POST` + `GET` to the same URL, e.g.
`/mcp`) that *can* upgrade a response to `Content-Type: text/event-stream`. The
server picks per-request whether to respond with `application/json` (one shot) or
SSE (stream). The legacy two-endpoint model (`GET /sse` for the channel +
`POST /messages` to push) is the deprecated 2024-11-05 transport.

**Spec security warnings (must implement, today's server already partially does):**

- §2 of "Streamable HTTP" — *"Servers MUST validate the `Origin` header on all
  incoming connections to prevent DNS rebinding attacks"* — **not implemented**
  today; current code only sets CORS headers (`src/server.ts:184-199`).
- *"When running locally, servers SHOULD bind only to localhost"* — current code
  binds `0.0.0.0` when `--http` is given without a host. Acceptable for containers,
  but the spec language matters for local dev.
- *"Servers SHOULD implement proper authentication for all connections"* — done via
  `microsoftBearerTokenAuthMiddleware`, but token introspection is missing
  (CONCERNS.md §"Bearer token middleware accepts any string").

**Session management (§ Session Management):** the spec lets a server set a
`Mcp-Session-Id` header on `InitializeResult`; clients echo it on subsequent
requests. Current server runs in **stateless** mode (`sessionIdGenerator: undefined`,
`src/server.ts:532`) — that is spec-conformant and the right call for horizontal
scaling. Recommendation: **keep stateless** for v2 unless we need server-initiated
notifications keyed by session.

### Client compatibility (April 2026)

| Client | Streamable HTTP | Legacy SSE | Notes |
|---|---|---|---|
| Claude Desktop | Yes (Settings > Integrations) | Deprecated | JSON config only takes stdio |
| Claude Code | Yes | Yes (until cutoff) | `claude mcp add --transport http` |
| Cursor (recent) | Yes | Yes (until cutoff) | "Streamable HTTP" preferred |
| Continue (VS Code/JetBrains) | Yes | Yes | Stores config in `~/.continue` |
| MCP Inspector | Yes | Yes | Both supported for testing |

Source: [MCP server handbook April 2026](https://use-apify.com/blog/mcp-server-handbook-2026),
[Stacklok client compatibility matrix](https://docs.stacklok.com/toolhive/reference/client-compatibility),
[Cursor forum on Streamable HTTP](https://forum.cursor.com/t/mcp-streamable-http-support/96770).

**Decision: ship Streamable HTTP only.** Drop the brief's "SSE transport" framing
(it predates the rename) and document this clearly. If we discover lingering legacy
clients in production, add a thin `/sse` shim later — but don't pay the dual-stack
cost up front.

### Reverse-proxy gotchas (the part that actually breaks in production)

Streamable HTTP responses can be SSE; SSE on a reverse proxy goes wrong by default.

**nginx:**
```nginx
location /t/ {
  proxy_pass http://upstream;
  proxy_http_version 1.1;
  proxy_set_header Connection "";          # disable upstream keepalive disabling
  proxy_buffering off;                      # critical for SSE
  proxy_cache off;
  chunked_transfer_encoding on;             # allow streaming chunks
  proxy_read_timeout 1h;                    # SSE may sit idle between events
  proxy_send_timeout 1h;
  add_header X-Accel-Buffering no always;   # belt-and-suspenders
}
```
Source: [Nginx SSE buffering fix](https://atlassc.net/2023/12/28/realtime-server-sent-events-held-back-by-nginx).

**Server-side header to set on all `text/event-stream` responses:**
```
X-Accel-Buffering: no
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

**Caddy:**
```
reverse_proxy /t/* upstream:3000 {
  flush_interval -1            # flush every chunk; required for SSE
  transport http {
    read_timeout 1h
    write_timeout 1h
  }
}
```
Source: [Caddy flush_interval discussion](https://caddy.community/t/server-sent-events-buffering-with-reverse-proxy/11722).

**Azure Front Door:** does not buffer SSE by default but enforces a 4-minute idle
timeout on the standard tier. Either send a `:keepalive\n\n` SSE comment every ~30s
from the server, or upgrade to AFD Premium (longer timeout) — same trick the
existing Azure Container Apps example sidesteps by being short-lived.

**Action item:** add a heartbeat ping on long-lived `GET /mcp` SSE streams so AFD,
Cloudflare, and corporate proxies don't drop us.

---

## 2) Multi-Tenant Azure AD Patterns

### The three models, explicitly

#### Model (a) — Multi-tenant single app registration + admin consent per tenant

Single Entra app registration with `signInAudience: AzureADMultipleOrgs` (or
`AzureADandPersonalMicrosoftAccount` for personal accounts too). Authority is
`/common` or `/organizations`. Each new tenant runs an admin-consent flow
(`prompt=consent`); once consented, a service principal exists in their tenant and
all their users can sign in.

- **Pros:** one app to operate; self-service onboarding; minimal config; matches
  how most SaaS-on-Microsoft works (e.g. Linear, Notion).
- **Cons:** all tenants share the same client ID, default scopes set, and
  redirect URIs — adding scopes triggers re-consent across **every** tenant; can't
  have per-tenant token lifetime policies; some regulated customers refuse to
  consent to a third-party app reg they don't own.
- **Token cache key:** `clientId + tenantId + userId` (per [MSAL distributed cache
  guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching)).

#### Model (b) — One app registration per tenant (config-driven)

Each tenant brings their own app registration (their own client ID, optional client
secret, their own redirect URIs) and we store that config keyed by tenant.

- **Pros:** tenant owns their app reg; can enforce conditional access policies on
  their own SP; per-tenant scope set; no shared blast radius on consent changes.
- **Cons:** onboarding is a manual customer task (create app reg → register with
  us); no self-service; client secret rotation is a multi-party operation; we hold
  N client secrets which expand our security surface.
- **Best for:** large enterprise customers with security/compliance requirements.

#### Model (c) — Hybrid: shared multi-tenant app + per-tenant overrides

Default to the shared multi-tenant app (model a) for self-service; allow customers
to upload their own app reg (model b) for their tenant when they need it. Tenant
config in Postgres has nullable `client_id` / `client_secret_ref`; resolver falls
back to shared values when null.

- **Pros:** best of both — quick onboarding for the long tail, escape hatch for
  the enterprise.
- **Cons:** two code paths to test (shared client, tenant client); admins must
  understand which mode they're in; per-tenant overrides need a UI/API to manage.

> **Recommendation: Model (c) — hybrid.** It costs ~20% more code and gives 100%
> of the customer addressable market. The code paths converge at the MSAL layer
> if we always read client config through a `resolveTenantClient(tenantId)` boundary.

### Per-tenant configuration storage

Comparison for a system with 10–10,000 tenants:

| Store | Hot reload | Audit | Encryption | Ops cost | Recommended |
|---|---|---|---|---|---|
| `.env` file | No (restart) | None | Filesystem perms | Lowest | Local dev only |
| Mounted YAML/JSON | Hard (file-watch) | None | Filesystem perms | Low | Single-instance only |
| K8s `ConfigMap` + `Secret` | Pod restart or sync | RBAC audit | Sealed/Encrypted | Medium | If already on K8s |
| Admin REST API + DB | Yes | Native | Per-row | Medium | **Recommended** |
| External Secrets Operator | Yes (sync interval) | Cloud-side | Backend-native | Medium | If multi-secret backend |

**Recommendation: Postgres for tenant config, Key Vault/secret manager for tenant
secrets** (referenced by name from the Postgres row). Reasons:
- Tenant config is structured (id, display name, app_reg fields, scope overrides,
  enabled tools, rate limits, audit fields). DB is the natural shape.
- Onboarding becomes a DB insert, exposable through an admin API later.
- A small Postgres adds ~$15/mo on Azure Flexible Server (B1ms); negligible vs
  the value.
- Secrets stay out of the DB row — Postgres holds `client_secret_ref:
  kv://my-vault/tenant-acme-secret`, server resolves on use.

Source: [Multitenant config patterns AWS Architecture Blog](https://aws.amazon.com/blogs/architecture/build-a-multi-tenant-configuration-system-with-tagged-storage-patterns/),
[Azure SaaS storage patterns](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data).

### Per-request tenant routing

Compared on three axes — discoverability for the OAuth client, isolation, and
operational burden:

| Strategy | OAuth metadata works? | Tenant isolation | Operational cost | Recommended |
|---|---|---|---|---|
| Subdomain `acme.mcp.example.com` | Yes — issuer per tenant | Strong (DNS-level) | Wildcard cert + DNS automation | Phase 2 |
| Header `X-Tenant-ID: acme` | No — `/.well-known/*` is path-based, can't vary by header in client logic | Weak — easy to forge if not paired with auth | Lowest | Reject |
| Path `/t/{tenantId}/mcp` | Yes — per-tenant `/t/{id}/.well-known/oauth-authorization-server` | Strong | Lowest | **Phase 1** |
| JWT `iss` claim | Yes after auth — but PKCE state needs tenant *before* auth | N/A pre-auth | None | Pair with path |
| OAuth issuer (RFC 9728) | This *is* path or subdomain in practice | — | — | Implementation detail |

**Recommendation: path-based for v2 (`/t/{tenantId}/mcp`).** It composes cleanly
with the existing `MS365_MCP_PUBLIC_URL` plumbing (just append `/t/{id}` to the
publicBase per request), it works without DNS work, and the OAuth metadata
documents (`/t/{id}/.well-known/oauth-authorization-server`) advertise the
correct tenant-scoped issuer. Subdomains can layer on later as nginx
`map $host $tenant_id` rewrites.

### Per-tenant token cache isolation

Per [MSAL Node caching guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching):

> "For multi-tenant daemon apps using client credentials grant, the partition key
> format is `<clientId>.<tenantId>`."

For our delegated-user case, the safe partition key is:

```
ms365-mcp:cache:{tenantId}:{clientId}:{userObjectId}:{scopeHash}
```

- `tenantId` first so `KEYS ms365-mcp:cache:{tenantId}:*` lets us purge a single
  tenant in O(N) without scanning all tenants.
- `clientId` second to handle hybrid model (a) vs (c) — same user under different
  app regs gets distinct tokens.
- `userObjectId` (Entra `oid` claim, NOT `upn`/email which can change).
- `scopeHash` last — different scope sets need different tokens; hashing keeps the
  key bounded.

Implement using MSAL Node's `ICachePlugin` interface with a Redis-backed
implementation (sample at [auth-code-distributed-cache](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/auth-code-distributed-cache/README.md)).

### Tenant onboarding flow

```
1. Admin clicks "Add Microsoft 365" in our admin console
2. Choose mode:
   (a) Self-service: redirect to /t/new/admin-consent which sends the admin to
       https://login.microsoftonline.com/common/adminconsent?client_id={SHARED}&...
       Microsoft redirects back to /t/new/admin-consent/callback with the
       admin's tenant_id; we INSERT tenants(id, mode='shared')
   (b) Bring-your-own: form for client_id, client_secret (optional), tenant_id;
       INSERT tenants(id, mode='byo', client_id, client_secret_ref)
3. Issue a tenant-scoped onboarding URL for the customer:
   https://mcp.example.com/t/{tenantId}/mcp
4. Customer adds that URL to their MCP client (Claude Desktop integrations panel,
   Cursor mcp.json, etc.)
5. First MCP request triggers OAuth flow against /t/{tenantId}/authorize, which
   resolves the tenant config and uses the right authority + client_id
```

Sources: [Configure admin consent workflow](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow),
[Convert app to multi-tenant](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant).

---

## 3) Docker / Production Patterns

### Current Dockerfile review (`Dockerfile`)

The existing file is 22 lines, multi-stage, runs as root, no healthcheck, no
labels, no `npm ci`, and uses three different Node versions (24 build, 20 runtime,
package.json `>=18`) — concern flagged in CONCERNS.md.

```dockerfile
# Recommended v2 Dockerfile (sketch)
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libsecret-dev   # for keytar/native
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run generate && npm run build

FROM node:${NODE_VERSION}-alpine AS release
WORKDIR /app

# Non-root user
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nodejs

COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts \
 && npm cache clean --force \
 && chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 3000

# tini for signal forwarding (PID 1 reaping)
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js", "--http", "3000"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

LABEL org.opencontainers.image.source="https://github.com/softeria/ms-365-mcp-server"
LABEL org.opencontainers.image.licenses="MIT"
```

Deltas from current:
- Single Node version (22, the LTS in April 2026), referenced via `ARG`.
- `npm ci` (deterministic) instead of `npm i`.
- BuildKit cache mount — npm install layer rebuilds from cache when only source
  changes.
- Non-root `nodejs` user (UID 1001).
- `tini` as PID 1 — fixes the "Express doesn't actually exit on SIGTERM in
  Alpine" footgun.
- `HEALTHCHECK` directive for Docker-native health.
- OCI labels for GHCR provenance.

Source: [Node.js multi-stage 2026 guide](https://oneuptime.com/blog/post/2026-01-06-nodejs-multi-stage-dockerfile/view),
[Docker container best practices 2026](https://jishulabs.com/blog/docker-container-best-practices-2026).

### Secret injection — pick one per platform

| Platform | Recommended | Why |
|---|---|---|
| Local dev | `.env` file (current) | Lowest friction |
| Docker Compose | Docker secrets via `secrets:` block | Mounted as files, not env |
| Azure Container Apps | ACA secret references | Built-in, no extra infra |
| Azure Kubernetes Service | Key Vault CSI driver | Bypasses etcd; rotation polling |
| Other K8s | External Secrets Operator (ESO) | Backend-agnostic; syncs to Secret |

**Why CSI driver over ESO on AKS:** The Azure Key Vault CSI driver mounts secrets
as **files** in `tmpfs` and bypasses etcd entirely. ESO syncs to a native
`Secret`, which is base64-encoded in etcd by default — fine if you have envelope
encryption on etcd, problematic if you don't. CSI is also more granular for
per-tenant secret rotation. Source: [AKS Secrets Store CSI Driver](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-driver),
[CSI vs ESO comparison](https://www.kubeblog.com/kubernetes/secrets-store-csi-driver-vs-external-secrets-operator/).

**Caveat:** CSI driver requires AKS-managed identity setup; ESO is more portable
across non-Azure clusters. Pick CSI if you're committed to AKS, ESO if you might
move.

### Health endpoints

Two endpoints, distinct concerns:

```typescript
// Liveness: process is alive and event loop responds
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

// Readiness: deep — can we serve real traffic?
app.get('/readyz', async (_req, res) => {
  const checks = await Promise.allSettled([
    redis.ping(),                                    // distributed cache
    fetch(`${cloudEndpoints.graphApi}/v1.0/$metadata?$top=1`, {
      method: 'HEAD', signal: AbortSignal.timeout(2000)
    }),                                              // Graph reachability
    secretsProvider.healthCheck(),                  // KV reachable (if used)
  ]);
  const failures = checks
    .filter((c) => c.status === 'rejected')
    .map((c, i) => ({ check: ['redis','graph','secrets'][i], reason: (c as PromiseRejectedResult).reason?.message }));
  if (failures.length > 0) {
    return res.status(503).json({ status: 'degraded', failures });
  }
  res.status(200).json({ status: 'ready' });
});
```

`/healthz` for liveness probes, `/readyz` for readiness probes. Critically:
- **Don't fail liveness on a transient Graph 5xx** — that triggers pod restarts
  and makes outages worse.
- **Do fail readiness** on Redis ping failure — without Redis, PKCE state is
  stale and OAuth flows will randomly fail.

Source: [Effective Docker healthchecks for Node.js](https://patrickleet.medium.com/effective-docker-healthchecks-for-node-js-b11577c3e595).

### Token cache persistence (the ephemeral container problem)

Current state: tokens go to `~/.ms-365-mcp-server/.token-cache.json` next to
the binary, with `keytar` fallback to OS keychain. Inside a container, the OS
keychain doesn't exist; the file goes to a writable layer that is wiped on every
pod restart and not shared between replicas.

**Recommendation: Redis with envelope encryption.**

- MSAL Node `ICachePlugin` writes serialized cache JSON.
- We wrap it in AES-256-GCM with a **per-tenant data encryption key** (DEK).
- DEKs are themselves wrapped with a **single key encryption key** (KEK) held in
  Azure Key Vault (or AWS KMS / GCP KMS).
- Redis stores `{ wrappedDek, ciphertext, iv, authTag, savedAt }`.
- `MS365_MCP_KEK_ID` env var points at the KEK; rotation = create new KEK, walk
  cache rewrapping under new KEK on read.

This gives:
- Survival across pod restarts.
- Tenant-level key destruction (delete DEK = cryptoshred their tokens).
- No plaintext refresh tokens at rest in Redis.

Source: [Redis OAuth token caching](https://oneuptime.com/blog/post/2026-01-21-redis-oauth-token-caching/view),
[MSAL distributed cache sample](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/auth-code-distributed-cache/README.md).

### Structured JSON logging with correlation IDs

Current logger is Winston with line-formatted file output. PII leaks documented
in CONCERNS.md (full URLs with base64 IDs, request bodies on errors, etc.).

```typescript
// Use winston with json format + AsyncLocalStorage for request-scoped fields
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()                     // structured for log aggregators
  ),
  defaultMeta: { service: 'ms-365-mcp-server' },
  transports: [
    new winston.transports.Console(),         // stderr in container
  ],
});

// Per-request fields stored in AsyncLocalStorage (we already have one)
// Add: requestId, tenantId, userId (oid), tool — never accessToken/refreshToken/body
```

PII rules (apply via a `redactor` log helper):
- Never log: `accessToken`, `refreshToken`, request `body` (other than `grant_type`),
  full Graph URLs (truncate after `/me/messages`).
- Always log: `requestId`, `tenantId`, `userOid` (last 4 chars), `tool`, latency,
  HTTP status.
- Demote URL+body logs to `debug` (currently `info`).

### Observability — OpenTelemetry + Prometheus

```typescript
// instrumentation.ts — preloaded via NODE_OPTIONS=--require ./instrumentation.js
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const prom = new PrometheusExporter({ port: 9464, endpoint: '/metrics' });

new NodeSDK({
  serviceName: 'ms-365-mcp-server',
  traceExporter: new OTLPTraceExporter(),         // OTLP to collector
  metricReader: prom,                              // /metrics scrape
  instrumentations: [getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },  // noisy
  })],
}).start();
```

Custom metrics worth tracking:
- `mcp_tool_calls_total{tenant,tool,status}` — counter
- `mcp_tool_duration_seconds{tenant,tool}` — histogram
- `mcp_oauth_pkce_store_size` — gauge (alarm > 800/1000)
- `mcp_graph_throttled_total{tenant}` — counter (Graph 429s)
- `mcp_token_cache_hit_ratio{tenant}` — gauge
- `mcp_active_streams{tenant}` — gauge (open SSE responses)

Source: [Custom metrics in Node.js with OpenTelemetry + Prometheus](https://medium.com/google-cloud/custom-metrics-in-node-js-with-opentelemetry-and-prometheus-c10c8c0204d3),
[Instrument MCP servers with OpenTelemetry](https://oneuptime.com/blog/post/2026-03-26-how-to-instrument-mcp-servers-with-opentelemetry/view).

### Reverse proxy / TLS termination

| Choice | Pros | Cons | Pick when |
|---|---|---|---|
| Caddy | Auto-TLS via Let's Encrypt; simple `Caddyfile`; SSE-friendly with `flush_interval -1` | Single binary; less ecosystem | Self-hosted, small ops team |
| Traefik | K8s-native via IngressRoute CRDs; dashboards | YAML-heavy | Already on Traefik |
| nginx | Battle-tested; easy to find ops people | Manual TLS; SSE config gotchas | Existing nginx shop |
| Azure Front Door | Global anycast; WAF; managed | Per-route timeout; no MCP-specific tuning | Enterprise customers, multi-region |
| Cloudflare | Same as AFD; cheaper | Strict idle timeouts on free tier | Public OSS deployments |

**Recommendation: Caddy for self-hosted reference deployment, Azure Front Door
in the Azure Container Apps example.** Both already work for SSE with the
buffering tweaks listed in §1.

### Horizontal scaling — what breaks today

PKCE store and MSAL token cache are in-process Maps. Two replicas behind a
round-robin LB will silently lose 50% of OAuth flows and 50% of token cache hits.

**Two paths:**

1. **Externalize state** (recommended): Redis for both, as described. Stateless
   replicas scale linearly.
2. **Sticky sessions**: route by client IP or `Mcp-Session-Id`. Works for the MCP
   path but breaks `/authorize` → `/token` (different IPs possible across the
   browser redirect). Reject unless we adopt session-mode MCP.

### Graceful shutdown

Required because:
- Kubernetes sends `SIGTERM` and gives 30s before `SIGKILL`.
- Long SSE streams must drain or be closed cleanly so clients can reconnect.
- Pending OAuth flows must finish (or fail loudly).

```typescript
// shutdown.ts
let shuttingDown = false;
const sockets = new Set<Socket>();

server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown.initiated', { signal });

  // 1. Fail readiness (LB stops sending us new traffic)
  app.locals.ready = false;

  // 2. Wait for LB to remove us (preStop hook gives us this)
  await sleep(5000);

  // 3. Stop accepting new connections; existing requests can finish
  server.close((err) => {
    if (err) logger.error('shutdown.server.close.error', { err });
    process.exit(err ? 1 : 0);
  });

  // 4. Force-close idle sockets after 25s (5s buffer before SIGKILL)
  setTimeout(() => {
    logger.warn('shutdown.force.close', { sockets: sockets.size });
    sockets.forEach((s) => s.destroy());
  }, 25_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

K8s manifest:
```yaml
spec:
  terminationGracePeriodSeconds: 30
  containers:
  - name: mcp
    lifecycle:
      preStop:
        exec:
          command: ["sleep", "5"]   # let endpoints update before SIGTERM
```

Source: [Node.js graceful shutdown right way](https://dev.to/axiom_agent_1dc642fa83651/nodejs-graceful-shutdown-the-right-way-sigterm-connection-draining-and-kubernetes-fp8),
[K8s + Node health checks done right](https://dev.to/builtbyali/kubernetes-nodejs-health-checks-and-graceful-shutdown-done-right-5h4n).

---

## 4) Per-Tenant Token Storage — Decision Matrix

| Backend | Latency | Ops cost | Survives restart | Multi-instance | Encryption | TTL native | Audit |
|---|---|---|---|---|---|---|---|
| File volume (PVC) | <1ms | Low | Yes | **No** (RWO) | Filesystem perms | No | None |
| Redis (with envelope encryption) | 1–5ms | Medium | Yes (AOF/RDB) | Yes | App-side AES-GCM | **Yes** | Via Redis ACL log |
| Azure Key Vault (per-secret) | 50–200ms | Low (managed) | Yes | Yes | At-rest (HSM-backed) | Per-secret expiry | Native, comprehensive |
| Postgres / Cosmos | 5–20ms | Medium | Yes | Yes | At-rest + column-level option | No (need cron) | Via row-level | 

**Recommendation: Redis with app-side envelope encryption.**

- Latency matters: every Graph tool call may need a token cache lookup. 1–5ms
  Redis vs 50–200ms Key Vault is the difference between snappy and laggy MCP.
- Token TTLs match Redis TTLs — refresh tokens get auto-evicted on expiry.
- Envelope encryption (DEK in Redis, KEK in Key Vault/KMS) gives Key Vault's
  audit trail for the *key*, while keeping the *data* fast.
- Azure Cache for Redis (Basic C0) is ~$15/mo; AWS ElastiCache t4g.micro is ~$13/mo.

**Postgres for tenant config + audit log only.** Tokens stay in Redis; long-lived
config (tenant rows, app reg overrides, scope policies, audit trail of
"tenant X granted scope Y at time Z") goes in Postgres.

**Key Vault for KEK + tenant-supplied client secrets.** Never for hot-path tokens.

---

## Reference Architecture Diagram

```
                                ┌────────────────────────┐
                                │  MCP client            │
                                │  (Claude Desktop /     │
                                │   Cursor / Continue)   │
                                └──────────┬─────────────┘
                                           │
                                       HTTPS
                                           │
                          ┌────────────────▼────────────────┐
                          │  Edge / TLS termination         │
                          │  (Azure Front Door,             │
                          │   Caddy, or nginx)              │
                          │  - WAF / rate limit             │
                          │  - SSE: proxy_buffering off,    │
                          │    flush_interval -1            │
                          │  - X-Accel-Buffering: no        │
                          └────────────────┬────────────────┘
                                           │
                  ┌────────────────────────┼────────────────────────┐
                  │                        │                        │
            ┌─────▼──────┐          ┌──────▼─────┐          ┌──────▼─────┐
            │  Replica 1 │          │  Replica 2 │  ...     │  Replica N │
            │ ms-365-mcp │          │ ms-365-mcp │          │ ms-365-mcp │
            │ stateless  │          │ stateless  │          │ stateless  │
            │ Node 22    │          │            │          │            │
            └──┬──┬──┬───┘          └──┬──┬──┬───┘          └──┬──┬──┬───┘
               │  │  │                 │  │  │                 │  │  │
               │  │  └─────────────────┴──┴──┴─── /metrics ────┴──┴──┘
               │  │                          │                       │
               │  │                          ▼                       ▼
               │  │            ┌──────────────────────┐  ┌────────────────────┐
               │  │            │  Prometheus / OTel   │  │  Loki / DataDog /  │
               │  │            │  Collector           │  │  Application       │
               │  │            └──────────────────────┘  │  Insights (logs)   │
               │  │                                       └────────────────────┘
               │  │
               │  └──────────── shared state ─────────────────────────────────────┐
               │                                                                  │
               ▼                                                                  ▼
   ┌────────────────────────┐                                        ┌────────────────────┐
   │  Postgres              │                                        │  Redis             │
   │  - tenants(id,         │                                        │  - PKCE store      │
   │    mode, client_id,    │                                        │    (state → verifier)│
   │    secret_ref, ...)    │                                        │  - MSAL token cache│
   │  - audit_log           │                                        │    (envelope-encrypted)│
   │  - admin sessions      │                                        │  - rate-limit counters │
   └────────────────────────┘                                        │  - idempotency keys │
                                                                     └─────────┬──────────┘
                                                                               │
                            ┌──────────────────────────────────────────────────┤
                            │                                                  │
                            ▼                                                  ▼
            ┌──────────────────────────────┐               ┌──────────────────────────────┐
            │  Azure Key Vault             │               │  Microsoft Graph / Entra ID  │
            │  - KEK for envelope encrypt  │               │  - graph.microsoft.com       │
            │  - tenant client secrets     │               │  - login.microsoftonline.com │
            │    (BYO mode)                │               │    /{tenantId}/oauth2/v2.0   │
            │  - shared client secret      │               │  - per-tenant authority      │
            └──────────────────────────────┘               └──────────────────────────────┘

Tenant routing (per HTTP request):
  https://mcp.example.com/t/{tenantId}/mcp
  https://mcp.example.com/t/{tenantId}/.well-known/oauth-authorization-server
  https://mcp.example.com/t/{tenantId}/authorize
  https://mcp.example.com/t/{tenantId}/token

Inside the request:
  middleware: parseTenant(req.params.tenantId)
            → loadTenantConfig(tenantId) ← Postgres (cached LRU 1m)
            → resolveClientCreds(tenantConfig) ← KV if BYO, else shared
            → asyncLocalStorage.run({ tenantId, clientConfig }, handler)
            → all downstream MSAL/Graph calls see tenant via getCurrentTenant()
```

---

## Migration Path: current → target

Each step is independently shippable behind a feature flag and avoids breaking the
single-tenant stdio code path that today's users depend on.

### Phase 0 — Foundation (no behavior change)
1. Bump Node engines to `>=22`; align Dockerfile, CI matrix, README. Drops Node
   18 polyfill (CONCERNS.md §"Node.js engines").
2. Switch logger to JSON format; add `requestId` + `tenantId` (default `null`)
   to `defaultMeta`. Demote URL/body logs to `debug` (CONCERNS.md §"Verbose mode
   logs every Graph URL").
3. Externalize `LRU<endpointConfigByName>` cache (CONCERNS.md
   §"endpointsData.find lookup per tool") and memoize `buildScopesFromEndpoints`.
4. Harden Dockerfile: non-root user, `tini`, `HEALTHCHECK`, `npm ci`, single
   Node version, BuildKit cache mounts.

### Phase 1 — Production-grade single-tenant HTTP
5. Add `/healthz` (liveness, always 200) + `/readyz` (deep checks).
6. Add OpenTelemetry SDK, `/metrics` (Prometheus), define core metrics.
7. Implement graceful shutdown with `SIGTERM` handler, readiness flip, socket
   drain, force-close at 25s.
8. Add `Origin` header validation per MCP spec security warning (DNS rebinding).
9. Add `express-rate-limit` to `/authorize`, `/token`, `/register` (CONCERNS.md
   §"client_secret flows through req.body").
10. Validate `redirect_uris` on `/register` against allowlist; collision-safe
    `client_id` generation (CONCERNS.md §"Generated `mcp-client-${Date.now()}`").
11. Stop logging request bodies on 4xx (CONCERNS.md §"Token endpoint logs body
    on missing grant_type", §"Client registration request").
12. Add SSE heartbeat (`:keepalive\n\n` every 25s) on `GET /mcp` to survive
    proxy idle timeouts.

### Phase 2 — Externalize state (still single-tenant, but multi-replica capable)
13. Introduce `RedisClient` wrapper in `src/lib/redis.ts`. Optional dependency;
    falls back to in-memory Map for stdio mode.
14. Move PKCE store from `pkceStore: Map` to `RedisPkceStore`. Index by
    `clientCodeChallenge` (CONCERNS.md §"Linear-scan PKCE store"), key prefix
    `mcp:pkce:`, TTL 10m. Single GET on `/token` instead of full scan.
15. Implement `ICachePlugin` for MSAL Node backed by Redis with envelope
    encryption (KEK in Key Vault). Switch `AuthManager` to use it when
    `MS365_MCP_REDIS_URL` is set.
16. Now safely scale to N replicas; document in `docs/deployment.md`.

### Phase 3 — Multi-tenant routing
17. Introduce `tenants` table (Postgres) with `id`, `mode`, `client_id`,
    `client_secret_ref`, `tenant_id` (Microsoft tenant), `cloud_type`, `created_at`,
    `enabled_tools`, `read_only`, `org_mode`. Migration tooling in `bin/`.
18. Add path-routed Express router: `/t/:tenantId/...` → `loadTenant` middleware
    populates `req.tenant` and `requestContext`.
19. Refactor OAuth metadata handlers to read tenant config and emit per-tenant
    `issuer`, `authorization_endpoint`, etc.
20. Refactor `MicrosoftOAuthProvider` to be tenant-aware (constructor takes
    `tenantConfig`, not global secrets).
21. Refactor `AuthManager.create()` → `AuthManager.forTenant(tenantConfig)` so
    each MSAL `PublicClientApplication` is per-tenant. Cache instances LRU.
22. Token cache key composition: `mcp:cache:{tenantId}:{clientId}:{userOid}:{scopeHash}`.
23. Add admin REST API: `POST /admin/tenants` (create), `GET /admin/tenants/:id`
    (read), `PATCH /admin/tenants/:id` (update), `DELETE /admin/tenants/:id`
    (delete + cryptoshred Redis cache prefix). Gate with admin token.
24. Self-service onboarding: `/admin/onboard` redirects to Microsoft admin consent
    for the shared multi-tenant app, callback creates the `tenants` row.

### Phase 4 — Operational polish
25. Token introspection cache: cache `/me` validation results in Redis
    (TTL 5m) to short-circuit arbitrary-bearer-string forwarding (CONCERNS.md
    §"Bearer token middleware accepts any string").
26. Graph 429 backoff: respect `Retry-After`, exponential backoff, surface
    `mcp_graph_throttled_total{tenant}` metric (CONCERNS.md §"No 429/throttling
    handling").
27. Per-tenant rate limiting backed by Redis (sliding window).
28. Audit log: append-only `audit_log` table — every OAuth flow, every admin
    action, every tenant config change.
29. Reference deployments: update `examples/azure-container-apps/main.bicep` to
    multi-tenant shape; add `examples/aks/` with Helm chart, CSI driver wiring.
30. Migration guide for current single-tenant users → "tenant zero" of v2 using
    the same client ID.

### Phase 5 — Stretch
31. Subdomain routing as nginx `map $host $tenant_id` rewrite — reuses Phase 3.
32. Per-tenant scope override UI (drop work-account scopes for personal-only
    tenants etc.).
33. `MS365_MCP_OAUTH_TOKEN` env-shortcut path retired (was for stdio; now
    obsolete in HTTP mode).

---

## Open Questions (need user input before finalizing)

1. **Self-service vs invite-only?** Phase 3 step 24 assumes self-service admin
   consent works for the shared multi-tenant app. If the operator wants to
   review every new tenant first, we need an admin approval queue.

2. **Multi-region?** Single-region (Azure Container Apps in one region) is the
   simplest. Multi-region needs either: (a) Redis replication (Azure Cache
   geo-replication) + Postgres read replicas, or (b) per-region tenant homing.
   Are there latency/data-residency requirements?

3. **Brand-your-own-domain per tenant?** Some enterprise customers want
   `mcp.acme.com` instead of `mcp.example.com/t/acme`. This is a Phase 5 add-on
   (TLS SAN management + tenant-by-host routing). Worth scoping now?

4. **Confidential vs public client per tenant?** Phase 3 stores
   `client_secret_ref`, but for shared-app mode we currently use a public client
   (no secret). Do we plan to require confidential for BYO mode? Some MS docs
   recommend it for multi-tenant SaaS.

5. **Postgres requirement.** Current server has zero database dependency.
   Adding Postgres is a meaningful operational shift. Alternatives: (a) Cosmos
   DB (Azure-native, expensive), (b) tenant config in Redis (loses queryability
   and easy backups), (c) flat-file YAML mounted into pod (no hot reload). Is
   the team OK adding Postgres?

6. **Session-mode MCP?** Spec allows server-assigned `Mcp-Session-Id`. Today we
   are stateless. Adopting sessions enables server-initiated notifications
   (e.g., subscriptions) but couples replicas to sessions (or needs
   session-affinity in the LB). Is there a product feature that needs this in
   v2, or do we stay stateless?

7. **MCP transport scope.** I am recommending Streamable HTTP only and dropping
   the legacy SSE framing in the brief. If there are known clients still using
   `/sse` + `/messages` in our user base, the cost is roughly +1 Express route
   pair + a 200-line SSE shim. Worth gathering data: do logs of the current
   server show legacy SSE usage?

8. **Org-mode vs personal-account scopes per tenant.** Today `--org-mode` is a
   process-wide flag. In multi-tenant, this becomes per-tenant config. Should
   the default for new tenants be org-mode (work accounts) or personal (consumer)?
   Mixed?

9. **Backwards compat for stdio users.** Plan keeps stdio working unchanged
   throughout — but the npm package size grows (Postgres driver, Redis client,
   OTel SDK). Is that acceptable, or do we want optional peer deps?

10. **Cloud sovereignty.** China cloud (`microsoftgraph.chinacloudapi.cn`) is
    already supported via `cloud_type`. Will tenant rows carry their own
    `cloud_type`? (Implied yes by the schema sketch — confirm.)

---

## Source list

**MCP spec & ecosystem:**
- [MCP spec 2025-06-18 — Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [Keboola — SSE deprecation notice (April 1, 2026 cutoff)](https://changelog.keboola.com/deprecation-of-sse-transport-in-mcp-server-upgrade-to-streamable-http/)
- [MCP server handbook April 2026 (Apify)](https://use-apify.com/blog/mcp-server-handbook-2026)
- [Stacklok client compatibility matrix](https://docs.stacklok.com/toolhive/reference/client-compatibility)
- [Cursor forum — Streamable HTTP support](https://forum.cursor.com/t/mcp-streamable-http-support/96770)

**Microsoft Entra / Azure AD:**
- [Convert single-tenant app to multitenant](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant)
- [Multitenant SaaS solution architecture (Azure Architecture Center)](https://learn.microsoft.com/en-us/azure/architecture/example-scenario/multi-saas/multitenant-saas)
- [Multitenant storage and data approaches](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data)
- [MSAL Node — Token caching](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching)
- [MSAL Node — auth-code-distributed-cache sample](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/samples/msal-node-samples/auth-code-distributed-cache/README.md)
- [Configure admin consent workflow](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow)
- [Tenancy models for multitenant solutions](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models)
- [Multi-tenant configuration storage patterns (AWS Architecture Blog)](https://aws.amazon.com/blogs/architecture/build-a-multi-tenant-configuration-system-with-tagged-storage-patterns/)

**Docker & K8s production patterns:**
- [Node.js multi-stage Dockerfile (2026)](https://oneuptime.com/blog/post/2026-01-06-nodejs-multi-stage-dockerfile/view)
- [Docker container best practices 2026](https://jishulabs.com/blog/docker-container-best-practices-2026)
- [Effective Docker healthchecks for Node.js](https://patrickleet.medium.com/effective-docker-healthchecks-for-node-js-b11577c3e595)
- [AKS — Azure Key Vault provider for Secrets Store CSI Driver](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-driver)
- [CSI Driver vs External Secrets Operator (KubeBlog)](https://www.kubeblog.com/kubernetes/secrets-store-csi-driver-vs-external-secrets-operator/)
- [Node.js graceful shutdown the right way](https://dev.to/axiom_agent_1dc642fa83651/nodejs-graceful-shutdown-the-right-way-sigterm-connection-draining-and-kubernetes-fp8)
- [K8s + Node health checks done right](https://dev.to/builtbyali/kubernetes-nodejs-health-checks-and-graceful-shutdown-done-right-5h4n)

**Reverse proxy SSE handling:**
- [Solving SSE cache problems with Nginx](https://atlassc.net/2023/12/28/realtime-server-sent-events-held-back-by-nginx)
- [Caddy SSE buffering with reverse_proxy](https://caddy.community/t/server-sent-events-buffering-with-reverse-proxy/11722)
- [Caddy flush_interval issue thread](https://github.com/caddyserver/caddy/issues/4247)

**Observability:**
- [OpenTelemetry Node.js getting started](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
- [Custom metrics in Node.js with OpenTelemetry + Prometheus](https://medium.com/google-cloud/custom-metrics-in-node-js-with-opentelemetry-and-prometheus-c10c8c0204d3)
- [Instrument MCP servers with OpenTelemetry](https://oneuptime.com/blog/post/2026-03-26-how-to-instrument-mcp-servers-with-opentelemetry/view)
- [Node.js observability stack 2026](https://dev.to/axiom_agent/the-nodejs-observability-stack-in-2026-opentelemetry-prometheus-and-distributed-tracing-229b)

**Token storage:**
- [Redis OAuth token caching](https://oneuptime.com/blog/post/2026-01-21-redis-oauth-token-caching/view)
- [Redis authentication token storage](https://redis.io/solutions/authentication-token-storage/)

---

*Architecture research: 2026-04-18*
