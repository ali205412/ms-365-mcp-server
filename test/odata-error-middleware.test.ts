/**
 * Tests for ODataErrorHandler middleware (Plan 02-03).
 *
 * Direct-invocation + integration test coverage:
 *   - 2xx responses pass through unchanged.
 *   - 4xx / 5xx responses throw the correct typed GraphError subclass.
 *   - Hyphenated innerError fields normalize through the middleware to
 *     camelCase on the thrown error.
 *   - Retry-After header on 429 populates retryAfterMs on the thrown
 *     GraphThrottleError (02-02 RetryHandler consumes this).
 *   - Integration via composePipeline ensures the chain-position contract:
 *     an outer middleware catches the thrown GraphError and can observe its
 *     instanceof / statusCode for retry decisions.
 *   - Non-JSON response bodies fall back to a synthetic { code:
 *     'nonJsonError' } envelope so callers still receive a GraphError.
 *
 * Logger is mocked so the test suite does not depend on pino bootstrap.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ODataErrorHandler } from '../src/lib/middleware/odata-error.js';
import {
  GraphValidationError,
  GraphThrottleError,
  GraphError,
  GraphServerError,
  GraphConcurrencyError,
  GraphAuthError,
} from '../src/lib/graph-errors.js';
import {
  canonical400ValidationError,
  canonical429Throttle,
  canonical412PreconditionFailed,
  canonical500InternalServer,
  canonical503ServiceUnavailable,
  toResponse,
} from './fixtures/graph-responses.js';
import type { GraphRequest } from '../src/lib/middleware/types.js';

function mkReq(): GraphRequest {
  return { url: 'https://graph.microsoft.com/v1.0/me', method: 'GET', headers: {} };
}

describe('ODataErrorHandler middleware', () => {
  it('passes 2xx response through unchanged (no parse attempt)', async () => {
    const mw = new ODataErrorHandler();
    const response = new Response(JSON.stringify({ foo: 'bar' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const next = vi.fn().mockResolvedValue(response);

    const result = await mw.execute(mkReq(), next);

    expect(result.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(1);
    // Body still readable (not consumed by the middleware).
    expect(await result.json()).toEqual({ foo: 'bar' });
  });

  it('204 No Content passes through unchanged', async () => {
    const mw = new ODataErrorHandler();
    const response = new Response(null, { status: 204 });
    const next = vi.fn().mockResolvedValue(response);

    const result = await mw.execute(mkReq(), next);
    expect(result.status).toBe(204);
  });

  it('400 throws GraphValidationError with structured fields (statusCode + requestId)', async () => {
    const mw = new ODataErrorHandler();
    const next = vi.fn().mockResolvedValue(toResponse(canonical400ValidationError));

    try {
      await mw.execute(mkReq(), next);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GraphValidationError);
      const typed = err as GraphValidationError;
      expect(typed.statusCode).toBe(400);
      expect(typed.code).toBe('invalidRequest');
      expect(typed.requestId).toBe('33333333-4444-5555-6666-777777777777');
      expect(typed.clientRequestId).toBe('33333333-4444-5555-6666-777777777777');
    }
  });

  it('429 throws GraphThrottleError with retryAfterMs parsed from header', async () => {
    const mw = new ODataErrorHandler();
    const response = new Response(JSON.stringify(canonical429Throttle.body), {
      status: 429,
      headers: { 'retry-after': '10', 'content-type': 'application/json' },
    });
    const next = vi.fn().mockResolvedValue(response);

    try {
      await mw.execute(mkReq(), next);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GraphThrottleError);
      expect((err as GraphThrottleError).retryAfterMs).toBe(10_000);
    }
  });

  it('412 throws GraphConcurrencyError with re-fetch hint', async () => {
    const mw = new ODataErrorHandler();
    const next = vi.fn().mockResolvedValue(toResponse(canonical412PreconditionFailed));

    try {
      await mw.execute(mkReq(), next);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GraphConcurrencyError);
      expect((err as GraphConcurrencyError).message).toContain('resource changed');
    }
  });

  it('500 throws GraphServerError', async () => {
    const mw = new ODataErrorHandler();
    const next = vi.fn().mockResolvedValue(toResponse(canonical500InternalServer));

    try {
      await mw.execute(mkReq(), next);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GraphServerError);
      expect((err as GraphServerError).statusCode).toBe(500);
    }
  });

  it('503 throws GraphServerError (5xx fallback)', async () => {
    const mw = new ODataErrorHandler();
    const next = vi.fn().mockResolvedValue(toResponse(canonical503ServiceUnavailable));

    try {
      await mw.execute(mkReq(), next);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GraphServerError);
    }
  });

  it('hyphenated innerError fields normalize to camelCase on thrown error', async () => {
    const mw = new ODataErrorHandler();
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'X',
          message: 'Y',
          innerError: { 'request-id': 'REQ', 'client-request-id': 'CLI' },
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
    const next = vi.fn().mockResolvedValue(response);

    try {
      await mw.execute(mkReq(), next);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GraphError);
      expect((err as GraphError).requestId).toBe('REQ');
      expect((err as GraphError).clientRequestId).toBe('CLI');
    }
  });

  it('non-JSON error body falls back to synthetic nonJsonError envelope', async () => {
    const mw = new ODataErrorHandler();
    const response = new Response('<html>gateway timeout</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    });
    const next = vi.fn().mockResolvedValue(response);

    try {
      await mw.execute(mkReq(), next);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GraphServerError);
      const typed = err as GraphServerError;
      expect(typed.statusCode).toBe(502);
      expect(typed.code).toBe('nonJsonError');
      expect(typed.message).toContain('gateway timeout');
    }
  });

  it('403 with scope/permission keyword sets requiresOrgMode', async () => {
    const mw = new ODataErrorHandler();
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'Forbidden',
          message: 'Insufficient permission to access resource',
        },
      }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    );
    const next = vi.fn().mockResolvedValue(response);

    try {
      await mw.execute(mkReq(), next);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GraphAuthError);
      expect((err as GraphAuthError).requiresOrgMode).toBe(true);
    }
  });
});

describe('ODataErrorHandler + composePipeline integration', () => {
  it('outer middleware catches the typed GraphError from inner ODataErrorHandler', async () => {
    const { composePipeline } = await import('../src/lib/middleware/pipeline.js');
    const odata = new ODataErrorHandler();

    const outer = {
      name: 'outer-catch',
      async execute(req: GraphRequest, next: () => Promise<Response>): Promise<Response> {
        try {
          return await next();
        } catch (err) {
          // Rewrap inside a 200 so we can assert the outer saw the typed error.
          if (err instanceof GraphValidationError) {
            return new Response(
              JSON.stringify({ caught: true, statusCode: err.statusCode, code: err.code }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          throw err;
        }
      },
    };

    const terminal = vi.fn().mockResolvedValue(toResponse(canonical400ValidationError));
    const pipeline = composePipeline([outer, odata], terminal);
    const result = await pipeline(mkReq());

    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toEqual({ caught: true, statusCode: 400, code: 'invalidRequest' });
    expect(terminal).toHaveBeenCalledTimes(1);
  });

  it('GraphThrottleError from pipeline carries retryAfterMs for outer consumption', async () => {
    const { composePipeline } = await import('../src/lib/middleware/pipeline.js');
    const odata = new ODataErrorHandler();

    let captured: GraphError | null = null;
    const outer = {
      name: 'outer-capture',
      async execute(req: GraphRequest, next: () => Promise<Response>): Promise<Response> {
        try {
          return await next();
        } catch (err) {
          captured = err as GraphError;
          throw err;
        }
      },
    };

    const response = new Response(JSON.stringify(canonical429Throttle.body), {
      status: 429,
      headers: { 'retry-after': '10', 'content-type': 'application/json' },
    });
    const terminal = vi.fn().mockResolvedValue(response);
    const pipeline = composePipeline([outer, odata], terminal);

    await expect(pipeline(mkReq())).rejects.toBeInstanceOf(GraphThrottleError);
    expect(captured).toBeInstanceOf(GraphThrottleError);
    expect((captured as unknown as GraphThrottleError).retryAfterMs).toBe(10_000);
  });
});
