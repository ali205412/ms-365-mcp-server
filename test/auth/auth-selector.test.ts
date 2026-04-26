/**
 * authSelector middleware — WWW-Authenticate emission on 401 paths.
 *
 * The two paths covered here are the auth-selector-owned 401s:
 *   3. tenant.mode === 'delegated' without prior authorize → 401
 *   4. tenant.mode === 'bearer' without Authorization header → 401
 *
 * Both must emit `WWW-Authenticate: Bearer ... resource_metadata=...`
 * pointing at the per-tenant /.well-known/oauth-protected-resource so
 * MCP clients (Claude.ai connectors) can discover the auth flow.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createAuthSelectorMiddleware } from '../../src/lib/auth-selector.js';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import {
  delegatedAccessTokenTtlSeconds,
  rememberDelegatedAccessToken,
} from '../../src/lib/delegated-access-tokens.js';
import { SessionStore } from '../../src/lib/session-store.js';
import { getRequestTokens } from '../../src/request-context.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeMw(
  options: {
    redis?: MemoryRedisFacade;
    bearerVerifier?: Parameters<typeof createAuthSelectorMiddleware>[0]['bearerVerifier'];
  } = {}
) {
  const dek = Buffer.alloc(32, 7);
  return createAuthSelectorMiddleware({
    tenantPool: {
      acquire: vi.fn(),
      buildCachePlugin: vi.fn(),
      getDekForTenant: vi.fn(() => dek),
    } as never,
    redis: options.redis,
    bearerVerifier: options.bearerVerifier,
  });
}

function makeReqRes(opts: {
  authHeader?: string;
  tenant?: { id: string; mode: string; client_id?: string; allowed_scopes?: string[] };
}) {
  const headers: Record<string, string> = { host: 'mcp.test.local' };
  if (opts.authHeader) headers.authorization = opts.authHeader;
  const req = {
    protocol: 'https',
    headers,
    params: opts.tenant ? { tenantId: opts.tenant.id } : {},
    tenant: opts.tenant
      ? {
          ...opts.tenant,
          client_id: opts.tenant.client_id ?? 'client-id',
          allowed_scopes: opts.tenant.allowed_scopes ?? [],
        }
      : undefined,
    get(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe('createAuthSelectorMiddleware — WWW-Authenticate (RFC 9728)', () => {
  it('delegated mode with server-issued bearer marker → flow=delegated without strict JWT verifier', async () => {
    const redis = new MemoryRedisFacade();
    const token = 'opaque-microsoft-graph-access-token';
    const sessionStore = new SessionStore(redis, Buffer.alloc(32, 7));
    await sessionStore.put('tenant-d', token, {
      tenantId: 'tenant-d',
      clientId: 'delegated-client',
      scopes: ['User.Read'],
      graphAccessToken: 'current-graph-access-token',
      createdAt: Date.now(),
    });
    await rememberDelegatedAccessToken({
      redis,
      tenantId: 'tenant-d',
      accessToken: token,
      expiresOn: new Date(Date.now() + 3600_000),
    });
    const bearerVerifier = vi.fn(async () => {
      throw new Error('strict verifier should not run for issued delegated token');
    });
    const mw = makeMw({ redis, bearerVerifier });
    const { req, res, next } = makeReqRes({
      authHeader: `Bearer ${token}`,
      tenant: { id: 'tenant-d', mode: 'delegated', client_id: 'delegated-client' },
    });

    let contextTokenInsideNext: string | undefined;
    let contextFlowInsideNext: string | undefined;
    let contextClientIdInsideNext: string | undefined;
    let contextClientTokenInsideNext: string | undefined;
    (next as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const ctx = getRequestTokens();
      contextTokenInsideNext = ctx?.accessToken;
      contextFlowInsideNext = ctx?.flow;
      contextClientIdInsideNext = ctx?.authClientId;
      contextClientTokenInsideNext = ctx?.clientAccessToken;
    });

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(bearerVerifier).not.toHaveBeenCalled();
    expect(contextTokenInsideNext).toBe('current-graph-access-token');
    expect(contextClientTokenInsideNext).toBe(token);
    expect(contextFlowInsideNext).toBe('delegated');
    expect(contextClientIdInsideNext).toBe('delegated-client');
  });

  it('delegated admission TTL follows server session TTL, not one-hour Graph token expiry', () => {
    const previousDelegatedTtl = process.env.MS365_MCP_DELEGATED_ACCESS_TTL_SECONDS;
    const previousSessionTtl = process.env.MS365_MCP_SESSION_TTL_SECONDS;
    try {
      delete process.env.MS365_MCP_DELEGATED_ACCESS_TTL_SECONDS;
      delete process.env.MS365_MCP_SESSION_TTL_SECONDS;
      expect(delegatedAccessTokenTtlSeconds()).toBe(14 * 24 * 60 * 60);

      process.env.MS365_MCP_SESSION_TTL_SECONDS = '7200';
      expect(delegatedAccessTokenTtlSeconds()).toBe(7200);

      process.env.MS365_MCP_DELEGATED_ACCESS_TTL_SECONDS = '9000';
      expect(delegatedAccessTokenTtlSeconds()).toBe(9000);
    } finally {
      if (previousDelegatedTtl === undefined)
        delete process.env.MS365_MCP_DELEGATED_ACCESS_TTL_SECONDS;
      else process.env.MS365_MCP_DELEGATED_ACCESS_TTL_SECONDS = previousDelegatedTtl;
      if (previousSessionTtl === undefined) delete process.env.MS365_MCP_SESSION_TTL_SECONDS;
      else process.env.MS365_MCP_SESSION_TTL_SECONDS = previousSessionTtl;
    }
  });

  it('delegated mode with unmarked bearer → falls back to bearer verifier', async () => {
    const redis = new MemoryRedisFacade();
    const bearerVerifier = vi.fn(async () => ({ tid: 'tenant-d' }));
    const mw = makeMw({ redis, bearerVerifier });
    const { req, res, next } = makeReqRes({
      authHeader: 'Bearer direct-bearer-token',
      tenant: { id: 'tenant-d', mode: 'delegated', tenant_id: 'tenant-d' } as never,
    });

    await mw(req, res, next);

    expect(bearerVerifier).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('delegated mode without bearer → 401 + WWW-Authenticate pointing at per-tenant resource metadata', async () => {
    const mw = makeMw();
    const { req, res, next } = makeReqRes({
      tenant: { id: 'tenant-d', mode: 'delegated' },
    });

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'delegated_flow_requires_prior_authorize' })
    );
    const headerValue = (res.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(headerValue).toMatch(/^Bearer /);
    expect(headerValue).toContain('/t/tenant-d/.well-known/oauth-protected-resource');
    expect(headerValue).toContain('error="invalid_token"');
    expect(next).not.toHaveBeenCalled();
  });

  it('bearer mode without bearer → 401 + WWW-Authenticate pointing at per-tenant resource metadata', async () => {
    const mw = makeMw();
    const { req, res, next } = makeReqRes({
      tenant: { id: 'tenant-b', mode: 'bearer' },
    });

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'bearer_token_required' })
    );
    const headerValue = (res.set as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(headerValue).toMatch(/^Bearer /);
    expect(headerValue).toContain('/t/tenant-b/.well-known/oauth-protected-resource');
    expect(next).not.toHaveBeenCalled();
  });

  it('loadTenant missing → 500 (no WWW-Authenticate emitted; not an auth failure)', async () => {
    const mw = makeMw();
    const { req, res, next } = makeReqRes({});

    await mw(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.set).not.toHaveBeenCalledWith('WWW-Authenticate', expect.anything());
    expect(next).not.toHaveBeenCalled();
  });
});
