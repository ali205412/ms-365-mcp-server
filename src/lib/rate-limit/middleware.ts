/**
 * Per-tenant rate-limit Express middleware (plan 06-09 — closes OPS-08 gap from 06-04 Task 3).
 *
 * Mounts between toolsListFilter / authSelector and MCP dispatch on
 * /t/:tenantId/mcp (src/server.ts region:phase6-rate-limit — plan 06-09 Task 3).
 *
 * Gates on BOTH budgets per ROADMAP SC#3 + RESEARCH.md §Open Question #5:
 *   - Request-rate: mcp:rl:req:{tenantId} (cost=1 per request)
 *   - Graph-points budget: mcp:rl:graph:{tenantId} (pre-call floor cost=1; the
 *     ACTUAL cost is observed post-response by RetryHandler via observe(),
 *     so this pre-check uses a conservative cost floor of 1. If either budget
 *     is exhausted → 429).
 *
 * Fail-closed posture per RESEARCH.md §Security Domain §Checklist:
 *   - Redis unavailability → 503 + Retry-After: 5 (availability trade-off —
 *     outage blocks traffic rather than silently admitting unmetered traffic).
 *   - Missing req.tenant.id → 400 (T-06-02 mitigation — loadTenant should have
 *     populated req.tenant; absence indicates an upstream bug and we must not
 *     admit unmetered traffic).
 *
 * Threat dispositions:
 *   - T-06-02 (rate-limit bypass via missing tenantId): mitigate — hard-fail 400.
 *   - T-06-04-c (Lua script not atomic): mitigated by sliding-window.ts
 *     (single EVAL — confirmed in 06-04 Task 1 tests).
 *   - T-06-04-d (Redis outage blocks traffic): accept — fail-closed is intended.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { RedisClient } from '../redis.js';
import type { RateLimitsConfig } from '../tenant/tenant-row.js';
import { consume } from './sliding-window.js';
import { resolveRateLimits, WINDOW_MS } from './defaults.js';
import { mcpRateLimitBlockedTotal } from '../otel-metrics.js';
import logger from '../../logger.js';

export interface RateLimitMiddlewareDeps {
  redis: RedisClient;
}

/**
 * Narrow req.tenant at read-time — Express's Request is untyped for our
 * tenant extension; this helper isolates the cast so the rest of the function
 * stays clean and the contract stays visible.
 */
interface TenantAttached {
  tenant?: {
    id?: string;
    rate_limits?: RateLimitsConfig | null;
  };
}

/**
 * createRateLimitMiddleware — Express middleware factory.
 * Call once at mount time; returns a RequestHandler that checks both budgets
 * on every request.
 *
 * Expected req shape (populated by loadTenant + authSelector upstream):
 *   req.tenant = { id: string, rate_limits: RateLimitsConfig | null, ... }
 */
export function createRateLimitMiddleware(deps: RateLimitMiddlewareDeps): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const tenantReq = req as Request & TenantAttached;
    const tenant = tenantReq.tenant;
    const tenantId = tenant?.id;

    // T-06-02 mitigation: hard-fail when tenant is not populated upstream.
    // loadTenant should have set req.tenant — if it didn't, we must not admit
    // unmetered traffic.
    if (!tenantId) {
      logger.warn('plan 06-09: rate-limit middleware — req.tenant.id absent; refusing request');
      res.status(400).json({ error: 'rate_limit_no_tenant' });
      return;
    }

    // Redis readiness — fail CLOSED on outage per §Security Domain §Checklist.
    // ioredis exposes .status in {'wait','connect','connecting','ready','reconnecting','end','close'};
    // we gate on membership in the healthy set. MemoryRedisFacade has no .status
    // (undefined) which falls through to the consume() path — test harness relies on this.
    const status = (deps.redis as unknown as { status?: string }).status;
    if (status !== undefined && status !== 'ready' && status !== 'wait') {
      res.setHeader('Retry-After', '5');
      logger.warn(
        { tenantId, redisStatus: status },
        'plan 06-09: rate-limit middleware — Redis unavailable, failing closed'
      );
      res.status(503).json({ error: 'redis_unavailable' });
      return;
    }

    const resolved = resolveRateLimits({
      rate_limits: tenant?.rate_limits ?? null,
    });

    try {
      // Gate 1: request-rate budget
      const reqCheck = await consume(
        deps.redis,
        `mcp:rl:req:${tenantId}`,
        WINDOW_MS,
        resolved.request_per_min,
        1
      );
      if (!reqCheck.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(reqCheck.retryAfterMs / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        mcpRateLimitBlockedTotal.add(1, {
          tenant: tenantId,
          reason: 'request_rate',
        });
        logger.info(
          {
            tenantId,
            reason: 'request_rate',
            currentCount: reqCheck.currentCount,
            retryAfterMs: reqCheck.retryAfterMs,
          },
          'plan 06-09: rate-limit 429 — request_rate budget exhausted'
        );
        res.status(429).json({ error: 'rate_limited', reason: 'request_rate' });
        return;
      }

      // Gate 2: graph-points budget (pre-call floor; actual cost observed post-call
      // via src/lib/middleware/retry.ts observe() — D-05).
      const graphCheck = await consume(
        deps.redis,
        `mcp:rl:graph:${tenantId}`,
        WINDOW_MS,
        resolved.graph_points_per_min,
        1
      );
      if (!graphCheck.allowed) {
        const retryAfterSec = Math.max(1, Math.ceil(graphCheck.retryAfterMs / 1000));
        res.setHeader('Retry-After', String(retryAfterSec));
        mcpRateLimitBlockedTotal.add(1, {
          tenant: tenantId,
          reason: 'graph_points',
        });
        logger.info(
          {
            tenantId,
            reason: 'graph_points',
            currentCount: graphCheck.currentCount,
            retryAfterMs: graphCheck.retryAfterMs,
          },
          'plan 06-09: rate-limit 429 — graph_points budget exhausted'
        );
        res.status(429).json({ error: 'rate_limited', reason: 'graph_points' });
        return;
      }

      next();
    } catch (err) {
      // Fail closed on unexpected Redis / Lua error — 503 not 500 so scraper can retry.
      logger.error(
        { err: (err as Error).message, tenantId },
        'plan 06-09: rate-limit middleware — consume() threw, failing closed'
      );
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: 'rate_limit_error' });
    }
  };
}
