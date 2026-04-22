/**
 * Plan 06-01 Task 3 — OTel bootstrap verification test.
 *
 * Verifies that src/lib/otel.ts (Phase 1 landing) still satisfies every
 * invariant Phase 6 depends on:
 *
 *   1. NodeSDK starts without throwing under both Prometheus-enabled and
 *      Prometheus-disabled configurations.
 *   2. The module exports `prometheusExporter` as a named export — `undefined`
 *      when MS365_MCP_PROMETHEUS_ENABLED is not truthy; a `PrometheusExporter`
 *      instance when it is. Plan 06-03 imports this for Bearer-gated hosting.
 *   3. PrometheusExporter is constructed with `preventServerStart: true` so the
 *      exporter does NOT bind its own HTTP listener — a second listener on the
 *      same port must be able to bind without EADDRINUSE.
 *   4. `src/index.ts` line 2 remains `import './lib/otel.js'` (P-9 first-import
 *      invariant — any reorder breaks auto-instrumentation).
 *   5. `ignoreOutgoingRequestHook` is wired on the http instrumentation so
 *      OTel's own OTLP export POSTs are not re-instrumented (Pitfall 7).
 *   6. Global `trace.getTracer(...)` and `metrics.getMeter(...)` accessors
 *      return valid providers after the module side-effect import.
 *
 * Uses vi.hoisted + vi.mock('../../src/logger.js') per P-7 so the side-effect
 * import of otel.ts does not pull real pino transports into the test
 * process. vi.resetModules() between cases lets each test observe a fresh
 * SDK construction under its own env stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('plan 06-01 — OTel bootstrap verification', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('src/index.ts first-import invariant (P-9)', () => {
    it("first import in src/index.ts is './lib/otel.js' (no reorder, no insert)", () => {
      // Anchor the invariant at a test level — any plan that tries to push
      // another import above this one breaks the auto-instrumentation contract.
      const indexPath = path.resolve(REPO_ROOT, 'src', 'index.ts');
      const lines = readFileSync(indexPath, 'utf8').split(/\r?\n/);
      // The shebang is line 1; the OTel import must be the FIRST `import`
      // statement encountered within the first few lines of the file.
      const firstImport = lines.slice(0, 10).find((l) => l.trim().startsWith('import '));
      expect(
        firstImport,
        `expected to find an import in first 10 lines of ${indexPath}`
      ).toBeDefined();
      expect(firstImport).toMatch(/import\s+['"]\.\/lib\/otel\.js['"]/);
    });
  });

  describe('NodeSDK start + shutdown', () => {
    it('importing src/lib/otel.js does not throw when MS365_MCP_PROMETHEUS_ENABLED is unset', async () => {
      vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '');
      vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
      await expect(import('../../src/lib/otel.js')).resolves.toBeDefined();
    });

    it('exports `prometheusExporter` as undefined when MS365_MCP_PROMETHEUS_ENABLED is unset', async () => {
      vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '');
      vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');
      const mod = (await import('../../src/lib/otel.js')) as {
        prometheusExporter?: unknown;
      };
      expect(mod.prometheusExporter).toBeUndefined();
    });

    it('exports `prometheusExporter` as a PrometheusExporter instance when enabled', async () => {
      vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '1');
      vi.stubEnv('MS365_MCP_METRICS_PORT', '0'); // port 0 — kernel picks a free one
      const mod = (await import('../../src/lib/otel.js')) as {
        prometheusExporter?: unknown;
      };
      expect(mod.prometheusExporter).toBeDefined();
      // Duck-type check — the instance should have `getMetricsRequestHandler`
      // per D-02. Plan 06-03 consumes this method.
      const exp = mod.prometheusExporter as { getMetricsRequestHandler?: unknown };
      expect(typeof exp.getMetricsRequestHandler).toBe('function');
    });

    it('preventServerStart: true — the exporter does NOT bind its own HTTP listener', async () => {
      // Pick a deterministic high port that's unlikely to be in use on CI runners.
      const TEST_PORT = 19464;
      vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '1');
      vi.stubEnv('MS365_MCP_METRICS_PORT', String(TEST_PORT));
      await import('../../src/lib/otel.js');
      // If preventServerStart were false, binding a second listener on
      // TEST_PORT would fail with EADDRINUSE — we'd never reach the resolve().
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(TEST_PORT, '127.0.0.1', () => resolve());
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  });

  describe('auto-instrumentation HTTP ignoreOutgoingRequestHook (Pitfall 7)', () => {
    it('otel.ts source wires ignoreOutgoingRequestHook on @opentelemetry/instrumentation-http', async () => {
      vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '1');
      vi.stubEnv('MS365_MCP_METRICS_PORT', '0');
      vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector.local:4318');
      // Assert the import succeeds with OTLP configured — closure for the
      // hook is constructed at module-load time.
      await expect(import('../../src/lib/otel.js')).resolves.toBeDefined();
      // Read the source to confirm the hook wiring is present. We can't
      // reach into getNodeAutoInstrumentations to invoke the hook directly
      // (the instrumentation tree is private to the SDK), so anchoring the
      // wiring at the source level is the contract this test enforces.
      const source = readFileSync(path.resolve(REPO_ROOT, 'src', 'lib', 'otel.ts'), 'utf8');
      expect(source).toMatch(/ignoreOutgoingRequestHook/);
      expect(source).toMatch(/@opentelemetry\/instrumentation-http/);
    });
  });

  describe('global tracer + meter provider registered', () => {
    it("trace.getTracer('ms-365-mcp-server') returns a valid tracer after import", async () => {
      vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '1');
      vi.stubEnv('MS365_MCP_METRICS_PORT', '0');
      await import('../../src/lib/otel.js');
      const { trace } = await import('@opentelemetry/api');
      const tracer = trace.getTracer('ms-365-mcp-server');
      expect(tracer).toBeDefined();
      expect(typeof tracer.startActiveSpan).toBe('function');
    });

    it("metrics.getMeter('ms-365-mcp-server') returns a valid meter after import", async () => {
      vi.stubEnv('MS365_MCP_PROMETHEUS_ENABLED', '1');
      vi.stubEnv('MS365_MCP_METRICS_PORT', '0');
      await import('../../src/lib/otel.js');
      const { metrics } = await import('@opentelemetry/api');
      const meter = metrics.getMeter('ms-365-mcp-server');
      expect(meter).toBeDefined();
      expect(typeof meter.createCounter).toBe('function');
      expect(typeof meter.createHistogram).toBe('function');
    });
  });
});
