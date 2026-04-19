/**
 * App-only (client credentials) flow integration test (plan 03-06, AUTH-02).
 *
 * Covers:
 *   - authSelector picks app-only when tenant.mode='app-only' and no Authorization header
 *   - MSAL client.acquireTokenByClientCredential called with scopes=['.default']
 *   - requestContext.flow='app-only' during downstream handler execution
 *   - Fresh cache plugin built with userOid='appOnly'
 *   - 502 on MSAL acquire failure
 *
 * Uses MemoryRedisFacade + mocked MSAL — no testcontainers-pg needed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { generateTenantDek } from '../../src/lib/crypto/dek.js';
import type { TenantRow } from '../../src/lib/tenant/tenant-row.js';
import { getRequestTokens } from '../../src/request-context.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const KEK = crypto.randomBytes(32);

function makeTenant(overrides: Partial<TenantRow> = {}): TenantRow {
  const { wrappedDek } = generateTenantDek(KEK);
  return {
    id: overrides.id ?? crypto.randomUUID(),
    mode: overrides.mode ?? 'app-only',
    client_id: overrides.client_id ?? 'app-client-id',
    client_secret_ref: overrides.client_secret_ref ?? 'env:SECRET',
    client_secret_resolved: overrides.client_secret_resolved ?? 'resolved-secret',
    tenant_id: overrides.tenant_id ?? 'tenant-guid',
    cloud_type: overrides.cloud_type ?? 'global',
    redirect_uri_allowlist: overrides.redirect_uri_allowlist ?? [],
    cors_origins: overrides.cors_origins ?? [],
    allowed_scopes: overrides.allowed_scopes ?? [],
    enabled_tools: overrides.enabled_tools ?? null,
    wrapped_dek: overrides.wrapped_dek === undefined ? wrappedDek : overrides.wrapped_dek,
    slug: overrides.slug ?? null,
    disabled_at: overrides.disabled_at ?? null,
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
  };
}

interface AppHarness {
  url: string;
  close: () => Promise<void>;
  tenant: TenantRow;
  capturedFlow: { value: string | undefined };
  mockAcquireByCredential: ReturnType<typeof vi.fn>;
  mockBuildCachePlugin: ReturnType<typeof vi.fn>;
}

async function startApp(
  options: {
    tenant?: Partial<TenantRow>;
    acquireImpl?: () => Promise<{ accessToken: string } | null>;
  } = {}
): Promise<AppHarness> {
  const redis = new MemoryRedisFacade();
  void redis;
  const tenant = makeTenant(options.tenant);

  const acquireImpl =
    options.acquireImpl ??
    (async () => ({
      accessToken: 'app-only-token-abc',
      expiresOn: new Date(Date.now() + 3600 * 1000),
    }));

  const mockAcquireByCredential = vi.fn(acquireImpl);
  const mockClient = {
    acquireTokenByClientCredential: mockAcquireByCredential,
  };
  const mockBuildCachePlugin = vi.fn(() => ({
    beforeCacheAccess: vi.fn(),
    afterCacheAccess: vi.fn(),
  }));
  const mockTenantPool = {
    acquire: vi.fn(async () => mockClient),
    buildCachePlugin: mockBuildCachePlugin,
    evict: vi.fn(),
  };

  const { createAuthSelectorMiddleware } = await import(
    '../../src/lib/auth-selector.js'
  );

  const app = express();
  app.use(express.json());

  // loadTenant stub
  const loadTenantStub = (req: Request, _res: Response, next: NextFunction): void => {
    (req as Request & { tenant?: TenantRow }).tenant = tenant;
    if (!req.params) (req as Request & { params: Record<string, string> }).params = {};
    (req as Request & { params: Record<string, string> }).params.tenantId = '_';
    next();
  };

  const capturedFlow: { value: string | undefined } = { value: undefined };

  app.post(
    '/mcp',
    loadTenantStub,
    createAuthSelectorMiddleware({
      tenantPool: mockTenantPool as unknown as Parameters<
        typeof createAuthSelectorMiddleware
      >[0]['tenantPool'],
    }),
    (_req: Request, res: Response) => {
      const ctx = getRequestTokens();
      capturedFlow.value = ctx?.flow;
      res.status(200).json({
        ok: true,
        flow: ctx?.flow,
        hasToken: !!ctx?.accessToken,
      });
    }
  );

  return await new Promise((resolve) => {
    const server = http.createServer(app).listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        tenant,
        capturedFlow,
        mockAcquireByCredential,
        mockBuildCachePlugin,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

describe('App-only (client credentials) flow (AUTH-02)', () => {
  let harness: AppHarness | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (harness) {
      await harness.close();
      harness = undefined;
    }
  });

  it('Test 1: app-only tenant → MSAL acquireTokenByClientCredential called with .default', async () => {
    harness = await startApp();

    const res = await fetch(`${harness.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });

    expect(res.status).toBe(200);
    expect(harness.mockAcquireByCredential).toHaveBeenCalledTimes(1);
    const args = harness.mockAcquireByCredential.mock.calls[0]![0] as {
      scopes: string[];
    };
    expect(args.scopes).toContain('https://graph.microsoft.com/.default');
  });

  it('Test 2: requestContext.flow = "app-only" during downstream handler execution', async () => {
    harness = await startApp();

    const res = await fetch(`${harness.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { flow: string; hasToken: boolean };
    expect(body.flow).toBe('app-only');
    expect(body.hasToken).toBe(true);
    expect(harness.capturedFlow.value).toBe('app-only');
  });

  it('Test 3: buildCachePlugin called with userOid="appOnly"', async () => {
    harness = await startApp();

    await fetch(`${harness.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });

    expect(harness.mockBuildCachePlugin).toHaveBeenCalled();
    const call = harness.mockBuildCachePlugin.mock.calls[0]!;
    // signature: (tenantId, userOid, scopes)
    expect(call[1]).toBe('appOnly');
  });

  it('Test 4: MSAL acquire failure → 502 app_only_acquire_failed', async () => {
    harness = await startApp({
      acquireImpl: async () => ({ accessToken: '' }) as unknown as { accessToken: string },
    });

    const res = await fetch(`${harness.url}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('app_only_acquire_failed');
  });

  it('Test 5: Authorization: Bearer header present → selector delegates to bearer middleware (not app-only)', async () => {
    harness = await startApp();

    // A bearer header WITHOUT a correctly-shaped JWT should bypass the app-only
    // branch but be rejected by bearer middleware (malformed → 401).
    const res = await fetch(`${harness.url}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer not.a.valid.jwt',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });

    // bearer middleware handled it (401 invalid_token), app-only MSAL was NOT called
    expect(res.status).toBe(401);
    expect(harness.mockAcquireByCredential).not.toHaveBeenCalled();
  });
});
