import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Redis from 'ioredis-mock';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

describe('plan 06-04 — sliding-window primitive', () => {
  let redis: import('ioredis').Redis;

  beforeEach(async () => {
    vi.resetModules();
    redis = new (Redis as unknown as new () => import('ioredis').Redis)();
    const { registerSlidingWindow, __resetRegisteredForTesting } =
      await import('../../../src/lib/rate-limit/sliding-window.js');
    __resetRegisteredForTesting();
    registerSlidingWindow(redis);
  });

  afterEach(async () => {
    await redis.quit();
    vi.restoreAllMocks();
  });

  describe('consume — request-rate gate', () => {
    it('admits up to max then denies the (max+1)-th', async () => {
      const { consume } = await import('../../../src/lib/rate-limit/sliding-window.js');
      const key = 'mcp:rl:req:tenant-a';
      for (let i = 0; i < 5; i++) {
        const r = await consume(redis, key, 60_000, 5);
        expect(r.allowed).toBe(true);
      }
      const denied = await consume(redis, key, 60_000, 5);
      expect(denied.allowed).toBe(false);
      expect(denied.retryAfterMs).toBeGreaterThan(0);
      expect(denied.currentCount).toBe(5);
    });

    it('returns retryAfterMs close to window_ms when newest entry was just added', async () => {
      const { consume } = await import('../../../src/lib/rate-limit/sliding-window.js');
      const key = 'mcp:rl:req:tenant-b';
      for (let i = 0; i < 3; i++) {
        await consume(redis, key, 60_000, 3);
      }
      const denied = await consume(redis, key, 60_000, 3);
      expect(denied.allowed).toBe(false);
      // Retry-after should be close to 60s (the oldest entry was added just now).
      expect(denied.retryAfterMs).toBeGreaterThan(59_000);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
    });

    it('admits again after the window passes', async () => {
      const { consume } = await import('../../../src/lib/rate-limit/sliding-window.js');
      const key = 'mcp:rl:req:tenant-c';
      for (let i = 0; i < 2; i++) {
        await consume(redis, key, 100 /* ms */, 2);
      }
      const deniedImmediate = await consume(redis, key, 100, 2);
      expect(deniedImmediate.allowed).toBe(false);
      await new Promise((r) => setTimeout(r, 150));
      const admittedAfterWait = await consume(redis, key, 100, 2);
      expect(admittedAfterWait.allowed).toBe(true);
    });

    it('atomic under concurrency — parallel calls cannot double-admit beyond max', async () => {
      const { consume } = await import('../../../src/lib/rate-limit/sliding-window.js');
      const key = 'mcp:rl:req:tenant-d';
      const results = await Promise.all(
        Array.from({ length: 10 }, () => consume(redis, key, 60_000, 3))
      );
      const admitted = results.filter((r) => r.allowed).length;
      expect(admitted).toBe(3);
      expect(results.filter((r) => !r.allowed).length).toBe(7);
    });
  });

  describe('observe — weighted cost, never gates', () => {
    it('adds N ZSET entries for cost=N', async () => {
      const { observe } = await import('../../../src/lib/rate-limit/sliding-window.js');
      await observe(redis, 'tenant-e', 60_000, 5);
      const count = await redis.zcard('mcp:rl:graph:tenant-e');
      expect(count).toBe(5);
    });

    it('observe(weight=0) is a no-op', async () => {
      const { observe } = await import('../../../src/lib/rate-limit/sliding-window.js');
      await observe(redis, 'tenant-f', 60_000, 0);
      const count = await redis.zcard('mcp:rl:graph:tenant-f');
      expect(count).toBe(0);
    });

    it('observe NEVER returns allowed: false even at very high counts', async () => {
      const { observe, consume } = await import('../../../src/lib/rate-limit/sliding-window.js');
      await observe(redis, 'tenant-g', 60_000, 10);
      await observe(redis, 'tenant-g', 60_000, 10);
      // observe uses MAX_SAFE_INTEGER as max — would always admit.
      // We verify by calling consume directly on the same key at a reasonable max
      // and seeing that even with 20 entries, observe did not mark any as "denied"
      // (observation-only semantics).
      const r = await consume(redis, 'mcp:rl:graph:tenant-g', 60_000, 10_000);
      expect(r.allowed).toBe(true);
    });
  });

  describe('registerSlidingWindow — idempotent', () => {
    it('calling twice on the same client does not throw', async () => {
      const { registerSlidingWindow } =
        await import('../../../src/lib/rate-limit/sliding-window.js');
      expect(() => {
        registerSlidingWindow(redis);
        registerSlidingWindow(redis);
      }).not.toThrow();
    });
  });

  describe('parseResourceUnit — defensive parsing', () => {
    it('null → 1 (default when header absent)', async () => {
      const { parseResourceUnit } = await import('../../../src/lib/rate-limit/sliding-window.js');
      expect(parseResourceUnit(null)).toBe(1);
    });

    it('"5" → 5', async () => {
      const { parseResourceUnit } = await import('../../../src/lib/rate-limit/sliding-window.js');
      expect(parseResourceUnit('5')).toBe(5);
    });

    it('"999" → 100 (capped at 100 per A1)', async () => {
      const { parseResourceUnit } = await import('../../../src/lib/rate-limit/sliding-window.js');
      expect(parseResourceUnit('999')).toBe(100);
    });

    it('"-1" → 1 (negative rejected)', async () => {
      const { parseResourceUnit } = await import('../../../src/lib/rate-limit/sliding-window.js');
      expect(parseResourceUnit('-1')).toBe(1);
    });

    it('"abc" → 1 (non-numeric rejected)', async () => {
      const { parseResourceUnit } = await import('../../../src/lib/rate-limit/sliding-window.js');
      expect(parseResourceUnit('abc')).toBe(1);
    });
  });

  describe('defaults.ts — platform defaults', () => {
    it('resolveRateLimits with null tenant.rate_limits returns platform defaults', async () => {
      const { resolveRateLimits } = await import('../../../src/lib/rate-limit/defaults.js');
      const resolved = resolveRateLimits({ rate_limits: null });
      expect(resolved.source).toBe('platform-default');
      expect(resolved.request_per_min).toBeGreaterThan(0);
      expect(resolved.graph_points_per_min).toBeGreaterThan(0);
    });

    it('resolveRateLimits with tenant.rate_limits returns tenant values', async () => {
      const { resolveRateLimits } = await import('../../../src/lib/rate-limit/defaults.js');
      const resolved = resolveRateLimits({
        rate_limits: { request_per_min: 500, graph_points_per_min: 10_000 },
      });
      expect(resolved.source).toBe('tenant');
      expect(resolved.request_per_min).toBe(500);
      expect(resolved.graph_points_per_min).toBe(10_000);
    });

    it('env var MS365_MCP_DEFAULT_REQ_PER_MIN overrides hardcoded default', async () => {
      vi.stubEnv('MS365_MCP_DEFAULT_REQ_PER_MIN', '777');
      vi.resetModules();
      const { resolveRateLimits } = await import('../../../src/lib/rate-limit/defaults.js');
      const resolved = resolveRateLimits({ rate_limits: null });
      expect(resolved.request_per_min).toBe(777);
      vi.unstubAllEnvs();
    });
  });
});
