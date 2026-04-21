/**
 * Health check endpoints: /healthz (liveness) and /readyz (readiness).
 *
 * /healthz ALWAYS returns 200 while the process is alive and the event loop
 * can dispatch — consumed by Docker HEALTHCHECK (bin/check-health.cjs from
 * plan 01-03) and orchestrator liveness probes. Returning 503 here would
 * cause Docker / Kubernetes to restart the container — which is exactly
 * wrong for a draining-but-healthy process.
 *
 * /readyz returns 200 when the server is ready to serve traffic, 503 when
 * draining (SIGTERM received — plan 01-05 flips the flag) or when any
 * pushed readiness check fails. Phase 3 pushes a Postgres/Redis check;
 * Phase 6 pushes "at least one tenant loaded". Phase 1 baseline has no
 * readiness checks — the server is ready as soon as it is up and NOT
 * draining.
 *
 * Intentional exceptions to house style:
 *   - Module-level mutable `draining` flag. Matches the pattern used by the
 *     pino-http logger and the auth.ts keytar singletons — flipping a single
 *     process-wide boolean is the simplest correct implementation for a
 *     single-tenant Phase 1 server. Phase 3 may refactor to a DI container
 *     once the tenant pool lands.
 *   - No logger import. The /healthz + /readyz routes run every ~30s from
 *     Docker HEALTHCHECK; adding logger.debug here produces noise with zero
 *     diagnostic value. pino-http autoLogging.ignore (plan 01-02) already
 *     skips these paths.
 *   - No OpenTelemetry manual spans. The OTel auto-instrumentations bundle
 *     (plan 01-02) already wraps every Express request — a manual span here
 *     is redundant.
 *
 * Threat disposition (from plan 01-04 <threat_model>):
 *   - T-01-04a (log spam): addressed by pino-http autoLogging.ignore.
 *   - T-01-04b (auth on health probe): addressed by mounting BEFORE auth
 *     middleware in src/server.ts — see callsite ordering there.
 *   - T-01-04c (info disclosure via readiness body): addressed by keeping
 *     the 503 body opaque — only `{ status: 'not_ready' }` or
 *     `{ status: 'draining' }` is emitted. Callers that push readiness
 *     checks MUST preserve this contract.
 */
import type { Application, Request, Response, Router } from 'express';
import type { Pool } from 'pg';

let draining = false;

/**
 * Returns true when the process has been asked to drain (plan 01-05 SIGTERM
 * handler calls setDraining(true)).
 */
export const isDraining = (): boolean => draining;

/**
 * Flip the draining flag. Called by the graceful-shutdown signal handler
 * (plan 01-05) to make /readyz return 503 while in-flight requests finish.
 */
export const setDraining = (v: boolean): void => {
  draining = v;
};

/**
 * A readiness check returns true when the dependency it guards is healthy
 * and ready to serve traffic, or false otherwise. Checks may be sync or
 * async; a thrown error is treated as "not ready" (never propagates out
 * of /readyz).
 */
export type ReadinessCheck = () => boolean | Promise<boolean>;

/**
 * Mount /healthz (liveness) and /readyz (readiness) routes on the given
 * Express app or router. MUST be called BEFORE any auth middleware, CORS
 * middleware, or body parsers so that health probes never exercise those
 * paths (T-01-04b mitigation).
 *
 * @param app - Express Application or Router to mount on.
 * @param readinessChecks - Optional array of readiness checks to evaluate
 *   on each /readyz probe. Empty by default (Phase 1 baseline). Phase 3
 *   pushes a Postgres/Redis check; Phase 6 pushes tenantLoaded.
 */
export function mountHealth(
  app: Pick<Router, 'get'>,
  readinessChecks: ReadinessCheck[] = []
): void {
  // Liveness — always 200 while the process is alive and the event loop can
  // dispatch. Orchestrator restart decisions are made off this response.
  app.get('/healthz', (_req: Request<any, any, any, any>, res: Response): void => {
    res.status(200).json({ status: 'ok' });
  });

  // Readiness — 503 while draining OR when any pushed readiness check fails.
  // Load balancers use this to decide whether to route traffic; returning
  // 200 while draining would cause requests to be aborted mid-flight.
  app.get('/readyz', async (_req: Request<any, any, any, any>, res: Response): Promise<void> => {
    if (draining) {
      res.status(503).json({ status: 'draining' });
      return;
    }

    for (const check of readinessChecks) {
      let ok = false;
      try {
        ok = await check();
      } catch {
        ok = false;
      }
      if (!ok) {
        res.status(503).json({ status: 'not_ready' });
        return;
      }
    }

    res.status(200).json({ status: 'ready' });
  });
}

/**
 * Readiness check factory: at least one active (non-disabled) tenant exists.
 *
 * Plan 03-10 /readyz composition pushes this alongside
 * `postgres.readinessCheck` + `redisClient.readinessCheck` so the endpoint
 * flips to 503 on a freshly-deployed empty Postgres (Phase 4 admin API
 * onboards the first tenant; before that, /readyz correctly reports
 * not_ready). Returns false on any SQL error so callers never see a thrown
 * exception bubble out of the probe.
 *
 * Query: `SELECT COUNT(*)::int AS n FROM tenants WHERE disabled_at IS NULL
 * LIMIT 1` — cheap; relies on the `(disabled_at) WHERE IS NULL` partial
 * index seeded by 03-01's tenants migration.
 */
export function tenantsLoadedCheck(pool: Pool): ReadinessCheck {
  return async (): Promise<boolean> => {
    try {
      const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS n FROM tenants WHERE disabled_at IS NULL LIMIT 1'
      );
      const n = rows[0]?.n;
      return typeof n === 'number' ? n > 0 : false;
    } catch {
      return false;
    }
  };
}
