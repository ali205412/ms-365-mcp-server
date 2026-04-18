# ms-365-mcp-server v2 — Enterprise Multi-Tenant Microsoft 365 MCP Gateway

## What This Is

An enterprise-grade Model Context Protocol server that gives AI assistants full, governed access to Microsoft 365 (Graph API) across multiple Azure AD tenants from a single Docker Compose deployment. It is the v2 major rewrite of `ms-365-mcp-server`: same project identity, fundamentally new runtime — Dockerized, multi-tenant, production-hardened, and aimed at organizations that want to register many orgs / app registrations against one MCP gateway and expose a curated set of Graph tools to their AI clients (Claude Desktop, Claude Code, Cursor, Continue, and bespoke integrations).

## Core Value

**One deployable, multi-tenant MCP gateway that exposes the entire Microsoft Graph surface an organization needs — with tenant isolation, resilient Graph transport, and all four identity flows — so AI assistants can safely act on behalf of any user or app across any registered tenant.**

If everything else fails, this must hold: a correctly-authenticated request against any registered tenant must reach Graph with full retry/throttle/batch/pagination/error semantics, never leak a token across tenant boundaries, and return a typed, normalized response.

## Requirements

### Validated

<!-- Inherited from v1 — already shipped, in production, relied upon. These remain true through v2 unless explicitly moved to Out of Scope. -->

- ✓ MCP server exposes Microsoft Graph as a flat catalog of tools (212 today) — v1 baseline
- ✓ stdio transport for local/desktop MCP clients — v1 baseline
- ✓ OAuth PKCE proxy implementation (authorization_code + refresh_token) — v1 baseline
- ✓ Device-code auth flow for CLI use cases — v1 baseline
- ✓ Interactive browser auth flow (localhost:3000 redirect) — v1 baseline
- ✓ MSAL-backed token acquisition with keytar + file cache fallback — v1 baseline
- ✓ `--org-mode` work-account support (single tenant) — v1 baseline
- ✓ `--read-only` mode for safe browsing — v1 baseline
- ✓ `--enabled-tools` / preset filtering for tool surface control — v1 baseline
- ✓ Generated Zod client from trimmed OpenAPI spec — v1 baseline
- ✓ Per-request AsyncLocalStorage isolation in HTTP mode — v1 baseline
- ✓ Docker multi-stage build + semantic-release CI — v1 baseline

### Active

<!-- v2 scope. Hypotheses until shipped and validated. -->

**Transport**
- [ ] Streamable HTTP transport (current MCP spec) at `/t/{tenantId}/mcp`
- [ ] Legacy HTTP+SSE transport shim at `/t/{tenantId}/sse` + `/t/{tenantId}/messages` for backwards compatibility
- [ ] stdio transport preserved (single-tenant mode for CLI)
- [ ] Tenant routing via URL path segment `/t/{tenantId}/...`

**Multi-Tenancy**
- [ ] Per-tenant Azure AD app-registration configuration (runtime onboarding, not config file)
- [ ] Admin REST API for tenant onboarding (create, list, update, disable, rotate secrets)
- [ ] Admin API secured by dual auth: Entra OAuth (admin app reg + group check) AND rotatable API keys
- [ ] Per-tenant token cache isolation — cache key = `{tenantId}:{clientId}:{userOid|appOnly}:{scopeHash}`
- [ ] Per-tenant MSAL instance pool (tenant-keyed `AuthManager` resolver)
- [ ] Tenant config persisted in Postgres; hot state (PKCE, token cache TTLs, rate-limit counters) in Redis
- [ ] Per-tenant enabled-tools selection stored in DB — overrides default preset at tenant onboarding

**Identity Flows (all four supported concurrently)**
- [ ] Delegated OAuth (authorization code + PKCE) — per-user tokens via tenant's Entra
- [ ] App-only client credentials — service-principal tokens with admin-consented app permissions
- [ ] Bearer pass-through — caller supplies access token in Authorization header; forwarded as-is
- [ ] Device code — retained for stdio/CLI use

**Graph Coverage — All v1.0 + Selected Beta**
- [ ] Regenerate client against the full Graph v1.0 OpenAPI spec (~5,021 operations)
- [ ] Curated beta endpoints whitelist (subscriptions, Copilot, Security, Compliance, selected Intune)
- [ ] Default tool preset ships ~150 "essentials" covering Mail, Calendar, Files/OneDrive, Teams, Users, Groups, SharePoint Sites, Planner, ToDo
- [ ] Per-tenant admin can expand tool exposure by workload or individual operation
- [ ] HIGH-priority coverage targets (v2.0 milestone): Mail, Calendar, Files/OneDrive, Teams, Users, Groups, SharePoint Sites, Identity & Access, Planner/ToDo, Search, Subscriptions

**Transport-Layer Hardening (Kiota-pattern middleware pipeline on top of our generator)**
- [ ] RetryHandler: 429 with `Retry-After` parsing + exponential backoff with full jitter
- [ ] RetryHandler: transient 5xx (408/500/502/503/504) with bounded attempts
- [ ] BatchClient: `$batch` coalescing (up to 20 sub-requests, `dependsOn` chains)
- [ ] PageIterator: async generator pattern; no silent truncation; caller-controllable `maxPages`
- [ ] UploadSession: resumable large-file uploads (320 KiB chunks, resume on `nextExpectedRanges`)
- [ ] ETag plumbing: `If-Match` / `If-None-Match` propagation for optimistic concurrency
- [ ] Typed Graph error normalization: `ODataError` with `code`, `message`, `requestId`, `clientRequestId` surfaced in MCP `_meta`
- [ ] Delta query helper + per-tenant delta-token persistence

**Change Notifications**
- [ ] `/t/{tenantId}/notifications` webhook receiver with validation-token handshake
- [ ] HMAC validation of notification payloads
- [ ] Subscription lifecycle helpers (create, renew, delete) per tenant

**Production Hardening**
- [ ] Structured JSON logging with correlation IDs; PII redaction in default `info` log level
- [ ] `/healthz` liveness + `/readyz` readiness endpoints (Postgres + Redis + token-cache health)
- [ ] OpenTelemetry traces + metrics; Prometheus `/metrics` endpoint
- [ ] Per-tenant rate limiting (request count + Graph budget)
- [ ] Graceful shutdown (drain in-flight, flush logs, close DB pools)
- [ ] Audit log table: tenant actions, admin-API calls, Graph errors with requestId
- [ ] Token encryption at rest: AES-GCM envelope encryption; KEK from env/KeyVault-style injection
- [ ] Dockerfile hardening: non-root user, read-only root FS, pinned Node 22 LTS base
- [ ] Docker Compose reference stack: MCP + Postgres + Redis, optional reverse proxy

**Security**
- [ ] Validated `redirect_uris` on dynamic client registration (no `javascript:`, allowlist schemes)
- [ ] PKCE store externalized to Redis (no more in-process O(N) scan; survives multi-replica if later scaled)
- [ ] CORS policy driven by per-tenant allowed origins
- [ ] Refresh tokens removed from custom headers; moved to cookie or opaque server-side session
- [ ] No `grant_type` body logging (fixes CONCERNS.md "Token endpoint logs body on missing grant_type")

### Out of Scope

- **Kubernetes / AKS / Helm chart** — deployment target is Docker Compose single VM; K8s can layer on later without code changes but is not an active requirement
- **Azure Container Apps / Azure App Service native integration** — portable Docker is the contract; cloud-specific niceties deferred
- **Wrapping the official `@microsoft/msgraph-sdk` fluent client** — wrong shape for MCP's flat tool catalog; SDK audit confirms we stay on `openapi-zod-client` + add Kiota-style runtime middleware
- **Backwards compatibility with v1 config** — v2 is a major rewrite; v1 users migrate explicitly via a documented cutover path
- **Multi-region / horizontal scale-out** — single-VM deploy only in v2.0; code should not preclude it (Redis-backed PKCE, stateless workers) but no testing / Helm / autoscaler investment
- **Built-in Let's Encrypt / TLS termination** — users supply reverse proxy (Caddy/Traefik/Nginx) or run behind cloud TLS
- **End-user admin UI (web frontend)** — admin is REST-API-only in v2.0; a management UI can come later
- **Intune device management tools (0/749 today)** — LOW coverage priority for v2.0; out of initial tool preset
- **Excel Workbook operations (0/583)** — LOW; defer unless explicit tenant demand
- **Education, Bookings, Partner Billing, Backup Storage workloads** — LOW priority workloads; excluded from initial scope
- **`@microsoft/kiota-*` full runtime adoption** — we borrow patterns (RetryHandler, BatchRequestContent, LargeFileUploadTask, PageIterator) but implement them inside our generator pipeline; no dependency on Kiota runtime packages
- **Custom management dashboard / Grafana preset** — `/metrics` and structured logs are the contract; visualization is operator-owned

## Context

**Upstream ecosystem (audited 2026-04-18):**
- Microsoft Graph v1.0 exposes 5,021 unique operations across 40+ workloads (beta: 8,926 additional). We currently surface 172 of v1.0 = 3.4% coverage. HIGH-priority business workloads are barely covered: Identity & Access 0/809, Calendars 43/503, Teams 49/456, Mail 34/333, Users 41/303, Files 14/273, Groups 13/196, SharePoint Sites 7/166.
- Official Microsoft Graph TypeScript SDK (`microsoftgraph/msgraph-sdk-typescript`) is a Kiota-generated Lerna monorepo. It is a thin facade; the production-hardening behavior (auth, retry, throttle, batch, pagination, upload sessions, typed errors) lives in `@microsoft/kiota-*` and `@microsoft/msgraph-sdk-core`. These patterns are the blueprint for v2's middleware pipeline. Full gap analysis: `.planning/research/GAP-SDK-PATTERNS.md`. Coverage gap analysis: `.planning/research/GAP-GRAPH-API.md`. Architecture research: `.planning/research/ARCHITECTURE-MULTI-TENANT-SSE.md`.

**Current codebase state (mapped 2026-04-18 at commit 888786f):**
- TypeScript 5.8.3 ESM, Node 18+, MCP SDK 1.29.0, MSAL 3.8.0, Express 5.2.1, Vitest 3.x
- 8 architectural layers (Entry/CLI → Transport → Auth → Graph Client → Generated Client → Cross-Cutting)
- Excellent happy-path test coverage; ZERO coverage on the 654-line OAuth surface (PKCE concurrency, eviction, dynamic-client-registration, `.well-known/*`)
- Known fragile areas: `src/generated/hack.ts` Zodios shim, three-form name resolution, dual-storage `pickNewest`, `fetchAllPages` mutation
- Full documentation suite at `.planning/codebase/` (STACK, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, INTEGRATIONS, CONCERNS — 1,861 lines)

**Known risks from v1 to address in v2 (from `.planning/codebase/CONCERNS.md`):**
- MSAL singleton hard-bound to one `tenantId` at construction — **blocks multi-tenant** without rewrite (CRITICAL)
- No 429 / Retry-After handling — cascade failure under multi-user load (CRITICAL)
- No transient 5xx retry — AAD service blips fail tools (CRITICAL)
- In-memory PKCE store with O(N) linear scan + SHA-256 per entry on every `/token` — doesn't scale, doesn't survive restart
- `mcp-client-${Date.now()}` client-ID collision under concurrent registration
- Dynamic registration accepts arbitrary `redirect_uris` without validation — OAuth attack surface
- Refresh tokens ride in custom cleartext header `x-microsoft-refresh-token`
- Default `info` logs emit full Graph URLs, request bodies, and `Prefer`/`Content-Type` headers — PII leakage
- Pagination silently truncates at 10,000 items; `@odata.nextLink` deleted from merged response
- Express body-parser 100 KB default — compounds with missing resumable uploads
- `keytar` is archived / unmaintained — replacement path needed (`@node-rs/keyring` or server-side-only token store)
- Node 18 EOL passed April 2025 — upgrade to Node 22 LTS baseline

**Organizational intent:**
The user's organization needs a single deployable that can serve multiple customer/partner/sibling-organization Azure AD tenants, with each tenant registered dynamically (not baked into config at build time). The MCP server is the AI-facing edge of a Microsoft-365-centric toolchain: delegated-user AI assistants for employees, app-only automation for internal services, bearer-passthrough for chained services, and device-code for operator CLI access — all four flows must coexist.

## Constraints

- **Tech stack**: TypeScript ESM, Node 22 LTS, keep `@modelcontextprotocol/sdk` + `@azure/msal-node` + `express` — v1 stack extended, not replaced. Add Postgres (official `pg` or `postgres` client) and Redis (`ioredis`). — Continuity, ecosystem fit, and SDK-audit recommendation to retain `openapi-zod-client` generator.
- **Deployment**: Docker Compose on a single VM is the reference target. Must work without Kubernetes / Azure-native services. — User's operational constraint; aligned with "build for portability".
- **Transports**: Must expose all three concurrently (legacy HTTP+SSE, Streamable HTTP, stdio). — Maximum MCP-client compatibility through the transition window; users can drop legacy SSE when their clients catch up.
- **Identity**: All four auth flows (delegated OAuth, app-only client credentials, bearer pass-through, device code) must be supported concurrently and correctly isolated. — Organizational requirement; each covers a use case the others do not.
- **Admin API**: Dual-secured — Entra OAuth (admin app reg + group check) AND rotatable API keys. — Humans use OAuth, automation uses API keys; both must be first-class.
- **Tenancy model**: Runtime onboarding (REST API), persisted in Postgres. No restart to add a tenant. — User's operational preference; enables self-service onboarding flow.
- **Per-tenant isolation**: Token cache, PKCE state, rate limit, audit log all keyed by tenantId. Cross-tenant leak = bug. — Security foundation for multi-tenant deployment.
- **Coverage scope**: All Graph v1.0 + curated beta operations in the generated catalog. — User's "fully featured for my organization" requirement; beta curation prevents preview-API churn from destabilizing tenants.
- **Tool surface control**: Per-tenant enabled-tools selection with a ~150-op "essentials" default preset. — MCP clients cannot cope with 5,000 tools in one catalog; per-tenant scoping is how we ship all v1.0 without breaking clients.
- **Security posture**: No PII in default-level logs. Tokens AES-GCM encrypted at rest. `redirect_uris` validated. Refresh tokens off custom headers. — Multi-tenant trust requirements; v1 concerns must not carry over.
- **Backwards compatibility**: v2 is a clean break; v1 users migrate explicitly. — User's "v2 major rewrite" choice.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| v2 major rewrite (breaking changes OK) over evolution | Scope of multi-tenant + middleware pipeline + coverage makes incremental migration more work than a clean v2 line | — Pending |
| Keep `openapi-zod-client` generator, do NOT wrap `@microsoft/msgraph-sdk` | SDK audit: fluent API is wrong shape for flat MCP tool catalog; our pipeline gives Zod → JSON Schema in one transform. Gaps are all in middleware, not codegen. | — Pending |
| Bolt on Kiota-pattern middleware pipeline (RetryHandler / BatchClient / PageIterator / UploadSession / ETag / ODataError / DeltaTokens) inside our HTTP client | SDK audit: these are the actual deploy-blockers, all implementable as middleware without swapping the generator | — Pending |
| All three transports literal (legacy HTTP+SSE + Streamable HTTP + stdio) | User prioritized max client compatibility during the transition window, even though MCP spec replaced legacy SSE on 2025-03-26 | ⚠️ Revisit — legacy SSE shim may be retired in v2.1 once client ecosystem fully adopts Streamable HTTP |
| Runtime tenant onboarding (Admin REST API + Postgres) over static config | User wants self-service onboarding without container restart | — Pending |
| Tenant routing via URL path `/t/{tenantId}/...` over subdomain | No DNS/wildcard-cert coordination; composable with existing `MS365_MCP_PUBLIC_URL`; subdomains can layer later | — Pending |
| Stack = Postgres + Redis (Docker Compose) | Postgres = durable tenant registry + audit + delta tokens; Redis = hot state (PKCE, token cache, rate limiters). User chose this over Postgres-only to get TTL-native hot paths. | — Pending |
| Admin API = OAuth + API keys (dual-auth) | Humans via Entra + group check; automation via rotatable keys. Both are first-class, minted/revoked via admin API. | — Pending |
| All four identity flows concurrent | Organizational need: delegated (users), app-only (automation), bearer (service-to-service), device code (CLI operator) | — Pending |
| Coverage = all v1.0 + curated beta with per-tenant tool selection | Organization wants "fully featured"; per-tenant gating is how ~5,000 ops coexist with ~150-tool MCP-client limits | — Pending |
| Default tool preset = ~150 essentials (Mail/Cal/Files/Teams/Users/Groups/Sites/Planner/ToDo) | HIGH-priority workloads from coverage audit; aligns with Microsoft 365 "business productivity" surface | — Pending |
| Node 22 LTS baseline, drop Node 18 | Node 18 EOL passed April 2025; CI matrix simplifies to 20/22 | — Pending |
| Tokens encrypted at rest (AES-GCM envelope with KEK from env) | Multi-tenant DB-backed token cache must not be plaintext; KeyVault optional layering via env-var injection | — Pending |
| `keytar` removed — server-side token store only | `keytar` archived; v2 is server-first; CLI/device-code stdio reuses file store with explicit warning | — Pending |
| Reverse-proxy is operator-owned (no bundled TLS) | Keeps deployment portable; Caddy/Traefik/Nginx all work; docs provide reference configs | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-18 after initialization (v2 scope definition, brownfield + three upstream audits)*
