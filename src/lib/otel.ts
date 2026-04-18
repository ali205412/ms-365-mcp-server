/**
 * OpenTelemetry SDK bootstrap singleton.
 *
 * This module is imported as the FIRST import in src/index.ts (before dotenv/config
 * and before any other module loads) so that OTel instrumentation hooks are
 * registered before pino, Express, or any other instrumented library initialises.
 *
 * Note on import order: OTel reads OTEL_EXPORTER_OTLP_ENDPOINT directly from
 * process.env at SDK start time. That env var MUST come from the real environment
 * in production (systemd / Docker / CI), NOT from .env — which is exactly why this
 * module must be imported BEFORE dotenv/config.
 *
 * When OTEL_EXPORTER_OTLP_ENDPOINT is unset AND MS365_MCP_PROMETHEUS_ENABLED is
 * not '1'/'true', the SDK is started with no exporter — it is a silent no-op with
 * zero network traffic.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// otel.ts lives in src/lib/, so package.json is two levels up
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  name: string;
  version: string;
};

const SERVICE_NAME = 'ms-365-mcp-server';
const SERVICE_VERSION: string = packageJson.version;
const DEPLOYMENT_ENV = process.env.NODE_ENV || 'development';

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  'deployment.environment': DEPLOYMENT_ENV,
});

// ── Trace exporter ──────────────────────────────────────────────────────────
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
const traceExporter = otlpEndpoint
  ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
  : undefined;

// ── Metric reader ────────────────────────────────────────────────────────────
const prometheusEnabled =
  process.env.MS365_MCP_PROMETHEUS_ENABLED === '1' ||
  process.env.MS365_MCP_PROMETHEUS_ENABLED === 'true';

let metricReader: PeriodicExportingMetricReader | PrometheusExporter | undefined;

if (prometheusEnabled) {
  // Prometheus exporter listens on port 9464 at /metrics
  metricReader = new PrometheusExporter({ port: 9464 });
} else if (otlpEndpoint) {
  // Export metrics to OTLP when endpoint is configured
  metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` }),
  });
}

// ── Instrumentations ─────────────────────────────────────────────────────────
const instrumentations = getNodeAutoInstrumentations({
  // Disable fs instrumentation — it is extremely noisy and adds no value here
  '@opentelemetry/instrumentation-fs': { enabled: false },
});

// ── SDK construction + start ──────────────────────────────────────────────────
const sdk = new NodeSDK({
  resource,
  traceExporter,
  metricReader,
  instrumentations,
});

sdk.start();

// ── Shutdown with 10-second timeout ──────────────────────────────────────────
// OTel shutdown can hang if the OTLP collector is unreachable. Wrap in a
// Promise.race with a 10 s timeout so graceful-shutdown in plan 01-05 never
// blocks the process exit sequence.
const shutdown = async (): Promise<void> => {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('OTel shutdown timed out after 10s')), 10_000)
  );
  try {
    await Promise.race([sdk.shutdown(), timeoutPromise]);
  } catch {
    // Swallow shutdown errors — we must not block process exit
  }
};

export const otel = { sdk, shutdown };
export default otel;
