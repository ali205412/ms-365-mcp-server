/**
 * In-memory OTel reader helpers for unit + integration tests (plan 06-05).
 *
 * Pattern per 06-RESEARCH.md §Validation Architecture §3 (lines 990-1001).
 * Tests install a MeterProvider / TracerProvider with in-memory exporters
 * so assertions can inspect emitted metrics/spans without running a real
 * OTel collector.
 *
 * Usage:
 *   const { provider, exporter, reader } = setupTestMeterProvider();
 *   metrics.setGlobalMeterProvider(provider);
 *   // ... emit metrics ...
 *   await reader.collect();
 *   const snapshots = exporter.getMetrics();
 */
import {
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
  MeterProvider,
} from '@opentelemetry/sdk-metrics';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  BasicTracerProvider,
} from '@opentelemetry/sdk-trace-base';

export function setupTestMeterProvider(): {
  provider: MeterProvider;
  exporter: InMemoryMetricExporter;
  reader: PeriodicExportingMetricReader;
} {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter,
    // Disabled auto-export; tests force a pull via reader.collect().
    exportIntervalMillis: 100_000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  return { provider, exporter, reader };
}

export function setupTestTracerProvider(): {
  provider: BasicTracerProvider;
  exporter: InMemorySpanExporter;
} {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  return { provider, exporter };
}
