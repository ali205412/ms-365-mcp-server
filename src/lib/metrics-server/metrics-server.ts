/**
 * Prometheus /metrics server (plan 06-03, OPS-07).
 *
 * Hosts `PrometheusExporter.getMetricsRequestHandler` on a dedicated port
 * (default 9464, configurable via `MS365_MCP_METRICS_PORT`) so scrape
 * traffic is isolated from the main transport's auth + rate-limit scope.
 *
 * Per CONTEXT.md §D-02 + §D-08:
 *   - Optional Bearer auth via `MS365_MCP_METRICS_BEARER` (see bearer-auth.ts).
 *     null / undefined / empty = OPEN endpoint (localhost / reverse-proxy trust).
 *   - Dedicated port for network-ACL-friendly isolation.
 *   - `pino-http` with `autoLogging.ignore` on `/metrics` to prevent scrape
 *     spam (every 15s would otherwise flood the log — see T-06-03-c).
 *
 * Plan 06-01 constructs the exporter with `preventServerStart: true` so the
 * exporter does NOT bind its own listener. We own the listener here.
 *
 * Threat dispositions (from 06-03-PLAN.md <threat_model>):
 *   - T-06-01 (tenant fingerprinting via aggregate metrics): localhost-only
 *     default + Bearer when publicly exposed; documented in runbook.md
 *     (plan 06-07).
 *   - T-06-03-c (log flood from scrapes): mitigate — autoLogging.ignore
 *     on `/metrics`.
 *   - T-06-03-d (port flood DoS): accept — documented in runbook.md,
 *     reverse-proxy rate-limit recommended for public exposure.
 */
import express from 'express';
import type { Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { nanoid } from 'nanoid';
import { createServer, type Server } from 'node:http';
import type { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

import { createBearerAuthMiddleware } from './bearer-auth.js';
import { resolveTrustProxySetting } from '../trust-proxy.js';
import logger, { rawPinoLogger } from '../../logger.js';

export interface MetricsServerConfig {
  /**
   * Port to bind. Default 9464 — `MS365_MCP_METRICS_PORT`. Tests pass 0 for
   * a kernel-assigned port.
   */
  port: number;
  /** Bearer token gate. null / undefined / empty = open endpoint (D-02). */
  bearerToken: string | null | undefined;
  /** Optional host bind. Default undefined = 0.0.0.0 (all interfaces). */
  host?: string;
}

/**
 * Create and start the metrics server. Returns the `http.Server` handle so
 * the caller can register shutdown hooks.
 *
 * The listener is bound asynchronously (via `server.listen(...)`). Callers
 * that need to wait for the port to be bound should attach a one-shot
 * `'listening'` event listener before their subsequent `server.address()`
 * call (see `test/integration/metrics-endpoint.int.test.ts` for the
 * canonical pattern).
 */
export function createMetricsServer(
  exporter: PrometheusExporter,
  config: MetricsServerConfig
): Server {
  const app = express();
  app.set('trust proxy', resolveTrustProxySetting());

  // pino-http with autoLogging.ignore on /metrics — Prometheus scrapes every
  // 15s would otherwise flood the log (T-06-03-c "log flood"). Health probe
  // is also silenced so load-balancer pokes don't produce noise.
  app.use(
    pinoHttp({
      logger: rawPinoLogger,
      genReqId: () => nanoid(),
      autoLogging: {
        ignore: (req) => {
          const url = req.url ?? '';
          return (
            url === '/metrics' ||
            url.startsWith('/metrics?') ||
            url === '/healthz' ||
            url.startsWith('/healthz?')
          );
        },
      },
      customProps: (req) => ({ requestId: req.id, tenantId: null }),
    })
  );

  // Bearer auth (null / undefined / empty = open). Applied ONLY to /metrics;
  // /healthz stays unauthenticated so orchestrators can probe without a token.
  const auth = createBearerAuthMiddleware(config.bearerToken);

  app.get('/metrics', auth, (req: Request, res: Response) => {
    // exporter.getMetricsRequestHandler accepts (IncomingMessage, ServerResponse).
    // Express Request extends IncomingMessage at runtime; the `id` property
    // added by pino-http is optional and unused by the exporter — widen the
    // static type to match the nominal IncomingMessage contract.
    exporter.getMetricsRequestHandler(
      req as unknown as Parameters<typeof exporter.getMetricsRequestHandler>[0],
      res as unknown as Parameters<typeof exporter.getMetricsRequestHandler>[1]
    );
  });

  // Health probe for orchestrators (no auth — always 200). The metrics server
  // keeps itself separate from the main transport's /healthz + /readyz (which
  // live on a different port and include readiness-chain composition).
  app.get('/healthz', (_req, res) => {
    res.status(200).send('ok');
  });

  const server = createServer(app);
  if (config.host) {
    server.listen(config.port, config.host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : config.port;
      logger.info(
        {
          metricsPort: actualPort,
          metricsHost: config.host,
          bearerGated: isBearerGated(config.bearerToken),
        },
        'plan 06-03 — metrics server listening'
      );
    });
  } else {
    server.listen(config.port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : config.port;
      logger.info(
        { metricsPort: actualPort, bearerGated: isBearerGated(config.bearerToken) },
        'plan 06-03 — metrics server listening on all interfaces'
      );
    });
  }

  return server;
}

function isBearerGated(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.length > 0;
}
