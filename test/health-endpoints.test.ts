/**
 * Tests for /healthz (liveness) and /readyz (readiness) endpoints (OPS-03 / OPS-04).
 *
 * /healthz ALWAYS returns 200 while the process is alive — consumed by Docker
 * HEALTHCHECK and orchestrator liveness probes.
 *
 * /readyz returns 200 when the server is ready to serve traffic, 503 when
 * draining (SIGTERM received, plan 01-05 calls setDraining(true)) or when any
 * pushed readiness check fails. Phase 3 will push a Postgres/Redis check;
 * Phase 6 will push "at least one tenant loaded". Phase 1 baseline has no
 * readiness checks — the server is ready as soon as it is up and NOT draining.
 *
 * These tests MUST FAIL before src/lib/health.ts is implemented (RED phase).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger so tests stay silent and portable across transports.
vi.mock('../src/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Reusable type for the minimal Express-shaped handler we intercept.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: any, res: any) => void | Promise<void>;

/**
 * Spy-style fake Express application that captures `app.get(path, handler)`
 * calls without binding a real port. Works across Express versions — unlike
 * `app._router.stack`, which changed shape between Express 4 and 5.
 */
function makeFakeApp(): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (path: string, ...handlers: any[]) => void;
  routes: Record<string, Handler>;
} {
  const routes: Record<string, Handler> = {};
  return {
    // Accept the variadic `(path, ...middleware, handler)` signature Express 5 uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(path: string, ...handlers: any[]) {
      const handler = handlers[handlers.length - 1];
      if (typeof handler === 'function') {
        routes[path] = handler;
      }
    },
    routes,
  };
}

/**
 * Invokes the captured handler with stubbed req/res and returns what the
 * handler wrote via `res.status(n).json(body)`. Supports both sync and async
 * handlers — we always `await` the returned value.
 */
async function invokeHandler(
  handler: Handler | undefined
): Promise<{ status: number; body: unknown }> {
  if (!handler) throw new Error('handler was not registered');

  const captured: { status: number; body: unknown } = { status: 0, body: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req: any = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    status(n: number) {
      captured.status = n;
      return this;
    },
    json(b: unknown) {
      captured.body = b;
      return this;
    },
  };

  await handler(req, res);
  return captured;
}

describe('health endpoints (OPS-03 / OPS-04)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    // Reset module-level draining flag between tests so state never leaks.
    const { setDraining } = await import('../src/lib/health.js');
    setDraining(false);
  });

  it('Test 1: GET /healthz returns 200 with { status: "ok" }', async () => {
    const { mountHealth } = await import('../src/lib/health.js');

    const app = makeFakeApp();
    mountHealth(app);

    const result = await invokeHandler(app.routes['/healthz']);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'ok' });
  });

  it('Test 2: GET /readyz returns 200 with { status: "ready" } by default', async () => {
    const { mountHealth } = await import('../src/lib/health.js');

    const app = makeFakeApp();
    mountHealth(app);

    const result = await invokeHandler(app.routes['/readyz']);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'ready' });
  });

  it('Test 3: after setDraining(true), GET /readyz returns 503 with { status: "draining" }', async () => {
    const { mountHealth, setDraining } = await import('../src/lib/health.js');

    const app = makeFakeApp();
    mountHealth(app);

    setDraining(true);
    const result = await invokeHandler(app.routes['/readyz']);

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: 'draining' });
  });

  it('Test 4: after setDraining(false), /readyz returns 200 again', async () => {
    const { mountHealth, setDraining } = await import('../src/lib/health.js');

    const app = makeFakeApp();
    mountHealth(app);

    setDraining(true);
    const drainingResult = await invokeHandler(app.routes['/readyz']);
    expect(drainingResult.status).toBe(503);

    setDraining(false);
    const recoveredResult = await invokeHandler(app.routes['/readyz']);

    expect(recoveredResult.status).toBe(200);
    expect(recoveredResult.body).toEqual({ status: 'ready' });
  });

  it('Test 5: failing readiness check -> /readyz returns 503 with { status: "not_ready" }', async () => {
    const { mountHealth } = await import('../src/lib/health.js');

    const app = makeFakeApp();
    mountHealth(app, [() => false]);

    const result = await invokeHandler(app.routes['/readyz']);

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: 'not_ready' });
  });

  it('Test 6: throwing async readiness check -> /readyz returns 503 (error swallowed, status degraded)', async () => {
    const { mountHealth } = await import('../src/lib/health.js');

    const app = makeFakeApp();
    mountHealth(app, [
      async () => {
        throw new Error('boom');
      },
    ]);

    const result = await invokeHandler(app.routes['/readyz']);

    expect(result.status).toBe(503);
    expect(result.body).toEqual({ status: 'not_ready' });
  });

  it('Test 7: all-passing readiness checks -> /readyz returns 200', async () => {
    const { mountHealth } = await import('../src/lib/health.js');

    const app = makeFakeApp();
    mountHealth(app, [async () => true, () => true]);

    const result = await invokeHandler(app.routes['/readyz']);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'ready' });
  });

  it('isDraining() reflects current setDraining value', async () => {
    const { setDraining, isDraining } = await import('../src/lib/health.js');

    setDraining(false);
    expect(isDraining()).toBe(false);

    setDraining(true);
    expect(isDraining()).toBe(true);

    setDraining(false);
    expect(isDraining()).toBe(false);
  });
});
