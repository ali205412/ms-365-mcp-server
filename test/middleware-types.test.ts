/**
 * Middleware type contract sanity check (Plan 02-01).
 *
 * The sole purpose of this file is to force a Vitest-visible failure if the
 * `GraphMiddleware` / `GraphRequest` interfaces in src/lib/middleware/types.ts
 * are ever renamed, removed, or change shape in a way that breaks the Phase 2
 * pipeline. The compile check happens during TypeScript transform; the runtime
 * assertion is a belt-and-braces smoke test.
 *
 * All behavioural tests live in test/pipeline.test.ts +
 * test/token-refresh-middleware.test.ts — this file intentionally stays a
 * single `it()` block.
 */
import { describe, it, expect } from 'vitest';
import type { GraphMiddleware, GraphRequest } from '../src/lib/middleware/types.js';

describe('GraphMiddleware interface shape (02-01)', () => {
  it('a no-op middleware satisfies the interface (compile + runtime)', async () => {
    // Force a runtime import so vitest surfaces "module not found" during RED.
    // Pure `import type` lines are erased at transform time and leak false GREEN
    // results when the module does not yet exist.
    const types = await import('../src/lib/middleware/types.js');
    expect(types).toBeDefined();

    const passthrough: GraphMiddleware = {
      name: 'passthrough',
      async execute(_req: GraphRequest, next: () => Promise<Response>) {
        return next();
      },
    };

    expect(passthrough.name).toBe('passthrough');
    expect(typeof passthrough.execute).toBe('function');

    // Exercise the closure to prove the signature is wired correctly.
    const terminal = async () => new Response(null, { status: 204 });
    const req: GraphRequest = { url: 'https://graph/x', method: 'GET', headers: {} };
    const response = await passthrough.execute(req, terminal);
    expect(response.status).toBe(204);
  });
});
