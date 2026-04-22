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

vi.mock('../../src/logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

/**
 * Install an in-memory meter provider BEFORE importing otel-metrics.ts so the
 * instruments created at module load register against our test reader.
 */
function installTestMeterProvider(): {
  provider: MeterProvider;
  exporter: InMemoryMetricExporter;
  reader: PeriodicExportingMetricReader;
} {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 100_000, // effectively disabled; tests force via reader.collect()
  });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  return { provider, exporter, reader };
}

describe('plan 06-02 — otel-metrics instrument registry', () => {
  let testEnv: ReturnType<typeof installTestMeterProvider>;

  beforeEach(async () => {
    vi.resetModules();
    testEnv = installTestMeterProvider();
  });

  afterEach(async () => {
    metrics.disable();
    vi.restoreAllMocks();
  });

  describe('labelForTool (D-06 workload prefix)', () => {
    it('splits on dash — "list-mail-messages" → "list"', async () => {
      const { labelForTool } = await import('../../src/lib/otel-metrics.js');
      expect(labelForTool('list-mail-messages')).toBe('list');
    });

    it('splits on dot — "users.list" → "users"', async () => {
      const { labelForTool } = await import('../../src/lib/otel-metrics.js');
      expect(labelForTool('users.list')).toBe('users');
    });

    it('Power Platform prefix — "__powerbi__GroupsGetGroups" → "powerbi"', async () => {
      const { labelForTool } = await import('../../src/lib/otel-metrics.js');
      expect(labelForTool('__powerbi__GroupsGetGroups')).toBe('powerbi');
    });

    it('beta prefix stripped first — "__beta__users.list" → "users"', async () => {
      const { labelForTool } = await import('../../src/lib/otel-metrics.js');
      expect(labelForTool('__beta__users.list')).toBe('users');
    });
  });

  describe('instrument registry shape', () => {
    it('exports a Counter `mcpToolCallsTotal` with .add()', async () => {
      const { mcpToolCallsTotal } = await import('../../src/lib/otel-metrics.js');
      expect(typeof mcpToolCallsTotal.add).toBe('function');
    });

    it('exports a Histogram `mcpToolDurationSeconds` with .record()', async () => {
      const { mcpToolDurationSeconds } = await import('../../src/lib/otel-metrics.js');
      expect(typeof mcpToolDurationSeconds.record).toBe('function');
    });

    it('exports Counters mcpGraphThrottledTotal + mcpRateLimitBlockedTotal', async () => {
      const { mcpGraphThrottledTotal, mcpRateLimitBlockedTotal } = await import(
        '../../src/lib/otel-metrics.js'
      );
      expect(typeof mcpGraphThrottledTotal.add).toBe('function');
      expect(typeof mcpRateLimitBlockedTotal.add).toBe('function');
    });

    it('exports ObservableGauge `mcpOauthPkceStoreSize` with .addCallback', async () => {
      const { mcpOauthPkceStoreSize } = await import('../../src/lib/otel-metrics.js');
      expect(typeof mcpOauthPkceStoreSize.addCallback).toBe('function');
    });

    it('exports UpDownCounter `mcpActiveStreams` with .add', async () => {
      const { mcpActiveStreams } = await import('../../src/lib/otel-metrics.js');
      expect(typeof mcpActiveStreams.add).toBe('function');
    });
  });

  describe('data-point capture via InMemoryMetricExporter', () => {
    it('mcpToolCallsTotal.add(1, {tenant,tool,status}) is captured with exact labels', async () => {
      const { mcpToolCallsTotal } = await import('../../src/lib/otel-metrics.js');
      mcpToolCallsTotal.add(1, { tenant: 't1', tool: 'mail', status: '200' });
      await testEnv.reader.collect();
      const collected = testEnv.exporter.getMetrics();
      const series = collected
        .flatMap((batch) => batch.scopeMetrics.flatMap((sm) => sm.metrics))
        .find((m) => m.descriptor.name === 'mcp_tool_calls_total');
      expect(series).toBeDefined();
      const point = series!.dataPoints.find(
        (p) =>
          (p.attributes as Record<string, unknown>).tenant === 't1' &&
          (p.attributes as Record<string, unknown>).tool === 'mail' &&
          (p.attributes as Record<string, unknown>).status === '200'
      );
      expect(point).toBeDefined();
    });

    it('mcpToolDurationSeconds.record(0.42, {tenant,tool}) stores histogram data', async () => {
      const { mcpToolDurationSeconds } = await import('../../src/lib/otel-metrics.js');
      mcpToolDurationSeconds.record(0.42, { tenant: 't1', tool: 'mail' });
      await testEnv.reader.collect();
      const collected = testEnv.exporter.getMetrics();
      const hist = collected
        .flatMap((batch) => batch.scopeMetrics.flatMap((sm) => sm.metrics))
        .find((m) => m.descriptor.name === 'mcp_tool_duration_seconds');
      expect(hist).toBeDefined();
      expect(hist!.dataPoints.length).toBeGreaterThanOrEqual(1);
    });

    it('mcpGraphThrottledTotal increments only with tenant label (no tool, no status)', async () => {
      const { mcpGraphThrottledTotal } = await import('../../src/lib/otel-metrics.js');
      mcpGraphThrottledTotal.add(1, { tenant: 't-a' });
      await testEnv.reader.collect();
      const collected = testEnv.exporter.getMetrics();
      const throttled = collected
        .flatMap((batch) => batch.scopeMetrics.flatMap((sm) => sm.metrics))
        .find((m) => m.descriptor.name === 'mcp_graph_throttled_total');
      expect(throttled).toBeDefined();
      const point = throttled!.dataPoints[0];
      expect((point!.attributes as Record<string, unknown>).tenant).toBe('t-a');
      // No tool/status labels on the throttled counter (explicitly per metric spec).
      expect((point!.attributes as Record<string, unknown>).tool).toBeUndefined();
      expect((point!.attributes as Record<string, unknown>).status).toBeUndefined();
    });
  });

  describe('cardinality guard — full tool alias must NOT land on labels', () => {
    it('D-06: callers should pass labelForTool(alias), NOT alias, as the tool label', async () => {
      const { mcpToolCallsTotal, labelForTool } = await import('../../src/lib/otel-metrics.js');
      // Simulate a 100-tool workload; every emission uses workload prefix.
      for (let i = 0; i < 100; i++) {
        mcpToolCallsTotal.add(1, {
          tenant: 't1',
          tool: labelForTool(`users.operation-${i}`),
          status: '200',
        });
      }
      await testEnv.reader.collect();
      const collected = testEnv.exporter.getMetrics();
      const series = collected
        .flatMap((batch) => batch.scopeMetrics.flatMap((sm) => sm.metrics))
        .find((m) => m.descriptor.name === 'mcp_tool_calls_total');
      expect(series).toBeDefined();
      // All 100 increments should collapse into a SINGLE data point with tool="users".
      const usersPoints = series!.dataPoints.filter(
        (p) => (p.attributes as Record<string, unknown>).tool === 'users'
      );
      expect(usersPoints).toHaveLength(1);
    });
  });
});
