/**
 * Plan 06-03 Task 1 — createBearerAuthMiddleware unit tests.
 *
 * Covers the optional-Bearer gate pattern from D-02:
 *   - null/empty bearerToken = OPEN endpoint (dev / localhost / reverse-proxy trust)
 *   - set bearerToken = every request must carry Authorization: Bearer {token}
 *   - Comparison uses crypto.timingSafeEqual (T-06-03-a timing-oracle mitigation)
 *   - 401 responses carry WWW-Authenticate: Bearer per RFC 6750
 *
 * Tests spin up a real ephemeral Express server on port 0 so the middleware is
 * exercised through the full request pipeline (header parsing, status codes,
 * response headers) rather than mocked Request/Response objects — aligns with
 * test/oauth-register-hardening.test.ts pattern.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createBearerAuthMiddleware } from '../../../src/lib/metrics-server/bearer-auth.js';

async function spinUp(middleware: express.RequestHandler): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.get('/protected', middleware, (_req, res) => {
    res.status(200).send('ok');
  });
  const server = await new Promise<http.Server>((resolve) => {
    const s = http.createServer(app).listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
      }),
  };
}

describe('plan 06-03 — createBearerAuthMiddleware', () => {
  it('null token: endpoint is open — request with no Authorization returns 200', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware(null));
    try {
      const res = await fetch(`${url}/protected`);
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('undefined token: endpoint is open (absent env var)', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware(undefined));
    try {
      const res = await fetch(`${url}/protected`);
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('empty-string token: endpoint is open (MS365_MCP_METRICS_BEARER= no value)', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware(''));
    try {
      const res = await fetch(`${url}/protected`);
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('token set + no Authorization header: 401 + WWW-Authenticate: Bearer', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware('secret-token-123'));
    try {
      const res = await fetch(`${url}/protected`);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
    } finally {
      await close();
    }
  });

  it('token set + wrong Bearer: 401 + WWW-Authenticate: Bearer', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware('secret-token-123'));
    try {
      const res = await fetch(`${url}/protected`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
    } finally {
      await close();
    }
  });

  it('token set + correct Bearer: 200', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware('secret-token-123'));
    try {
      const res = await fetch(`${url}/protected`, {
        headers: { Authorization: 'Bearer secret-token-123' },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('ok');
    } finally {
      await close();
    }
  });

  it('malformed Authorization (no Bearer prefix): 401', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware('secret-token-123'));
    try {
      const res = await fetch(`${url}/protected`, {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('length-mismatched Bearer does NOT throw (defensive length check before timingSafeEqual)', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware('secret-token-123'));
    try {
      // Shorter token — timingSafeEqual would throw without the length pre-check
      const short = await fetch(`${url}/protected`, {
        headers: { Authorization: 'Bearer abc' },
      });
      expect(short.status).toBe(401);
      // Longer token — same defensive short-circuit path
      const long = await fetch(`${url}/protected`, {
        headers: {
          Authorization:
            'Bearer much-longer-than-the-configured-secret-token-123-that-is-expected',
        },
      });
      expect(long.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('case-insensitive header lookup — lowercase authorization works (Node http normalizes)', async () => {
    const { url, close } = await spinUp(createBearerAuthMiddleware('secret-token-123'));
    try {
      const res = await fetch(`${url}/protected`, {
        headers: { authorization: 'Bearer secret-token-123' },
      });
      expect(res.status).toBe(200);
    } finally {
      await close();
    }
  });
});
