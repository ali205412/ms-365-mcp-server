/**
 * Graph middleware pipeline driver (Plan 02-01; double-call guard refined
 * in Plan 02-02 to support sequential retries).
 *
 * `composePipeline(middlewares, terminal)` returns a function
 * `(req: GraphRequest) => Promise<Response>` that dispatches `req` through
 * the middleware chain in outer-to-inner order, then into `terminal`
 * (typically the raw `fetch` call).
 *
 * Algorithm:
 *   For each middleware position `i`, build a `next` closure that tracks
 *   its own in-flight state. `next()` calls are permitted sequentially
 *   (each awaited before the next starts) — this is the retry pattern used
 *   by RetryHandler (02-02) and TokenRefreshMiddleware (02-01). Concurrent
 *   / overlapping `next()` invocations from the same middleware are rejected
 *   with `Error('next() called multiple times')`.
 *
 * The double-call guard (T-02-01a / T-02-01b) catches the real-world bug:
 * a middleware forgets to `await next()` or kicks off two parallel `next()`
 * invocations, which in the original code would cause duplicate terminal
 * calls and therefore duplicate HTTP requests on POST / PATCH / DELETE.
 * The guard surfaces this deterministically at test time rather than
 * shipping silent double-writes to Microsoft Graph.
 *
 * Refinement (02-02): the 02-01 implementation used a monotonically-
 * increasing global index sentinel which rejected ALL sequential re-entries.
 * That was too strict — RetryHandler legitimately calls `next()` multiple
 * times in sequence to retry a retryable status, and TokenRefreshMiddleware
 * calls `next()` a second time after a 401-refresh. The guard is now scoped
 * per-middleware-closure and checks an "in-flight" boolean so sequential
 * retries pass while parallel misuse still throws.
 */

import type { GraphMiddleware, GraphRequest } from './types.js';

export function composePipeline(
  middlewares: GraphMiddleware[],
  terminal: (req: GraphRequest) => Promise<Response>
): (req: GraphRequest) => Promise<Response> {
  return async function execute(req: GraphRequest): Promise<Response> {
    async function dispatch(i: number): Promise<Response> {
      const mw = middlewares[i];
      if (!mw) return terminal(req);

      // Per-closure in-flight flag. Each middleware gets its own `next`
      // binding; the flag flips true on entry and false in a finally block
      // so sequential retries (await next(); await next();) work while
      // parallel misuse (next(); next();) throws.
      let nextInFlight = false;
      const next = async (): Promise<Response> => {
        if (nextInFlight) {
          throw new Error('next() called multiple times');
        }
        nextInFlight = true;
        try {
          return await dispatch(i + 1);
        } finally {
          nextInFlight = false;
        }
      };
      return mw.execute(req, next);
    }

    return dispatch(0);
  };
}
