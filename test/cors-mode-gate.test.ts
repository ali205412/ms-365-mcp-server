/**
 * Tests for CORS middleware factory (SECUR-04 / plan 01-07).
 *
 * Threat refs from plan 01-07 <threat_model>:
 *   - T-01-07b: v1 default CORS echoes `http://localhost:3000` regardless of
 *     deployment — replaced by a dev/prod mode gate per D-02.
 *
 * Contract under test — src/lib/cors.ts:
 *   - createCorsMiddleware({ mode, allowlist }) returns an Express
 *     RequestHandler.
 *   - Dev mode: echo `Access-Control-Allow-Origin` for any
 *     http://localhost:* OR http://127.0.0.1:* origin. Deny anything else.
 *   - Prod mode: allowlist is the ONLY source of truth. Exact string match,
 *     no prefix/wildcard. Deny everything else.
 *   - Always set `Vary: Origin` so browser caches disambiguate allowed vs
 *     denied responses.
 *   - OPTIONS preflight responds 204 on allowed origins, 403 on denied —
 *     never leak ACAO when the origin is not in scope.
 *
 * These tests MUST FAIL on first run (RED) because src/lib/cors.ts does not
 * yet exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * Invoke the middleware with a stubbed req/res/next and return the captured
 * headers + status state. The stub deliberately mirrors the tiny slice of the
 * Express API the middleware actually uses so the tests stay fast and
 * free of any HTTP server bootstrap.
 */
function runMiddleware(
  middleware: (req: unknown, res: unknown, next: () => void) => void,
  opts: { method: string; origin?: string }
): {
  headers: Record<string, string | string[]>;
  statusCode: number;
  nextCalled: boolean;
} {
  const headers: Record<string, string | string[]> = {};
  let statusCode = 0;
  let nextCalled = false;

  const req = {
    method: opts.method,
    headers: opts.origin ? { origin: opts.origin } : {},
  };

  const res = {
    header(name: string, val: string | string[]) {
      headers[name] = val;
      return this;
    },
    // Some middleware factories (cors, helmet) use `set` instead of `header`.
    set(name: string, val: string | string[]) {
      headers[name] = val;
      return this;
    },
    sendStatus(s: number) {
      statusCode = s;
      return this;
    },
    status(s: number) {
      statusCode = s;
      return this;
    },
    end() {
      return this;
    },
  };

  middleware(req, res, () => {
    nextCalled = true;
  });

  return { headers, statusCode, nextCalled };
}

describe('createCorsMiddleware — dev mode (SECUR-04 / T-01-07b)', () => {
  it('Test 4: echoes Access-Control-Allow-Origin for http://localhost:4200 (dev)', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({ mode: 'dev', allowlist: [] });

    const { headers } = runMiddleware(middleware, {
      method: 'GET',
      origin: 'http://localhost:4200',
    });

    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:4200');
    expect(headers['Vary']).toBe('Origin');
  });

  it('dev mode accepts http://127.0.0.1:any-port', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({ mode: 'dev', allowlist: [] });

    const { headers } = runMiddleware(middleware, {
      method: 'GET',
      origin: 'http://127.0.0.1:51234',
    });

    expect(headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:51234');
  });

  it('Test 5: does NOT echo ACAO for https://evil.com (dev rejects non-loopback http)', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    // Dev mode still denies origins that are not http://localhost:* /
    // http://127.0.0.1:* — we deliberately scope "dev permissive" to loopback
    // so a stray https://evil.com request from a browser session cannot CSRF
    // the dev server.
    const middleware = createCorsMiddleware({ mode: 'dev', allowlist: [] });

    const { headers } = runMiddleware(middleware, {
      method: 'GET',
      origin: 'https://evil.com',
    });

    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('Test 8: OPTIONS preflight on allowed origin responds 204 with ACAO + ACAM + ACAH', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({ mode: 'dev', allowlist: [] });

    const { headers, statusCode, nextCalled } = runMiddleware(middleware, {
      method: 'OPTIONS',
      origin: 'http://localhost:3000',
    });

    expect(statusCode).toBe(204);
    expect(nextCalled).toBe(false);
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    expect(headers['Access-Control-Allow-Methods']).toMatch(/GET.*POST.*OPTIONS/);
    expect(headers['Access-Control-Allow-Headers']).toMatch(
      /Authorization|Content-Type|mcp-protocol-version/i
    );
  });

  it('requests without Origin header pass through without ACAO (curl / server-to-server)', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({ mode: 'dev', allowlist: [] });

    const { headers, nextCalled } = runMiddleware(middleware, {
      method: 'POST',
      // no origin
    });

    expect(nextCalled).toBe(true);
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('createCorsMiddleware — prod mode (SECUR-04 / T-01-07b)', () => {
  it('Test 6: echoes ACAO for origin in allowlist', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({
      mode: 'prod',
      allowlist: ['https://app.example.com'],
    });

    const { headers } = runMiddleware(middleware, {
      method: 'GET',
      origin: 'https://app.example.com',
    });

    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(headers['Vary']).toBe('Origin');
  });

  it('Test 7: does NOT echo ACAO for origin outside allowlist', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({
      mode: 'prod',
      allowlist: ['https://app.example.com'],
    });

    const { headers } = runMiddleware(middleware, {
      method: 'GET',
      origin: 'https://evil.com',
    });

    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('prod + loopback origin is NOT permitted (loopback is dev-only)', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({
      mode: 'prod',
      allowlist: ['https://app.example.com'],
    });

    const { headers } = runMiddleware(middleware, {
      method: 'GET',
      origin: 'http://localhost:3000',
    });

    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('prod + exact allowlist match on multi-entry list', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({
      mode: 'prod',
      allowlist: ['https://app.example.com', 'https://desktop.example.com'],
    });

    const { headers } = runMiddleware(middleware, {
      method: 'GET',
      origin: 'https://desktop.example.com',
    });

    expect(headers['Access-Control-Allow-Origin']).toBe('https://desktop.example.com');
  });

  it('OPTIONS preflight on denied origin returns 403 (not silent 200)', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({
      mode: 'prod',
      allowlist: ['https://app.example.com'],
    });

    const { statusCode, headers } = runMiddleware(middleware, {
      method: 'OPTIONS',
      origin: 'https://evil.com',
    });

    // 403 is a loud signal to the operator that CORS is misconfigured.
    expect(statusCode).toBe(403);
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('createCorsMiddleware — Vary: Origin (cache correctness)', () => {
  it('sets Vary: Origin even on denied origin (prevents browser cache poisoning)', async () => {
    const { createCorsMiddleware } = await import('../src/lib/cors.js');
    const middleware = createCorsMiddleware({
      mode: 'prod',
      allowlist: ['https://app.example.com'],
    });

    const { headers } = runMiddleware(middleware, {
      method: 'GET',
      origin: 'https://evil.com',
    });

    // Even when we deny, setting Vary: Origin tells the browser cache to
    // differentiate responses by Origin — so a later allowed-origin request
    // doesn't get served the denied response.
    expect(headers['Vary']).toBe('Origin');
  });
});
