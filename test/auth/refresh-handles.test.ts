import { describe, expect, it } from 'vitest';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { SessionStore } from '../../src/lib/session-store.js';
import {
  consumeGatewayRefreshSession,
  mintGatewayRefreshToken,
  storeGatewayRefreshToken,
} from '../../src/lib/oauth/refresh-handles.js';

describe('opaque gateway refresh handles', () => {
  it('stores only an access-token hash in the refresh index', async () => {
    const redis = new MemoryRedisFacade();
    const tenantId = 'tenant-refresh-hash';
    const accessToken = 'access-token-plaintext-never-store';
    const refreshToken = mintGatewayRefreshToken();
    const sessionStore = new SessionStore(redis, Buffer.alloc(32, 7));

    await sessionStore.put(tenantId, accessToken, {
      tenantId,
      refreshToken: 'microsoft-refresh-token-secret',
      clientId: 'client-1',
      scopes: ['User.Read'],
      createdAt: Date.now(),
    });
    await storeGatewayRefreshToken({ redis, tenantId, refreshToken, accessToken });

    const keys = await redis.keys(`mcp:refresh:${tenantId}:*`);
    expect(keys).toHaveLength(1);
    const raw = await redis.get(keys[0]);
    expect(raw).toBeTruthy();
    expect(raw).not.toContain(accessToken);
    expect(raw).not.toContain('microsoft-refresh-token-secret');
    expect(JSON.parse(raw!)).toEqual({ accessTokenHash: expect.any(String) });
  });

  it('consumes a gateway refresh token exactly once', async () => {
    const redis = new MemoryRedisFacade();
    const tenantId = 'tenant-refresh-consume';
    const accessToken = 'access-token-single-use';
    const refreshToken = mintGatewayRefreshToken();
    const sessionStore = new SessionStore(redis, Buffer.alloc(32, 8));

    await sessionStore.put(tenantId, accessToken, {
      tenantId,
      refreshToken: 'microsoft-refresh-token-secret',
      clientId: 'client-1',
      scopes: ['User.Read'],
      createdAt: Date.now(),
    });
    await storeGatewayRefreshToken({ redis, tenantId, refreshToken, accessToken });

    const first = await consumeGatewayRefreshSession({
      redis,
      sessionStore,
      tenantId,
      refreshToken,
    });
    const second = await consumeGatewayRefreshSession({
      redis,
      sessionStore,
      tenantId,
      refreshToken,
    });

    expect(first?.record.clientId).toBe('client-1');
    expect(second).toBeNull();
  });
});
