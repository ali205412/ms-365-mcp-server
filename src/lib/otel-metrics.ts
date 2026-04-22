/**
 * OpenTelemetry Meter + named instruments (plan 06-02, OPS-06 + D-06).
 *
 * Constructed ONCE at module load. Consumers import specific instruments and
 * call .add() / .record() per event; the SDK deduplicates under the hood.
 *
 * Label cardinality (D-06): `tool` label is the workload prefix (first segment
 * before '.'/'-', or the product name for __powerbi__/__exo__/etc.), NOT the
 * full tool alias. See labelForTool() — re-exported from
 * src/lib/tool-selection/registry-validator.ts (already implements the exact
 * normalization semantics).
 *
 * Cardinality budget: ~40 workloads × ~20 HTTP statuses × N tenants.
 * Full tool alias (~14k values) appears ONLY as the `tool.alias` span attribute.
 *
 * This module MUST NOT import ./otel.js — the SDK bootstrap is consumed
 * indirectly via the global MeterProvider that metrics.getMeter() reads.
 * A direct import would create a circular-dependency risk.
 */
import { metrics } from '@opentelemetry/api';

// Re-export the D-06 label helper (workload prefix — NOT full tool alias).
// The source of truth is registry-validator.ts; this is a name alias
// for consumers that want explicit "this is for metric labels" semantics.
export { extractWorkloadPrefix as labelForTool } from './tool-selection/registry-validator.js';

/**
 * Structural type describing the subset of the PKCE-store interface consumed
 * by the observable-gauge wiring below. Deliberately narrower than
 * `PkceStore` from `./pkce-store/pkce-store.js` — plan 06-03 adds `size()`
 * to the full interface and concrete implementations; plan 06-02 defines the
 * wiring helper up-front using this structural shape so that we stay type-
 * safe without prematurely modifying the PkceStore interface (plan 06-03's
 * explicit scope). Any object providing `size(): Promise<number>` satisfies
 * this contract, including both MemoryPkceStore and RedisPkceStore once
 * plan 06-03 lands.
 */
export interface PkceStoreSize {
  size(): Promise<number>;
}

// Named meter — appears in Prometheus serialization as otel_scope_name="ms-365-mcp-server"
const meter = metrics.getMeter('ms-365-mcp-server', process.env.npm_package_version);

export const mcpToolCallsTotal = meter.createCounter('mcp_tool_calls_total', {
  description:
    'Total MCP Graph tool invocations, labelled by tenant, workload prefix, and HTTP status code',
});

export const mcpToolDurationSeconds = meter.createHistogram('mcp_tool_duration_seconds', {
  description: 'End-to-end duration of each Graph tool call, measured at GraphClient.makeRequest',
  unit: 's',
});

export const mcpGraphThrottledTotal = meter.createCounter('mcp_graph_throttled_total', {
  description: 'Count of Graph responses with HTTP 429 (throttled), per tenant',
});

export const mcpRateLimitBlockedTotal = meter.createCounter('mcp_rate_limit_blocked_total', {
  description:
    'Count of requests rejected by the gateway rate limiter, per tenant and reason (request_rate|graph_points)',
});

// Observable (pull-based) gauges — the SDK polls the callback each collection cycle.
export const mcpOauthPkceStoreSize = meter.createObservableGauge('mcp_oauth_pkce_store_size', {
  description:
    'Count of PKCE entries currently resident in the store (Redis SCAN in prod; Map.size in stdio)',
});

export const mcpTokenCacheHitRatio = meter.createObservableGauge('mcp_token_cache_hit_ratio', {
  description:
    'Ratio of MSAL token cache hits to total acquires over the last collection interval, per tenant',
});

export const mcpActiveStreams = meter.createUpDownCounter('mcp_active_streams', {
  description: 'Active long-lived streams (legacy SSE + streamable HTTP open sockets), per tenant',
});

/**
 * Plan 06-03: attach a PKCE-store observable gauge callback. Invoked once at
 * server startup (after the pkceStore instance is constructed). Idempotent —
 * addCallback can be called multiple times; each fires on every collection.
 *
 * The `pkceStore` parameter is typed structurally via `PkceStoreSize` rather
 * than the full `PkceStore` interface so this function compiles cleanly
 * without requiring plan 06-03's interface-and-impl changes to land first.
 */
export function wirePkceStoreGauge(pkceStore: PkceStoreSize): void {
  mcpOauthPkceStoreSize.addCallback(async (observableResult) => {
    try {
      observableResult.observe(await pkceStore.size());
    } catch {
      // Never fail a metric collection — the SDK swallows the missed sample.
    }
  });
}
