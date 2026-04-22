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
// PeriodicExportingMetricReader is exported from @opentelemetry/sdk-metrics.
// The @opentelemetry/sdk-node meta-package aggregates metrics exports under
// its `metrics` namespace but does NOT re-export the reader as a top-level
// named export — a direct named import from 'sdk-node' fails at runtime
// under ESM strict import semantics (Node 22). Import it from the actual
// owning package so both ESM and CJS module resolvers agree.
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
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
// Phase 6 plan 06-01: named export so plan 06-03's metrics server can host
// the exporter's getMetricsRequestHandler behind a Bearer-auth middleware.
// `undefined` when MS365_MCP_PROMETHEUS_ENABLED is not '1'/'true' — consumers
// MUST null-check before reading.
let prometheusExporter: PrometheusExporter | undefined;

if (prometheusEnabled) {
  // Phase 6 plan 06-01: construct with preventServerStart so the exporter
  // does NOT bind its own listener on port 9464. Plan 06-03 wires the
  // handler into a dedicated Express app with optional Bearer gating.
  // MS365_MCP_METRICS_PORT lets operators override the default port
  // (9464) without code changes; Number() returns NaN for empty strings,
  // so fall back to 9464 when the env var is unset.
  prometheusExporter = new PrometheusExporter({
    port: Number(process.env.MS365_MCP_METRICS_PORT ?? 9464),
    preventServerStart: true,
  });
  metricReader = prometheusExporter;
} else if (otlpEndpoint) {
  // Export metrics to OTLP when endpoint is configured
  metricReader = new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` }),
  });
}

// ── Instrumentations ─────────────────────────────────────────────────────────
// Phase 6 plan 06-01 (Pitfall 7): extract the OTLP collector host once at
// startup so the outgoing-request filter on http instrumentation can skip
// OTel's own self-export POSTs without incurring a URL-parse per outbound
// request. An invalid OTEL_EXPORTER_OTLP_ENDPOINT falls through to `null`
// so the hook becomes a no-op — we never want to crash the SDK because the
// operator typoed a URL.
let otlpHost: string | null = null;
try {
  otlpHost = otlpEndpoint ? new URL(otlpEndpoint).host : null;
} catch {
  otlpHost = null;
}
const instrumentations = getNodeAutoInstrumentations({
  // Disable fs instrumentation — it is extremely noisy and adds no value here
  '@opentelemetry/instrumentation-fs': { enabled: false },
  // Phase 6 plan 06-01 (Pitfall 7): do NOT instrument OTel's own OTLP export
  // POSTs — self-referential spans pile up on slow collectors and can wedge
  // the exporter under backpressure. The hook runs on every outbound HTTP
  // request so the closed-over `otlpHost` string comparison must stay cheap.
  '@opentelemetry/instrumentation-http': {
    // Type matches @opentelemetry/instrumentation-http's IgnoreOutgoingRequestFunction:
    // `request` is `http.RequestOptions` whose `hostname`/`host` are
    // `string | null | undefined`. Treat null as "no hostname" (Symbol mutability
    // inside core http means we must not narrow further).
    ignoreOutgoingRequestHook: (req: { hostname?: string | null; host?: string | null }) => {
      if (!otlpHost) return false;
      const h = req.hostname ?? req.host ?? '';
      return typeof h === 'string' && h.includes(otlpHost);
    },
  },
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

// Phase 6 plan 06-01: named export so plan 06-03 can host
// `getMetricsRequestHandler` inside a Bearer-gated Express app (D-02).
// `undefined` when MS365_MCP_PROMETHEUS_ENABLED is not '1'/'true' — consumers
// must null-check before reading.
export { prometheusExporter };
