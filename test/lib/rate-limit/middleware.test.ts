import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

describe('plan 06-04 — rate-limit middleware', () => {
  let redis: import('ioredis').Redis;
  let server: http.Server | undefined;
  let baseUrl: string;

  async function spinUp(tenant: {
    id: string;
    rate_limits: { request_per_min: number; graph_points_per_min: number } | null;
  }): Promise<void> {
    const { createRateLimitMiddleware } = await import(
      '../../../src/lib/rate-limit/middleware.js'
    );
    const { registerSlidingWindow, __resetRegisteredForTesting } = await import(
      '../../../src/lib/rate-limit/sliding-window.js'
    );
    __resetRegisteredForTesting();
    registerSlidingWindow(redis);

    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { tenant?: unknown }).tenant = tenant;
      (req as unknown as { tenantId?: string }).tenantId = tenant.id;
      next();
    });
    app.use(createRateLimitMiddleware({ redis }));
    app.get('/t/:tenantId/mcp', (_req, res) => {
      res.status(200).send('ok');
    });

    server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(app).listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeEach(() => {
    vi.resetModules();
    redis = new (Redis as unknown as new () => import('ioredis').Redis)();
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
    try {
      await redis.quit();
    } catch {
      // already quit in some tests
    }
    vi.restoreAllMocks();
  });

  it('5 requests under max=5 return 200', async () => {
    await spinUp({
      id: 't-a',
      rate_limits: { request_per_min: 5, graph_points_per_min: 10000 },
    });
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/t/t-a/mcp`);
      expect(res.status).toBe(200);
    }
  });

  it('6th request when request_per_min=5 returns 429 + Retry-After', async () => {
    await spinUp({
      id: 't-b',
      rate_limits: { request_per_min: 5, graph_points_per_min: 10000 },
    });
    for (let i = 0; i < 5; i++) {
      await fetch(`${baseUrl}/t/t-b/mcp`);
    }
    const res = await fetch(`${baseUrl}/t/t-b/mcp`);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('rate_limited');
    expect(body.reason).toBe('request_rate');
  });

  it('per-tenant isolation: tenant A exhausted + tenant B fresh → B = 200', async () => {
    // spin up tenant A and exhaust
    await spinUp({
      id: 't-a-iso',
      rate_limits: { request_per_min: 2, graph_points_per_min: 10000 },
    });
    for (let i = 0; i < 2; i++) {
      await fetch(`${baseUrl}/t/t-a-iso/mcp`);
    }
    const aExhausted = await fetch(`${baseUrl}/t/t-a-iso/mcp`);
    expect(aExhausted.status).toBe(429);
    // Now close server and re-spin with tenant B (shares same Redis instance)
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    await spinUp({
      id: 't-b-iso',
      rate_limits: { request_per_min: 2, graph_points_per_min: 10000 },
    });
    const bFresh = await fetch(`${baseUrl}/t/t-b-iso/mcp`);
    expect(bFresh.status).toBe(200);
  });

  it('missing req.tenant.id returns 400', async () => {
    const { createRateLimitMiddleware } = await import(
      '../../../src/lib/rate-limit/middleware.js'
    );
    const app = express();
    app.use((_req, _res, next) => {
      // Deliberately NO tenant setup — simulates upstream bug
      next();
    });
    app.use(createRateLimitMiddleware({ redis }));
    app.get('/anything', (_req, res) => {
      res.status(200).send('ok');
    });
    const srv = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(app).listen(0, () => resolve(s));
    });
    const u = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const res = await fetch(`${u}/anything`);
    expect(res.status).toBe(400);
    await new Promise<void>((r) => srv.close(() => r()));
  });

  it('Redis unavailable (status=end) returns 503 + Retry-After: 5', async () => {
    await spinUp({
      id: 't-c',
      rate_limits: { request_per_min: 5, graph_points_per_min: 10000 },
    });
    await redis.quit();
    // Now redis.status === 'end'
    const res = await fetch(`${baseUrl}/t/t-c/mcp`);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
  });

  it('graph_points_per_min=3 → 4th request returns 429 reason: graph_points', async () => {
    await spinUp({
      id: 't-d',
      // Set request_per_min HIGH so it won't trigger, focus on graph_points
      rate_limits: { request_per_min: 10000, graph_points_per_min: 3 },
    });
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${baseUrl}/t/t-d/mcp`);
      expect(r.status).toBe(200);
    }
    const denied = await fetch(`${baseUrl}/t/t-d/mcp`);
    expect(denied.status).toBe(429);
    const body = (await denied.json()) as { reason: string };
    expect(body.reason).toBe('graph_points');
  });
});
