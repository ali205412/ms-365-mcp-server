/**
 * Graph middleware pipeline driver (Plan 02-01).
 *
 * `composePipeline(middlewares, terminal)` returns a function
 * `(req: GraphRequest) => Promise<Response>` that dispatches `req` through
 * the middleware chain in outer-to-inner order, then into `terminal`
 * (typically the raw `fetch` call).
 *
 * Algorithm (adapted from koa-compose and evertpot.com/generic-middleware):
 *   1. `index = -1` (sentinel)
 *   2. `dispatch(i)`:
 *        - if `i <= index`: a middleware called `next()` twice → throw
 *        - `index := i`
 *        - `mw := middlewares[i]`
 *        - if `!mw`: return `terminal(req)` (we have walked past the last mw)
 *        - else return `mw.execute(req, () => dispatch(i + 1))`
 *   3. Kick off with `dispatch(0)`.
 *
 * The double-call guard (T-02-01a / T-02-01b) is critical: without it, a
 * buggy middleware that awaits `next()` twice would cause duplicate terminal
 * invocations — and therefore duplicate HTTP requests — producing duplicate
 * side effects on POST / PATCH / DELETE. The sentinel detects this
 * deterministically and surfaces the bug at test time rather than shipping
 * silent double-writes to Microsoft Graph.
 */

import type { GraphMiddleware, GraphRequest } from './types.js';

export function composePipeline(
  middlewares: GraphMiddleware[],
  terminal: (req: GraphRequest) => Promise<Response>
): (req: GraphRequest) => Promise<Response> {
  return async function execute(req: GraphRequest): Promise<Response> {
    let index = -1;

    async function dispatch(i: number): Promise<Response> {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;
      const mw = middlewares[i];
      if (!mw) return terminal(req);
      return mw.execute(req, () => dispatch(i + 1));
    }

    return dispatch(0);
  };
}
