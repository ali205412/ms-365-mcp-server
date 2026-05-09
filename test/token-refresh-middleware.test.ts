/**
 * Tests for TokenRefreshMiddleware (Plan 02-01, innermost middleware).
 *
 * Preserves v1 401-refresh semantics extracted from src/graph-client.ts:
 *   - Non-401 responses pass through without touching the refresh path.
 *   - On 401 + refresh token available via RequestContext, call
 *     refreshAccessToken(), swap the Authorization header in-place, retry
 *     next() exactly once, and return whichever response (200 or the
 *     propagated 401 if no refresh token) we got.
 *
 * Logger + microsoft-auth are mocked to prove the middleware never logs a
 * bearer token (T-02-01c) and that refreshAccessToken is called with the
 * exact argument contract (refreshToken, clientId, clientSecret, tenantId,
 * cloudType) documented in src/lib/microsoft-auth.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock() is hoisted to the top of the file, so any variable it references
// must be declared inside vi.hoisted() so it is initialised before the mock
// factory runs. Pattern from Vitest docs: https://vitest.dev/api/vi.html#vi-hoisted
const { refreshSpy, sessionRefreshSpy, rememberDelegatedSpy, getRedisSpy, getTenantPoolSpy } =
  vi.hoisted(() => ({
    refreshSpy: vi.fn(),
    sessionRefreshSpy: vi.fn(),
    rememberDelegatedSpy: vi.fn(),
    getRedisSpy: vi.fn(),
    getTenantPoolSpy: vi.fn(),
  }));

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/lib/microsoft-auth.js', () => ({
  refreshAccessToken: refreshSpy,
}));

vi.mock('../src/lib/session-refresh.js', () => ({
  refreshSessionAndRetry: sessionRefreshSpy,
}));

vi.mock('../src/lib/delegated-access-tokens.js', () => ({
  rememberDelegatedAccessToken: rememberDelegatedSpy,
}));

vi.mock('../src/lib/redis.js', () => ({
  getRedis: getRedisSpy,
}));

vi.mock('../src/lib/tenant/tenant-pool.js', () => ({
  getTenantPool: getTenantPoolSpy,
}));

import { TokenRefreshMiddleware } from '../src/lib/middleware/token-refresh.js';
import type { GraphRequest } from '../src/lib/middleware/types.js';

function mkReq(): GraphRequest {
  return {
    url: 'https://graph.microsoft.com/v1.0/me',
    method: 'GET',
    headers: { Authorization: 'Bearer old' },
  };
}

const authManager = {} as unknown as Parameters<typeof TokenRefreshMiddleware>[0];
const secrets = {
  clientId: 'test-client',
  tenantId: 'test-tenant',
  clientSecret: undefined,
  cloudType: 'global' as const,
};

describe('TokenRefreshMiddleware', () => {
  beforeEach(() => {
    refreshSpy.mockReset();
    sessionRefreshSpy.mockReset();
    rememberDelegatedSpy.mockReset();
    getRedisSpy.mockReset();
    getTenantPoolSpy.mockReset();
  });

  it('non-401 passes through unchanged (no refresh attempted)', async () => {
    const mw = new TokenRefreshMiddleware(
      authManager,
      secrets as Parameters<typeof TokenRefreshMiddleware>[1]
    );
    const next = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    const res = await mw.execute(mkReq(), next);

    expect(res.status).toBe(200);
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('401 triggers refresh and retries once; returns 200 on second attempt', async () => {
    refreshSpy.mockResolvedValueOnce({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    });
    const mw = new TokenRefreshMiddleware(
      authManager,
      secrets as Parameters<typeof TokenRefreshMiddleware>[1]
    );

    let callCount = 0;
    const next = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1
        ? new Response(null, { status: 401 })
        : new Response(null, { status: 200 });
    });

    // HTTP mode supplies the refresh token via AsyncLocalStorage.
    const { requestContext } = await import('../src/request-context.js');
    const req = mkReq();
    const res = await requestContext.run({ refreshToken: 'oldRefresh' }, () =>
      mw.execute(req, next)
    );

    expect(res.status).toBe(200);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(
      'oldRefresh',
      'test-client',
      undefined,
      'test-tenant',
      'global'
    );
    expect(next).toHaveBeenCalledTimes(2);
    // Bearer token swapped in place before the retry.
    expect(req.headers.Authorization).toBe('Bearer new-access-token');
  });

  it('401 delegated context uses server-side session refresh and retries once', async () => {
    const redis = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
    const tenantPool = { acquire: vi.fn(), getDekForTenant: vi.fn() };
    getRedisSpy.mockReturnValue(redis);
    getTenantPoolSpy.mockReturnValue(tenantPool);
    sessionRefreshSpy.mockResolvedValueOnce({
      accessToken: 'new-delegated-access-token',
      expiresOn: new Date(Date.now() + 3600_000),
    });
    rememberDelegatedSpy.mockResolvedValueOnce(undefined);

    const mw = new TokenRefreshMiddleware(
      authManager,
      secrets as Parameters<typeof TokenRefreshMiddleware>[1]
    );

    let callCount = 0;
    const next = vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1
        ? new Response(null, { status: 401 })
        : new Response(null, { status: 200 });
    });

    const tenantRow = { id: 'tenant-id', mode: 'delegated' };
    const { requestContext } = await import('../src/request-context.js');
    const req = mkReq();
    const res = await requestContext.run(
      {
        flow: 'delegated',
        accessToken: 'old-delegated-access-token',
        clientAccessToken: 'stable-client-access-token',
        tenantRow: tenantRow as never,
      },
      () => mw.execute(req, next)
    );

    expect(res.status).toBe(200);
    expect(sessionRefreshSpy).toHaveBeenCalledWith({
      tenant: tenantRow,
      oldAccessToken: 'stable-client-access-token',
      tenantPool,
      redis,
    });
    expect(rememberDelegatedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        redis,
        tenantId: 'tenant-id',
        accessToken: 'stable-client-access-token',
      })
    );
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(2);
    expect(req.headers.Authorization).toBe('Bearer new-delegated-access-token');
  });
});
