/**
 * Graceful shutdown orchestration (OPS-09 / plan 01-05).
 *
 * On SIGTERM or SIGINT:
 *   1. Flip setDraining(true) — /readyz starts returning 503 so load balancers
 *      stop routing new traffic (plan 01-04 owns the setDraining state).
 *   2. server.close() — stop accepting new connections; await in-flight
 *      completion. Null server in stdio mode skips this step.
 *   3. logger.flush?() — sync flush of the pino buffer (pino v10 flush is
 *      synchronous for the stdout destination). Wrapped in try/catch so a
 *      flush error does not abort the exit sequence.
 *   4. otel.shutdown() — flush spans + metrics. Wrapped in Promise.race with
 *      OTEL_SHUTDOWN_TIMEOUT_MS (10s) because a dead OTLP collector can hang
 *      sdk.shutdown() indefinitely. The otel module (plan 01-02) also applies
 *      its own 10s race; this layer is defense-in-depth.
 *   5. process.exit(0).
 *
 * Budget: MS365_MCP_SHUTDOWN_GRACE_MS (default 25000ms). A failsafe
 * setTimeout.unref() deadline forces process.exit(1) if the drain sequence
 * exceeds the budget — this matters because Docker's default `docker stop`
 * grace is 10s before SIGKILL; operators tuning `--time=30s` still rely on
 * us bounding at 25s.
 *
 * Idempotent: a second SIGTERM during an in-flight drain is a no-op via the
 * isDraining() guard at handler entry. Guards against operators hitting
 * Ctrl-C twice in a panic. Also defends against registration from stdio, the
 * main HTTP listener, and the metrics listener: each call adds its server
 * handle to a shared registry, and one signal handler closes them all.
 *
 * Threat dispositions (from plan 01-05 <threat_model>):
 *   - T-01-05a: Handler runs because Dockerfile STOPSIGNAL SIGTERM (plan 01-03)
 *     forwards `docker stop` to SIGTERM; tini PID 1 then forwards to node.
 *   - T-01-05b: OTel exporter hang — mitigated by Promise.race with 10s timeout.
 *   - T-01-05c: Incomplete log flush — mitigated by try/catch-wrapped
 *     logger.flush?() on pino v10 synchronous stdout destination.
 *   - T-01-05d: Double signal — mitigated by isDraining() idempotency guard.
 */
import type { Server } from 'node:http';
import { isDraining, setDraining } from './health.js';
import { otel } from './otel.js';

/**
 * Minimal logger contract used by the shutdown handler. Accepts both the pino
 * native `Logger` interface and the Winston-to-pino adapter exported by
 * src/logger.ts (which provides .info/.error but is not a full pino.Logger).
 * Structural typing: any object exposing these methods is accepted. Arguments
 * are typed as `unknown` to match pino's overloaded (obj, msg) / (msg) /
 * (obj) signatures and the Winston-style (msg, meta?) adapter.
 */
export interface ShutdownLogger {
  info: (arg1: unknown, arg2?: unknown) => void;
  error: (arg1: unknown, arg2?: unknown) => void;
  flush?: () => void;
}

const GRACE_MS = Number.parseInt(process.env.MS365_MCP_SHUTDOWN_GRACE_MS ?? '25000', 10);

const OTEL_SHUTDOWN_TIMEOUT_MS = 10_000;
const registeredServers = new Set<Server>();
let activeLogger: ShutdownLogger | null = null;
let hooksRegistered = false;

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function closeRegisteredServers(): Promise<void> {
  await Promise.all([...registeredServers].map(closeServer));
}

async function shutdown(signal: string): Promise<void> {
  const logger = activeLogger;
  if (!logger || isDraining()) {
    // Idempotent: double-signal is a no-op. Guards against operator double
    // Ctrl-C and against re-entry from cascading subsystems.
    return;
  }
  setDraining(true);
  logger.info({ signal, graceMs: GRACE_MS }, 'Graceful shutdown initiated');

  // Failsafe deadline — if the drain sequence stalls past GRACE_MS, force
  // exit(1). unref() so the timer does not keep the event loop alive when
  // shutdown completes faster.
  const deadline = setTimeout(() => {
    logger.error({ graceMs: GRACE_MS }, 'Graceful shutdown deadline exceeded; forcing exit');
    process.exit(1);
  }, GRACE_MS);
  deadline.unref();

  // 1. Stop accepting new HTTP connections; await in-flight to drain.
  await closeRegisteredServers();

  // 2. Flush pino logger (sync on stdout destination in pino v10).
  try {
    logger.flush?.();
  } catch {
    // Swallow — we are exiting anyway; a flush failure must not block the
    // remaining shutdown steps.
  }

  // 3. Shut down OTel SDK with a 10s race ceiling. A dead OTLP collector
  // can hang sdk.shutdown indefinitely; the race guarantees exit bounds.
  try {
    await Promise.race([
      otel.shutdown(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('OTel shutdown timed out')), OTEL_SHUTDOWN_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'OTel shutdown did not complete within timeout; proceeding to exit'
    );
  }

  clearTimeout(deadline);
  logger.info('Graceful shutdown complete');
  process.exit(0);
}

/**
 * Register SIGTERM + SIGINT handlers that run the graceful drain sequence.
 *
 * @param server - The http.Server returned by app.listen(...), or null for
 *   stdio mode (no HTTP to close).
 * @param logger - Logger for lifecycle audit lines. Accepts either a pino
 *   Logger directly or the Winston-to-pino adapter from src/logger.ts. .flush
 *   is optional so logger mocks without .flush still work.
 */
export function registerShutdownHooks(server: Server | null, logger: ShutdownLogger): void {
  activeLogger = logger;
  if (server) {
    registeredServers.add(server);
  }

  if (!hooksRegistered) {
    hooksRegistered = true;
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}
