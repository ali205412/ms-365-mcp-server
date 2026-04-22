# Phase 6: Operational Observability & Rate Limiting — Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 29 (17 new, 12 modified)
**Analogs found:** 27 / 29 (2 have no exact analog and fall back to RESEARCH.md excerpts)

## Table of Contents

1. [File Classification](#file-classification)
2. [Shared / Cross-Cutting Patterns](#shared--cross-cutting-patterns)
3. New source modules
   - [`src/lib/otel-metrics.ts`](#srcliboteltimetricsts-new--plan-06-02)
   - [`src/lib/rate-limit/sliding-window.ts`](#srclibrate-limitsliding-windowts-new--plan-06-04)
   - [`src/lib/rate-limit/sliding-window.lua`](#srclibrate-limitsliding-windowlua-new--plan-06-04)
   - [`src/lib/rate-limit/middleware.ts`](#srclibrate-limitmiddlewarets-new--plan-06-04)
   - [`src/lib/rate-limit/defaults.ts`](#srclibrate-limitdefaultsts-new--plan-06-04)
   - [`src/lib/metrics-server/metrics-server.ts`](#srclibmetrics-servermetrics-serverts-new--plan-06-03)
   - [`src/lib/metrics-server/bearer-auth.ts`](#srclibmetrics-serverbearer-authts-new--plan-06-03)
4. Existing source files to modify
   - [`src/lib/otel.ts`](#srcliboteltts-modify--plan-06-01--06-03)
   - [`src/graph-client.ts`](#srcgraph-clientts-modify--plan-06-02)
   - [`src/lib/middleware/retry.ts`](#srclibmiddlewareretryts-modify--plan-06-02--06-04)
   - [`src/lib/admin/tenants.ts`](#srclibadmintenantsts-modify--plan-06-04)
   - [`src/lib/tenant/tenant-row.ts`](#srclibtenanttenant-rowts-modify--plan-06-04)
   - [`src/lib/redis.ts`](#srclibredists-modify--plan-06-04)
   - [`src/lib/pkce-store/*.ts`](#srclibpkce-storets-modify-all-3--plan-06-03)
   - [`src/request-context.ts`](#srcrequest-contextts-modify--plan-06-02)
   - [`src/graph-tools.ts`](#srcgraph-toolsts-modify--plan-06-02)
   - [`src/server.ts`](#srcserverts-modify--plans-06-03--06-04)
   - [`src/index.ts`](#srcindexts-modify--plan-06-03)
   - [`vitest.config.js`](#vitestconfigjs-modify--plan-06-05)
   - [`.env.example`](#envexample-modify--plans-06-01--06-07)
5. New migration
   - [`migrations/20260901000000_tenant_rate_limits.sql`](#migrations20260901000000_tenant_rate_limitssql-new--plan-06-04)
6. Test infrastructure
   - [`test/setup/integration-globalSetup.ts`](#testsetupintegration-globalsetupts-new--plan-06-05)
   - [`test/setup/otel-test-reader.ts`](#testsetupotel-test-readerts-new--plan-06-05)
   - [`test/setup/pkce-fixture.ts`](#testsetuppkce-fixturets-new--plan-06-05)
7. Unit tests
   - [`test/lib/otel-metrics.test.ts`](#testliboteltimetricstestts-new--plan-06-02)
   - [`test/lib/graph-client.span.test.ts`](#testlibgraph-clientspantestts-new--plan-06-02)
   - [`test/lib/rate-limit/sliding-window.test.ts`](#testlibrate-limitsliding-windowtestts-new--plan-06-04)
8. Integration tests
   - [`test/integration/metrics-endpoint.int.test.ts`](#testintegrationmetrics-endpointinttestts-new--plan-06-03)
   - [`test/integration/rate-limit/gateway-429.int.test.ts`](#testintegrationrate-limitgateway-429inttestts-new--plan-06-04)
   - [`test/integration/rate-limit/admin-config.int.test.ts`](#testintegrationrate-limitadmin-configinttestts-new--plan-06-04)
   - [`test/integration/oauth-surface/*.int.test.ts`](#testintegrationoauth-surfaceinttestts-new--plan-06-05)
   - [`test/integration/multi-tenant/bearer-tid-mismatch.int.test.ts`](#testintegrationmulti-tenantbearer-tid-mismatchinttestts-new--plan-06-06)
9. Script / bin
   - [`bin/check-oauth-coverage.mjs`](#bincheck-oauth-coveragemjs-new--plan-06-05)
10. Docs
    - [`docs/observability/*`](#docsobservability-new--plan-06-07)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/lib/otel-metrics.ts` | utility/singleton | pub (pull metrics) | `src/lib/otel.ts` | role-match |
| `src/lib/rate-limit/sliding-window.ts` | utility + Redis client extension | request-response | `src/lib/pkce-store/redis-store.ts` | role-match |
| `src/lib/rate-limit/sliding-window.lua` | inline Lua asset | n/a | none in codebase | **no analog** — cite RESEARCH.md |
| `src/lib/rate-limit/middleware.ts` | Express middleware | request-response | `src/lib/admin/auth/dual-stack.ts` | role-match |
| `src/lib/rate-limit/defaults.ts` | config helper | config-read | inline env-var parsing in `src/lib/middleware/retry.ts:163-168` | partial |
| `src/lib/metrics-server/metrics-server.ts` | Express app factory | request-response | `src/lib/admin/__tests__/tenants.int.test.ts:131-168` + `src/server.ts:1371-1431` | role-match |
| `src/lib/metrics-server/bearer-auth.ts` | middleware (security) | request-response | `src/lib/admin/auth/dual-stack.ts:113-175` | role-match |
| `src/lib/otel.ts` | bootstrap singleton (existing) | — | self | n/a |
| `src/graph-client.ts` | client/chokepoint (existing) | request-response | self — extend `makeRequest` at lines 180-247 | n/a |
| `src/lib/middleware/retry.ts` | middleware (existing) | request-response | self — lines 64-159 | n/a |
| `src/lib/admin/tenants.ts` | router (existing) | CRUD | self — lines 156-199, 702-732 | n/a |
| `src/lib/tenant/tenant-row.ts` | type (existing) | — | self — extend interface | n/a |
| `src/lib/redis.ts` | singleton (existing) | — | self — extend `getRedis()` at line 84-94 | n/a |
| `src/lib/pkce-store/pkce-store.ts` + `redis-store.ts` + `memory-store.ts` | interface + 2 impls (existing) | read/write | self — add `size()` | n/a |
| `src/request-context.ts` | ALS store (existing) | — | self — add `toolAlias` field | n/a |
| `src/graph-tools.ts` | tool registry (existing) | request-response | self — extend `requestContext.run(...)` frame | n/a |
| `src/server.ts` | Express app (existing) | request-response | self — add metrics server startup + rate-limit middleware | n/a |
| `src/index.ts` | bootstrap (existing) | n/a | self — MUST NOT reorder first-line `./lib/otel.js` | n/a |
| `vitest.config.js` | test config (existing) | n/a | self | n/a |
| `.env.example` | docs/config (existing) | n/a | self | n/a |
| `migrations/20260901000000_tenant_rate_limits.sql` | migration | DDL | `migrations/20260801000000_sharepoint_domain.sql` | exact |
| `test/setup/integration-globalSetup.ts` | vitest globalSetup | n/a | `test/setup/testcontainers.ts` | role-match |
| `test/setup/otel-test-reader.ts` | test helper | n/a | none — cite RESEARCH.md §Validation Architecture §3 | **no analog** |
| `test/setup/pkce-fixture.ts` | test helper | n/a | none direct — pattern in `src/server.ts:296-299` (sha256 base64url) | partial |
| `test/lib/otel-metrics.test.ts` | unit test | n/a | `test/retry-handler.test.ts` | role-match |
| `test/lib/graph-client.span.test.ts` | unit test | n/a | `test/retry-handler.test.ts` + `src/lib/middleware/odata-error.ts:41-82` | role-match |
| `test/lib/rate-limit/sliding-window.test.ts` | unit test | n/a | `test/pkce-store/redis-store.test.ts` | exact |
| `test/integration/metrics-endpoint.int.test.ts` | integration test | n/a | `test/oauth-register-hardening.test.ts` | role-match |
| `test/integration/rate-limit/gateway-429.int.test.ts` | integration test | n/a | `src/lib/admin/__tests__/webhook-ratelimit.int.test.ts` | exact |
| `test/integration/rate-limit/admin-config.int.test.ts` | integration test | n/a | `src/lib/admin/__tests__/tenants.int.test.ts` + `product-selectors.int.test.ts` | exact |
| `test/integration/oauth-surface/*.int.test.ts` (4 files) | integration test | n/a | `test/integration/runtime-tenant-onboarding.test.ts` + `test/oauth-register-hardening.test.ts` | role-match |
| `test/integration/multi-tenant/bearer-tid-mismatch.int.test.ts` | integration test | n/a | `test/integration/multi-tenant-isolation.test.ts` (existing) | role-match |
| `bin/check-oauth-coverage.mjs` | CI script | file-read | `bin/migrate.mjs` | role-match |
| `docs/observability/grafana-starter.json` | docs asset | n/a | none | **no analog** |
| `docs/observability/runbook.md` | docs | n/a | none in repo | **no analog** |
| `docs/observability/metrics-reference.md` | docs | n/a | none | **no analog** |

---

## Shared / Cross-Cutting Patterns

These patterns appear in multiple Phase 6 files. Quote once here; each file subsection below references back.

### P-1. Module-level JSDoc header

**Source:** `src/lib/admin/webhooks.ts:1-47`, `src/lib/pkce-store/pkce-store.ts:1-26`

Every new src module opens with a multi-paragraph JSDoc that names the plan (`plan 06-04`), the requirement (`OPS-08`), and the Phase 6 decision (`D-03`). Follow-through imports are limited to type-only where possible. Example pattern (excerpt from `src/lib/pkce-store/pkce-store.ts:1-25`):

```ts
/**
 * PKCE store interface (plan 03-03, SECUR-03 + TENANT-05).
 *
 * Replaces the v1 in-memory `pkceStore: Map` at src/server.ts ...
 *
 * Implementations:
 *   - RedisPkceStore (HTTP mode, production) — SET NX EX + GETDEL; shared
 *     state across replicas via Redis (ROADMAP SC#6).
 *   - MemoryPkceStore (stdio mode + tests) — Map-backed with Date.now() TTL;
 *
 * Threat dispositions (plan 03-03 <threat_model>):
 *   - T-03-03-01 (replay): takeByChallenge is atomic read-and-delete ...
 */
```

**Apply to:** every new `src/` file in Phase 6.

### P-2. Pino structured logging (meta-first, never string-interpolate)

**Source:** `src/lib/middleware/retry.ts:91-95`, `src/lib/admin/tenants.ts:539-541`

```ts
logger.info(
  { attempts: attempt + 1, status: response.status, method: req.method },
  'retry exhausted'
);
```

Invariants:
- Pino native order is `(meta, message)`. Never embed variable data in the message string — the redact chain in `src/logger.ts` traverses the meta object, not the message substring.
- `err: (err as Error).message` — never `err: err` (the raw Error object is redact-bypass).
- No `console.log` anywhere in Phase 6 source; `console.*` is reserved for `bin/*.mjs` stdout/stderr.

**Apply to:** every new handler in `metrics-server.ts`, `rate-limit/middleware.ts`, every new test-harness log.

### P-3. Migration SQL shape (Up / Down, non-blocking ALTER)

**Source:** `migrations/20260801000000_sharepoint_domain.sql:1-34`, `migrations/20260702000000_preset_version.sql:1-30`

```sql
-- Up Migration
-- Plan 5.1-06: tenants.sharepoint_domain column.
--
-- Per 05.1-RESEARCH §SharePoint Option A (recommended choice):
--   - ... (design notes)
--
-- Migration safety:
--   - ALTER TABLE tenants ADD COLUMN ... NULL is non-blocking on
--     PostgreSQL (fast path — no table rewrite for nullable columns ...
--   - No backfill needed ...

ALTER TABLE tenants
  ADD COLUMN sharepoint_domain text NULL;

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS sharepoint_domain;
```

**Apply to:** `migrations/20260901000000_tenant_rate_limits.sql`. Use `JSONB NULL` instead of `text NULL`. Keep the doc-block header. Up/Down sections separated by `-- Down Migration` marker — the integration test helper `stripPgcryptoExtensionStmts` in `test/integration/runtime-tenant-onboarding.test.ts:46-66` splits on that exact string.

### P-4. Zod schema next to router, no external file

**Source:** `src/lib/admin/tenants.ts:156-199`

```ts
const CreateTenantZod = z.object({
  mode: z.enum(['delegated', 'app-only', 'bearer']),
  client_id: z.string().min(1).max(256),
  ...
  redirect_uri_allowlist: z.array(z.string().url()).default([]),
  ...
});

const PatchTenantZod = CreateTenantZod.partial().strict();
```

Two conventions that plan 06-04 MUST follow:
1. snake_case wire field names (admin API contract per D-14 from Phase 4).
2. `CreateTenantZod.partial().strict()` is the canonical PATCH validator — adding a new field only requires extending `CreateTenantZod`; `PatchTenantZod` inherits it.

### P-5. Express sub-router factory with DI deps bag

**Source:** `src/lib/admin/tenants.ts:423-427`, `src/lib/admin/webhooks.ts:342-343`

```ts
export function createTenantsRoutes(deps: AdminRouterDeps): Router {
  const r = Router();
  const policy = buildRedirectUriPolicy();
  // ... router.post('/', async (req, res) => { ... })
  return r;
}
```

**Apply to:** `createMetricsServer(exporter, cfg)` and `createRateLimitMiddleware(deps)`.

### P-6. Integration test harness (pg-mem + MemoryRedisFacade + ephemeral express)

**Source:** `src/lib/admin/__tests__/tenants.int.test.ts:80-169`, `src/lib/admin/__tests__/webhook-ratelimit.int.test.ts:47-100`

Canonical scaffold:
```ts
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

async function makePool(): Promise<Pool> {
  const db = newDb();
  db.registerExtension('pgcrypto', () => {});
  const { Pool: PgMemPool } = db.adapters.createPg();
  const pool = new PgMemPool() as Pool;
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const up = stripPgcryptoExtensionStmts(
      (sql.split(/^--\s*Down Migration\s*$/m)[0] ?? '').replace(/^--\s*Up Migration\s*$/m, '')
    );
    await pool.query(up);
  }
  return pool;
}
```

HTTP harness:
```ts
const server = await new Promise<http.Server>((resolve) => {
  const s = http.createServer(app).listen(0, () => resolve(s));
});
const port = (server.address() as AddressInfo).port;
```

**Apply to:** every new `*.int.test.ts` file in `test/integration/rate-limit/` and `test/integration/oauth-surface/`. Plan 06-05's globalSetup switches `makePool()` → Testcontainers for the CI tier while keeping this same template for pg-mem unit-fast runs.

### P-7. Hoisted logger mock

**Source:** `src/lib/admin/__tests__/tenants.int.test.ts:35-48`

```ts
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  },
}));

vi.mock('../../../logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));
```

**Apply to:** every new Phase 6 test file. The `vi.hoisted` ordering matters — vitest hoists `vi.mock` above imports, so the mock fn reference must exist before the mock factory runs.

### P-8. OTel tracer pattern (existing middleware style)

**Source:** `src/lib/middleware/retry.ts:47,59,72` and `src/lib/middleware/odata-error.ts:41-47`

```ts
import { trace, type Span } from '@opentelemetry/api';
// module-level (not per-request) to avoid getTracer lookup cost:
const tracer = trace.getTracer('graph-middleware');
...
return tracer.startActiveSpan('graph.middleware.retry', async (span) => {
  span.setAttribute('graph.retry.count', attempt);
  try { ... } finally { span.end(); }
});
```

**Apply to:** `src/graph-client.ts` new `graph.request` parent span. Use a NEW tracer name `'ms-365-mcp-server'` (matches the scope name operators will see in Prometheus); keep `graph-middleware` for existing child spans.

### P-9. No reordering of `import './lib/otel.js'` in `src/index.ts:2`

**Source:** `src/index.ts:1-6` (the load-bearing first line)

```ts
#!/usr/bin/env node
import './lib/otel.js'; // MUST be first import — registers OTel instrumentation hooks before anything else loads
// Note: OTel reads OTEL_EXPORTER_OTLP_ENDPOINT from process.env at SDK start time.
// This MUST run BEFORE dotenv/config so that in production the env var comes from
// the real environment (systemd / Docker / CI), not from .env.
import 'dotenv/config';
```

**Apply to:** plan 06-03 must insert the metrics-server startup AFTER `server.start()` in `src/index.ts` (anywhere below line 569), not above `./lib/otel.js`. Plan 06-02 must not add any import line above line 2 of `src/index.ts`.

### P-10. `region:` / `endregion:` marker discipline

**Source:** `src/index.ts:287-350`, `.env.example:142-201`

Existing phases use load-bearing marker comments to delimit disjoint edit regions. Example:

```ts
// region:phase3-redis       (filled by 03-02 Task 2)
if (isHttpMode) {
  redisClient.getRedis();
  readinessChecks.push(redisClient.readinessCheck);
}
// endregion:phase3-redis
```

**Apply to:** plan 06-03 adds `// region:phase6-metrics-server` / `// endregion:phase6-metrics-server` in `src/index.ts`. Plan 06-04 adds `// region:phase6-rate-limit` / `// endregion:phase6-rate-limit`. `.env.example` gains matching `# region:phase6-observability` / `# endregion:phase6-observability` and `# region:phase6-rate-limit` sections.

---

## `src/lib/otel-metrics.ts` (NEW — plan 06-02)

**Role:** utility singleton — Meter factory and instrument exports.
**Analog:** `src/lib/otel.ts` (module-singleton bootstrap pattern).
**Why this analog:** otel.ts is the only existing OTel bootstrap/singleton file; it constructs a single `NodeSDK` instance at module load and exports a shutdown helper. otel-metrics.ts follows the same shape: module-level instruments built ONCE at import, exported as named constants.

**Module header pattern** (apply P-1):
```ts
/**
 * OpenTelemetry Meter + named instruments (plan 06-02, OPS-06 + D-06).
 *
 * Constructed ONCE at module load. Consumers import specific instruments and
 * call .add() / .record() per event; the SDK deduplicates under the hood.
 *
 * Label cardinality (D-06): `tool` label is the workload prefix (first segment
 * before '.'/'-', or the product name for __powerbi__/__exo__/etc.), NOT the
 * full tool alias. See labelForTool() + extractWorkloadPrefix.
 *
 * Cardinality budget: ~40 workloads × ~20 HTTP statuses × N tenants.
 * Full tool alias (~14k) appears ONLY as the `tool.alias` span attribute.
 */
```

**Meter construction pattern** (copy from RESEARCH.md §Pattern 2, lines 304-344 — no codebase analog since the Meter API is absent today):
```ts
import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('ms-365-mcp-server', process.env.npm_package_version);

export const mcpToolCallsTotal = meter.createCounter('mcp_tool_calls_total', {
  description: 'Total MCP Graph tool invocations, labelled by tenant, workload prefix, and HTTP status code',
});
export const mcpToolDurationSeconds = meter.createHistogram('mcp_tool_duration_seconds', {
  description: 'End-to-end duration of each Graph tool call, measured at GraphClient.makeRequest',
  unit: 's',
});
export const mcpGraphThrottledTotal = meter.createCounter('mcp_graph_throttled_total', { ... });
export const mcpRateLimitBlockedTotal = meter.createCounter('mcp_rate_limit_blocked_total', { ... });
export const mcpOauthPkceStoreSize = meter.createObservableGauge('mcp_oauth_pkce_store_size', { ... });
export const mcpTokenCacheHitRatio = meter.createObservableGauge('mcp_token_cache_hit_ratio', { ... });
export const mcpActiveStreams = meter.createUpDownCounter('mcp_active_streams', { ... });
```

**labelForTool() — REUSE existing extractWorkloadPrefix**:

The D-06 label helper is NOT new code. The existing `extractWorkloadPrefix` in `src/lib/tool-selection/registry-validator.ts:71-88` already performs the exact normalization:

```ts
// src/lib/tool-selection/registry-validator.ts:71-88 (verbatim)
function extractWorkloadPrefix(alias: string): string {
  // Phase 5.1: product prefix → product name is the workload.
  for (const audience of PRODUCT_AUDIENCES.values()) {
    if (alias.startsWith(audience.prefix)) {
      return audience.product;
    }
  }
  // Existing Graph behavior unchanged:
  const stripped = alias.startsWith('__beta__') ? alias.slice('__beta__'.length) : alias;
  const dash = stripped.indexOf('-');
  const dot = stripped.indexOf('.');
  const dashIdx = dash === -1 ? Infinity : dash;
  const dotIdx = dot === -1 ? Infinity : dot;
  const cutoff = Math.min(dashIdx, dotIdx);
  return cutoff === Infinity ? stripped : stripped.slice(0, cutoff);
}
```

**Action:** export `extractWorkloadPrefix` from `registry-validator.ts` (currently unexported), then re-export as `labelForTool` from `otel-metrics.ts`:
```ts
export { extractWorkloadPrefix as labelForTool } from '../tool-selection/registry-validator.js';
```

**Non-obvious constraints:**
- `process.env.npm_package_version` is only populated when the server is launched via `npm`. In Docker/systemd it is `undefined`, which is fine — `getMeter(name, undefined)` is valid.
- The module MUST NOT import `./otel.js` (circular — otel.ts boots the SDK which then provides the global MeterProvider that `metrics.getMeter(...)` reads). Just depend on `@opentelemetry/api`.

---

## `src/lib/rate-limit/sliding-window.ts` (NEW — plan 06-04)

**Role:** utility — registers and invokes a custom ioredis Lua command.
**Analog:** `src/lib/pkce-store/redis-store.ts` (Redis-backed module with key-prefix convention, stdio-facade compat note, and ts cast pattern for ioredis command typing).

**Imports + TTL pattern** (copy from `src/lib/pkce-store/redis-store.ts:23-33`):
```ts
// src/lib/pkce-store/redis-store.ts:23-33 (verbatim)
import type { PkceEntry, PkceStore } from './pkce-store.js';
import type { RedisClient } from '../redis.js';

const TTL_SECONDS = 600;

export class RedisPkceStore implements PkceStore {
  constructor(private readonly redis: RedisClient) {}

  private key(tenantId: string, clientCodeChallenge: string): string {
    return `mcp:pkce:${tenantId}:${clientCodeChallenge}`;
  }
```

**ioredis command typing cast (re-use exact pattern)** — copy from `src/lib/pkce-store/redis-store.ts:40-53`:
```ts
// src/lib/pkce-store/redis-store.ts:40-53 (verbatim)
const result = await (
  this.redis as unknown as {
    set: (
      key: string, value: string, mode: 'EX', seconds: number, nx: 'NX'
    ) => Promise<'OK' | null>;
  }
).set(k, JSON.stringify(entry), 'EX', TTL_SECONDS, 'NX');
return result === 'OK';
```

**Lua registration pattern** — no codebase analog (no existing `defineCommand` usage). Copy from RESEARCH.md §Pattern 4 (lines 473-547):
```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Redis as IORedis } from 'ioredis';
import type { RedisClient } from '../redis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LUA = readFileSync(path.join(__dirname, 'sliding-window.lua'), 'utf8');

declare module 'ioredis' {
  interface RedisCommander<Context> {
    slidingWindow(
      key: string, windowMs: number, maxCount: number,
      nowMs: number, reqId: string, cost: number
    ): Result<[number, number, number], Context>;
  }
}

export function registerSlidingWindow(redis: IORedis): void {
  redis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: LUA });
}

export interface ConsumeResult {
  allowed: boolean; currentCount: number; retryAfterMs: number;
}
export async function consume(
  redis: RedisClient, key: string, windowMs: number, maxCount: number, cost = 1
): Promise<ConsumeResult> { ... }
export async function observe(
  redis: RedisClient, tenantId: string, windowMs: number, weight: number
): Promise<void> { ... }
```

**Key-prefix convention** — MUST use the reserved prefix documented at `src/lib/redis.ts:21`:
```ts
// src/lib/redis.ts:18-24 (verbatim)
 * Key-prefix conventions (CONTEXT.md D-13):
 *   mcp:pkce:<state>            — 03-03 PKCE store (EX 600s)
 *   mcp:cache:<tenant>:<user>   — 03-05 MSAL token cache
 *   mcp:rl:<tenant>:<bucket>    — Phase 6 rate-limit counters (reserved)
```

Phase 6 uses `mcp:rl:req:{tenantId}` and `mcp:rl:graph:{tenantId}` — matches the reserved prefix scheme.

**Non-obvious constraints:**
- `MemoryRedisFacade` has NO ZSET support (confirmed by `src/lib/redis.ts:14-22` doc-comment + absence of zadd/zcard/zremrangebyscore methods in `src/lib/redis-facade.ts`). Production callers in HTTP mode hit real ioredis; stdio callers MUST short-circuit above this module. The `consume` function cast `redis as IORedis` is therefore a runtime guarantee: callers must ensure they never invoke it under the facade.
- ioredis-mock (already installed per `package.json`) DOES support ZSET commands + `defineCommand`/`eval` per `node_modules/ioredis-mock/compat.md`. Unit tests use ioredis-mock, NOT MemoryRedisFacade.

---

## `src/lib/rate-limit/sliding-window.lua` (NEW — plan 06-04)

**Role:** inline Lua asset (read at module load via `readFileSync`).
**Analog:** none — no Lua scripts exist in the codebase today.

**Fallback:** copy verbatim from RESEARCH.md §Pattern 4 (lines 421-470). The script is 48 lines including comments. Load-bearing constraints:
- KEYS[1] = ZSET key; ARGV[1..5] = window_ms, max_count, now_ms, req_id, cost
- Returns `{allowed: 0|1, current_count: int, retry_after_ms: int}` — three-element table; NOT a hash
- Uses `redis.call('PEXPIRE', key, window_ms * 2)` for safety-net TTL
- `cost` defaults to 1 via `ARGV[5] or "1"` for the consume path; observe path passes weight

**Non-obvious constraints:**
- File must live NEXT TO `sliding-window.ts` (path.join(__dirname, 'sliding-window.lua')). Do NOT move to a resources/ directory — the relative path is load-bearing.
- `tsup` build (see `tsup.config.ts`) already copies `endpoints.json`; plan 06-04 must extend the tsup config to copy `sliding-window.lua` as well, OR use `JSON.stringify(readFileSync(...))` so the Lua body inlines at build time. Researcher recommends adding a `copyfiles` step — look at `tsup.config.ts`.

---

## `src/lib/rate-limit/middleware.ts` (NEW — plan 06-04)

**Role:** Express middleware — reads `req.tenant.rate_limits`, calls `consume()`, returns 429 on deny.
**Analog:** `src/lib/admin/auth/dual-stack.ts:113-175` (middleware factory that reads a deps bag, short-circuits with status codes).

**Factory shape + Request type declaration-merge** — copy from `src/lib/admin/auth/dual-stack.ts:52-63,113-120`:
```ts
// src/lib/admin/auth/dual-stack.ts:52-63 (verbatim)
declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminIdentity;
    id?: string;
  }
}

// src/lib/admin/auth/dual-stack.ts:113-120 (verbatim)
export function createAdminAuthMiddleware(deps: AdminAuthDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const instance = (req as unknown as { id?: string }).id;
    ...
```

**Apply:** `createRateLimitMiddleware({ redis, defaults })` returns `RequestHandler`. The existing `Request.tenant?: TenantRow` is already declaration-merged by load-tenant middleware — Phase 6 reads `req.tenant.rate_limits` after the `TenantRow` interface is extended.

**Status-code + Retry-After short-circuit** — pattern from `src/lib/admin/webhooks.ts:365-369`:
```ts
// src/lib/admin/webhooks.ts:365-369 (verbatim)
if (current >= MAX_401_PER_MINUTE_PER_IP) {
  res.setHeader('Retry-After', String(UNAUTHORIZED_RATE_TTL_SECONDS));
  res.status(429).json({ error: 'rate_limited' });
  return;
}
```

**Apply:** on rate-limit deny, emit:
```ts
res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
res.status(429).json({ error: 'rate_limited', reason: 'request_rate' | 'graph_points' });
mcpRateLimitBlockedTotal.add(1, { tenant: tenantId, reason });
```

**Fail-closed on Redis outage** — pattern from `src/lib/admin/webhooks.ts:191-204` (but INVERT: webhook prefers availability; rate-limit per §Security Domain §Checklist prefers fail-closed). On Redis error, return 503 + `Retry-After: 5`:
```ts
// ADAPTED from src/lib/admin/tenants.ts:358-374 (redisReadyOrAbort helper)
const status = (redis as unknown as { status?: string }).status;
if (status !== undefined && status !== 'ready' && status !== 'wait') {
  res.setHeader('Retry-After', '5');
  res.status(503).json({ error: 'redis_unavailable' });
  return;
}
```

**Non-obvious constraints:**
- Middleware MUST run AFTER `loadTenant` and BEFORE the `/mcp` dispatch handler. See `src/server.ts:1145,1300` for the existing `app.use('/t/:tenantId', loadTenant)` mount point — rate-limit slots between loadTenant and the MCP dispatcher.
- Must gate on BOTH `consume(mcp:rl:req:{tid})` AND `consume(mcp:rl:graph:{tid})` per RESEARCH.md §Open Question #5: ROADMAP SC#3 requires "exceeding either budget → structured 429 before any Graph call".

---

## `src/lib/rate-limit/defaults.ts` (NEW — plan 06-04)

**Role:** config helper — resolve platform-default rate limits from env vars.
**Analog:** inline env parsing in `src/lib/middleware/retry.ts:163-168`.

**Pattern** — copy from `src/lib/middleware/retry.ts:163-168`:
```ts
// src/lib/middleware/retry.ts:163-168 (verbatim)
function parseMaxAttempts(): number {
  const raw = process.env.MS365_MCP_RETRY_MAX_ATTEMPTS;
  if (!raw) return DEFAULT_MAX_ATTEMPTS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_ATTEMPTS;
}
```

**Apply:** export `DEFAULT_REQ_PER_MIN`, `DEFAULT_GRAPH_POINTS_PER_MIN`, `WINDOW_MS` constants and a `resolveRateLimits(tenantRow): { requestPerMin, graphPointsPerMin }` helper that falls back to the env var defaults when `tenantRow.rate_limits === null`.

**Env vars** (per CONTEXT.md §Specifics):
- `MS365_MCP_DEFAULT_REQ_PER_MIN` (default 1000)
- `MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN` (default 50000)

---

## `src/lib/metrics-server/metrics-server.ts` (NEW — plan 06-03)

**Role:** Express app factory running on port 9464.
**Analog:** `src/server.ts:1371-1431` (Express app bootstrap) + `src/lib/admin/__tests__/tenants.int.test.ts:131-168` (http.createServer + listen pattern).

**Express app wiring pattern** — copy from `src/server.ts:1371-1431`:
```ts
// src/server.ts:1371-1387 (verbatim)
const app = express();
app.set('trust proxy', true);

// Health endpoints ... MUST be mounted BEFORE pino-http, CORS, body parsers
// ... (OPS-03)
mountHealth(app, this.readinessChecks);

// pino-http request logging — MUST be registered BEFORE express.json() ...
app.use(
  pinoHttp({
    logger: rawPinoLogger,
    genReqId: () => nanoid(),
    autoLogging: {
      ignore: (req) => {
        const url = req.url ?? '';
        return url.startsWith('/healthz') || url.startsWith('/readyz');
      },
    },
    customProps: (req) => ({ requestId: req.id, tenantId: null }),
  })
);
```

**Apply:** skip `mountHealth` (the metrics server doesn't need it — it's behind a separate ACL). Re-use `pinoHttp` with `autoLogging.ignore` on `/metrics` to prevent log spam from every Prometheus scrape.

**Listen pattern** — copy from `src/server.ts:1888-1907`:
```ts
// src/server.ts:1888-1907 (verbatim)
let httpServer: import('node:http').Server;
if (host) {
  httpServer = app.listen(port, host, () => {
    logger.info(`Server listening on ${host}:${port}`);
    ...
  });
} else {
  httpServer = app.listen(port, () => {
    logger.info(`Server listening on all interfaces (0.0.0.0:${port})`);
    ...
  });
}
registerShutdownHooks(httpServer, logger);
```

**Apply:** bind on `0.0.0.0:${port}` by default so the container network sees it; document that operators should use a reverse-proxy ACL or the D-02 Bearer when publishing this port. Return the http.Server handle so `src/index.ts` plan 06-03 changes can register a shutdown hook.

**Exporter hosting** — no codebase analog; copy from RESEARCH.md §Pattern 3 (lines 354-399):
```ts
app.get('/metrics', requireBearer, (req: Request, res: Response) => {
  exporter.getMetricsRequestHandler(req, res);
});
```

**Non-obvious constraints:**
- The existing `PrometheusExporter({ port: 9464 })` call in `src/lib/otel.ts:69` currently binds its OWN HTTP listener. Plan 06-01 MUST refactor it to `new PrometheusExporter({ port, preventServerStart: true })` and EXPORT the exporter so plan 06-03 can host it. This is the "small refactor" called out in CONTEXT.md D-02.
- Verify via `node_modules/@opentelemetry/exporter-prometheus/build/src/PrometheusExporter.d.ts` that `preventServerStart` exists (confirmed in RESEARCH.md Pitfall 2 — gated since 0.44.0+).

---

## `src/lib/metrics-server/bearer-auth.ts` (NEW — plan 06-03)

**Role:** Express middleware — optional Bearer token auth gate.
**Analog:** `src/lib/admin/auth/dual-stack.ts:113-175` (middleware short-circuit on header validation).

**Constant-time compare pattern** — no codebase analog for Bearer tokens today (api-key verification uses `crypto.timingSafeEqual` via `verifyApiKeyHeader` in `src/lib/admin/auth/api-key.ts` — check that file for the hash-compare pattern). Copy from RESEARCH.md §Pattern 3 (lines 383-399):
```ts
import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export function createBearerAuthMiddleware(bearerToken: string | null): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (bearerToken === null) return next();
    const hdr = req.headers.authorization;
    if (!hdr?.startsWith('Bearer ')) {
      res.status(401).set('WWW-Authenticate', 'Bearer').end();
      return;
    }
    const supplied = hdr.slice('Bearer '.length).trim();
    if (!timingSafeCompare(supplied, bearerToken)) {
      res.status(401).set('WWW-Authenticate', 'Bearer').end();
      return;
    }
    next();
  };
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
```

**Non-obvious constraints:**
- `bearerToken === null` MUST be the enabled/disabled signal, not `''` (empty string). An operator who sets `MS365_MCP_METRICS_BEARER=` (no value) should get an open endpoint; only `MS365_MCP_METRICS_BEARER=actual-token` should gate.
- `WWW-Authenticate: Bearer` header is REQUIRED on 401 per RFC 6750 — tests in `metrics-endpoint.int.test.ts` MUST assert this.

---

## `src/lib/otel.ts` (modify — plan 06-01 + 06-03)

**Role:** existing bootstrap (self).
**Change 1 (plan 06-01):** add `ignoreOutgoingRequestHook` to http instrumentation to filter OTel's own OTLP export spans (Pitfall 7).

Current file at `src/lib/otel.ts:78-81`:
```ts
// src/lib/otel.ts:78-81 (verbatim)
const instrumentations = getNodeAutoInstrumentations({
  // Disable fs instrumentation — it is extremely noisy and adds no value here
  '@opentelemetry/instrumentation-fs': { enabled: false },
});
```

**Apply:** extend the config to add `'@opentelemetry/instrumentation-http': { ignoreOutgoingRequestHook: (req) => req.hostname?.includes('otel-collector') }` OR document the limitation per Pitfall 9.

**Change 2 (plan 06-03):** refactor the PrometheusExporter instantiation.

Current:
```ts
// src/lib/otel.ts:67-69 (verbatim)
if (prometheusEnabled) {
  // Prometheus exporter listens on port 9464 at /metrics
  metricReader = new PrometheusExporter({ port: 9464 });
}
```

**New:**
```ts
let prometheusExporter: PrometheusExporter | undefined;
if (prometheusEnabled) {
  prometheusExporter = new PrometheusExporter({
    port: Number(process.env.MS365_MCP_METRICS_PORT ?? 9464),
    preventServerStart: true, // host via src/lib/metrics-server/metrics-server.ts
  });
  metricReader = prometheusExporter;
}
...
export { prometheusExporter }; // plan 06-03 imports for createMetricsServer()
```

**Non-obvious constraints:**
- Do NOT reorder the `sdk.start()` call; it remains at its current position.
- Do NOT change the fs/pino instrumentation gates unless the researcher's verification test (plan 06-01 task 3) confirms a concrete gap.

---

## `src/graph-client.ts` (modify — plan 06-02)

**Role:** existing chokepoint.
**Change:** wrap `makeRequest` (lines 180-247) in a `graph.request` parent span and emit counter/histogram.

**Current `makeRequest` entry** — `src/graph-client.ts:180-246`:
```ts
// src/graph-client.ts:180-246 (verbatim, trimmed)
async makeRequest(endpoint: string, options: GraphRequestOptions = {}): Promise<unknown> {
  const contextTokens = getRequestTokens();
  const accessToken =
    options.accessToken ?? contextTokens?.accessToken ?? (await this.authManager.getToken());

  if (!accessToken) {
    throw new Error('No access token available');
  }

  try {
    const response = await this.performRequest(endpoint, accessToken, options);
    // ...
    return result;
  } catch (error) {
    logger.error('Microsoft Graph API request failed:', error);
    throw error;
  }
}
```

**Target wrap pattern** — RESEARCH.md §Pattern 1 (lines 250-295). Key invariants:
- `const tracer = trace.getTracer('ms-365-mcp-server');` (module-level, distinct from `'graph-middleware'`)
- `span.setAttribute('tenant.id', ctx?.tenantId ?? 'unknown')`, `'tool.name'` = workload prefix, `'tool.alias'` = full alias (per D-06)
- `mcpToolCallsTotal.add(1, { tenant, tool, status })` in `finally`
- `mcpToolDurationSeconds.record(durationSec, { tenant, tool })` — duration in SECONDS
- `mcpGraphThrottledTotal.add(1, { tenant })` when status === 429
- Uses `performance.now()` (available globally in Node 18+)

**Status label cardinality** — cite RESEARCH.md §Anti-Patterns (line 604). Emit `status` as string of numeric HTTP code; ~15 distinct values acceptable. NEVER emit error messages as labels.

**Non-obvious constraints:**
- `ctx?.toolAlias` requires extending RequestContext (see `src/request-context.ts` subsection below).
- The span MUST end in `finally` — any early return (cache hit, binary response) MUST go through the finally block.
- Pre-existing error-log line `logger.error('Microsoft Graph API request failed:', error)` at line 244 MUST remain — it's load-bearing for operator triage.

---

## `src/lib/middleware/retry.ts` (modify — plan 06-02 + 06-04)

**Role:** existing middleware (self).

**Change 1 (plan 06-02):** increment `mcp_graph_throttled_total` on 429. After line 94-98 (the "retry exhausted" branch) and throughout all `return response` sites where `response.status === 429`, emit:
```ts
if (response.status === 429) {
  const { mcpGraphThrottledTotal } = await import('../otel-metrics.js');
  mcpGraphThrottledTotal.add(1, { tenant: requestContext.getStore()?.tenantId ?? 'unknown' });
}
```

Static import is fine — `otel-metrics.ts` has no side effects beyond constructing instruments (which is idempotent). The dynamic import is only needed if plan 06-02 wants to defer the cost.

**Change 2 (plan 06-04 / D-05):** call `rateLimit.observe()` after each response.

Current retry span emission at `src/lib/middleware/retry.ts:170-184`:
```ts
// src/lib/middleware/retry.ts:170-184 (verbatim)
function finalizeSpan(span: Span, attempt: number, lastStatus: number): void {
  span.setAttribute('graph.retry.count', attempt);
  span.setAttribute('graph.retry.last_status', lastStatus);
  span.end();
}

function updateContext(retryCount: number, lastStatus: number): void {
  const ctx = requestContext.getStore();
  if (ctx) {
    ctx.retryCount = retryCount;
    ctx.lastStatus = lastStatus;
  }
}
```

**Apply** — RESEARCH.md §Code Examples (lines 723-750). After the response is received (inside the `try` block, before `return response`), parse `x-ms-resource-unit`:
```ts
const resourceUnits = parseResourceUnit(response.headers.get('x-ms-resource-unit'));
const tenantId = requestContext.getStore()?.tenantId;
if (tenantId && resourceUnits > 0) {
  void observe(getRedis(), tenantId, 60_000, resourceUnits).catch((err) =>
    logger.warn({ err: (err as Error).message, tenantId }, 'rate-limit observe failed')
  );
}

export function parseResourceUnit(raw: string | null): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(n, 100); // cap at 100 — defense in depth (A1)
}
```

**Non-obvious constraints:**
- `observe()` is FIRE-AND-FORGET (`void ... .catch(...)`). Never `await` it — observer never gates request delivery.
- `parseResourceUnit` MUST cap at 100 per RESEARCH.md §Assumptions Log A1. Export it for unit-test access.
- The new call to `observe()` on every 2xx path CANNOT run when `requestContext.getStore()` is undefined (stdio mode).

---

## `src/lib/admin/tenants.ts` (modify — plan 06-04)

**Role:** existing admin router.
**Change:** extend `CreateTenantZod` + add `addSet('rate_limits', ...)` in PATCH handler.

**Zod extension — copy pattern from `src/lib/admin/tenants.ts:156-199`**:
```ts
// src/lib/admin/tenants.ts:156-199 (excerpt — existing)
const CreateTenantZod = z.object({
  mode: z.enum(['delegated', 'app-only', 'bearer']),
  client_id: z.string().min(1).max(256),
  ...
  sharepoint_domain: z
    .string()
    .regex(/^[a-z0-9-]{1,63}$/, { message: 'sharepoint_domain must be lowercase alphanumeric + dashes, 1-63 chars' })
    .nullable()
    .optional(),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/).optional().nullable(),
});
const PatchTenantZod = CreateTenantZod.partial().strict();
```

**Apply** — add alongside other fields:
```ts
const RateLimitsZod = z.object({
  request_per_min: z.number().int().positive().max(1_000_000),
  graph_points_per_min: z.number().int().positive().max(10_000_000),
}).strict();

// In CreateTenantZod.object({...}):
  rate_limits: RateLimitsZod.nullable().optional(),
```

**`addSet` extension** — copy pattern from `src/lib/admin/tenants.ts:700-732`:
```ts
// src/lib/admin/tenants.ts:700-732 (verbatim)
const addSet = (col: string, value: unknown, jsonb = false): void => {
  if (jsonb) {
    setParts.push(`${col} = $${idx}::jsonb`);
  } else {
    setParts.push(`${col} = $${idx}`);
  }
  params.push(value);
  idx++;
};
if (body.mode !== undefined) addSet('mode', body.mode);
...
if (body.sharepoint_domain !== undefined) addSet('sharepoint_domain', body.sharepoint_domain);
```

**Apply** — add new branch:
```ts
if (body.rate_limits !== undefined) {
  addSet('rate_limits', body.rate_limits === null ? null : JSON.stringify(body.rate_limits), true /* jsonb */);
}
```

**Wire response extension** — extend `TenantWireRow` (line 86-115) + `tenantRowToWire` (line 217-287) to surface the parsed JSONB. Follow the `sharepoint_domain` precedent exactly.

**Non-obvious constraints:**
- Audit log row (`meta: { tenantId: id, fieldsChanged }` at `src/lib/admin/tenants.ts:760`) auto-captures `rate_limits` in `fieldsChanged` — no extra audit code needed. Verify via `product-selectors.int.test.ts` pattern.
- `publishTenantInvalidation` at line 780 auto-evicts per-tenant state so the rate-limit middleware rereads on next request.

---

## `src/lib/tenant/tenant-row.ts` (modify — plan 06-04)

**Role:** existing shape type (self).
**Change:** add `rate_limits: RateLimitsConfig | null` field.

**Pattern — follow `src/lib/tenant/tenant-row.ts:43-60`** (existing `preset_version` + `sharepoint_domain` extension precedent):
```ts
// src/lib/tenant/tenant-row.ts:43-60 (verbatim)
/**
 * Plan 05-03 (D-19). The tenant's pinned preset version ...
 */
preset_version: string;
/**
 * Plan 5.1-06 (T-5.1-06-c). The tenant's single-label SharePoint hostname ...
 * NULL is the correct default — tenants without SharePoint admin access simply don't set it.
 */
sharepoint_domain: string | null;
```

**Apply**:
```ts
export interface RateLimitsConfig {
  request_per_min: number;
  graph_points_per_min: number;
}
/**
 * Plan 06-04 (D-11). Per-tenant rate-limit overrides. NULL = inherit
 * platform defaults from MS365_MCP_DEFAULT_REQ_PER_MIN /
 * MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN env vars.
 */
rate_limits: RateLimitsConfig | null;
```

---

## `src/lib/redis.ts` (modify — plan 06-04)

**Role:** existing singleton.
**Change:** call `registerSlidingWindow(realClient)` immediately after construction.

**Current `getRedis()` at `src/lib/redis.ts:67-94`**:
```ts
// src/lib/redis.ts:84-94 (verbatim)
const realClient: Redis = new IORedis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});
realClient.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'redis client error');
});
client = realClient;
return realClient;
```

**Apply**:
```ts
const realClient: Redis = new IORedis(url, { ... });
realClient.on('error', (err: Error) => { ... });
// Phase 6 plan 06-04: register the sliding-window Lua command so rate-limit
// middleware can invoke .slidingWindow(...) via EVALSHA. Idempotent —
// defineCommand is safe to call repeatedly.
import('./rate-limit/sliding-window.js').then(({ registerSlidingWindow }) => {
  registerSlidingWindow(realClient);
}).catch((err) => logger.error({ err: err.message }, 'slidingWindow registration failed'));
client = realClient;
return realClient;
```

**Non-obvious constraints:**
- MUST use dynamic import — `src/lib/rate-limit/sliding-window.ts` imports `readFileSync` + path-munging which would pull the Lua file into every module that imports redis.ts. Lazy-loading defers the cost to the HTTP-mode path.
- MUST NOT register against `MemoryRedisFacade` — stdio-mode branch at line 70-74 skips entirely.

---

## `src/lib/pkce-store/*.ts` (modify all 3 — plan 06-03)

**Role:** existing PKCE store interface + impls.
**Change:** add `size(): Promise<number>` method to interface + both implementations.

**Interface extension** — copy from RESEARCH.md §Code Examples (lines 756-763):
```ts
// src/lib/pkce-store/pkce-store.ts EXTEND the interface
export interface PkceStore {
  put(tenantId: string, entry: PkceEntry): Promise<boolean>;
  takeByChallenge(tenantId: string, clientCodeChallenge: string): Promise<PkceEntry | null>;
  /** Phase 6: observable count for mcp_oauth_pkce_store_size gauge. */
  size(): Promise<number>;
}
```

**Redis impl — copy from RESEARCH.md (lines 765-775)**:
```ts
// src/lib/pkce-store/redis-store.ts ADD:
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
```

**Memory impl — copy from RESEARCH.md (line 778)**:
```ts
// src/lib/pkce-store/memory-store.ts ADD:
async size(): Promise<number> {
  return this.store.size;
}
```

**Observable gauge wiring** — add to `src/lib/otel-metrics.ts` per RESEARCH.md §Code Examples (lines 784-791):
```ts
export function wirePkceStoreGauge(pkceStore: PkceStore): void {
  mcpOauthPkceStoreSize.addCallback(async (observableResult) => {
    try { observableResult.observe(await pkceStore.size()); } catch { /* swallow */ }
  });
}
```

**Non-obvious constraints:**
- `scanDel` pattern in `src/lib/admin/tenants.ts:403-414` uses COUNT=100; PKCE size uses COUNT=500 because SCAN for counting is read-only (no deletion) and higher batch sizes amortize round-trips.
- The Redis SCAN cursor iteration MUST terminate cleanly on `cursor === '0'`. The MemoryRedisFacade stdio path returns `.store.size` directly — no SCAN.

---

## `src/request-context.ts` (modify — plan 06-02)

**Role:** existing AsyncLocalStorage store.
**Change:** add optional `toolAlias?: string` field.

**Current shape at `src/request-context.ts:13-64`** — extends pattern:
```ts
// src/request-context.ts:13-33 (excerpt)
export interface RequestContext {
  accessToken?: string;
  refreshToken?: string;
  requestId?: string;
  tenantId?: string | null;
  retryCount?: number;
  lastStatus?: number;
  ...
  flow?: AuthFlow;
  authClientId?: string;
  enabledToolsSet?: ReadonlySet<string>;
  presetVersion?: string;
  ...
}
```

**Apply** — append (MUST stay optional — stdio + HTTP paths that don't set it still compile):
```ts
/**
 * Plan 06-02 (OPS-05, D-06). Full tool alias captured at dispatch time and
 * consumed by GraphClient.makeRequest to emit `tool.alias` span attribute.
 * The metric label uses the workload prefix (extractWorkloadPrefix(alias));
 * the span attribute keeps the full alias for high-fidelity trace queries.
 */
toolAlias?: string;
```

---

## `src/graph-tools.ts` (modify — plan 06-02)

**Role:** existing tool registry.
**Change:** populate `toolAlias` on the `requestContext.run(...)` frame around each dispatch.

Existing call site pattern — Phase 5 plans wire `enabledToolsSet` + `presetVersion` via `requestContext.run`. The new `toolAlias` slots into the same frame. Per `src/index.ts:494-565`, the stdio-mode fallback uses `setStdioFallback` — plan 06-02 does not need to touch it.

**Action:** in `executeGraphTool` (per RESEARCH.md §File-by-File Impact line 1216), at the call site that invokes `requestContext.run(...)`, add `toolAlias: tool.alias` to the run-context object.

---

## `src/server.ts` (modify — plans 06-03 + 06-04)

**Role:** existing Express app.
**Changes:**

**Plan 06-03:** start the metrics server when `MS365_MCP_PROMETHEUS_ENABLED=1`. Insert between `app.listen(...)` at line 1890-1907 and the existing `registerShutdownHooks` call. Use region markers per P-10:
```ts
// region:phase6-metrics-server (filled by 06-03)
if (process.env.MS365_MCP_PROMETHEUS_ENABLED === '1' || process.env.MS365_MCP_PROMETHEUS_ENABLED === 'true') {
  const { prometheusExporter } = await import('./lib/otel.js');
  if (prometheusExporter) {
    const { createMetricsServer } = await import('./lib/metrics-server/metrics-server.js');
    const metricsServer = createMetricsServer(prometheusExporter, {
      port: Number(process.env.MS365_MCP_METRICS_PORT ?? 9464),
      bearerToken: process.env.MS365_MCP_METRICS_BEARER ?? null,
    });
    // Register shutdown hook for graceful close
    registerShutdownHooks(metricsServer, logger);
  }
}
// endregion:phase6-metrics-server
```

**Plan 06-04:** mount rate-limit middleware between `loadTenant` and MCP dispatch. Current chain at `src/server.ts:1145` + `1300`:
```ts
// src/server.ts:1145 (verbatim)
app.use('/t/:tenantId', loadTenant);
...
// src/server.ts:1300 (verbatim)
app.use('/t/:tenantId/mcp', [loadTenant, ...rateLimit..., mcpDispatchHandler]);
```

**Apply:**
```ts
// region:phase6-rate-limit (filled by 06-04)
const { createRateLimitMiddleware } = await import('./lib/rate-limit/middleware.js');
const rateLimit = createRateLimitMiddleware({ redis: redisClient.getRedis() });
app.use('/t/:tenantId/mcp', rateLimit);
// endregion:phase6-rate-limit
```

**Non-obvious constraints:**
- `src/server.ts:1300` already contains a middleware stack for `/mcp`; rate-limit MUST be inserted INSIDE that stack AFTER `loadTenant` and BEFORE `mcpDispatchHandler`. Insert between lines 1300-1302.
- Do NOT mount rate-limit globally on `/t/:tenantId` — the `/authorize` and `/token` paths are not per-request-rate gated (they are OAuth handshake surface, not tool-call surface).

---

## `src/index.ts` (modify — plan 06-03)

**Role:** existing bootstrap (self).
**Change:** none required for plan 06-02 / 06-04 directly — metrics-server hook is in `src/server.ts`, rate-limit middleware wiring is also in `src/server.ts`. Plan 06-03 only updates `.env.example` and the `src/index.ts` shutdown orchestrator IF the metrics server handle needs to survive the existing phase3ShutdownOrchestrator.

**Constraint (P-9):** `import './lib/otel.js'` at line 2 is LOAD-BEARING. No Phase 6 change may add an import above it. Verify by running `rg -n "^import" src/index.ts | head -5` after every edit.

---

## `vitest.config.js` (modify — plan 06-05)

**Role:** existing test config.
**Change:** wire `globalSetup`; extend `coverage.include`.

**Current config at `vitest.config.js:27-66`:**
```ts
// vitest.config.js:27-66 (excerpt)
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', ...(RUN_INTEGRATION ? [] : INTEGRATION_PATTERNS)],
    pool: 'threads',
    fileParallelism: false,
    poolOptions: { threads: { singleThread: true } },
    isolate: true,
    testTimeout: 45_000,
    hookTimeout: 45_000,
  },
});
```

**Apply**:
```ts
test: {
  globals: true,
  environment: 'node',
  setupFiles: ['./test/setup.ts'],
  globalSetup: RUN_INTEGRATION ? ['./test/setup/integration-globalSetup.ts'] : [],
  exclude: [...],
  coverage: {
    provider: 'v8',
    include: ['src/server.ts'], // D-10: narrow the coverage pass to OAuth-surface file
    reporter: ['json', 'lcov', 'text'],
  },
  ...
}
```

**Non-obvious constraints:**
- `globalSetup` MUST gate on `RUN_INTEGRATION` — otherwise `npm test` pays the Testcontainers cold-start.
- `coverage.include: ['src/server.ts']` limits the file set; D-10 line-range filtering happens in `bin/check-oauth-coverage.mjs` (see below).

---

## `.env.example` (modify — plans 06-01 + 06-07)

**Role:** existing docs/config.
**Change:** add new region blocks per P-10.

**Existing region pattern at `.env.example:142-171`:**
```
# region:phase3-postgres
# Phase 3 (plan 03-01) — Postgres
...
# endregion:phase3-postgres
```

**Apply** — append:
```
# region:phase6-observability
# Phase 6 (plan 06-01 / 06-03) — OpenTelemetry + Prometheus

# Port for the Prometheus /metrics endpoint (default 9464).
# MS365_MCP_METRICS_PORT=9464

# Optional Bearer token gating GET /metrics. When set, callers must send
# `Authorization: Bearer {token}`. When unset, the endpoint is open —
# document that operators should bind 0.0.0.0:9464 only behind a network
# ACL, or set this token and expose publicly.
# MS365_MCP_METRICS_BEARER=
# endregion:phase6-observability

# region:phase6-rate-limit
# Phase 6 (plan 06-04) — per-tenant rate limiting

# Platform default request-rate ceiling (requests/minute/tenant) applied
# when the tenant's rate_limits column is NULL.
# MS365_MCP_DEFAULT_REQ_PER_MIN=1000

# Platform default Graph token-budget ceiling (resource units/minute/tenant)
# applied when the tenant's rate_limits column is NULL.
# MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN=50000
# endregion:phase6-rate-limit
```

**Constraint:** the existing `MS365_MCP_PROMETHEUS_ENABLED` flag is documented at line 72-73 of `.env.example`. Plan 06-01 should leave it there and add a cross-reference to the new region.

---

## `migrations/20260901000000_tenant_rate_limits.sql` (NEW — plan 06-04)

**Role:** SQL migration.
**Analog:** `migrations/20260801000000_sharepoint_domain.sql` — exact role match.

**Copy-and-adapt pattern:**
```sql
-- Up Migration
-- Plan 06-04 (D-11): tenants.rate_limits JSONB column.
--
-- Per 06-CONTEXT.md §D-11:
--   - JSONB shape: { "request_per_min": int, "graph_points_per_min": int }
--   - NULL default; absence inherits platform defaults from env vars
--     (MS365_MCP_DEFAULT_REQ_PER_MIN / MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN).
--   - Admin PATCH /admin/tenants/{id} accepts the field via the existing
--     dynamic UPDATE builder (plan 04-02 shipped the addSet helper).
--   - Zod validation `RateLimitsZod` applied at admin PATCH (defense against
--     negative / zero / Infinity values).
--
-- Migration safety:
--   - ALTER TABLE tenants ADD COLUMN ... NULL is non-blocking on
--     PostgreSQL (fast path — no table rewrite for nullable columns with
--     no default value).
--   - No backfill — existing tenants pick up platform defaults on first
--     request via the rate-limit middleware's resolveRateLimits(tenant) helper.
--   - Backward compatible: no existing callers reference this column.

ALTER TABLE tenants
  ADD COLUMN rate_limits JSONB DEFAULT NULL;

COMMENT ON COLUMN tenants.rate_limits IS
  'Per-tenant rate-limit overrides as JSONB. Keys: request_per_min, graph_points_per_min. NULL inherits from MS365_MCP_DEFAULT_REQ_PER_MIN / MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN env vars.';

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS rate_limits;
```

**Non-obvious constraints:**
- Integration tests in `test/integration/runtime-tenant-onboarding.test.ts:61-66` iterate migrations in `sort()` order and split on `-- Down Migration`. The new file name MUST preserve the YYYYMMDDhhmmss timestamp prefix.
- `DEFAULT NULL` is explicit for clarity; PostgreSQL defaults to NULL for nullable columns without DEFAULT.

---

## `test/setup/integration-globalSetup.ts` (NEW — plan 06-05)

**Role:** vitest globalSetup hook.
**Analog:** `test/setup/testcontainers.ts` — closest existing (Postgres-only, per-file invocation).

**Current analog pattern at `test/setup/testcontainers.ts:36-55`:**
```ts
// test/setup/testcontainers.ts:36-55 (verbatim)
export async function startPgContainer(): Promise<IntegrationPgEnv> {
  if (cached) return cached.env;
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withUsername('mcp')
    .withPassword('mcp')
    .withDatabase('mcp')
    .start();
  const env: IntegrationPgEnv = {
    pgUrl: container.getConnectionUri(),
    cleanup: async () => { try { await container.stop(); } finally { cached = null; } },
  };
  cached = { env, container };
  return env;
}
```

**Apply** — RESEARCH.md §Pattern 5 (lines 556-591). Extend the existing testcontainers.ts shape into a TestProject-aware globalSetup:
```ts
import type { TestProject } from 'vitest/node';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

let pg: StartedPostgreSqlContainer | undefined;
let redis: StartedRedisContainer | undefined;

export async function setup(project: TestProject): Promise<void> {
  if (process.env.MS365_MCP_INTEGRATION !== '1') return;
  pg = await new PostgreSqlContainer('postgres:16-alpine')
    .withUsername('mcp').withPassword('mcp').withDatabase('mcp').start();
  redis = await new RedisContainer('redis:7-alpine').start();
  project.provide('pgUrl', pg.getConnectionUri());
  project.provide('redisUrl', redis.getConnectionUrl());
}

export async function teardown(): Promise<void> {
  await pg?.stop();
  await redis?.stop();
}
```

**Non-obvious constraints:**
- Requires `@testcontainers/redis` devDep — plan 06-05 task 0 installs it. Version pin to `11.14.0` to match `@testcontainers/postgresql`.
- `process.env.MS365_MCP_INTEGRATION !== '1'` gate is mandatory — `npm test` (unit-only) must not pay the Docker cost.
- `project.provide('pgUrl', ...)` is consumed via `inject('pgUrl')` in individual test files. TypeScript may need the declaration-merge to `ProvidedContext` — reference Vitest globalSetup docs.

---

## `test/setup/otel-test-reader.ts` (NEW — plan 06-05)

**Role:** test helper — in-memory MeterProvider + InMemoryMetricExporter.
**Analog:** none. No in-process OTel-reader helpers exist today.

**Fallback:** copy from RESEARCH.md §Validation Architecture §3 (lines 990-1001):
```ts
import {
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
  MeterProvider,
} from '@opentelemetry/sdk-metrics';

export function setupTestMeterProvider() {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 100_000 });
  const provider = new MeterProvider({ readers: [reader] });
  // Consumers call `await reader.collect()` to force emission in tests.
  return { provider, exporter, reader };
}
```

**Non-obvious constraints:**
- Must pair with a test-only override of the global MeterProvider via `metrics.setGlobalMeterProvider(provider)` — tests need to be able to assert that `mcpToolCallsTotal.add(...)` ended up in the in-memory exporter.
- `exportIntervalMillis: 100_000` effectively disables periodic export; tests force collection via `reader.collect()`.

---

## `test/setup/pkce-fixture.ts` (NEW — plan 06-05)

**Role:** test helper.
**Analog:** inline sha256 base64url pattern in `src/server.ts:294-299`.

**Existing code in `src/server.ts:294-299`** (verbatim):
```ts
if (body.code_verifier) {
  const clientVerifier = body.code_verifier as string;
  const clientChallengeComputed = crypto
    .createHash('sha256')
    .update(clientVerifier)
    .digest('base64url');
```

**Apply** — RESEARCH.md §Validation Architecture §5 (lines 1006-1012):
```ts
import crypto from 'node:crypto';

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
```

**Non-obvious constraints:**
- Plan 06-05 integration tests MUST use this generator per test (never hard-code challenges — see RESEARCH.md Pitfall 5). Hard-coded values cause key collisions in shared-Redis integration runs.

---

## `test/lib/otel-metrics.test.ts` (NEW — plan 06-02)

**Role:** unit test.
**Analog:** `test/retry-handler.test.ts` (middleware unit-test layout) + test-reader from above.

**Canonical scaffold from `test/retry-handler.test.ts:1-57` (verbatim, trimmed):**
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RetryHandler } from '../src/lib/middleware/retry.js';
import type { GraphRequest } from '../src/lib/middleware/types.js';
import { requestContext } from '../src/request-context.js';

describe('RetryHandler', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('honors Retry-After seconds verbatim (clamped to max)', async () => {
    ...
    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
```

**Apply** — target test cases per RESEARCH.md §Phase Requirements → Test Map:
- `mcp_tool_calls_total` increments once with {tenant, tool, status}
- `mcp_tool_duration_seconds` histogram records with tenant/tool labels
- `mcp_graph_throttled_total` increments on 429 only
- Workload prefix (not full alias) on labels — assert `labelForTool('list-mail-messages')` → `'list'` (follows existing `extractWorkloadPrefix` semantics)
- Workload prefix product path — assert `labelForTool('__powerbi__GroupsGetGroups')` → `'powerbi'`

---

## `test/lib/graph-client.span.test.ts` (NEW — plan 06-02)

**Role:** unit test.
**Analog:** `test/retry-handler.test.ts` (same scaffold); span-assertion pattern from `src/lib/middleware/odata-error.ts:41-82`.

**Span-assertion pattern** — use `@opentelemetry/sdk-trace-base` `InMemorySpanExporter`:
```ts
import { InMemorySpanExporter, SimpleSpanProcessor, BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';

const spanExporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(spanExporter)] });
trace.setGlobalTracerProvider(provider);

// After calling makeRequest:
const spans = spanExporter.getFinishedSpans();
const parentSpan = spans.find((s) => s.name === 'graph.request');
expect(parentSpan?.attributes['tenant.id']).toBe('tenant-a');
expect(parentSpan?.attributes['tool.name']).toBe('mail'); // workload
expect(parentSpan?.attributes['tool.alias']).toBe('mail.messages.send'); // full
expect(parentSpan?.attributes['http.status_code']).toBe(200);
```

---

## `test/lib/rate-limit/sliding-window.test.ts` (NEW — plan 06-04)

**Role:** unit test.
**Analog:** `test/pkce-store/redis-store.test.ts` — exact match (Redis-backed store unit test with MemoryRedisFacade / ioredis-mock).

**Exact copy-adapt pattern from `test/pkce-store/redis-store.test.ts:1-80`:**
```ts
// test/pkce-store/redis-store.test.ts:1-50 (verbatim)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { RedisPkceStore } from '../../src/lib/pkce-store/redis-store.js';
import type { PkceEntry } from '../../src/lib/pkce-store/pkce-store.js';

function makeEntry(overrides: Partial<PkceEntry> = {}): PkceEntry { ... }

describe('plan 03-03 — RedisPkceStore', () => {
  let facade: MemoryRedisFacade;
  let store: RedisPkceStore;

  beforeEach(() => { facade = new MemoryRedisFacade(); store = new RedisPkceStore(facade); });
  afterEach(async () => {
    vi.useRealTimers();
    if (facade.status !== 'end') await facade.quit();
  });

  it('put() returns true on first write, stores the entry as JSON under mcp:pkce:{tenant}:{challenge}', async () => {
    ...
    expect(ok).toBe(true);
    const raw = await facade.get('mcp:pkce:_:ch-1');
    expect(raw).not.toBeNull();
  });
});
```

**Apply** — SWAP MemoryRedisFacade for ioredis-mock (the facade has no ZSET support). RESEARCH.md §Anti-Patterns explicitly states "DON'T reuse MemoryRedisFacade for rate-limit tests".

```ts
import Redis from 'ioredis-mock';
...
describe('plan 06-04 — sliding-window', () => {
  let redis: import('ioredis').Redis;
  beforeEach(() => {
    redis = new (Redis as any)();
    registerSlidingWindow(redis);
  });
  it('rejects the (max+1)-th request with retry_after_ms > 0', async () => {
    const key = 'mcp:rl:req:tenant-a';
    for (let i = 0; i < 5; i++) {
      const r = await consume(redis, key, 60_000, 5);
      expect(r.allowed).toBe(true);
    }
    const denied = await consume(redis, key, 60_000, 5);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });
});
```

**Target test cases** (per VALIDATION.md Wave 0):
- consume() returns allowed=false at max+1
- ZSET script atomic under concurrent consume() (spawn Promise.all of 2× max)
- Observe cost weight applied
- TTL expires stale entries

---

## `test/integration/metrics-endpoint.int.test.ts` (NEW — plan 06-03)

**Role:** integration test (HTTP contract).
**Analog:** `test/oauth-register-hardening.test.ts` — exact role (fetch-based HTTP contract + ephemeral server).

**Server-bootstrap pattern from `test/oauth-register-hardening.test.ts:56-82`:**
```ts
// test/oauth-register-hardening.test.ts:56-82 (verbatim, trimmed)
async function startMiniServer(opts: { mode: 'prod' | 'dev'; publicUrlHost: string | null; }): Promise<{ url: string; close: () => Promise<void> }> {
  const { createRegisterHandler } = await import('../src/server.js');
  const app = express();
  app.use(express.json());
  app.post('/register', createRegisterHandler({ mode: opts.mode, publicUrlHost: opts.publicUrlHost }));
  return await new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => { server.close(() => r()); }),
      });
    });
  });
}
```

**Apply** — `createMetricsServer(exporter, { port: 0, bearerToken: 'test-token' })`. Assert:
- GET /metrics without header → 401 + `WWW-Authenticate: Bearer`
- GET /metrics with wrong Bearer → 401
- GET /metrics with correct Bearer → 200 + body contains `# TYPE mcp_tool_calls_total counter`
- Timing-safe compare — fuzz two tokens of equal length and assert no observable timing difference (optional stretch test)

---

## `test/integration/rate-limit/gateway-429.int.test.ts` (NEW — plan 06-04)

**Role:** integration test.
**Analog:** `src/lib/admin/__tests__/webhook-ratelimit.int.test.ts` — exact (per-IP 401 flood counter verification; same middleware structure + IP isolation test pattern).

**Exact copy-adapt pattern from `src/lib/admin/__tests__/webhook-ratelimit.int.test.ts:1-100`:**
```ts
// webhook-ratelimit.int.test.ts:1-100 (excerpt)
const { loggerMock } = vi.hoisted(() => ({ loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../../logger.js', () => ({ default: loggerMock, rawPinoLogger: loggerMock, enableConsoleLogging: vi.fn() }));

import { createWebhookHandler, MAX_401_PER_MINUTE_PER_IP } from '../webhooks.js';
import { MemoryRedisFacade } from '../../redis-facade.js';
...
async function makePool(): Promise<Pool> { ... }
async function seedTenant(pool: Pool, id = TENANT_A): Promise<void> { ... }
```

**Apply** — scaffold:
- seed tenant with `rate_limits: { request_per_min: 5, graph_points_per_min: 1000 }`
- Send 5 consecutive MCP calls under tenant — all 200
- 6th call — 429 + `Retry-After` header
- After 61s (advance vi.useFakeTimers), 7th call — 200 again
- Per-tenant isolation: tenant A exhausted + tenant B fresh → tenant B → 200

**Non-obvious constraint:** This test must use ioredis-mock, NOT MemoryRedisFacade (ZSET requirement). Swap per P-6 scaffold.

---

## `test/integration/rate-limit/admin-config.int.test.ts` (NEW — plan 06-04)

**Role:** integration test (admin PATCH persistence + invalidation).
**Analog:** `src/lib/admin/__tests__/tenants.int.test.ts` + `product-selectors.int.test.ts` — both (tenants.int.test covers CRUD paths; product-selectors adds the PATCH-with-complex-field pattern).

**Harness — verbatim from `src/lib/admin/__tests__/tenants.int.test.ts:131-169`:**
```ts
async function startServer(
  pool: Pool, redis: MemoryRedisFacade, admin: AdminContext, tenantPool: TenantPoolStub
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json() as unknown as express.RequestHandler);
  app.use((req, _res, next) => {
    (req as unknown as { admin?: AdminContext }).admin = admin;
    (req as express.Request & { id?: string }).id = `req-${Math.random().toString(36).slice(2, 10)}`;
    next();
  });
  app.use('/admin/tenants', createTenantsRoutes({
    pgPool: pool, redis, tenantPool, kek: KEK,
    cursorSecret: createCursorSecret(), adminOrigins: [],
    entraConfig: { appClientId: 'x', groupId: 'g' },
  }));
  const server = await new Promise<http.Server>((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  ...
}
```

**Apply** — target test cases:
- POST /admin/tenants with `rate_limits: { request_per_min: 100, graph_points_per_min: 5000 }` → 201, row has JSONB
- PATCH /admin/tenants/:id with `rate_limits: { request_per_min: 200, ... }` → 200, row updated
- PATCH with `rate_limits: { request_per_min: -1, ... }` → 400 (Zod rejects negative)
- PATCH with `rate_limits: { request_per_min: 1000 }` (missing graph_points_per_min) → 400 (strict schema)
- PATCH with `rate_limits: null` → 200, clears override
- GET /admin/tenants/:id includes `rate_limits` field
- Audit log row contains `fieldsChanged: ['rate_limits']`
- publishTenantInvalidation called via tenantPool.invalidate mock

---

## `test/integration/oauth-surface/*.int.test.ts` (NEW — plan 06-05)

**Role:** integration tests (4 new files).
**Analog:** `test/integration/runtime-tenant-onboarding.test.ts` (end-to-end tenant + Express mount pattern) + `test/oauth-register-hardening.test.ts` (OAuth handler assertions).

**Existing analog pattern from `test/integration/runtime-tenant-onboarding.test.ts:108-130`:**
```ts
// test/integration/runtime-tenant-onboarding.test.ts:108-130 (excerpt)
beforeEach(async () => {
  pool = await makePool();
  redis = new MemoryRedisFacade();
  pkceStore = new RedisPkceStore(redis);
  const mockAcquireByCode = vi.fn(async () => ({
    accessToken: 'access-token-after-onboarding',
    expiresOn: new Date(Date.now() + 3600 * 1000),
  }));
  const mockTenantPool = {
    acquire: vi.fn(async () => ({ acquireTokenByCode: mockAcquireByCode })),
    buildCachePlugin: vi.fn(),
    evict: vi.fn(),
```

**Apply per file:**

**`pkce-concurrent.int.test.ts`** — two concurrent PKCE flows (RESEARCH.md §Validation Architecture §6, lines 1015-1033):
- `const pkceA = newPkce(); const pkceB = newPkce();` (use `test/setup/pkce-fixture.ts`)
- Interleave `/authorize` and `/token` calls with `Promise.all`
- Assert cross-verifier mismatch → 400; own-verifier → 200

**`register-invalid-redirect.int.test.ts`** — dynamic-register with `javascript:` redirect → 400. Extend existing `test/oauth-register-hardening.test.ts` (already covers most of this) with additional branches.

**`token-error-paths.int.test.ts`** — /token error branches (missing grant_type, wrong redirect_uri, expired PKCE) → ensure logs do NOT contain request body (enforce Site B/C scrub from `src/server.ts:205-258`).

**`well-known-metadata.int.test.ts`** — `/.well-known/oauth-authorization-server` AND `/.well-known/oauth-protected-resource` return valid JSON with/without MS365_MCP_PUBLIC_URL.

**Non-obvious constraints:**
- Test file naming: `.int.test.ts` suffix (vitest integration pattern — see `vitest.config.js:11`).
- Each test file MUST use `newPkce()` per-test (Pitfall 5) — never hard-code challenges.
- `afterEach` should flush keys matching `mcp:pkce:*` (NOT `FLUSHDB` — that wipes parallel tests).

---

## `test/integration/multi-tenant/bearer-tid-mismatch.int.test.ts` (NEW — plan 06-06)

**Role:** integration test.
**Analog:** `test/integration/multi-tenant-isolation.test.ts` (existing; same directory, same mount pattern).

**Scaffold:** bootstrap two tenants A and B. Mint a bearer token whose `tid` claim points to tenant A. Call `/t/{tenant-B}/mcp` with that bearer. Assert 401 + audit row `auth.tid_mismatch`.

**Existing `test/integration/multi-tenant-isolation.test.ts`** already implements the two-tenant scaffold — copy its pool + Redis setup verbatim, extend with `Authorization: Bearer` header handling. Inspect that test for the existing JWT fixture pattern.

---

## `bin/check-oauth-coverage.mjs` (NEW — plan 06-05)

**Role:** CI gate script.
**Analog:** `bin/migrate.mjs` — programmatic entrypoint + CLI entrypoint bin script pattern.

**Exact pattern from `bin/migrate.mjs:1-42`:**
```js
// bin/migrate.mjs:1-42 (verbatim, trimmed)
#!/usr/bin/env node
/**
 * ...plan 03-01 doc block...
 *
 * Module design (bin/migrate-tokens.mjs:27-30 pattern): export `main` so
 * tests can invoke it programmatically; entry-point check at the bottom
 * runs main() only when invoked as a script.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
...

export async function main(argv = process.argv.slice(2)) {
  ...
  return 0; // or non-zero on error
}

// Entry-point guard at bottom:
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code)).catch(...);
}
```

**Apply** — RESEARCH.md §Validation Architecture §Line-Coverage Measurement (lines 1037-1053):
```js
#!/usr/bin/env node
/**
 * OAuth-surface coverage gate for D-10 (plan 06-05).
 *
 * Reads coverage/coverage-final.json, counts statement hits inside the
 * OAuth-handler line ranges of src/server.ts, prints percentage, exits
 * non-zero if below 70%.
 *
 * Line-range discovery (Plan 06-05 task 0):
 *   grep -n 'createAuthorizeHandler\|createTokenHandler\|createRegisterHandler' src/server.ts
 *   grep -n '/\.well-known' src/server.ts
 *
 * Current anchors (captured 2026-04-22 via the Grep tool):
 *   - createRegisterHandler: line 108
 *   - createTokenHandler: line 205
 *   - createAuthorizeHandler: line 491
 *   - createTenantTokenHandler: line 687
 *   - /.well-known/oauth-authorization-server: line 1495
 *   - /.well-known/oauth-protected-resource: line 1522
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OAUTH_LINE_RANGES = [
  { fn: 'createRegisterHandler', start: 108, end: 156 },
  { fn: 'createTokenHandler', start: 205, end: 399 },
  { fn: 'createAuthorizeHandler', start: 491, end: 670 },
  { fn: 'createTenantTokenHandler', start: 687, end: 878 },
  { fn: 'wellKnownAuthServer', start: 1495, end: 1521 },
  { fn: 'wellKnownProtectedResource', start: 1522, end: 1560 },
];

export function main() {
  const cov = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'coverage', 'coverage-final.json'), 'utf8'));
  const serverFile = Object.keys(cov).find((f) => f.endsWith('src/server.ts'));
  if (!serverFile) { console.error('src/server.ts not in coverage output'); return 1; }
  const { statementMap, s } = cov[serverFile];
  let hit = 0, total = 0;
  for (const [id, loc] of Object.entries(statementMap)) {
    const inRange = OAUTH_LINE_RANGES.some((r) => loc.start.line >= r.start && loc.end.line <= r.end);
    if (!inRange) continue;
    total++;
    if (s[id] > 0) hit++;
  }
  const pct = total === 0 ? 0 : (100 * hit / total);
  console.log(`OAuth-surface coverage: ${hit}/${total} = ${pct.toFixed(1)}%`);
  return pct < 70 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
```

**Non-obvious constraints:**
- Line ranges are BRITTLE. Plan 06-05 task 0 must re-run the grep and hard-code CURRENT ranges (shown above — captured during pattern mapping on 2026-04-22).
- End-line of each handler is the closing `}` of the exported function. Grep helper for task 0: `awk '/^}/ && NR > START' src/server.ts` to find the closing brace.
- If `createRegisterHandler` (or any other) moves in a Phase 6 refactor, plan 06-05 tests MUST be updated to match. The CI gate protects against accidental coverage regression.

---

## `docs/observability/*` (NEW — plan 06-07)

**Role:** docs assets.
**Analog:** none in repo.

**Fallbacks:**
- `grafana-starter.json` — export from a live Grafana v10 instance per RESEARCH.md §Don't Hand-Roll. 5 panels per D-09.
- `runbook.md` — operator-facing runbook; structure per RESEARCH.md §Open Question #4 (include sizing guide for MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN: S/M/L tier table).
- `metrics-reference.md` — per-metric table: name, labels, typical values, PromQL snippets.
- `prometheus-scrape.yml` — reference scrape-target fragment; document auth header for the D-02 Bearer token.
- `README.md` (index page for the directory) — which file is for which audience.

**Pitfall to avoid:** Grafana `uid` collisions — scrub `uid` to `null` before committing (RESEARCH.md Pitfall 8).

---

## No Analog Found — Summary

Files listed with `**no analog**` above: planner should copy verbatim from the RESEARCH.md code-examples section they cite. These are NEW primitives for this codebase:

| File | RESEARCH.md reference |
|------|----------------------|
| `src/lib/rate-limit/sliding-window.lua` | §Pattern 4, lines 421-470 |
| `test/setup/otel-test-reader.ts` | §Validation Architecture §3, lines 990-1001 |
| `docs/observability/grafana-starter.json` | §D-09 (5 panels listed); schema v41 per A2 |
| `docs/observability/runbook.md` | §Open Question #4 sizing guide |
| `docs/observability/metrics-reference.md` | §Span Attribute Schema + §Phase Requirements → Test Map |

---

## Metadata

**Analog search scope:** `src/**/*.ts`, `test/**/*.test.ts`, `migrations/*.sql`, `bin/*.mjs`, `bin/*.cjs`, `.env.example`, `vitest.config.js`
**Files scanned:** ~35 (closest analogs) out of ~1500 total in the tree
**Pattern extraction date:** 2026-04-22
**Strong-match analogs cited (with line numbers):** `src/lib/otel.ts`, `src/lib/admin/tenants.ts`, `src/lib/admin/webhooks.ts`, `src/lib/middleware/retry.ts`, `src/lib/middleware/odata-error.ts`, `src/lib/pkce-store/redis-store.ts`, `src/lib/pkce-store/memory-store.ts`, `src/lib/redis.ts`, `src/lib/tenant/tenant-row.ts`, `src/request-context.ts`, `src/graph-client.ts`, `src/server.ts`, `src/index.ts`, `src/lib/admin/auth/dual-stack.ts`, `src/lib/tool-selection/registry-validator.ts`, `migrations/20260801000000_sharepoint_domain.sql`, `test/setup/testcontainers.ts`, `test/retry-handler.test.ts`, `test/pkce-store/redis-store.test.ts`, `test/oauth-register-hardening.test.ts`, `test/integration/runtime-tenant-onboarding.test.ts`, `test/integration/tenant-disable-cascade.test.ts`, `src/lib/admin/__tests__/tenants.int.test.ts`, `src/lib/admin/__tests__/webhook-ratelimit.int.test.ts`, `src/lib/admin/__tests__/product-selectors.int.test.ts`, `bin/migrate.mjs`, `.env.example`, `vitest.config.js`
