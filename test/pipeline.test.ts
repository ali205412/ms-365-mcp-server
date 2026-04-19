/**
 * Tests for the onion-model middleware pipeline driver (Plan 02-01).
 *
 * Covers:
 *   - Dispatch ordering: outer middleware runs BEFORE inner, after-hooks run in
 *     reverse order (classic Koa/onion semantics).
 *   - Double-call guard: a buggy middleware that awaits next() twice triggers
 *     a deterministic throw — without this, side-effectful requests (POST /
 *     PATCH / DELETE) could be issued twice (T-02-01a, T-02-01b).
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

  it('throws when a middleware calls next() twice', async () => {
    const buggy: GraphMiddleware = {
      name: 'buggy',
      async execute(_req, next) {
        await next();
        await next(); // BUG — double-call must be detected by the driver.
        return new Response(null);
      },
    };
    const terminal = async () => new Response(null, { status: 204 });
    const pipeline = composePipeline([buggy], terminal);

    await expect(
      pipeline({ url: 'https://graph/x', method: 'GET', headers: {} })
    ).rejects.toThrow(/next\(\)\s+called\s+multiple\s+times/i);
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
