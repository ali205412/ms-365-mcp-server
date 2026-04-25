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

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeMw() {
  return createAuthSelectorMiddleware({
    tenantPool: {
      acquire: vi.fn(),
      buildCachePlugin: vi.fn(),
    } as never,
  });
}

function makeReqRes(opts: {
  authHeader?: string;
  tenant?: { id: string; mode: string; allowed_scopes?: string[] };
}) {
  const headers: Record<string, string> = { host: 'mcp.test.local' };
  if (opts.authHeader) headers.authorization = opts.authHeader;
  const req = {
    protocol: 'https',
    headers,
    params: opts.tenant ? { tenantId: opts.tenant.id } : {},
    tenant: opts.tenant
      ? { ...opts.tenant, allowed_scopes: opts.tenant.allowed_scopes ?? [] }
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
