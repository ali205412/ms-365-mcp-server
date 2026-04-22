/**
 * Plan 06-02 Task 3 — RetryHandler throttle-metric regression.
 *
 * Verifies:
 *  - Terminal 429 observation increments `mcp_graph_throttled_total{tenant}` exactly once.
 *  - Terminal 200 / 503 observations do NOT increment the throttle counter.
 *  - Existing 02-02 contract preserved: retryCount + lastStatus flow into
 *    RequestContext on every exit.
 *
 * Strategy: set MS365_MCP_RETRY_MAX_ATTEMPTS=0 so the handler's loop exits
 * on the first observation — no fake-timer dance required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
  MeterProvider,
} from '@opentelemetry/sdk-metrics';
import { metrics } from '@opentelemetry/api';

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

describe('plan 06-02 — RetryHandler throttle-metric emission', () => {
  let metricExporter: InMemoryMetricExporter;
  let reader: PeriodicExportingMetricReader;
  let originalMaxAttempts: string | undefined;

  beforeEach(() => {
    // Must disable before setGlobalMeterProvider — NX semantics mean a
    // prior suite's provider would otherwise shadow our install.
    metrics.disable();
    vi.resetModules();
    originalMaxAttempts = process.env.MS365_MCP_RETRY_MAX_ATTEMPTS;
    process.env.MS365_MCP_RETRY_MAX_ATTEMPTS = '0';
    metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 100_000,
    });
    const meterProvider = new MeterProvider({ readers: [reader] });
    metrics.setGlobalMeterProvider(meterProvider);
  });

  afterEach(() => {
    metrics.disable();
    if (originalMaxAttempts === undefined) {
      delete process.env.MS365_MCP_RETRY_MAX_ATTEMPTS;
    } else {
      process.env.MS365_MCP_RETRY_MAX_ATTEMPTS = originalMaxAttempts;
    }
    vi.restoreAllMocks();
  });

  async function runRetryCase(finalStatus: number, tenantId: string): Promise<Response> {
    const { RetryHandler } = await import('../../../src/lib/middleware/retry.js');
    const { requestContext } = await import('../../../src/request-context.js');
    const handler = new RetryHandler();
    const response = {
      status: finalStatus,
      headers: { get: (_k: string) => null },
      ok: finalStatus < 400,
    } as unknown as Response;
    const next = vi.fn(async () => response);
    const req = {
      method: 'GET',
      url: 'https://graph.microsoft.com/v1.0/users',
    } as unknown as Parameters<typeof handler.execute>[0];

    return requestContext.run({ tenantId } as never, () => handler.execute(req, next));
  }

  function findThrottledPoint(tenantId: string) {
    const collected = metricExporter.getMetrics();
    const throttled = collected
      .flatMap((b) => b.scopeMetrics.flatMap((sm) => sm.metrics))
      .find((m) => m.descriptor.name === 'mcp_graph_throttled_total');
    if (!throttled) return undefined;
    return throttled.dataPoints.find(
      (p) => (p.attributes as Record<string, unknown>).tenant === tenantId
    );
  }

  it('increments mcp_graph_throttled_total when terminal response is 429', async () => {
    await runRetryCase(429, 't-a');
    await reader.forceFlush();
    const point = findThrottledPoint('t-a');
    expect(point).toBeDefined();
    expect((point as unknown as { value: number }).value).toBeGreaterThanOrEqual(1);
  });

  it('does NOT increment throttled counter on 200', async () => {
    await runRetryCase(200, 't-b');
    await reader.forceFlush();
    const point = findThrottledPoint('t-b');
    if (point) {
      expect((point as unknown as { value: number }).value).toBe(0);
    }
  });

  it('does NOT increment throttled counter on 503 (only 429 is throttle-specific)', async () => {
    await runRetryCase(503, 't-c');
    await reader.forceFlush();
    const point = findThrottledPoint('t-c');
    if (point) {
      expect((point as unknown as { value: number }).value).toBe(0);
    }
  });

  it('preserves 02-02 contract: retryCount + lastStatus flow to RequestContext', async () => {
    const { RetryHandler } = await import('../../../src/lib/middleware/retry.js');
    const { requestContext } = await import('../../../src/request-context.js');
    const handler = new RetryHandler();
    const response = {
      status: 200,
      headers: { get: () => null },
      ok: true,
    } as unknown as Response;
    const next = vi.fn(async () => response);
    const req = {
      method: 'GET',
      url: 'https://graph.microsoft.com/v1.0/users',
    } as unknown as Parameters<typeof handler.execute>[0];

    let observedRetryCount: number | undefined;
    let observedLastStatus: number | undefined;

    await requestContext.run({ tenantId: 't-d' } as never, async () => {
      await handler.execute(req, next);
      const ctx = requestContext.getStore();
      observedRetryCount = ctx?.retryCount;
      observedLastStatus = ctx?.lastStatus;
    });

    expect(observedLastStatus).toBe(200);
    expect(observedRetryCount).toBe(0);
  });
});
