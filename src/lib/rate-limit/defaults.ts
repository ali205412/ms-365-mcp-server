/**
 * Platform default rate limits (plan 06-04, OPS-08, D-11).
 *
 * Resolution order: tenant.rate_limits (admin-configured) → env vars →
 * hardcoded defaults. See .env.example §phase6-rate-limit for operator guidance.
 *
 * Pattern from src/lib/middleware/retry.ts:163-168 (parseMaxAttempts).
 */
import type { TenantRow } from '../tenant/tenant-row.js';

export const WINDOW_MS = 60_000; // 60s rolling window — aligns with Graph's per-10s cap

const FALLBACK_REQ_PER_MIN = 1000;
const FALLBACK_GRAPH_POINTS_PER_MIN = 50_000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getDefaultReqPerMin(): number {
  return parsePositiveInt(process.env.MS365_MCP_DEFAULT_REQ_PER_MIN, FALLBACK_REQ_PER_MIN);
}

export function getDefaultGraphPointsPerMin(): number {
  return parsePositiveInt(
    process.env.MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN,
    FALLBACK_GRAPH_POINTS_PER_MIN
  );
}

export interface ResolvedRateLimits {
  request_per_min: number;
  graph_points_per_min: number;
  source: 'tenant' | 'platform-default';
}

/**
 * resolveRateLimits — prefer tenant override, fall back to platform defaults.
 * Accepts null/undefined tenant rate_limits (NULL JSONB column).
 */
export function resolveRateLimits(tenant: Pick<TenantRow, 'rate_limits'>): ResolvedRateLimits {
  if (tenant.rate_limits) {
    return {
      request_per_min: tenant.rate_limits.request_per_min,
      graph_points_per_min: tenant.rate_limits.graph_points_per_min,
      source: 'tenant',
    };
  }
  return {
    request_per_min: getDefaultReqPerMin(),
    graph_points_per_min: getDefaultGraphPointsPerMin(),
    source: 'platform-default',
  };
}
