/**
 * Plan 03-02 Task 2 — src/lib/redis.ts unit tests.
 *
 * Covers the singleton lifecycle + stdio-detection + shutdown + readinessCheck
 * behaviors (7 cases). Uses ioredis-mock for the HTTP-mode real-client path so
 * tests don't need a running Redis, and MemoryRedisFacade directly for the
 * stdio-mode path.
 *
 * Reset strategy: __setRedisForTesting(null) clears the module-level cache
 * between tests; env-var mutations are backed up / restored per case.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock ioredis with ioredis-mock (both provide the same API surface). The
// factory returns both `default` and the named `Redis` export because
// src/lib/redis.ts uses `import { Redis as IORedis } from 'ioredis'` —
// default-only was insufficient under the stricter named-export resolution
// exercised on Node 22 CI.
vi.mock('ioredis', async () => {
  const mod = await import('ioredis-mock');
  return { default: mod.default, Redis: mod.default };
});

import { getRedis, shutdown, readinessCheck, __setRedisForTesting } from '../../src/lib/redis.js';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';

describe('plan 03-02 — src/lib/redis', () => {
  let envBackup: Record<string, string | undefined>;

  beforeEach(() => {
    envBackup = {
      MS365_MCP_REDIS_URL: process.env.MS365_MCP_REDIS_URL,
      MS365_MCP_TRANSPORT: process.env.MS365_MCP_TRANSPORT,
      MS365_MCP_FORCE_REDIS: process.env.MS365_MCP_FORCE_REDIS,
    };
    __setRedisForTesting(null);
  });

  afterEach(async () => {
    // Restore env
    for (const key of Object.keys(envBackup)) {
      const prev = envBackup[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    await shutdown();
    __setRedisForTesting(null);
  });

  // ── 1. HTTP mode with URL set returns ioredis (mocked) ─────────────────────
  it('HTTP mode with MS365_MCP_REDIS_URL returns a real ioredis client (mocked)', () => {
    process.env.MS365_MCP_REDIS_URL = 'redis://localhost:6379';
    delete process.env.MS365_MCP_TRANSPORT;
    const client = getRedis();
    // ioredis-mock implements ping/set/get — assert shape
    expect(typeof client.ping).toBe('function');
    expect(typeof (client as { quit?: unknown }).quit).toBe('function');
    // Should NOT be our in-memory facade
    expect(client).not.toBeInstanceOf(MemoryRedisFacade);
  });

  // ── 2. Stdio mode (no URL, no force) returns MemoryRedisFacade ────────────
  it('stdio mode (no MS365_MCP_REDIS_URL) returns MemoryRedisFacade', () => {
    delete process.env.MS365_MCP_REDIS_URL;
    delete process.env.MS365_MCP_FORCE_REDIS;
    const client = getRedis();
    expect(client).toBeInstanceOf(MemoryRedisFacade);
  });

  // ── 3. Forced HTTP mode without URL throws a clear error ───────────────────
  it('throws when MS365_MCP_REDIS_URL missing but transport is forced http', () => {
    delete process.env.MS365_MCP_REDIS_URL;
    process.env.MS365_MCP_TRANSPORT = 'http';
    process.env.MS365_MCP_FORCE_REDIS = '1';
    expect(() => getRedis()).toThrow(/MS365_MCP_REDIS_URL is required/);
  });

  // ── 4. readinessCheck returns true on ping OK, false on error ─────────────
  it('readinessCheck returns true when ping resolves PONG', async () => {
    // Stdio facade path — ping always returns PONG when not ended.
    delete process.env.MS365_MCP_REDIS_URL;
    delete process.env.MS365_MCP_FORCE_REDIS;
    expect(await readinessCheck()).toBe(true);
  });

  it('readinessCheck returns false when client is disconnected', async () => {
    const fake = new MemoryRedisFacade();
    fake.disconnect(); // status === 'end'
    __setRedisForTesting(fake);
    expect(await readinessCheck()).toBe(false);
  });

  // ── 5. shutdown is idempotent and clears the cache ────────────────────────
  it('shutdown() is idempotent; second call is a no-op', async () => {
    const fake = new MemoryRedisFacade();
    __setRedisForTesting(fake);
    await shutdown();
    // Second call should not throw
    await expect(shutdown()).resolves.toBeUndefined();
    expect(fake.status).toBe('end');
  });

  // ── 6. getRedis() is idempotent (singleton) ───────────────────────────────
  it('getRedis() returns the same instance on repeated calls', () => {
    delete process.env.MS365_MCP_REDIS_URL;
    delete process.env.MS365_MCP_FORCE_REDIS;
    const a = getRedis();
    const b = getRedis();
    expect(a).toBe(b);
  });

  // ── 7. __setRedisForTesting injects a fake ─────────────────────────────────
  it('__setRedisForTesting allows injecting a MemoryRedisFacade', () => {
    const injected = new MemoryRedisFacade();
    __setRedisForTesting(injected);
    expect(getRedis()).toBe(injected);
  });
});
