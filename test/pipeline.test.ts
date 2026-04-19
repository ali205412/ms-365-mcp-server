/**
 * Tests for the onion-model middleware pipeline driver (Plan 02-01 +
 * refinements in 02-02 to support retry semantics).
 *
 * Covers:
 *   - Dispatch ordering: outer middleware runs BEFORE inner, after-hooks run in
 *     reverse order (classic Koa/onion semantics).
 *   - Double-call guard: concurrent / overlapping next() calls from the SAME
 *     middleware throw — the real-world T-02-01a / T-02-01b bug where a
 *     middleware forgets to `await` and kicks off two parallel terminal
 *     invocations.
 *   - Sequential retries are SUPPORTED: RetryHandler (02-02) and
 *     TokenRefreshMiddleware (02-01) both call next() multiple times in
 *     sequence (await-then-call-again). Refined guard in 02-02 allows this
 *     while still catching the parallel-invocation bug.
 *   - Terminal handler is invoked exactly once on the happy path (no
 *     accidental double-fetch when the pipeline is empty).
 */
import { describe, it, expect, vi } from 'vitest';
import { composePipeline } from '../src/lib/middleware/pipeline.js';
import type { GraphMiddleware, GraphRequest } from '../src/lib/middleware/types.js';

describe('composePipeline', () => {
  it('dispatches through middlewares in onion-model order', async () => {
    const order: string[] = [];
    const mkMw = (name: string): GraphMiddleware => ({
      name,
      async execute(_req, next) {
        order.push(`${name}:before`);
        const res = await next();
        order.push(`${name}:after`);
        return res;
      },
    });
    const terminal = async (_req: GraphRequest) => {
      order.push('terminal');
      return new Response(null, { status: 204 });
    };
    const pipeline = composePipeline([mkMw('A'), mkMw('B'), mkMw('C')], terminal);

    await pipeline({ url: 'https://graph/x', method: 'GET', headers: {} });

    expect(order).toEqual([
      'A:before',
      'B:before',
      'C:before',
      'terminal',
      'C:after',
      'B:after',
      'A:after',
    ]);
  });

  it('throws when a middleware calls next() concurrently (forgets await)', async () => {
    const buggy: GraphMiddleware = {
      name: 'buggy-parallel',
      async execute(_req, next) {
        // BUG — two next() invocations kicked off in parallel (no await on
        // the first). This causes overlapping terminal calls in the original
        // algorithm; the guard must reject it deterministically.
        const p1 = next();
        const p2 = next();
        await Promise.all([p1, p2]);
        return new Response(null);
      },
    };
    const terminal = async () => new Response(null, { status: 204 });
    const pipeline = composePipeline([buggy], terminal);

    await expect(pipeline({ url: 'https://graph/x', method: 'GET', headers: {} })).rejects.toThrow(
      /next\(\)\s+called\s+multiple\s+times/i
    );
  });

  it('supports sequential next() calls (retry pattern used by RetryHandler / TokenRefresh)', async () => {
    // RetryHandler (02-02) and TokenRefreshMiddleware (02-01) both rely on
    // being able to await next(), inspect the result, and call next() again
    // sequentially. The refined guard in 02-02 permits this while still
    // catching concurrent misuse (see prior test).
    let terminalCalls = 0;
    const retrying: GraphMiddleware = {
      name: 'retrying',
      async execute(_req, next) {
        const first = await next();
        if (first.status === 503) {
          return await next();
        }
        return first;
      },
    };
    const terminal = async () => {
      terminalCalls++;
      return new Response(null, { status: terminalCalls === 1 ? 503 : 200 });
    };
    const pipeline = composePipeline([retrying], terminal);

    const result = await pipeline({ url: 'https://graph/x', method: 'GET', headers: {} });

    expect(result.status).toBe(200);
    expect(terminalCalls).toBe(2);
  });

  it('invokes terminal handler exactly once on happy path', async () => {
    const terminal = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const pipeline = composePipeline([], terminal);

    const req: GraphRequest = { url: 'https://graph/x', method: 'GET', headers: {} };
    await pipeline(req);

    expect(terminal).toHaveBeenCalledTimes(1);
    expect(terminal).toHaveBeenCalledWith(req);
  });
});
