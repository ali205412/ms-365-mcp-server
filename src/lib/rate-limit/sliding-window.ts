/**
 * Sliding-window rate limiter (plan 06-04, OPS-08, D-03).
 *
 * Atomic ZSET+Lua implementation via ioredis.defineCommand — EVALSHA
 * transparent fallback means we pay the bandwidth for the full Lua body
 * once per client, then every consume/observe is a single ~100-byte RTT.
 *
 * Consumers:
 *   - src/lib/rate-limit/middleware.ts — gate on mcp:rl:req:{tid} + mcp:rl:graph:{tid}
 *   - src/lib/middleware/retry.ts — post-response observe(mcp:rl:graph:{tid}, weight)
 *
 * Unit tests use ioredis-mock (full ZSET + EVAL support per compat.md).
 * MemoryRedisFacade does NOT implement ZSET — it is NEVER the backing store
 * for this module's tests.
 *
 * Key-prefix (src/lib/redis.ts:21):
 *   mcp:rl:{bucket}:{tenantId} — Phase 6 reserved prefix
 *
 * Threat dispositions:
 *   - T-06-04-c (Lua script not atomic → DoS): mitigate — single EVAL with
 *     ZREMRANGEBYSCORE + ZCARD + ZADD in one round-trip.
 *   - T-06-02-c (counter increment under concurrency): mitigate — Lua runs
 *     single-threaded on Redis.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import type { Redis as IORedis } from 'ioredis';

import type { RedisClient } from '../redis.js';
import logger from '../../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LUA = readFileSync(path.join(__dirname, 'sliding-window.lua'), 'utf8');

// Extend ioredis types so TypeScript knows about the custom command.
// The return type widens to Promise<[number,number,number]> under the
// `default` ClientContext (non-pipeline). We coerce at the call site via
// `await client.slidingWindow(...)` — ioredis's ResultTypes maps through.
declare module 'ioredis' {
  interface RedisCommander<Context> {
    slidingWindow(
      this: unknown,
      key: string,
      windowMs: number | string,
      maxCount: number | string,
      nowMs: number | string,
      reqId: string,
      cost: number | string
    ): Promise<[number, number, number]>;
  }
}

let registered = new WeakSet<IORedis>();

/**
 * Register the custom `slidingWindow` command on the supplied client.
 * Idempotent — the weak-set guard prevents duplicate registrations on a
 * single client instance. Call once per getRedis() construction.
 */
export function registerSlidingWindow(redis: IORedis): void {
  if (registered.has(redis)) return;
  redis.defineCommand('slidingWindow', {
    numberOfKeys: 1,
    lua: LUA,
  });
  registered.add(redis);
}

export interface ConsumeResult {
  allowed: boolean;
  currentCount: number;
  retryAfterMs: number;
}

/**
 * consume — gate decision. Returns { allowed, currentCount, retryAfterMs }.
 * Atomic ZSET operation under Lua. `cost` defaults to 1 for request-rate
 * gates; weighted observe passes a cost equal to the observed resource unit.
 *
 * Caller-supplied key MUST match the `mcp:rl:*` convention for audit/debug.
 */
export async function consume(
  redis: RedisClient,
  key: string,
  windowMs: number,
  maxCount: number,
  cost = 1
): Promise<ConsumeResult> {
  const nowMs = Date.now();
  const reqId = crypto.randomUUID();
  const client = redis as unknown as IORedis;
  const [allowed, currentCount, retryAfterMs] = await client.slidingWindow(
    key,
    windowMs,
    maxCount,
    nowMs,
    reqId,
    cost
  );
  return {
    allowed: allowed === 1,
    currentCount: currentCount as number,
    retryAfterMs: retryAfterMs as number,
  };
}

/**
 * observe — D-05 sibling to consume. Post-response hook for RetryHandler
 * to record the ACTUAL resource-unit cost observed from Graph's
 * x-ms-resource-unit header. Never gates (max_count = MAX_SAFE_INTEGER).
 *
 * Weighted — the `weight` parameter drives the Lua script's cost branch
 * so N entries get added for a single observation of N units.
 */
export async function observe(
  redis: RedisClient,
  tenantId: string,
  windowMs: number,
  weight: number
): Promise<void> {
  if (weight <= 0) return;
  const key = `mcp:rl:graph:${tenantId}`;
  await consume(redis, key, windowMs, Number.MAX_SAFE_INTEGER, weight);
}

/**
 * Parse Graph's `x-ms-resource-unit` header. Range: typically 1-5 for reads,
 * 3-10 for writes/expands. Capped at 100 as defense-in-depth (A1) — a
 * pathological Graph response cannot blow through a tenant's budget in
 * one call.
 */
export function parseResourceUnit(raw: string | null): number {
  if (!raw) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.min(n, 100);
}

// Test-only hook — allows unit tests to reset the registered set between
// re-imports. Never called from production code.
export function __resetRegisteredForTesting(): void {
  registered = new WeakSet();
}

export { logger as __logger };
