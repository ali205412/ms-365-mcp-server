/**
 * Tests for OTel SDK bootstrap singleton (OPS-05/06/07 scaffolding).
 *
 * Requirement: OPS-01/OPS-02 scaffolding — OTel boots silently when env
 * unset; exports sdk + shutdown(); mounts Prometheus when
 * MS365_MCP_PROMETHEUS_ENABLED=1.
 *
 * These tests MUST FAIL before the implementation is written (RED phase).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('otel-bootstrap: NodeSDK singleton (D-03)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('importing src/lib/otel.js does NOT throw when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '');

    await expect(import('../src/lib/otel.js')).resolves.toBeDefined();
  });

  it('exported otel controller has sdk and shutdown properties', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '');

    const mod = await import('../src/lib/otel.js');
    const otel = mod.otel ?? mod.default;

    expect(otel).toBeDefined();
    expect(otel.sdk).toBeDefined();
    expect(typeof otel.shutdown).toBe('function');
  });

  it('shutdown() returns a Promise', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '');

    const mod = await import('../src/lib/otel.js');
    const otel = mod.otel ?? mod.default;

    const result = otel.shutdown();
    expect(result).toBeInstanceOf(Promise);
    // Resolve the promise to avoid unhandled rejection
    await result.catch(() => {
      // Ignore shutdown errors in test
    });
  });

  it('when MS365_MCP_PROMETHEUS_ENABLED=1, Prometheus metric reader is configured', async () => {
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
    vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '1');

    // We spy on PrometheusExporter constructor to verify it was instantiated
    const promModule = await import('@opentelemetry/exporter-prometheus');
    const PrometheusExporterSpy = vi.spyOn(promModule, 'PrometheusExporter');

    const mod = await import('../src/lib/otel.js');
    const otel = mod.otel ?? mod.default;

    expect(otel).toBeDefined();
    // Either the constructor was called, or we can inspect the sdk internals
    // Accept either: PrometheusExporter was instantiated OR sdk has _metricReader
    const sdkAny = otel.sdk as unknown as Record<string, unknown>;
    const hasMetricReader =
      PrometheusExporterSpy.mock.calls.length > 0 ||
      sdkAny._metricReader !== undefined ||
      sdkAny._metrics !== undefined;

    expect(hasMetricReader).toBe(true);

    await otel.shutdown().catch(() => {
      // Ignore errors
    });
  });
});
