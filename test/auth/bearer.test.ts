/**
 * Bearer middleware unit tests (plan 03-06, AUTH-03, D-13).
 *
 * Coverage of Task 1 behaviors:
 *   1. Valid tid match → sets requestContext and calls next()
 *   2. tid mismatch → 401 tenant_mismatch
 *   3. Missing tid claim → 401 invalid_token with missing_tid_claim detail
 *   4. Malformed JWT → 401 invalid_token
 *   5. No Authorization header → next() (pass-through)
 *   6. Case-insensitive tid comparison
 *   7. Signature verification failure → 401 invalid_token
 *   8. Redaction / no token in logs (Pitfall 5)
 *
 * Threat refs:
 *   - T-03-06-01 (S): forged tid
 *   - T-03-06-02 (EoP): forged token rejection
 *   - D-13: bearer validation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decodeJwt } from 'jose';
import type { Request, Response, NextFunction } from 'express';
import {
  createBearerMiddleware,
  type BearerTokenVerifier,
} from '../../src/lib/microsoft-auth.js';
import { requestContext, getRequestTokens } from '../../src/request-context.js';
import type { TenantRow } from '../../src/lib/tenant/tenant-row.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function makeJwt(payload: Record<string, unknown>): Promise<string> {
  void (await Promise.resolve());
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' }), 'utf8').toString(
    'base64url'
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${header}.${encodedPayload}.test-signature`;
}

function decodeOnlyVerifier(): BearerTokenVerifier {
  return vi.fn(async ({ token }) => decodeJwt(token));
}

function makeReqRes(
  authHeader: string | undefined,
  tenantId: string | undefined,
  tenant?: Partial<TenantRow>
): { req: Request; res: Response; next: ReturnType<typeof vi.fn> } {
  const headers: Record<string, string> = { host: 'mcp.test.local' };
  if (authHeader) headers.authorization = authHeader;
  const req = {
    protocol: 'https',
    headers,
    params: tenantId !== undefined ? { tenantId } : {},
    get(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
    tenant,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as unknown as ReturnType<typeof vi.fn>;
  return { req, res, next };
}

describe('createBearerMiddleware (AUTH-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: matches tid → calls next() and populates requestContext with flow=bearer', async () => {
    const jwt = await makeJwt({ tid: 'abc-123', sub: 'user-1' });
    const mw = createBearerMiddleware({ verifyToken: decodeOnlyVerifier() });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, 'abc-123');

    let contextTokenInsideNext: string | undefined;
    let contextFlowInsideNext: string | undefined;
    (next as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const store = getRequestTokens();
      contextTokenInsideNext = store?.accessToken;
      contextFlowInsideNext = store?.flow;
    });

    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(contextTokenInsideNext).toBe(jwt);
    expect(contextFlowInsideNext).toBe('bearer');
  });

  it('Test 2: tid mismatch → 401 tenant_mismatch, does NOT call next()', async () => {
    const jwt = await makeJwt({ tid: 'T-B' });
    const mw = createBearerMiddleware({ verifyToken: decodeOnlyVerifier() });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, 'T-A');

    await mw(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'tenant_mismatch' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('Test 3: missing tid claim → 401 invalid_token with missing_tid_claim detail', async () => {
    const jwt = await makeJwt({ sub: 'x' });
    const mw = createBearerMiddleware({ verifyToken: decodeOnlyVerifier() });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, 'any-tenant');

    await mw(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token', detail: 'missing_tid_claim' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('Test 4: malformed JWT → 401 invalid_token', async () => {
    const mw = createBearerMiddleware({ verifyToken: decodeOnlyVerifier() });
    const { req, res, next } = makeReqRes('Bearer not.a.valid.jwt', 'any-tenant');

    await mw(req, res, next as unknown as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_token' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('Test 5: no Authorization header → calls next() without populating requestContext', async () => {
    const mw = createBearerMiddleware();
    const { req, res, next } = makeReqRes(undefined, 'any-tenant');

    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('Test 6: case-insensitive tid match', async () => {
    const jwt = await makeJwt({ tid: 'T-A' });
    const mw = createBearerMiddleware({ verifyToken: decodeOnlyVerifier() });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, 't-a');

    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('Test 7: signature verification failure → 401 invalid_token', async () => {
    const jwt = await makeJwt({ tid: 'tenant-7' });
    const verifyToken = vi.fn(async () => {
      throw new Error('signature verification failed');
    });
    const mw = createBearerMiddleware({ verifyToken });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, 'tenant-7');

    await mw(req, res, next as unknown as NextFunction);

    expect(verifyToken).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_token' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('Test 8: redaction — raw token NOT logged on success or failure', async () => {
    const logger = (await import('../../src/logger.js')).default as unknown as Record<
      string,
      ReturnType<typeof vi.fn>
    >;

    // Happy-path token — verify it never surfaces in any logger call.
    const happyToken = await makeJwt({ tid: 'T-OK' });
    const verifyToken = vi.fn(async ({ token }) => {
      if (token === happyToken) return decodeJwt(token);
      throw new Error('signature verification failed');
    });
    const mw = createBearerMiddleware({ verifyToken });
    const happyReqRes = makeReqRes(`Bearer ${happyToken}`, 'T-OK');
    await mw(happyReqRes.req, happyReqRes.res, happyReqRes.next as unknown as NextFunction);

    // Malformed path — same assertion.
    const badReqRes = makeReqRes('Bearer malformed.jwt.here', 'T-OK');
    await mw(badReqRes.req, badReqRes.res, badReqRes.next as unknown as NextFunction);

    const joined: string[] = [];
    for (const fn of Object.values(logger)) {
      if (typeof fn !== 'function' || !('mock' in fn)) continue;
      for (const call of fn.mock.calls) {
        for (const arg of call) {
          if (typeof arg === 'string') joined.push(arg);
          else {
            try {
              joined.push(JSON.stringify(arg));
            } catch {
              joined.push(String(arg));
            }
          }
        }
      }
    }
    const all = joined.join('\n');
    expect(all).not.toContain(happyToken);
    // The malformed string contains 'malformed' — assert the full raw token
    // doesn't leak. (The decode-failed branch logs only (err.message).)
    expect(all).not.toContain('malformed.jwt.here');
  });

  it('Test 9: bearer without tenant-scoped route → 400 bearer_requires_tenant_context', async () => {
    const jwt = await makeJwt({ tid: 'abc-123' });
    const verifyToken = decodeOnlyVerifier();
    const mw = createBearerMiddleware({ verifyToken });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, undefined);

    await mw(req, res, next as unknown as NextFunction);

    expect(verifyToken).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'bearer_requires_tenant_context' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  // ── WWW-Authenticate header (RFC 9728 / MCP 2025-06-18) ────────────────
  // Each 401 emit site MUST set the WWW-Authenticate header pointing at
  // the OAuth Protected Resource Metadata document so MCP clients can
  // discover the auth flow. Without this header, Claude.ai-style
  // connectors fail with "Couldn't reach the MCP server".

  it('Test 10: missing tid claim → 401 sets WWW-Authenticate with resource_metadata', async () => {
    const jwt = await makeJwt({ sub: 'no-tid' });
    const mw = createBearerMiddleware({ verifyToken: decodeOnlyVerifier() });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, 'tenant-x');

    await mw(req, res, next as unknown as NextFunction);

    expect(res.set).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringMatching(
        /^Bearer .*resource_metadata=".+\/\.well-known\/oauth-protected-resource"/
      )
    );
    const headerValue = (res.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(headerValue).toContain('/t/tenant-x/.well-known/oauth-protected-resource');
    expect(headerValue).toContain('error="invalid_token"');
  });

  it('Test 11: malformed JWT → 401 sets WWW-Authenticate', async () => {
    const mw = createBearerMiddleware({ verifyToken: decodeOnlyVerifier() });
    const { req, res, next } = makeReqRes('Bearer not.a.jwt', 'tenant-y');

    await mw(req, res, next as unknown as NextFunction);

    const headerValue = (res.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(headerValue).toMatch(/^Bearer /);
    expect(headerValue).toContain('/t/tenant-y/.well-known/oauth-protected-resource');
    expect(headerValue).toContain('error="invalid_token"');
  });

  it('Test 12: tenant_mismatch → 401 sets WWW-Authenticate with URL tenantId (not the JWT tid)', async () => {
    const jwt = await makeJwt({ tid: 'jwt-tid' });
    const mw = createBearerMiddleware({ verifyToken: decodeOnlyVerifier() });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, 'url-tid');

    await mw(req, res, next as unknown as NextFunction);

    const headerValue = (res.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(headerValue).toContain('/t/url-tid/.well-known/oauth-protected-resource');
    expect(headerValue).not.toContain('/t/jwt-tid/');
  });

  it('Test 13: tenant row Azure tenant_id is authoritative over route id', async () => {
    const jwt = await makeJwt({ tid: 'azure-tenant-id' });
    const verifyToken = vi.fn(async ({ tenantId }) => {
      expect(tenantId).toBe('azure-tenant-id');
      return decodeJwt(jwt);
    });
    const mw = createBearerMiddleware({ verifyToken });
    const { req, res, next } = makeReqRes(`Bearer ${jwt}`, 'registry-route-id', {
      id: 'registry-route-id',
      tenant_id: 'azure-tenant-id',
      client_id: 'client-id',
      cloud_type: 'global',
    });

    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

// Ensure the tests consume requestContext so vitest treats the asyncstorage
// export as exercised.
void requestContext;
