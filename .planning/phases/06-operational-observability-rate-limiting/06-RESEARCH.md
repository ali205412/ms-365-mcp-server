# Phase 6: Operational Observability & Rate Limiting — Research

**Researched:** 2026-04-22
**Domain:** OpenTelemetry metrics + traces, Prometheus exposition, Redis sliding-window rate limiting, OAuth-surface integration testing on Express 5
**Confidence:** HIGH
**Consumes:** `06-CONTEXT.md` (11 locked decisions D-01..D-11), ROADMAP §Phase 6, REQUIREMENTS §OPS-05..08

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 OTel Bootstrap Reuse** — Reuse `src/lib/otel.ts` (landed Phase 1). Plan 06-01 scope collapses to "verify + document env var contract". Do NOT rewrite. Missing auto-instrumentations get added inline.
- **D-02 Metrics Endpoint Auth** — Dedicated port 9464, gated by optional `MS365_MCP_METRICS_BEARER`. When set, `/metrics` requires `Authorization: Bearer {token}`; when unset, open (localhost/reverse-proxy trust assumed).
- **D-03 Rate-Limit Algorithm** — Redis sliding-window ZSET with current-timestamp scores. `ZADD → ZREMRANGEBYSCORE → ZCARD` atomically wrapped in a Lua script. New module `src/lib/rate-limit/sliding-window.ts` exports `consume(tenantId, windowMs, max): {allowed, retryAfterMs?}`.
- **D-04 Rate-Limit Granularity** — Per-tenant only. No per-tool, no per-user sub-budgets.
- **D-05 Graph Token Budget Accounting** — Parse `Retry-After` + `x-ms-resource-unit` headers into per-tenant ZSET key `mcp:rl:graph:{tenantId}`. Score = observed cost (default 1 absent headers). `src/lib/middleware/retry.ts` (already parses `Retry-After`) extends to call `rateLimit.observe(tenantId, weight)`. Sibling `observe()` added alongside `consume()`.
- **D-06 Metric Label Cardinality** — Respect ROADMAP labels `{tenant, tool, status}` BUT `tool` = workload prefix (first segment before `.` or `-`, already implemented by `extractWorkloadPrefix` in `src/lib/tool-selection/registry-validator.ts`). Full tool alias ONLY in OTel span attribute `tool.alias` (never the metric label).
- **D-07 Integration Test Infrastructure** — Mix: Testcontainers for CI `.int.test.ts`, pg-mem + MemoryRedisFacade + `ioredis-mock` for unit. Gated by `MS365_MCP_INTEGRATION=1` (already wired in `vitest.config.js`).
- **D-08 Metrics Endpoint Port Binding** — Dedicated port 9464 default, configurable via `MS365_MCP_METRICS_PORT`. Already in `otel.ts`.
- **D-09 Grafana Dashboard Scope** — Ship a starter JSON with 3-5 panels at `docs/observability/grafana-starter.json`. Panels: (1) requests/sec per tenant, (2) p50/p95/p99 latency per workload, (3) 429s blocked per tenant, (4) token-cache hit ratio, (5) PKCE store size.
- **D-10 OAuth-Surface Test Baseline** — Target ≥70% line coverage on `src/server.ts` OAuth-handler code paths specifically (PKCE store, `/authorize`, `/token`, `/register`, `/.well-known/*`). NOT whole-file — the MCP transport branches would skew the number. Enforced via per-region `coverage.include` + a custom reporter.
- **D-11 Rate-Limit Admin API Surface** — Admin PATCH `/admin/tenants/:id` gains optional `rate_limits: { request_per_min, graph_points_per_min }`. Zod-validated. Missing/null = platform defaults (`MS365_MCP_DEFAULT_REQ_PER_MIN=1000`, `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN=50000`). Migration adds `rate_limits JSONB NULL` column.

### Claude's Discretion

- Span attribute schema beyond the ROADMAP-required set — may add `authFlow`, `cache.hit`, `graph.retry.count` if useful.
- Rate-limit Lua script file layout — single script vs multiple; separate from or shared with webhook rate-limit.
- Testcontainers startup orchestration — `globalSetup` vs per-file; the canonical `globalSetup` pattern is the recommended default (see Validation Architecture below).
- Which documented alerts ship in the runbook — minimum set implied by ROADMAP.

### Deferred Ideas (OUT OF SCOPE)

- Per-tool rate limiting (D-04 excludes)
- Distributed tracing across Graph internal hops
- Grafana Cloud / managed Prometheus provider-specific presets
- Per-tenant alert rule ship-alongs
- AI-driven anomaly detection
- Soft-limit / preview mode for rate limiter
- Audit log shipping to SIEM
- Per-tool cost estimation based on historical `x-ms-resource-unit` data
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-05 | OpenTelemetry traces emitted for every Graph request with attributes (tenant, tool, status, duration, retry-count) | §Plan 06-02 — instrument `GraphClient.makeRequest` single chokepoint; span attributes detailed in §Span Attribute Schema |
| OPS-06 | OpenTelemetry metrics emitted (request count, error count, latency histogram, throttle events) per tenant | §Plan 06-02 — `@opentelemetry/api` Meter wiring; counters + histograms emitted alongside the span; RetryHandler already writes retry state into `RequestContext` |
| OPS-07 | Prometheus `/metrics` endpoint scrapes OTel metrics | §Plan 06-03 — `PrometheusExporter` already bootstrapped in `otel.ts`; Phase 6 refactors to use `preventServerStart: true` + a tiny Bearer-auth Express app for D-02 |
| OPS-08 | Per-tenant rate limiting (request count + Graph token budget) enforced via Redis counters | §Plan 06-04 — `mcp:rl:req:{tenantId}` + `mcp:rl:graph:{tenantId}` ZSET + Lua; extends Retry middleware to call `rateLimit.observe`; admin PATCH adds `rate_limits` field |
</phase_requirements>

## Summary

Phase 6 is almost entirely **glue code** on top of substrate that already exists. The OpenTelemetry NodeSDK is bootstrapped at import-time-zero in `src/lib/otel.ts`, three of the four middlewares (`etag`, `retry`, `odata-error`, `token-refresh`) already start OTel spans named `graph.middleware.*`, `src/lib/middleware/retry.ts` already parses `Retry-After` and writes `retryCount` + `lastStatus` to `RequestContext`, and `extractWorkloadPrefix` in `src/lib/tool-selection/registry-validator.ts` already performs the exact label-normalization D-06 requires. The dev-dependency `ioredis-mock` (8.13.1, already installed) supports the full `ZADD` / `ZREMRANGEBYSCORE` / `ZCARD` / `EVAL` surface we need — so unit tests need no new Redis infra.

Five things are genuinely NEW and must be built:

1. A **single `graph.request` parent span** that wraps the middleware chain and records duration (the existing per-middleware spans are child spans of nothing — they have no common parent).
2. A **Meter factory** (`src/lib/otel-metrics.ts`) exposing one Counter, one Histogram, and two Gauges (one observable callback for PKCE store size; one ratio for cache hits) — the Meter API is absent from the codebase today.
3. A **sliding-window rate limiter** (`src/lib/rate-limit/sliding-window.ts`) with an atomic ZSET+Lua script loaded via `ioredis.defineCommand`, plus a `loadTenant`-populated `req.tenant.rate_limits` consumer middleware.
4. A **Prometheus exposition endpoint** that runs on a dedicated port 9464 via `preventServerStart: true` + a tiny Bearer-auth Express app — the `getMetricsRequestHandler(req, res)` method is public on `PrometheusExporter` and accepts a raw `IncomingMessage`/`ServerResponse` pair, so we don't need a custom serializer.
5. An **OAuth-surface integration test suite** exercising `/authorize`, `/token`, `/register`, `/.well-known/*` end-to-end with two concurrent PKCE flows against real Redis, plus a coverage-include filter that measures only the OAuth-handler line ranges of `src/server.ts`.

**Primary recommendation:** Implement plans 06-01 through 06-07 in roadmap order; plan 06-01 is a ~30-minute verification + `.env.example` update; plans 06-02..04 are each ~2-3h; plans 06-05..06 are the coverage lift (largest effort — write and wire ~15-25 new integration tests). Plan 06-07 docs come last once real metric values exist to screenshot.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| OTel span emission for Graph traffic | Middleware pipeline layer (`src/lib/middleware/*`) + GraphClient | — | Single chokepoint per CONTEXT.md §Integration Points. No per-call-site instrumentation. |
| OTel metrics emission (counters + histograms) | `src/lib/otel-metrics.ts` new module + GraphClient + RetryHandler | — | Metric API is separate from the tracing API; share infra but keep imports narrow. |
| Prometheus `/metrics` HTTP exposition | Standalone tiny Express app on port 9464 | — | Must be isolated from main transport (different port + different auth model per D-02) |
| Per-tenant rate-limit state | Redis (ZSET) | pg-mem / MemoryRedis / ioredis-mock for tests | Redis is the only store that supports atomic sliding-window semantics at the required throughput. |
| Rate-limit enforcement point | Middleware between `loadTenant` and `executeGraphTool` | — | Must run AFTER tenant loads (needs `req.tenant.rate_limits`) and BEFORE any Graph call issues (gate on spend, not on observed). |
| Rate-limit cost observation | `RetryHandler` (existing) + header parser | — | `Retry-After` + `x-ms-resource-unit` arrive in Graph responses — parsing already happens in `retry.ts`. Phase 6 extends that site; no new call path. |
| Admin API rate-limit config mutation | `src/lib/admin/tenants.ts` (existing PATCH handler) | — | Existing path already does Zod + audit + publish-invalidation. Single Zod schema extension + one column migration. |
| Grafana dashboard JSON | `docs/observability/grafana-starter.json` | — | Operator-owned visualization; not hot-path. |
| OAuth integration tests | `test/integration/oauth-surface/*.int.test.ts` | — | Already-established gate (`MS365_MCP_INTEGRATION=1` + `.int.test.ts` pattern). |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@opentelemetry/api` | ^1.9.1 | Tracer + Meter API surface | `[VERIFIED: npm view]` Latest 1.9.1, already installed. Consumers never depend on the SDK — only the API. |
| `@opentelemetry/sdk-node` | ^0.215.0 | NodeSDK bootstrap (instrumentations + exporters) | `[VERIFIED: npm view]` Latest 0.215.0, already installed. Already wired in `src/lib/otel.ts`. |
| `@opentelemetry/exporter-prometheus` | ^0.215.0 | Prometheus exposition (MetricReader subclass) | `[VERIFIED: npm view, reading d.ts]` Exposes `getMetricsRequestHandler(req, res)` as a public method; supports `preventServerStart: true` for custom hosting. |
| `@opentelemetry/semantic-conventions` | ^1.40.0 | Stable attribute names | `[VERIFIED: npm view]` 1.40.0 is current. Existing `otel.ts` imports `ATTR_SERVICE_NAME`, `ATTR_SERVICE_VERSION`. No per-metric convention exists for "tenant", so project conventions apply (see §Span Attribute Schema). |
| `ioredis` | ^5.10.1 | Redis client | `[VERIFIED: package.json]` Already installed. Supports `defineCommand` for atomic Lua scripts (our ZSET+Lua approach). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@opentelemetry/instrumentation-http` | auto-instrumentations | Auto-span for inbound/outbound HTTP | Already wired via `getNodeAutoInstrumentations()`. Gives us free spans for every `/mcp`, `/token`, `/admin/*` call without touching Express. |
| `@opentelemetry/instrumentation-express` | auto-instrumentations | Express route spans | Already wired. Middleware spans nest under the HTTP span — gives plan 06-05 tests a free way to assert path coverage. |
| `@opentelemetry/instrumentation-ioredis` | auto-instrumentations | Redis command spans | Already wired. Every rate-limit `EVAL` will be visible in traces, which helps plan 06-04 verification. |
| `@testcontainers/postgresql` | ^11.14.0 | Real Postgres in CI integration | `[VERIFIED: package.json]` Already installed. Existing harness at `test/setup/testcontainers.ts`. |
| `@testcontainers/redis` | 11.14.0 | Real Redis in CI integration | `[VERIFIED: npm view]` Same major as the pg one but NOT currently installed. Plan 06-05 / 06-06 must `npm install --save-dev @testcontainers/redis` OR reuse pg container in shared-CI-only mode. |
| `ioredis-mock` | ^8.13.1 | In-memory ZSET + EVAL for unit | `[VERIFIED: package.json + compat.md]` Already installed. Full `zadd` / `zcard` / `zremrangebyscore` / `eval` support — this is the unit-test substrate for rate-limit logic. |
| `supertest` | latest | HTTP assertion lib for OAuth tests | `[ASSUMED]` — not currently in `package.json`. OAuth integration tests need a request helper. Alternative: raw `fetch()` against `app.listen()` — simpler, zero new deps. **Recommendation:** use `fetch()` — no new dep; aligns with Phase 2/3 test style. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@opentelemetry/exporter-prometheus` custom hosting | `prom-client` + separate Express handler | `prom-client` would re-invent the serialization; the OTel exporter already does it, we just need to host it. Keep OTel exporter for a single metric-model source of truth. |
| ZSET + Lua sliding window | Token bucket via `INCR` + timestamp key | Fixed-window token-bucket double-counts at the boundary (proven race condition — see `engineering.classdojo.com` ClassDojo post-mortem). Sliding-window ZSET is the standard industry fix. |
| `defineCommand` for Lua | Raw `EVAL` every call | `EVAL` sends the script bytes every call. `defineCommand` uses `EVALSHA` transparently (falls back to `EVAL` + registers on NOSCRIPT). Lower bandwidth, better in prod. |
| Per-file Testcontainers startup | `vitest globalSetup` | Per-file = cold-start per file = ~30s × N. `globalSetup` = one container, shared via `project.provide()` / `inject()`. Recommended by Testcontainers docs (2026). |
| pg-mem for integration tests | Real PG via testcontainers | pg-mem can't execute triggers, partial indexes, or full JSONB operators that production uses. Keep pg-mem for UNIT tests only. |

**Installation:**

```bash
# Required NEW deps for plan 06-05 / 06-06 integration tests
npm install --save-dev @testcontainers/redis

# OPTIONAL — only if we adopt supertest; fetch() is sufficient and preferred
# npm install --save-dev supertest @types/supertest
```

**Version verification performed:**
- `@opentelemetry/api`: 1.9.1 (verified via `npm view` on 2026-04-22) — installed version matches latest.
- `@opentelemetry/exporter-prometheus`: 0.215.0 — installed matches.
- `@opentelemetry/sdk-node`: 0.215.0 — installed matches.
- `@opentelemetry/semantic-conventions`: 1.40.0 — installed matches.
- `@testcontainers/redis`: 11.14.0 latest — NOT installed.
- `ioredis-mock`: 8.13.1 — installed matches.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────┐
                          │  MCP client / AI assistant              │
                          └────────────────┬────────────────────────┘
                                           │ HTTP POST /t/{tenantId}/mcp
                                           ▼
                       ┌─────────────────────────────────────────┐
                       │ Express app (port 3000)                 │
                       │  ├─ pinoHttp(req.id)                    │
                       │  ├─ CORS middleware                     │
                       │  ├─ loadTenant → req.tenant.rate_limits │
                       │  ├─ [NEW 06-04] rate-limit middleware ──┼──► Redis ZSET consume()
                       │  │    ├─ consume(tenant, reqPerMin) ────┼──   `mcp:rl:req:{tid}`
                       │  │    └─ consume(tenant, graphPtsPerMin)┼──   `mcp:rl:graph:{tid}`
                       │  ├─ requestContext.run({tid, …})        │    (atomic Lua EVALSHA)
                       │  └─ MCP dispatch → executeGraphTool     │
                       │         │                               │
                       │         └──► GraphClient.makeRequest    │
                       │               │                         │
                       │  [NEW 06-02]  └──► tracer.startActiveSpan('graph.request')
                       │                    │   attrs: {tenant, tool=workload, alias, status, retry, …}
                       │                    │                    │
                       │                    │  Middleware pipeline (existing)
                       │                    │  ├─ ETag    (existing span)
                       │                    │  ├─ Retry   (existing span, reads Retry-After +
                       │                    │  │          x-ms-resource-unit → observe)
                       │                    │  ├─ ODataErr (existing span)
                       │                    │  └─ TokenRfr(existing span)
                       │                    │                    │
                       │                    ▼                    │
                       │                  fetch(…graph.microsoft.com…)
                       │                                         │
                       │  [NEW 06-02]  After span.end():         │
                       │   mcp_tool_calls_total.add(1, {tenant, tool, status})
                       │   mcp_tool_duration_seconds.record(ms/1000, {tenant, tool})
                       │   mcp_graph_throttled_total.add(1, {tenant}) if status==429
                       └─────────────────────────────────────────┘

                       ┌─────────────────────────────────────────┐
                       │ [NEW 06-03] Metrics app (port 9464)     │
                       │  GET /metrics                           │
                       │   ├─ [if MS365_MCP_METRICS_BEARER]      │
                       │   │    requireBearer middleware         │
                       │   └─ PrometheusExporter.getMetricsRequestHandler(req, res)
                       │        → collect() + serialize → text/plain
                       └─────────────────────────────────────────┘

                       ┌─────────────────────────────────────────┐
                       │ [NEW 06-04] rate-limit/sliding-window.ts│
                       │  consume(tenantId, windowMs, max):      │
                       │    redis.slidingWindowConsume(key, ...) │
                       │      Lua script: ZREMRANGEBYSCORE +     │
                       │                   ZCARD + conditional   │
                       │                   ZADD + PEXPIRE        │
                       │  observe(tenantId, weight):             │
                       │    ZADD(mcp:rl:graph:{tid}, now, uuid)  │
                       │    PEXPIRE(…, windowMs*2)               │
                       └─────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── lib/
│   ├── otel.ts                     (EXISTING — Plan 06-01 verifies + documents)
│   ├── otel-metrics.ts             (NEW — Plan 06-02: Meter singleton + instrument exports)
│   ├── rate-limit/
│   │   ├── sliding-window.ts       (NEW — Plan 06-04: consume + observe)
│   │   ├── sliding-window.lua      (NEW — Plan 06-04: atomic Lua script)
│   │   ├── middleware.ts           (NEW — Plan 06-04: Express middleware wiring)
│   │   └── defaults.ts             (NEW — Plan 06-04: env-var platform defaults)
│   ├── metrics-server/
│   │   ├── metrics-server.ts       (NEW — Plan 06-03: port 9464 Express app)
│   │   └── bearer-auth.ts          (NEW — Plan 06-03: optional Bearer middleware)
│   └── admin/
│       └── tenants.ts              (EXISTING — Plan 06-04: extends Zod + PATCH)
├── graph-client.ts                 (EXISTING — Plan 06-02: adds parent span)
└── lib/middleware/
    └── retry.ts                    (EXISTING — Plan 06-02: emits throttled counter;
                                     Plan 06-04: calls rateLimit.observe)

docs/observability/
├── grafana-starter.json            (NEW — Plan 06-07: 3-5 panel dashboard)
├── prometheus-scrape.yml           (NEW — Plan 06-07: reference scrape config)
└── runbook.md                      (NEW — Plan 06-07: alerts + tuning guide)

test/integration/oauth-surface/
├── pkce-concurrent.int.test.ts     (NEW — Plan 06-05)
├── register-invalid-redirect.int.test.ts (NEW — Plan 06-05)
├── token-error-paths.int.test.ts   (NEW — Plan 06-05)
├── well-known-metadata.int.test.ts (NEW — Plan 06-05)
└── multi-tenant-isolation.int.test.ts (NEW — Plan 06-06; may extend existing)

test/integration/rate-limit/
├── sliding-window.int.test.ts      (NEW — Plan 06-04)
└── admin-config.int.test.ts        (NEW — Plan 06-04)

migrations/
└── 20260901000000_tenant_rate_limits.sql  (NEW — Plan 06-04)
```

### Pattern 1: Parent Span Around Middleware Chain (NEW)

**What:** `GraphClient.makeRequest` today invokes the pipeline without a parent span — the four existing middleware spans (`graph.middleware.etag`, `graph.middleware.retry`, `graph.middleware.odata-error`, `graph.middleware.token-refresh`) are siblings, not children. Plan 06-02 introduces a `graph.request` parent span so all four nest under one row in the trace UI and carry the tenant/tool/status attributes as a unit.

**Why:** Parent-child nesting is the only way to correlate middleware timing with total request duration in a trace view. It also gives Plan 06-05 OAuth tests a single assertion site (`one span named graph.request with attrs X`) rather than four.

**When to use:** Anytime there's a chain of sub-spans that share a user-facing operation name. Phase 2 instrumented four sub-spans; Phase 6 nests them.

**Example:**
```typescript
// src/graph-client.ts — new implementation of makeRequest
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { mcpToolCallsTotal, mcpToolDurationSeconds, mcpGraphThrottledTotal } from './lib/otel-metrics.js';

const tracer = trace.getTracer('ms-365-mcp-server');

async makeRequest(endpoint: string, options: GraphRequestOptions = {}): Promise<unknown> {
  const ctx = getRequestTokens();
  const tenantId = ctx?.tenantId ?? 'unknown';
  const toolAlias = (ctx as any)?.toolAlias ?? 'unknown';
  const workload = extractWorkloadPrefix(toolAlias); // D-06 label

  return tracer.startActiveSpan(
    'graph.request',
    { kind: SpanKind.CLIENT, attributes: { 'tenant.id': tenantId, 'tool.name': workload, 'tool.alias': toolAlias } },
    async (span) => {
      const start = performance.now();
      let status = 0;
      try {
        // ... existing makeRequest body ...
        const response = await this.performRequest(endpoint, accessToken, options);
        status = response.status ?? 200;
        span.setAttribute('http.status_code', status);
        span.setAttribute('retry.count', ctx?.retryCount ?? 0);
        // If the graph response or error carried a requestId, attach it:
        const graphReqId = response.headers?.get?.('request-id') ?? undefined;
        if (graphReqId) span.setAttribute('graph.request_id', graphReqId);
        return /* … */;
      } catch (err) {
        status = (err as any)?.statusCode ?? 0;
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        const durationSec = (performance.now() - start) / 1000;
        mcpToolCallsTotal.add(1, { tenant: tenantId, tool: workload, status: String(status) });
        mcpToolDurationSeconds.record(durationSec, { tenant: tenantId, tool: workload });
        if (status === 429) {
          mcpGraphThrottledTotal.add(1, { tenant: tenantId });
        }
        span.end();
      }
    }
  );
}
```

**Source:** `[CITED: opentelemetry.io/docs/languages/js/instrumentation/]` + `[VERIFIED: existing RetryHandler pattern at src/lib/middleware/retry.ts:59-73]`

### Pattern 2: Meter Singleton with Named Instruments

**What:** Create instruments once at module load (not per-request); re-use across call sites. The OTel Meter API is intentionally stateless per call — `createCounter` returns the same instrument on re-invocation with the same name, but paying the lookup cost repeatedly is wasteful and mocking becomes harder.

**Example:**
```typescript
// src/lib/otel-metrics.ts — NEW file for plan 06-02
import { metrics } from '@opentelemetry/api';

// Single named meter — this name appears in the Prometheus serialization as
// `otel_scope_name="ms-365-mcp-server"` on every metric line.
const meter = metrics.getMeter('ms-365-mcp-server', process.env.npm_package_version);

export const mcpToolCallsTotal = meter.createCounter('mcp_tool_calls_total', {
  description: 'Total MCP Graph tool invocations, labelled by tenant, workload prefix, and HTTP status code',
});

export const mcpToolDurationSeconds = meter.createHistogram('mcp_tool_duration_seconds', {
  description: 'End-to-end duration of each Graph tool call, measured at GraphClient.makeRequest',
  unit: 's',
  // Default Prometheus histogram buckets are designed for seconds; let the SDK use its defaults.
});

export const mcpGraphThrottledTotal = meter.createCounter('mcp_graph_throttled_total', {
  description: 'Count of Graph responses with HTTP 429 (throttled), per tenant',
});

export const mcpRateLimitBlockedTotal = meter.createCounter('mcp_rate_limit_blocked_total', {
  description: 'Count of requests rejected by the gateway rate limiter, per tenant and reason (request|graph-points)',
});

// Observable (pull-based) gauges — the SDK polls the callback each collection cycle.
export const mcpOauthPkceStoreSize = meter.createObservableGauge('mcp_oauth_pkce_store_size', {
  description: 'Count of PKCE entries currently resident in the store (Redis DBSIZE in prod; Map.size in stdio)',
});
// Registration handled by plan 06-03 once pkceStore instance is in hand.

export const mcpTokenCacheHitRatio = meter.createObservableGauge('mcp_token_cache_hit_ratio', {
  description: 'Ratio of MSAL token cache hits to total acquires over the last collection interval, per tenant',
});

export const mcpActiveStreams = meter.createUpDownCounter('mcp_active_streams', {
  description: 'Active long-lived streams (legacy SSE + streamable HTTP open sockets), per tenant',
});
```

**Source:** `[CITED: opentelemetry.io/docs/specs/otel/metrics/api/]` + `[CITED: npmjs.com/package/@opentelemetry/sdk-metrics]`

### Pattern 3: Prometheus Exporter with Custom Hosting (D-02 Bearer Auth)

**What:** `PrometheusExporter` extends `MetricReader` and has a public method `getMetricsRequestHandler(req: IncomingMessage, res: ServerResponse): void` that handles the `/metrics` response directly. By constructing with `preventServerStart: true`, we prevent the default HTTP listener from binding on 9464 and instead host `getMetricsRequestHandler` from our own Express app — which gives us a clean place to install Bearer auth middleware.

**Example:**
```typescript
// src/lib/metrics-server/metrics-server.ts — NEW for plan 06-03
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

export interface MetricsServerConfig {
  port: number;               // default 9464 — MS365_MCP_METRICS_PORT
  bearerToken: string | null; // null = open; set = require `Authorization: Bearer {token}`
}

export function createMetricsServer(exporter: PrometheusExporter, cfg: MetricsServerConfig) {
  const app = express();

  // Optional Bearer auth — localhost/reverse-proxy trust when absent (D-02)
  const requireBearer: RequestHandler = (req, res, next) => {
    if (cfg.bearerToken === null) return next();
    const hdr = req.headers.authorization;
    if (!hdr?.startsWith('Bearer ')) {
      res.status(401).set('WWW-Authenticate', 'Bearer').end();
      return;
    }
    const supplied = hdr.slice('Bearer '.length).trim();
    // Constant-time compare to prevent timing oracle
    if (!timingSafeCompare(supplied, cfg.bearerToken)) {
      res.status(401).set('WWW-Authenticate', 'Bearer').end();
      return;
    }
    next();
  };

  app.get('/metrics', requireBearer, (req: Request, res: Response) => {
    // PrometheusExporter's getMetricsRequestHandler signature is
    // (IncomingMessage, ServerResponse). Express's Request extends IncomingMessage
    // and Response extends ServerResponse, so the cast is safe.
    exporter.getMetricsRequestHandler(req, res);
  });

  return app.listen(cfg.port, '0.0.0.0');
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
```

Then in `src/lib/otel.ts` (plan 06-01 adjusts):
```typescript
// When MS365_MCP_PROMETHEUS_ENABLED=1, create an exporter that does NOT
// start its own HTTP server — we host it from src/lib/metrics-server/metrics-server.ts.
const prometheusExporter = new PrometheusExporter({
  port: Number(process.env.MS365_MCP_METRICS_PORT ?? 9464),
  preventServerStart: true,   // <-- the key flag
});
// Export the exporter so src/server.ts can pass it to createMetricsServer()
export { prometheusExporter };
```

**Source:** `[VERIFIED: node_modules/@opentelemetry/exporter-prometheus/build/src/PrometheusExporter.d.ts line 49 + .js line 143-145]`

### Pattern 4: Sliding-Window Rate Limit via ioredis defineCommand (D-03)

**What:** ioredis's `defineCommand` lets us register a Lua script once at client construction and invoke it via `EVALSHA` transparently. ioredis handles the NOSCRIPT fallback automatically.

**Example — the Lua script (canonical pattern):**
```lua
-- src/lib/rate-limit/sliding-window.lua
-- KEYS[1] = sorted-set key (e.g., mcp:rl:req:{tenantId})
-- ARGV[1] = window_ms (integer, e.g., 60000)
-- ARGV[2] = max_count (integer, e.g., 1000)
-- ARGV[3] = now_ms (integer — passed from caller, NOT redis.call('TIME')
--           — so tests can pin the clock)
-- ARGV[4] = unique request ID (string — prevents ZADD dedup on duplicate timestamp)
-- ARGV[5] = cost (integer, default 1 — for weighted observe; consume uses 1)
-- Returns {allowed: 0|1, current_count: int, retry_after_ms: int}
-- retry_after_ms is 0 when allowed, >0 when denied (ms until the oldest entry
--   falls out of the window).

local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local max_count = tonumber(ARGV[2])
local now_ms   = tonumber(ARGV[3])
local req_id   = ARGV[4]
local cost     = tonumber(ARGV[5] or "1")

local cutoff = now_ms - window_ms

-- 1. Evict entries older than the window
redis.call('ZREMRANGEBYSCORE', key, '-inf', '(' .. cutoff)

-- 2. Count entries currently inside the window
local current = redis.call('ZCARD', key)

-- 3. Gate: would this request's cost exceed the budget?
if current + cost > max_count then
  -- Compute retry_after_ms from the oldest entry (next one to age out)
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_ms = 0
  if #oldest >= 2 then
    retry_ms = math.max(0, (tonumber(oldest[2]) + window_ms) - now_ms)
  end
  return {0, current, retry_ms}
end

-- 4. Admit: ZADD the request (or N copies for a weighted cost)
for i = 1, cost do
  -- Suffix the req_id with i so N copies don't dedup on the same member
  redis.call('ZADD', key, now_ms, req_id .. ':' .. tostring(i))
end

-- 5. Safety-net TTL: 2× window so dead tenants don't leak keys
redis.call('PEXPIRE', key, window_ms * 2)

return {1, current + cost, 0}
```

**Example — TypeScript wiring:**
```typescript
// src/lib/rate-limit/sliding-window.ts — NEW for plan 06-04
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import type { RedisClient } from '../redis.js';
import type { Redis as IORedis } from 'ioredis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LUA = readFileSync(path.join(__dirname, 'sliding-window.lua'), 'utf8');

// Extend ioredis types so TypeScript knows about the custom command.
declare module 'ioredis' {
  interface RedisCommander<Context> {
    slidingWindow(
      key: string,
      windowMs: number,
      maxCount: number,
      nowMs: number,
      reqId: string,
      cost: number
    ): Result<[number, number, number], Context>;
  }
}

export function registerSlidingWindow(redis: IORedis): void {
  redis.defineCommand('slidingWindow', {
    numberOfKeys: 1,
    lua: LUA,
  });
}

export interface ConsumeResult {
  allowed: boolean;
  currentCount: number;
  retryAfterMs: number;
}

export async function consume(
  redis: RedisClient,
  key: string,
  windowMs: number,
  maxCount: number,
  cost = 1
): Promise<ConsumeResult> {
  const nowMs = Date.now();
  const reqId = crypto.randomUUID();
  // MemoryRedisFacade has no ZSET support; this helper ONLY runs against real
  // ioredis or ioredis-mock. Callers in stdio mode must short-circuit above.
  const [allowed, currentCount, retryAfterMs] = await (redis as IORedis).slidingWindow(
    key, windowMs, maxCount, nowMs, reqId, cost
  );
  return { allowed: allowed === 1, currentCount, retryAfterMs };
}

/**
 * observe(): D-05 sibling. Called by RetryHandler post-response to record the
 * ACTUAL cost observed (x-ms-resource-unit weight, or 1 if absent). Uses the
 * same sliding-window script with cost = observed weight. The "consume"
 * gate uses `1` by default; observe uses the weighted amount.
 */
export async function observe(
  redis: RedisClient,
  tenantId: string,
  windowMs: number,
  weight: number
): Promise<void> {
  const key = `mcp:rl:graph:${tenantId}`;
  // max_count = Infinity (we never gate on this key — it's pure observation).
  // Use a very large value that the script's `current + cost > max_count`
  // branch will never hit in practice.
  await consume(redis, key, windowMs, Number.MAX_SAFE_INTEGER, weight);
}
```

**Source:** `[CITED: github.com/redis/ioredis/blob/main/examples/typescript/scripts.ts]` + `[CITED: oneuptime.com/blog/post/2026-01-25-redis-sliding-window-rate-limiting/view]` + `[VERIFIED: atomaras gist — core pattern]`

### Pattern 5: Testcontainers globalSetup for Vitest (D-07)

**What:** Start Postgres + Redis containers ONCE per vitest process, share via `project.provide()`, consume via `inject()` in tests. Integration tests that mutate state do so inside transactions (pg) or against isolated tenant IDs (Redis — the `mcp:*:{tenantId}:*` prefix provides namespace isolation).

**Example:**
```typescript
// test/setup/integration-globalSetup.ts — NEW (replaces or extends test/setup/testcontainers.ts)
import type { TestProject } from 'vitest/node';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  if (process.env.MS365_MCP_INTEGRATION !== '1') return; // fast-path for unit-only runs

  pg = await new PostgreSqlContainer('postgres:16-alpine')
    .withUsername('mcp')
    .withPassword('mcp')
    .withDatabase('mcp')
    .start();
  redis = await new RedisContainer('redis:7-alpine').start();

  project.provide('pgUrl', pg.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  await redis?.stop();
}

// Then in vitest.config.js:
// globalSetup: ['./test/setup/integration-globalSetup.ts'],

// In any integration test:
// import { inject } from 'vitest';
// const pgUrl = inject('pgUrl');
// const redisUrl = inject('redisUrl');
```

**Source:** `[CITED: node.testcontainers.org/quickstart/global-setup/]`

### Anti-Patterns to Avoid

- **DON'T instrument at every graph-tools.ts call site.** There are 212 Graph tools today (14k after Phase 5 expansion). Instrumenting N call sites = N drift risk. Instrument once in `GraphClient.makeRequest` — the single chokepoint per `src/graph-client.ts` and CONTEXT.md.
- **DON'T use the full tool alias as a Prometheus label.** D-06 explicitly forbids this. Cardinality = 14k × 5 statuses × N tenants = millions of series. The industry red-line is ~10k unique label combinations per metric before Prometheus OOMs. Use `extractWorkloadPrefix` (already exists).
- **DON'T use `redis.eval()` directly every call.** Use `defineCommand` → `EVALSHA` transparent fallback. Hot-path bandwidth matters — at 1000 req/min/tenant × N tenants, pushing the full Lua script each call wastes bytes.
- **DON'T use fixed-window `INCR` + `EXPIRE` for request-rate.** The webhook 401 limiter can get away with it (low-frequency 401 flood), but request-rate fires on every Graph call — double-counting at the boundary is a correctness bug.
- **DON'T mutate `src/index.ts` import order.** The first line is `import './lib/otel.js';` — any reorder would break auto-instrumentation of Express/PG/ioredis. All Phase 6 code lives downstream of this line.
- **DON'T add new auto-instrumentations without reading their span output.** `@opentelemetry/instrumentation-pino` is already listed in deps but log-correlation can be noisy. Audit the emitted spans before enabling additional instrumentations.
- **DON'T reuse `MemoryRedisFacade` for rate-limit tests.** The facade explicitly does NOT implement ZSET commands. Use `ioredis-mock` (already installed) in unit tests and Testcontainers-Redis in integration.
- **DON'T emit the span status code as a high-cardinality label.** Group by bucket: `"2xx" | "3xx" | "4xx" | "5xx" | "429" | "other"` OR string representation of the exact status if cardinality is acceptable. ROADMAP says `status` label = HTTP status code; numeric codes yield ~10-15 distinct values in practice, which is fine. But do NOT emit "error message" or "error code" as a label.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Prometheus text serialization | Custom counter/histogram stringifier | `@opentelemetry/exporter-prometheus` (already installed) + `preventServerStart: true` | PrometheusSerializer is 280 LoC of edge-case handling for exemplars, scope, target_info. The exporter does it right; we just host the handler. |
| Atomic rate-limit counter | Multiple Redis round-trips with MULTI/EXEC | Single Lua script via `ioredis.defineCommand` | MULTI/EXEC is atomic for consistency but NOT conditional — we can't branch on ZCARD result without a Lua round-trip anyway. One EVALSHA = one RTT; MULTI/EXEC + separate ZCARD = 2 RTTs + race window. |
| Bearer token constant-time compare | `str1 === str2` | `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` | String `===` short-circuits on first mismatched byte; timing oracle reveals token prefix. Use the node built-in. |
| Grafana dashboard from scratch | Panel JSON by hand | Export-and-edit from a live Grafana instance + commit to git | Grafana schemaVersion evolves (41 in late-2025, 42 current). Hand-editing is fragile. Build in Grafana UI, export, commit. |
| Test harness for concurrent PKCE flows | Manually-timed `Promise.all` | `vitest.concurrent` + two `fetch()` calls with interleaved `await` | See §Validation Architecture — concurrent PKCE test needs to guarantee Request A's `/authorize` completes before Request B's `/authorize` starts but Request A's `/token` arrives after Request B's `/token`. A single synchronous block in a `test.concurrent` works; raw Promise.all does not. |
| HTTP span attribute names | Ad-hoc attribute names | `@opentelemetry/semantic-conventions` constants (`ATTR_HTTP_REQUEST_METHOD`, `ATTR_HTTP_RESPONSE_STATUS_CODE`) | Ensures traces aggregate correctly in any OTel backend without per-vendor attribute translation. |
| Rate-limit retry-after calculation | JavaScript Date arithmetic in the middleware | Lua-script-computed `retry_after_ms` returned from the slidingWindow command | Keeps the calculation next to the atomic evict — no window drift between the gate decision and the response header value. |

**Key insight:** Every significant primitive Phase 6 needs is already a battle-tested library API. The work is **wiring + tests**, not novel code. Resist the urge to write a generic "metrics helper" abstraction — the Meter API is already that abstraction.

## Runtime State Inventory

> Phase 6 is additive (new code + new config) rather than a rename/refactor. No runtime state migrations required.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Redis keys `mcp:rl:req:{tenantId}` and `mcp:rl:graph:{tenantId}` are NEW keys introduced this phase. No pre-existing data to migrate. | None — fresh keys created on first consume. |
| Live service config | Admin PATCH `/admin/tenants/:id` gains `rate_limits` field. Existing tenants without the field inherit platform defaults from env vars; no data migration needed. | None — `rate_limits JSONB NULL` is DEFAULT-NULL. |
| OS-registered state | None — no OS-level registrations. | None. |
| Secrets/env vars | NEW: `MS365_MCP_METRICS_PORT` (default 9464), `MS365_MCP_METRICS_BEARER` (optional), `MS365_MCP_DEFAULT_REQ_PER_MIN` (1000), `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` (50000). Existing: `OTEL_EXPORTER_OTLP_ENDPOINT`, `MS365_MCP_PROMETHEUS_ENABLED`. | Document in `.env.example` — plan 06-07. No key rotation needed (new keys). |
| Build artifacts / installed packages | Phase 6 adds `@testcontainers/redis` as devDep. No build-artifact changes. | `npm install` runs on next `npm ci` in CI; Docker build unaffected (devDeps stripped). |

**Nothing found in category** "OS-registered state": verified — no systemd units, Task Scheduler, launchd, pm2, or Docker image tags reference Phase 6 concepts.

## Common Pitfalls

### Pitfall 1: OTel SDK Starts Silently When OTLP Endpoint Missing

**What goes wrong:** `otel.ts` starts `NodeSDK` with `undefined` trace exporter when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset. Spans are created but discarded. Tests that assert spans from auto-instrumented modules (Express, pg) see no spans unless the metric reader OR trace exporter is configured.

**Why it happens:** The SDK needs at least one exporter configured to propagate spans; otherwise the NodeSDK silently becomes a no-op.

**How to avoid:** In plan 06-05 integration tests, set `MS365_MCP_PROMETHEUS_ENABLED=1` before importing any application module so the exporter wires up and spans flow to an in-memory reader (via `InMemorySpanExporter` if tests need to assert specific spans).

**Warning signs:** Tests that try to `inject` or peek OTel state find empty collections; the NodeSDK never exports; Prometheus `/metrics` returns only target_info and scope_info.

### Pitfall 2: `preventServerStart: true` Still Binds on Some Versions

**What goes wrong:** Even with `preventServerStart: true`, some older versions of `@opentelemetry/exporter-prometheus` leaked an HTTP server bind in startup logs. Verified clean on 0.215.0 (current) — startServer() is gated behind the flag.

**Why it happens:** Historical bug pattern where the constructor called `this.startServer()` unconditionally. Fixed in 0.44.0+.

**How to avoid:** Pin `^0.215.0` (already pinned). Plan 06-01 verification includes a startup log grep for `Prometheus exporter server started` — should be ABSENT when we host the handler ourselves.

### Pitfall 3: Redis ZSET Clock Skew Across Replicas

**What goes wrong:** The Lua script uses `redis.call('TIME')` for the timestamp in some canonical patterns. But when the caller passes `now_ms` (as our script does), the caller's clock is used. With multiple Node replicas running NTP-synchronized, the skew is sub-millisecond; without NTP, drift can cause the `retry_after_ms` calc to go negative or a just-admitted request to appear evicted.

**Why it happens:** The Lua script runs single-threaded on Redis (single source of truth for the ZSET). But the `now_ms` argument comes from the replica — if replica A's clock is 50ms ahead of replica B's, a sequence of (A-admit t=1000, B-admit t=999) violates monotonicity.

**How to avoid:** Use `redis.call('TIME')` inside the Lua script for the timestamp, NOT a caller-supplied value. Exception: unit tests must be able to pin time (otherwise they're flaky). Resolve by: script signature accepts `now_ms` argument; production caller passes `Date.now()` (replicas NTP-sync to single-digit ms skew — negligible at 60-second windows); unit tests pass a deterministic value; integration tests use real Redis-time by passing `0` and have the script read `TIME` internally when `now_ms == 0`. Document this in the Lua comment.

**Warning signs:** Flaky tests that pass when run alone, fail when run in parallel with load. 429 responses with negative `Retry-After` headers.

### Pitfall 4: ioredis `defineCommand` + Cluster Mode

**What goes wrong:** If Phase 6 ever migrates to Redis Cluster (Phase v1.1+), `defineCommand` scripts can fail to register on all shards. Current architecture is single Redis, so not a near-term risk.

**Why it happens:** Cluster mode requires SCRIPT LOAD on every master; ioredis didn't auto-shard-register for a long time (see ioredis issue #1405).

**How to avoid:** Document this as a v1.1 gate in the roadmap (NOT Phase 6's concern). Phase 6 ships single-Redis; the Lua-script registration on a single node is reliable.

### Pitfall 5: Concurrent PKCE Store Writes Under Integration Tests

**What goes wrong:** Integration tests that open two concurrent `/authorize` flows against a shared Redis can interfere if the PKCE store key naming collides on `state` or `clientCodeChallenge`. RedisPkceStore uses `clientCodeChallenge` as the key (see `pkce-store.ts` docs) and uses SET NX semantics — so collisions return `false` rather than overwriting.

**Why it happens:** Test fixtures that hard-code PKCE challenges will collide across tests.

**How to avoid:** In plan 06-05 / 06-06 integration tests, generate PKCE challenges via `crypto.randomBytes(32).toString('base64url')` per-test. Never hard-code them. Use `afterEach` to flush keys matching `mcp:pkce:*` (not `FLUSHDB` — that would wipe parallel tests' state).

### Pitfall 6: Bearer Auth Middleware Order on `/metrics`

**What goes wrong:** Adding the Bearer middleware BEFORE the `getMetricsRequestHandler` is obvious; adding it AFTER means the handler has already written the body before the middleware returns 401.

**Why it happens:** `getMetricsRequestHandler` calls `response.end()` directly — it does not yield control back to Express. Middleware order is hard to debug post-hoc.

**How to avoid:** Plan 06-03 test cases MUST include: (a) request without Authorization header → 401; (b) request with wrong Bearer → 401; (c) request with correct Bearer → 200 + `# TYPE mcp_tool_calls_total counter` in body; (d) scrape response includes `WWW-Authenticate: Bearer` on 401.

### Pitfall 7: Auto-Instrumentation Span Flood

**What goes wrong:** `@opentelemetry/instrumentation-http` instruments EVERY outbound HTTP call. That includes OTel's own OTLP export POSTs. If the OTLP collector is slow, self-referential spans pile up.

**Why it happens:** The auto-instrumentation doesn't know which outbound calls are its own export traffic.

**How to avoid:** In `otel.ts` bootstrap, add an `ignoreOutgoingRequestHook` to the http instrumentation config that filters OTLP endpoint traffic. Look at the auto-instrumentations bag in `src/lib/otel.ts` line 78 — extend that config per plan 06-01's verification step.

**Source:** `[CITED: github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md]`

### Pitfall 8: Grafana Dashboard uid Collisions

**What goes wrong:** If `docs/observability/grafana-starter.json` has a hard-coded `uid`, operators who import it clobber any existing dashboard with the same uid.

**Why it happens:** Grafana dedupes by `uid`. Export-and-commit workflows tend to preserve the uid.

**How to avoid:** Plan 06-07 — scrub `uid` to `null` in the committed JSON; document `grafana-cli -import` or UI-import workflow that generates a fresh uid on first load.

### Pitfall 9: ESM Instrumentation Gotcha (AVOIDED BY CURRENT CODE)

**What goes wrong:** In Node 22 ESM mode, OTel auto-instrumentation requires `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` to patch imports (the CJS `Module._load` hook doesn't fire for ESM imports). Without the loader, auto-instrumentation SILENTLY does not patch Express/pg/ioredis.

**Why it happens:** ESM uses a completely different module-loading protocol.

**How to avoid:** Current code uses `import './lib/otel.js'` as the first import in `src/index.ts`. This works for OUR own code paths that explicitly call `trace.getTracer(...)` (which we do in middlewares + Phase 6 parent span). It does NOT fully auto-instrument Express/pg/ioredis unless the loader flag is set.

**Recommendation for plan 06-01 verification:** Check whether auto-instrumentation is actually patching Express. If not (likely with current bootstrap), either (a) accept reduced auto-coverage since our manual spans cover the important paths, OR (b) document that operators running with `NODE_OPTIONS='--experimental-loader=@opentelemetry/instrumentation/hook.mjs'` get fuller coverage. **Locked decision D-01 says "verify, don't rewrite"** — this pitfall should be surfaced as a documented limitation, not a Phase 6 blocker.

**Source:** `[CITED: github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md]`

## Code Examples

### `x-ms-resource-unit` Header Parsing (Plan 06-02 / D-05)

```typescript
// src/lib/middleware/retry.ts — extension (existing file)
import { observe } from '../rate-limit/sliding-window.js';

// After the existing response-handling branch in RetryHandler.execute,
// BEFORE span.end(), add an observe() call:
async execute(req: GraphRequest, next: () => Promise<Response>): Promise<Response> {
  // ... existing code ...
  const response = await next();
  const resourceUnits = parseResourceUnit(response.headers.get('x-ms-resource-unit'));
  const tenantId = requestContext.getStore()?.tenantId;
  if (tenantId && resourceUnits > 0) {
    // Fire-and-forget — never block response delivery on rate-limit book-keeping
    void observe(getRedis(), tenantId, 60_000, resourceUnits).catch((err) =>
      logger.warn({ err: err.message, tenantId }, 'rate-limit observe failed')
    );
  }
  // ... rest of existing code ...
}

/** Parse Graph's x-ms-resource-unit header. Range: typically 1-5 for reads, 3-10 for writes/expands. */
export function parseResourceUnit(raw: string | null): number {
  if (!raw) return 1;         // default cost when header absent
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 1;
  // Cap at 100 so a pathological server response can't blow through tenant budget in one request
  return Math.min(n, 100);
}
```

**Source:** `[CITED: learn.microsoft.com/en-us/graph/throttling-limits]` — resource unit costs: GET applications = 2, GET users = 2, POST directoryObjects/getByIds = 5; $select decreases cost by 1, $expand increases by 1.

### PKCE Store Observable Gauge (Plan 06-02 / 06-03)

```typescript
// src/lib/pkce-store/pkce-store.ts — EXTEND the interface
export interface PkceStore {
  put(tenantId: string, entry: PkceEntry): Promise<boolean>;
  takeByChallenge(tenantId: string, clientCodeChallenge: string): Promise<PkceEntry | null>;
  /** Phase 6: observable count for mcp_oauth_pkce_store_size gauge. */
  size(): Promise<number>;
}

// src/lib/pkce-store/redis-store.ts — ADD the method
async size(): Promise<number> {
  let cursor = '0';
  let total = 0;
  do {
    const [next, batch] = await this.redis.scan(cursor, 'MATCH', 'mcp:pkce:*', 'COUNT', '500');
    cursor = next;
    total += batch.length;
  } while (cursor !== '0');
  return total;
}

// src/lib/pkce-store/memory-store.ts — ADD the method
async size(): Promise<number> {
  return this.store.size;
}

// src/lib/otel-metrics.ts — WIRE the observable
import type { PkceStore } from '../pkce-store/pkce-store.js';
export function wirePkceStoreGauge(pkceStore: PkceStore): void {
  mcpOauthPkceStoreSize.addCallback(async (observableResult) => {
    try {
      observableResult.observe(await pkceStore.size());
    } catch {
      // never fail the metric collection — the SDK swallows the missed sample
    }
  });
}
```

**Source:** `[CITED: opentelemetry.io/docs/specs/otel/metrics/api/]` — observable gauge with `addCallback` is the SDK-canonical pattern for pull-based values.

### Admin Migration for rate_limits Column (Plan 06-04 / D-11)

```sql
-- migrations/20260901000000_tenant_rate_limits.sql
-- Phase 6 plan 06-04: per-tenant rate-limit overrides.
-- rate_limits = NULL → use platform defaults from env vars.
-- Shape: {"request_per_min": int, "graph_points_per_min": int}

ALTER TABLE tenants ADD COLUMN rate_limits JSONB DEFAULT NULL;

COMMENT ON COLUMN tenants.rate_limits IS
  'Per-tenant rate-limit overrides as JSONB. Keys: request_per_min, graph_points_per_min. NULL inherits from MS365_MCP_DEFAULT_REQ_PER_MIN / MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN env vars.';

-- No backfill — existing tenants pick up platform defaults on first request
-- via the rate-limit middleware's resolveRateLimit(tenant) helper.
```

### Admin Zod Schema Extension (Plan 06-04 / D-11)

```typescript
// src/lib/admin/tenants.ts — EXTEND UpdateTenantZod / PatchTenantZod
const RateLimitsZod = z.object({
  request_per_min: z.number().int().positive().max(1_000_000),
  graph_points_per_min: z.number().int().positive().max(10_000_000),
}).strict();

// Extend CreateTenantZod:
const CreateTenantZod = z.object({
  // ... existing fields ...
  rate_limits: RateLimitsZod.nullable().optional(),
});

// PatchTenantZod = CreateTenantZod.partial().strict() — already works after the above.

// In the PATCH handler's addSet() calls:
if (body.rate_limits !== undefined) {
  addSet('rate_limits', body.rate_limits === null ? null : JSON.stringify(body.rate_limits), true /* jsonb */);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `prom-client` + custom Express `/metrics` | `@opentelemetry/exporter-prometheus` with `preventServerStart: true` + hosted handler | OTel exporters stabilized 2024 | Single source of truth for the metric model; auto-instrumented spans and custom metrics share one SDK |
| Fixed-window INCR+EXPIRE for all rate limiting | Sliding-window ZSET + Lua for request-rate; keep fixed-window for 401-flood protection | Sliding-window canonical since 2015 ClassDojo post | No double-counting at window boundary; higher algorithmic fidelity |
| `redis.eval(...)` every call | `redis.defineCommand(...)` + transparent EVALSHA | ioredis 4+ | ~300 bytes/call bandwidth saved at hot path; simpler test code |
| Per-file Testcontainers startup | Vitest `globalSetup` + `project.provide()` | Vitest 1.0 + testcontainers-node 2024 | 30s cold-start paid ONCE per process instead of per-file |
| Full tool alias as Prometheus label | Workload prefix only; full alias as OTel span attribute | Prometheus best practice 2015+ | Cardinality drops from 14k × N → ~40 × N; feasible on vanilla Prometheus (no Mimir required) |
| `console.log` for OAuth test failures | `fetch(app.url)` + vitest assertions | Phase 2/3 pattern | Consistent with existing test style; zero new deps; reuses Phase 3 OAuth integration scaffolding |

**Deprecated/outdated:**
- `x-microsoft-refresh-token` custom header — removed in Phase 3 (SECUR-02). Phase 6 does NOT touch the refresh-token path.
- Winston logger — replaced by pino in Phase 1 plan 01-02. Phase 6 uses the pino logger directly.
- Keytar OS keychain — removed in Phase 1 plan 01-08. Phase 6 does not touch token storage.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `x-ms-resource-unit` values cap at ~10 for most workloads and ~100 for `$expand`-heavy reads. | §Code Examples `parseResourceUnit` — hardcoded cap at 100. | `[ASSUMED]` Exact upper bound not specified in Microsoft docs — verified only for directoryObjects/getByIds=5, GET users=2. If Graph ever returns >100 legitimately, a single expensive request could evict the tenant budget. Low risk — the cap is a defense-in-depth guard, not a correctness requirement; cap can be widened via env var in a patch release. |
| A2 | Grafana Labs ships schemaVersion 41+ in current releases and accepts v10-exported JSON in v11+. | §Pattern 8 (Grafana dashboard). | `[ASSUMED]` Based on Windows Exporter Dashboard 2025 reference. If operator is on Grafana v9 or earlier, plan 06-07 dashboard import may require schemaVersion downgrade. Document target version in README. |
| A3 | `supertest` is NOT required; raw `fetch(app.listen())` is sufficient for plan 06-05 OAuth tests. | §Standard Stack → Supporting. | `[ASSUMED]` Based on Phase 3 integration test style (`test/integration/pkce-redis-handoff.test.ts` uses raw fetch). If the OAuth tests need cookie jars or multipart fixtures, supertest may become necessary. Low risk — can add later without rework. |
| A4 | Line-range filtering within `src/server.ts` for D-10 coverage gate is implementable via a post-processing step on `coverage-final.json`, not via vitest-native `include`. | §Validation Architecture → Line-coverage measurement. | `[VERIFIED via vitest docs + GitHub issue #5423]` V8 coverage does NOT natively support line ranges within a file. `coverage.include: ['src/server.ts']` filters the file; post-process the `lcov.info` or `coverage-final.json` to count only the OAuth-handler line ranges. A small Node script (~30 LoC) in plan 06-05 will do this. |
| A5 | The Microsoft Graph `x-ms-resource-unit` header is returned on **successful** 2xx responses (not only on 429s). | §Plan 06-02 / D-05 wiring. | `[VERIFIED via Microsoft Learn docs throttling-limits]` — header is explicitly documented as "returned in regular (non-throttled) responses" indicating the resource unit consumed by that specific request. Our observe() call must run on the 2xx path, not only the 429 path. |
| A6 | ioredis-mock's `EVAL` implementation supports script-level atomicity for sliding-window semantics. | §Validation Architecture → unit tests. | `[VERIFIED via ioredis-mock compat.md]` — `eval` listed as fully supported. Unit tests must still exercise concurrency (parallel consume() calls against the mock) to verify no double-admit. If a mock concurrency gap emerges, fall back to Testcontainers-Redis for the unit tests too. |
| A7 | The `graph.request_id` span attribute name follows OTel semconv conventions. | §Span Attribute Schema. | `[ASSUMED]` — OTel semconv 1.40 does not define a `graph.*` namespace; this is a project-local attribute. Low risk — operator dashboards can match on attribute name; no contract with external systems. |
| A8 | Prometheus scrape interval ≥ 15s is compatible with the collection bucket defaults of the OTel SDK (cumulative temporality). | §Plan 06-03 scrape config. | `[ASSUMED]` — standard assumption for pull-based Prometheus. Sub-15s scrape may not catch delta-temporality resets cleanly if the SDK ever switches default. Current `PrometheusExporter` forces cumulative temporality in its constructor (verified in source), so this is safe. |

**This table is NON-EMPTY** → plan-check and discuss-phase should surface A1, A2, A3, A7, A8 to the user for confirmation before execution. A4, A5, A6 are verified.

## Open Questions (RESOLVED)

1. **Should plans 06-05 and 06-06 share a single `oauth-surface/` test directory or remain separate?**
   - What we know: ROADMAP specifies plan 06-05 covers OAuth-surface coverage gap, plan 06-06 covers multi-tenant correctness regression. Overlap: multi-tenant bearer-tid-mismatch is an OAuth concern.
   - What's unclear: whether multi-tenant concurrent-request tests belong in `oauth-surface/` or a sibling `multi-tenant/` folder.
   - RESOLVED: Recommendation: **Separate folders**. 06-05 tests live in `test/integration/oauth-surface/`, 06-06 tests live in `test/integration/multi-tenant/`. Cross-reference in both file headers.

2. **How should `mcp_token_cache_hit_ratio` be computed?**
   - What we know: ROADMAP lists the metric as a gauge per tenant. The MSAL token cache is backed by the Phase 3 Redis-encrypted session store.
   - What's unclear: Ratio over what window? Per-scrape delta, or rolling 1-minute average, or cumulative-since-startup?
   - RESOLVED: Recommendation: **Per-scrape delta** (cumulative counter of hits / cumulative counter of acquires; Prometheus computes `rate()` at query time). Simpler; also avoids a rolling-window buffer in memory.

3. **Does plan 06-07's Grafana dashboard need to handle both OTLP and Prometheus data sources?**
   - What we know: The metric names are the same regardless of source, but OTLP → Grafana routes through a different datasource (Tempo for traces; for metrics, typically Grafana Cloud's OTel-to-Prom translation).
   - What's unclear: Target reader audience — are we assuming Prometheus-only, or multi-backend?
   - RESOLVED: Recommendation: **Prometheus-only** starter dashboard. Document: "OTLP users should adapt PromQL → equivalent OTel-to-Prom translation in their data source."

4. **What's the right default value for `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN`?**
   - What we know: CONTEXT.md locks the default at 50000. Microsoft Graph tenant-level limit is 3500/5000/8000 ResourceUnits per 10 seconds per SKU.
   - What's unclear: Whether 50000/min (~833/10s) is conservative enough given an S tier (3500/10s). It's ~24% of S-tier budget — leaves headroom for other clients.
   - RESOLVED: Recommendation: **Keep 50000** as the documented default but include a sizing guide in plan 06-07's runbook: "Conservative for S tier; raise to 150000 for M tier, 300000 for L tier."

5. **Should `observe()` also gate (return allowed: false) when the graph-points budget is exhausted?**
   - What we know: D-05 says observe is informational (Graph itself has already returned 429, so the request is already over quota). CONTEXT.md implies observe is pure observation; the separate consume() path on `mcp:rl:req:{tenantId}` is the gate.
   - What's unclear: ROADMAP SC#3 says "AI assistant exceeding either [request budget OR graph-points budget] receives a structured 429 ... before any Graph call". That requires BOTH budgets to be consulted on the request-admit path, not just request-rate.
   - RESOLVED: Recommendation: **Gate on both.** The request-admit middleware calls `consume()` twice: once against `mcp:rl:req:{tid}` with cost=1, once against `mcp:rl:graph:{tid}` with cost=(historical average, or conservative floor like 2). If either denies, return 429. `observe()` (post-response) then adjusts the `mcp:rl:graph:{tid}` key with the actual cost observed. This satisfies SC#3 while letting the observed-cost accounting self-tune.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker daemon | Plan 06-05 / 06-06 integration tests (Testcontainers) | ✓ (assumed for CI) | Varies | `pg-mem` + `ioredis-mock` for unit tier; integration tier skipped when `MS365_MCP_INTEGRATION=1` not set |
| PostgreSQL 16 | Admin PATCH integration tests | ✓ via Testcontainers | `postgres:16-alpine` | `pg-mem` (already installed) |
| Redis 7 | Rate-limit integration tests | ✗ (current dev machine — not installed via apt/brew) | — | `ioredis-mock` + Testcontainers for CI |
| Node 22 LTS | Runtime | ✓ | Per Dockerfile | n/a |
| `@testcontainers/redis` npm package | Integration tests | ✗ Not installed | 11.14.0 latest | Install via `npm install --save-dev @testcontainers/redis` — plan 06-05 task 0 |
| OTel collector endpoint | Optional OTLP export | ✗ (operator-supplied) | n/a | Phase 6 works without — traces stay in-process, metrics still expose on /metrics |

**Missing dependencies with no fallback:**
- None that block execution. All Phase 6 code runs in CI + dev without external services; OTel endpoints are optional.

**Missing dependencies with fallback:**
- `@testcontainers/redis` → install command included in plan 06-05 task 0.
- Redis 7 on dev machine → `ioredis-mock` + Testcontainers for CI.

## Validation Architecture

> Nyquist validation enabled per `.planning/config.json` (`workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^3.1.1 + @vitest/coverage-v8 ^3.2.4 |
| Config file | `vitest.config.js` (single file; integration pattern already gated by `MS365_MCP_INTEGRATION=1`) |
| Quick run command | `npm test` |
| Full integration command | `npm run test:int` (= `MS365_MCP_INTEGRATION=1 NODE_OPTIONS=--max-old-space-size=12288 vitest run`) |
| Coverage command | `vitest run --coverage` (uses @vitest/coverage-v8 — already installed) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-05 | Every `GraphClient.makeRequest` emits an OTel `graph.request` span with required attrs | unit | `npx vitest run test/lib/graph-client.span.test.ts` | ❌ Wave 0 |
| OPS-05 | RetryHandler sets `retryCount` + `lastStatus` onto span context | unit | `npx vitest run test/lib/middleware/retry.span.test.ts` | ✅ (extend existing `test/middleware/retry-middleware.test.ts`) |
| OPS-06 | `mcp_tool_calls_total` increments once per Graph call with correct {tenant, tool, status} | unit | `npx vitest run test/lib/otel-metrics.test.ts` | ❌ Wave 0 |
| OPS-06 | `mcp_tool_duration_seconds` histogram records duration with tenant/tool labels | unit | same | ❌ Wave 0 |
| OPS-06 | `mcp_graph_throttled_total` increments on 429 only | unit | same | ❌ Wave 0 |
| OPS-06 | Workload prefix (not full alias) appears on metric labels (D-06) | unit | `npx vitest run test/lib/otel-metrics.labels.test.ts` | ❌ Wave 0 |
| OPS-07 | `/metrics` on port 9464 returns 200 + Prometheus text exposition | integration | `MS365_MCP_INTEGRATION=1 npx vitest run test/integration/metrics-endpoint.int.test.ts` | ❌ Wave 0 |
| OPS-07 | Bearer auth gates metrics when `MS365_MCP_METRICS_BEARER` set | integration | same | ❌ Wave 0 |
| OPS-07 | Missing/wrong Bearer → 401 + WWW-Authenticate header | integration | same | ❌ Wave 0 |
| OPS-08 | `consume(tenantId, window, max)` returns allowed=false at `max+1` | unit | `npx vitest run test/lib/rate-limit/sliding-window.test.ts` | ❌ Wave 0 |
| OPS-08 | ZSET script is atomic under concurrent consume() | unit | same (ioredis-mock concurrency) | ❌ Wave 0 |
| OPS-08 | Rate-limit middleware returns 429 + Retry-After when over budget | integration | `MS365_MCP_INTEGRATION=1 npx vitest run test/integration/rate-limit/gateway-429.int.test.ts` | ❌ Wave 0 |
| OPS-08 | `mcp_rate_limit_blocked_total{reason}` increments on 429 | integration | same | ❌ Wave 0 |
| D-11 | Admin PATCH `/admin/tenants/:id` accepts `rate_limits` object | integration | `MS365_MCP_INTEGRATION=1 npx vitest run test/integration/rate-limit/admin-config.int.test.ts` | ❌ Wave 0 |
| D-11 | Invalid `rate_limits` shape (negative / missing fields) → 400 | integration | same | ❌ Wave 0 |
| D-11 | Missing `rate_limits` → platform defaults applied at consumption time | integration | same | ❌ Wave 0 |
| D-10 | OAuth surface line coverage on `src/server.ts` ≥ 70% | integration (coverage) | `npm run test:int -- --coverage && node bin/check-oauth-coverage.mjs` | ❌ Wave 0 (script) |
| ROADMAP SC#4 | Two concurrent PKCE flows interleave correctly (no state cross-talk) | integration | `MS365_MCP_INTEGRATION=1 npx vitest run test/integration/oauth-surface/pkce-concurrent.int.test.ts` | ❌ Wave 0 |
| ROADMAP SC#4 | Dynamic-register with `javascript:` redirect → 400 | integration | `MS365_MCP_INTEGRATION=1 npx vitest run test/integration/oauth-surface/register-invalid-redirect.int.test.ts` | ❌ Wave 0 (may extend `test/oauth-register-hardening.test.ts`) |
| ROADMAP SC#4 | Multi-tenant token isolation: two tenants, same userOid → no cache hit | integration | `MS365_MCP_INTEGRATION=1 npx vitest run test/integration/multi-tenant/token-isolation.int.test.ts` | ✅ (extend existing `test/integration/multi-tenant-isolation.test.ts`) |
| ROADMAP SC#4 | Tenant disable → MSAL eviction + Redis cryptoshred cascades | integration | `MS365_MCP_INTEGRATION=1 npx vitest run test/integration/multi-tenant/disable-cascade.int.test.ts` | ✅ (extend existing `test/integration/tenant-disable-cascade.test.ts`) |
| ROADMAP SC#4 | Bearer pass-through with wrong `tid` claim → 401 | integration | `MS365_MCP_INTEGRATION=1 npx vitest run test/integration/multi-tenant/bearer-tid-mismatch.int.test.ts` | ❌ Wave 0 |

### Test Dimensions Needed

Phase 6 tests decompose into 4 dimensions:

1. **Observability unit tests** (plan 06-02 / 06-03): instrument emission verified via an in-memory MeterProvider reader. No network. Runs under `npm test`.
2. **Rate-limit unit tests** (plan 06-04): ZSET + Lua logic verified via `ioredis-mock`. No network. Runs under `npm test`.
3. **Integration tests** (plans 06-03, 06-04, 06-05, 06-06): Real Postgres + Redis via Testcontainers. Runs under `npm run test:int` (CI only).
4. **Coverage measurement pass** (plan 06-05): integration run with `--coverage`, then post-process `coverage-final.json` to count hits on OAuth-specific line ranges of `src/server.ts`.

### Unit vs Integration Tier Split

**Unit tier (fast, hermetic, runs on every PR):**
- `test/lib/otel-metrics.test.ts` — Meter instruments + label cardinality
- `test/lib/rate-limit/sliding-window.test.ts` — ZSET Lua correctness (ioredis-mock)
- `test/lib/graph-client.span.test.ts` — parent span attrs (InMemorySpanExporter)
- `test/lib/middleware/retry.span.test.ts` — retry attrs flow

**Integration tier (opt-in via `MS365_MCP_INTEGRATION=1`, runs in CI only):**
- `test/integration/metrics-endpoint.int.test.ts` — Prometheus port 9464 roundtrip
- `test/integration/rate-limit/gateway-429.int.test.ts` — middleware → 429 response
- `test/integration/rate-limit/admin-config.int.test.ts` — Admin PATCH persists config
- `test/integration/oauth-surface/*.int.test.ts` — five files, one per OAuth endpoint category
- `test/integration/multi-tenant/*.int.test.ts` — extends three existing

### Specific Harness / Fixture Requirements

1. **`@testcontainers/redis` devDep** — `npm install --save-dev @testcontainers/redis` (plan 06-05 task 0). Version pin to 11.14.0 to match `@testcontainers/postgresql`.

2. **Vitest globalSetup** — create `test/setup/integration-globalSetup.ts` (new). Export `setup(project)` + `teardown()` that start/stop a single Postgres + Redis container per vitest process, expose via `project.provide('pgUrl', ...)` and `project.provide('redisUrl', ...)`. Gate on `MS365_MCP_INTEGRATION === '1'` — unit-only runs skip container startup. Wire in `vitest.config.js`:
   ```js
   test: {
     // ... existing config ...
     globalSetup: ['./test/setup/integration-globalSetup.ts'],
   }
   ```

3. **In-memory OTel reader for unit tests** — create `test/setup/otel-test-reader.ts` helper:
   ```typescript
   import { InMemoryMetricExporter, PeriodicExportingMetricReader, AggregationTemporality } from '@opentelemetry/sdk-metrics';
   import { MeterProvider } from '@opentelemetry/sdk-metrics';
   export function setupTestMeterProvider() {
     const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
     const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 100_000 });
     const provider = new MeterProvider({ readers: [reader] });
     // Force a collection: `await reader.collect()`
     return { provider, exporter, reader };
   }
   ```

4. **Tenant seed fixture for integration tests** — a shared helper that inserts a test tenant into pg with known `client_id`, `tenant_id`, and `rate_limits`. Plans 06-04, 06-05, 06-06 all need this. Reuse the existing `test/integration/runtime-tenant-onboarding.test.ts` pattern.

5. **PKCE fixture generator** — helper that returns a freshly-generated `{ codeVerifier, codeChallenge }` pair per invocation:
   ```typescript
   function newPkce() {
     const verifier = crypto.randomBytes(32).toString('base64url');
     const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
     return { verifier, challenge };
   }
   ```

6. **Concurrent PKCE test pattern** — plan 06-05's two-concurrent-flows test:
   ```typescript
   test('two concurrent PKCE flows do not cross-contaminate', async () => {
     const pkceA = newPkce();
     const pkceB = newPkce();
     // A starts /authorize first
     const respA1 = await fetch(`${origin}/t/${tenantA}/authorize?code_challenge=${pkceA.challenge}&...`);
     const locA = respA1.headers.get('location');
     // B starts /authorize second, interleaved
     const respB1 = await fetch(`${origin}/t/${tenantB}/authorize?code_challenge=${pkceB.challenge}&...`);
     const locB = respB1.headers.get('location');
     // ... both /token round-trips in parallel ...
     const [tokA, tokB] = await Promise.all([
       fetch(`${origin}/t/${tenantA}/token`, { method: 'POST', body: `code=fakeA&code_verifier=${pkceA.verifier}&...` }),
       fetch(`${origin}/t/${tenantB}/token`, { method: 'POST', body: `code=fakeB&code_verifier=${pkceB.verifier}&...` }),
     ]);
     // Assert each tenant's /token succeeded with the other's code_verifier → 400
     // + each tenant's own verifier → 200
   });
   ```

### Line-Coverage Measurement Approach for D-10

vitest's v8 coverage provider does NOT support line-range filtering within a single file (verified via GitHub issue #5423). Approach:

1. `coverage.include: ['src/server.ts']` — narrow the file set to server.ts.
2. Run `vitest run --coverage` and dump `coverage/coverage-final.json` (V8 JSON format).
3. Write `bin/check-oauth-coverage.mjs` (~40 LoC Node script):
   - Parse `coverage-final.json`.
   - For `src/server.ts`, extract all `statementMap` entries whose location falls within OAuth-handler line ranges:
     - `createAuthorizeHandler` (lines identified during plan 06-05 discovery)
     - `createTokenHandler` (…)
     - `createRegisterHandler` (…)
     - `/.well-known/oauth-authorization-server` route handler (…)
     - `/.well-known/oauth-protected-resource` route handler (…)
   - Count hit vs total statements in those ranges.
   - Print `OAuth-surface coverage: X/Y = Z%` and exit non-zero if Z < 70.
4. CI step runs `npm run test:int -- --coverage && node bin/check-oauth-coverage.mjs` in plan 06-05 verification gate.

**Line-range discovery:** Plan 06-05 task 0 should `grep -n 'createAuthorizeHandler\|createTokenHandler\|createRegisterHandler\|/\\.well-known'` to enumerate the function bounds, then hard-code the ranges in `bin/check-oauth-coverage.mjs`. These ranges are stable (grep-anchored); a future refactor that moves the functions invalidates the script and the CI gate catches it.

### Sampling Rate

- **Per task commit:** `npx vitest run test/lib/<path-touched>.test.ts` — run only the tests for the module just edited. Completes in <5s for unit tests.
- **Per wave merge:** `npm test` — full unit suite (no Docker required). Completes in ~90s on the project's current `singleThread + fileParallelism: false` config.
- **Phase gate (pre-/gsd-verify-work):** `npm run test:int` — full unit + integration suite including Testcontainers. Completes in ~8-12 minutes in CI (cold start dominates first file).
- **Coverage gate (plan 06-05):** `npm run test:int -- --coverage && node bin/check-oauth-coverage.mjs` — adds ~2 minutes to the integration run.

### Wave 0 Gaps

- [ ] `test/lib/otel-metrics.test.ts` — covers OPS-06, D-06
- [ ] `test/lib/graph-client.span.test.ts` — covers OPS-05
- [ ] `test/lib/rate-limit/sliding-window.test.ts` — covers OPS-08 (unit)
- [ ] `test/setup/integration-globalSetup.ts` — shared Postgres + Redis fixtures for integration tier (replaces/extends current `test/setup/testcontainers.ts`)
- [ ] `test/setup/otel-test-reader.ts` — in-memory OTel reader helper
- [ ] `test/integration/metrics-endpoint.int.test.ts` — covers OPS-07
- [ ] `test/integration/rate-limit/gateway-429.int.test.ts` — covers OPS-08 (integration)
- [ ] `test/integration/rate-limit/admin-config.int.test.ts` — covers D-11
- [ ] `test/integration/oauth-surface/pkce-concurrent.int.test.ts` — covers SC#4
- [ ] `test/integration/oauth-surface/register-invalid-redirect.int.test.ts` — covers SC#4
- [ ] `test/integration/oauth-surface/token-error-paths.int.test.ts` — covers D-10 + SC#5
- [ ] `test/integration/oauth-surface/well-known-metadata.int.test.ts` — covers D-10
- [ ] `test/integration/multi-tenant/bearer-tid-mismatch.int.test.ts` — covers SC#4
- [ ] `bin/check-oauth-coverage.mjs` — CI gate script for D-10
- [ ] Framework install: `npm install --save-dev @testcontainers/redis` — plan 06-05 task 0

**Existing test infrastructure covers:** vitest 3.1.1 framework, @testcontainers/postgresql 11.14.0, pg-mem 3.0.14, ioredis-mock 8.13.1, @vitest/coverage-v8 3.2.4, shared `test/setup.ts` with permissive stdio fallback. The gap is all test files + the Redis testcontainer package + the globalSetup wiring.

## Security Domain

**Scope:** `security_enforcement` not set to false in config → security domain is in scope.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (metrics endpoint) | Optional Bearer token with `crypto.timingSafeEqual` comparison |
| V3 Session Management | yes (indirectly — PKCE store gauge) | Reuses Phase 3's RedisPkceStore; Phase 6 adds read-only `size()` method — no new session write path |
| V4 Access Control | yes | Admin PATCH rate_limits reuses existing admin dual-stack auth (Entra OAuth OR API key); RBAC enforced by existing `canActOnTenant` helper |
| V5 Input Validation | yes | New Zod schema `RateLimitsZod` validates shape + bounds (positive integers, reasonable max) |
| V6 Cryptography | no | Phase 6 does not touch encryption. KEK / DEK / envelope cryptography unchanged (Phase 3 owned). Bearer auth is a shared-secret compare, not cryptographic. |
| V8 Data Protection | yes | Metric labels scrubbed of PII — tenant ID is the identifier; tool names are workload prefixes, not PII. `x-ms-resource-unit` is a cost number, not PII. Prometheus text exposition includes metric values but not request content. |
| V13 API | yes | `/metrics` endpoint on a separate port with its own auth profile matches the Phase 4 "dual-stack admin" pattern (different port + different auth for different surface) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Metric-scrape DoS (attacker floods port 9464) | Denial of Service | Bind to 0.0.0.0 only with Bearer required in prod; bind to 127.0.0.1 or container-only network when Bearer absent; document reverse-proxy rate-limit in runbook |
| Metric cardinality explosion | Denial of Service | D-06 workload-prefix label; cap `tool` label to ≤100 known workload values; tenant label cardinality = tenant count (bounded by admin-onboarded tenants) |
| Bearer token timing oracle | Information Disclosure | `crypto.timingSafeEqual` — constant-time compare (see §Pattern 3) |
| Rate-limit bypass via clock skew | Elevation of Privilege | Lua script reads `redis.call('TIME')` for atomic timestamp; NTP-sync assumption for multi-replica deploys documented |
| Lua script injection | Code Execution | Script is loaded from a static `.lua` file at client construction; no runtime string concatenation of user input into the script body |
| PKCE store enumeration via size gauge | Information Disclosure | `mcp_oauth_pkce_store_size` is a single aggregate count, no labels — reveals only population size, not individual entries |
| Observed-cost budget poisoning | Tampering | `parseResourceUnit` caps observed weight at 100 (§Code Examples) — a malicious/malformed Graph response cannot blow a tenant's quota in one call |
| Rate-limit admin override by tenant-scoped admin | Elevation of Privilege | Existing `canActOnTenant(admin, id)` RBAC in `src/lib/admin/tenants.ts` covers PATCH /tenants/:id — tenant-scoped admin may set their own rate_limits; global admin may set any tenant's |
| Metric endpoint cross-tenant leakage | Information Disclosure | Metrics are aggregated across all tenants on a single scrape endpoint. Operator-level exposure (operators see all-tenant counts) is acceptable; per-tenant labels ARE exposed to the scraper. Document that the scraper is an operator trust boundary. |

### Security Hardening Checklist for Phase 6 Plans

- [ ] `MS365_MCP_METRICS_BEARER` uses `crypto.timingSafeEqual` — not `===`
- [ ] `/metrics` returns `WWW-Authenticate: Bearer` on 401
- [ ] Lua script loaded from file (not string literal in JS) and file has no write access in container image
- [ ] `rate_limits` Zod schema rejects negative, zero, and `Infinity` values; caps max at realistic ceilings (1M req/min, 10M graph points/min)
- [ ] Rate-limit middleware returns 429 (not 500) on Redis unavailability → fail-closed per security principle (availability trade-off acceptable: a Redis outage blocks traffic rather than silently admitting)
- [ ] Observable gauges never expose raw token bytes, user IDs, or cleartext PKCE values
- [ ] No `[VERIFIED: ...]` or `[CITED: ...]` attribute names contain `Authorization` / `refresh_token` / `access_token` — the pino redact chain from Phase 1 already covers log output, but span attributes are a separate emission path
- [ ] OAuth integration tests verify log-redaction contracts (grep emitted pino log lines for `refresh_token` → MUST have 0 matches)

## Sources

### Primary (HIGH confidence)

- `src/lib/otel.ts` — existing Phase 1 OTel bootstrap (read in full) — `[VERIFIED: local file]`
- `src/graph-client.ts` — single chokepoint for Graph traffic (read in full) — `[VERIFIED: local file]`
- `src/lib/middleware/retry.ts` — existing Retry-After parser + span emitter (read in full) — `[VERIFIED: local file]`
- `src/lib/admin/tenants.ts` — admin PATCH handler Phase 6 extends (read in full) — `[VERIFIED: local file]`
- `src/lib/admin/webhooks.ts` — existing fixed-window rate-limit for contrast (read relevant lines) — `[VERIFIED: local file]`
- `src/lib/redis-facade.ts` — confirms lack of ZSET support (read in full) — `[VERIFIED: local file]`
- `src/lib/pkce-store/pkce-store.ts` — PkceStore interface (read in full) — `[VERIFIED: local file]`
- `src/lib/tool-selection/registry-validator.ts` — `extractWorkloadPrefix` implementation — `[VERIFIED: local file]`
- `node_modules/@opentelemetry/exporter-prometheus/build/src/PrometheusExporter.d.ts` — public API — `[VERIFIED: reading .d.ts]`
- `node_modules/@opentelemetry/exporter-prometheus/build/src/PrometheusExporter.js` — `preventServerStart` + `getMetricsRequestHandler` confirmed — `[VERIFIED: reading .js source]`
- `node_modules/ioredis-mock/compat.md` — ZSET + EVAL support — `[VERIFIED: reading compat table]`
- `vitest.config.js` — `MS365_MCP_INTEGRATION` gate + singleThread config — `[VERIFIED: local file]`
- `package.json` — deps and scripts — `[VERIFIED: local file]`
- Microsoft Learn — Graph throttling: https://learn.microsoft.com/en-us/graph/throttling — `[CITED]`
- Microsoft Learn — Graph service-specific throttling limits + x-ms-resource-unit spec: https://learn.microsoft.com/en-us/graph/throttling-limits — `[CITED]`
- OpenTelemetry JS ESM support doc: https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md — `[CITED]`
- OpenTelemetry HTTP semantic conventions: https://opentelemetry.io/docs/specs/semconv/http/http-spans/ — `[CITED]`
- OpenTelemetry Metrics API spec: https://opentelemetry.io/docs/specs/otel/metrics/api/ — `[CITED]`
- ioredis TypeScript scripts example: https://github.com/redis/ioredis/blob/main/examples/typescript/scripts.ts — `[CITED]`
- Testcontainers NodeJS globalSetup: https://node.testcontainers.org/quickstart/global-setup/ — `[CITED]`

### Secondary (MEDIUM confidence)

- ClassDojo engineering — sliding-window rationale + MULTI/EXEC rate-limit race: https://engineering.classdojo.com/blog/2015/02/06/rolling-rate-limiter/ — `[CITED]`
- OneUptime — sliding-window rate limit with Redis (2026): https://oneuptime.com/blog/post/2026-01-25-redis-sliding-window-rate-limiting/view — `[CITED]`
- atomaras gist (canonical Lua script sliding-window): https://gist.github.com/atomaras/925a13f07c24df7f15dcc4fb7bc89c81 — `[CITED]`
- Grafana dashboard JSON model reference: https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/view-dashboard-json-model/ — `[CITED]`
- Last9 — OpenTelemetry cardinality best practices: https://last9.io/blog/how-to-manage-high-cardinality-metrics-in-prometheus/ — `[CITED]`
- Vitest coverage filtering issue #5423: https://github.com/vitest-dev/vitest/issues/5423 — `[CITED]`

### Tertiary (LOW confidence / assumptions)

- Grafana schemaVersion 41+ applicability to plan 06-07 dashboard — assumption flagged in §Assumptions Log A2
- `@opentelemetry/semantic-conventions` has no `graph.*` namespace — assumption A7
- 15s scrape interval compatibility with current cumulative-temporality defaults — assumption A8

## External References

**For the planner to cite in PLAN.md files:**

- **OpenTelemetry:**
  - Metrics API spec — https://opentelemetry.io/docs/specs/otel/metrics/api/
  - HTTP semantic conventions — https://opentelemetry.io/docs/specs/semconv/http/http-spans/
  - Semantic conventions root — https://opentelemetry.io/docs/specs/semconv/
  - ESM support doc — https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md
  - Prometheus exporter README — https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-exporter-prometheus

- **Prometheus:**
  - Label naming + cardinality — https://prometheus.io/docs/practices/naming/#labels
  - Instrumentation best practices — https://prometheus.io/docs/practices/instrumentation/
  - Histogram/summary selection — https://prometheus.io/docs/practices/histograms/

- **Microsoft Graph:**
  - Throttling guidance — https://learn.microsoft.com/en-us/graph/throttling
  - Service-specific throttling limits (x-ms-resource-unit spec) — https://learn.microsoft.com/en-us/graph/throttling-limits

- **RFCs:**
  - RFC 6585 §4 (Retry-After) — https://datatracker.ietf.org/doc/html/rfc6585
  - RFC 7231 §7.1.3 (Retry-After HTTP-date form) — https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.3
  - RFC 7636 (PKCE) — https://datatracker.ietf.org/doc/html/rfc7636
  - RFC 8414 (.well-known OAuth authorization-server metadata) — https://datatracker.ietf.org/doc/html/rfc8414

- **Testcontainers & Vitest:**
  - Testcontainers NodeJS globalSetup — https://node.testcontainers.org/quickstart/global-setup/
  - Vitest globalSetup config — https://vitest.dev/config/#globalsetup
  - Vitest coverage config — https://vitest.dev/config/coverage

- **Grafana:**
  - Dashboard JSON model — https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/view-dashboard-json-model/
  - Dashboard HTTP API — https://grafana.com/docs/grafana/latest/developer-resources/api-reference/http-api/dashboard/

- **ioredis:**
  - defineCommand docs — https://ioredis.readthedocs.io/en/latest/API/#redisdefinecommandnameoptions
  - TypeScript scripts example — https://github.com/redis/ioredis/blob/main/examples/typescript/scripts.ts

## File-by-File Impact List

Every file each of the 7 plans will touch, annotated with reason:

| Plan | File | Reason | Create / Modify |
|------|------|--------|-----------------|
| 06-01 | `src/lib/otel.ts` | Adjust `PrometheusExporter` instantiation to use `preventServerStart: true`; export the exporter for plan 06-03 to host | Modify |
| 06-01 | `.env.example` | Document `MS365_MCP_METRICS_PORT`, `MS365_MCP_METRICS_BEARER`, `MS365_MCP_DEFAULT_REQ_PER_MIN`, `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` | Modify |
| 06-01 | `docs/observability/env-vars.md` | New doc listing OTel + Prometheus + rate-limit env vars with examples | Create |
| 06-01 | `test/lib/otel-bootstrap.test.ts` | Verification test — SDK starts, no duplicate port bind | Create |
| 06-02 | `src/lib/otel-metrics.ts` | New Meter singleton + instrument exports (counters, histograms, gauges) | Create |
| 06-02 | `src/graph-client.ts` | Wrap `makeRequest` in parent `graph.request` span + emit counters/histogram | Modify |
| 06-02 | `src/lib/middleware/retry.ts` | After 429, increment `mcp_graph_throttled_total`; call `rate-limit.observe` (plan 06-04 adds the import) | Modify |
| 06-02 | `src/request-context.ts` | Optional: add `toolAlias` field so `makeRequest` can read it for the workload-prefix label | Modify |
| 06-02 | `src/graph-tools.ts` | Set `toolAlias` on the `requestContext.run(...)` frame around each tool dispatch | Modify |
| 06-02 | `test/lib/otel-metrics.test.ts` | Unit tests — label cardinality, counter increment, histogram recording | Create |
| 06-02 | `test/lib/graph-client.span.test.ts` | Unit tests — parent span name, attrs, duration | Create |
| 06-03 | `src/lib/metrics-server/metrics-server.ts` | New Express app on port 9464 wrapping `getMetricsRequestHandler` | Create |
| 06-03 | `src/lib/metrics-server/bearer-auth.ts` | Bearer auth middleware with timingSafeEqual | Create |
| 06-03 | `src/server.ts` | Wire the metrics server at startup when `MS365_MCP_PROMETHEUS_ENABLED=1`; register shutdown hook | Modify |
| 06-03 | `src/lib/pkce-store/pkce-store.ts` | Extend interface with `size(): Promise<number>` | Modify |
| 06-03 | `src/lib/pkce-store/redis-store.ts` | Implement `size()` via SCAN | Modify |
| 06-03 | `src/lib/pkce-store/memory-store.ts` | Implement `size()` via `Map.size` | Modify |
| 06-03 | `test/integration/metrics-endpoint.int.test.ts` | Integration — GET /metrics responses, Bearer auth | Create |
| 06-04 | `src/lib/rate-limit/sliding-window.ts` | New module — `consume`, `observe`, `registerSlidingWindow` | Create |
| 06-04 | `src/lib/rate-limit/sliding-window.lua` | New Lua script file (loaded at client construction) | Create |
| 06-04 | `src/lib/rate-limit/defaults.ts` | Platform defaults from env vars | Create |
| 06-04 | `src/lib/rate-limit/middleware.ts` | Express middleware — reads `req.tenant.rate_limits`, calls consume(), returns 429 on deny | Create |
| 06-04 | `src/lib/middleware/retry.ts` | Call `observe(tenantId, resourceUnits)` after 2xx | Modify (extends 06-02 changes) |
| 06-04 | `src/lib/redis.ts` | Call `registerSlidingWindow()` at getRedis() construction (real-Redis branch only; stdio-facade short-circuits) | Modify |
| 06-04 | `src/lib/admin/tenants.ts` | Extend `CreateTenantZod` + add `addSet('rate_limits', ...)` in PATCH handler | Modify |
| 06-04 | `src/lib/tenant/tenant-row.ts` | Add `rate_limits: { request_per_min, graph_points_per_min } \| null` field | Modify |
| 06-04 | `migrations/20260901000000_tenant_rate_limits.sql` | Add `rate_limits JSONB NULL` column | Create |
| 06-04 | `src/server.ts` | Mount the rate-limit middleware in the per-tenant chain between `loadTenant` and `/mcp` dispatch | Modify |
| 06-04 | `test/lib/rate-limit/sliding-window.test.ts` | Unit — ZSET+Lua correctness | Create |
| 06-04 | `test/integration/rate-limit/gateway-429.int.test.ts` | Integration — full middleware → 429 roundtrip | Create |
| 06-04 | `test/integration/rate-limit/admin-config.int.test.ts` | Integration — admin PATCH rate_limits | Create |
| 06-05 | `package.json` | Add `@testcontainers/redis` devDep | Modify |
| 06-05 | `test/setup/integration-globalSetup.ts` | Shared Postgres + Redis container startup for integration tier | Create (replaces/extends `test/setup/testcontainers.ts`) |
| 06-05 | `test/setup/otel-test-reader.ts` | In-memory OTel reader helper | Create |
| 06-05 | `vitest.config.js` | Wire `globalSetup`; `coverage.include: ['src/server.ts']` for the coverage pass | Modify |
| 06-05 | `test/integration/oauth-surface/pkce-concurrent.int.test.ts` | Two concurrent PKCE flows | Create |
| 06-05 | `test/integration/oauth-surface/register-invalid-redirect.int.test.ts` | Dynamic-register validation | Create |
| 06-05 | `test/integration/oauth-surface/token-error-paths.int.test.ts` | /token error branches (no body in logs) | Create |
| 06-05 | `test/integration/oauth-surface/well-known-metadata.int.test.ts` | `/.well-known/*` correctness with/without PUBLIC_URL | Create |
| 06-05 | `bin/check-oauth-coverage.mjs` | Post-process coverage-final.json → OAuth-surface coverage report | Create |
| 06-05 | `.github/workflows/ci.yml` (if exists) | Wire the coverage gate step | Modify |
| 06-06 | `test/integration/multi-tenant/token-isolation.int.test.ts` | Two tenants same userOid → no cache hit | Create (may reuse `test/integration/multi-tenant-isolation.test.ts`) |
| 06-06 | `test/integration/multi-tenant/disable-cascade.int.test.ts` | Tenant disable → MSAL eviction + cryptoshred | Create (may reuse `test/integration/tenant-disable-cascade.test.ts`) |
| 06-06 | `test/integration/multi-tenant/bearer-tid-mismatch.int.test.ts` | Bearer tid claim vs URL tenant ID → 401 | Create |
| 06-07 | `docs/observability/grafana-starter.json` | 3-5 panel Grafana v10-compatible JSON | Create |
| 06-07 | `docs/observability/prometheus-scrape.yml` | Reference scrape-target config | Create |
| 06-07 | `docs/observability/runbook.md` | Operator alerts + rate-limit tuning + KEK rotation + reverse-proxy configs | Create |
| 06-07 | `docs/observability/README.md` | Index page — which files, how to import dashboard, where metrics come from | Create |
| 06-07 | `docs/observability/metrics-reference.md` | Per-metric documentation: name, labels, typical values | Create |
| 06-07 | `.env.example` | Polish env-var section with rate-limit tuning hints | Modify (final polish) |

**Total estimated changes:** 7 new source modules (otel-metrics, metrics-server/*, rate-limit/*), 1 SQL migration, ~15 new test files, 5+ doc files, modifications to ~10 existing source files.

## Span Attribute Schema (for planner reference)

Phase 6 locks these attribute names on the `graph.request` parent span:

| Attribute | Type | Source | Cardinality | Required |
|-----------|------|--------|-------------|----------|
| `tenant.id` | string (UUID) | `requestContext.tenantId` | bounded by tenant count | yes |
| `tool.name` | string | `extractWorkloadPrefix(alias)` | ≤ ~40 | yes |
| `tool.alias` | string | raw alias from dispatch | ~14k | yes (span only — NOT metric label) |
| `http.request.method` | string | `GET\|POST\|PATCH\|DELETE\|PUT` | 5 | yes |
| `http.response.status_code` | int | fetch response.status | ~20 | yes |
| `graph.request_id` | string | `response.headers.get('request-id')` OR GraphError.requestId | ~unbounded per request | yes (when present) |
| `retry.count` | int | `requestContext.retryCount` | 0-3 | yes (when RetryHandler ran) |
| `duration_ms` | int | measured | — | yes (span duration already encodes this; emit as attribute for query convenience) |
| `auth.flow` | string | `requestContext.flow` | 4 | no (Claude's Discretion) |
| `cache.hit` | bool | TokenRefreshMiddleware emission | 2 | no (Claude's Discretion) |

For the **metric labels**, the intentionally narrower schema is: `{tenant, tool, status}` ONLY. `tool` = workload prefix. `status` = HTTP status code (as string). No `auth.flow`, no `cache.hit` in labels.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is in `node_modules/` and verified via `.d.ts` reading; versions current.
- Architecture: HIGH — single chokepoint instrumentation at `GraphClient.makeRequest` is the canonical pattern for outbound client-side HTTP spans + metrics.
- Pitfalls: HIGH (pitfalls 1-8 grounded in verified behavior of installed versions) / MEDIUM (pitfall 9 depends on actual runtime behavior of Node 22 + current `otel.ts` bootstrap — plan 06-01 verification test will disambiguate).
- Rate-limit algorithm: HIGH — ZSET+Lua is the canonical pattern; the script above is a synthesis of three canonical references and the existing webhook rate-limiter's spirit.
- Testing strategy: HIGH — vitest + Testcontainers globalSetup + ioredis-mock for unit is industry-standard for 2026.
- D-10 coverage gate: MEDIUM — line-range filtering within a file requires a custom post-processor; the approach works but the exact line ranges must be discovered at plan-time, not research-time.

**Research date:** 2026-04-22
**Valid until:** 2026-05-22 (30 days — Node/OTel/Prometheus ecosystem is stable at these versions; accelerated only if Node 24 LTS or OTel 2.0 ships)
