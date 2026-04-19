/**
 * Plan 03-09 Task 1 — Streamable HTTP transport handler (TRANS-01).
 *
 * Tests the createStreamableHttpHandler factory. Mounted at
 * /t/:tenantId/mcp (GET+POST), stateless (sessionIdGenerator: undefined).
 *
 * Each request builds a fresh McpServer scoped to req.tenant via the
 * injected buildMcpServer factory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createStreamableHttpHandler } from '../../src/lib/transports/streamable-http.js';
import type { TenantRow } from '../../src/lib/tenant/tenant-row.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const FAKE_TENANT: TenantRow = {
  id: 'aaaaaaaa-1111-2222-3333-444444444444',
  mode: 'delegated',
  client_id: 'fake-client',
  client_secret_ref: null,
  tenant_id: 'aaaaaaaa-1111-2222-3333-444444444444',
  cloud_type: 'global',
  redirect_uri_allowlist: [],
  cors_origins: [],
  allowed_scopes: ['User.Read'],
  enabled_tools: null,
  wrapped_dek: null,
  slug: null,
  disabled_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

function buildTestMcpServer(): McpServer {
  // Minimal McpServer — we rely on the SDK's built-in initialize handler.
  return new McpServer({ name: 'test-mcp', version: '2.0.0' });
}

describe('Streamable HTTP transport (TRANS-01)', () => {
  let server: http.Server | undefined;
  let baseUrl = '';
  let buildMcpServer: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    buildMcpServer = vi.fn((_tenant: TenantRow) => buildTestMcpServer());
    const handler = createStreamableHttpHandler({ buildMcpServer });

    const app = express();
    app.use(express.json());
    // Stub loadTenant: populate req.tenant from the URL param.
    app.use('/t/:tenantId', (req, _res, next) => {
      (req as express.Request & { tenant?: TenantRow }).tenant = {
        ...FAKE_TENANT,
        id: req.params.tenantId,
      };
      next();
    });
    app.post('/t/:tenantId/mcp', handler);
    app.get('/t/:tenantId/mcp', handler);

    await new Promise<void>((resolve) => {
      server = http.createServer(app).listen(0, () => {
        const { port } = server!.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
    vi.restoreAllMocks();
  });

  it('POST /t/:tenantId/mcp with initialize returns MCP-shaped JSON-RPC response', async () => {
    const res = await fetch(`${baseUrl}/t/${FAKE_TENANT.id}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });

    expect(res.status).toBe(200);
    // Streamable HTTP can respond with either JSON or SSE — both are valid
    // per the MCP spec. We accept either.
    const contentType = res.headers.get('content-type') ?? '';

    let body: { jsonrpc?: string; id?: number; result?: { protocolVersion?: string } };
    if (contentType.includes('application/json')) {
      body = (await res.json()) as typeof body;
    } else {
      // SSE-encoded response: first "data:" line contains the JSON-RPC frame.
      const text = await res.text();
      const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
      expect(dataLine).toBeDefined();
      body = JSON.parse(dataLine!.slice(5).trim()) as typeof body;
    }

    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result).toBeDefined();
    expect(body.result!.protocolVersion).toBeDefined();
  });

  it('buildMcpServer is invoked with the tenant populated by loadTenant', async () => {
    await fetch(`${baseUrl}/t/${FAKE_TENANT.id}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 2,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      }),
    });

    expect(buildMcpServer).toHaveBeenCalled();
    const tenantArg = buildMcpServer.mock.calls[0]?.[0] as TenantRow;
    expect(tenantArg).toBeDefined();
    expect(tenantArg.id).toBe(FAKE_TENANT.id);
  });

  it('returns 500 loadTenant_middleware_missing when req.tenant is absent', async () => {
    // Separate app that skips the loadTenant stub — handler should refuse.
    const noLoadApp = express();
    noLoadApp.use(express.json());
    const handler = createStreamableHttpHandler({ buildMcpServer });
    noLoadApp.post('/mcp', handler); // No /t/:tenantId prefix → no req.tenant

    const probeServer = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(noLoadApp).listen(0, () => resolve(s));
    });
    try {
      const addr = probeServer.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${addr.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 3 }),
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toBe('loadTenant_middleware_missing');
    } finally {
      await new Promise<void>((r) => probeServer.close(() => r()));
    }
  });

  it('two requests with different tenants build two distinct McpServer instances', async () => {
    const tenant1 = 'aaaaaaaa-1111-2222-3333-444444444444';
    const tenant2 = 'bbbbbbbb-5555-6666-7777-888888888888';

    const body = (id: number) =>
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      });

    await fetch(`${baseUrl}/t/${tenant1}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: body(1),
    });
    await fetch(`${baseUrl}/t/${tenant2}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: body(2),
    });

    expect(buildMcpServer).toHaveBeenCalledTimes(2);
    const firstTenantArg = buildMcpServer.mock.calls[0]?.[0] as TenantRow;
    const secondTenantArg = buildMcpServer.mock.calls[1]?.[0] as TenantRow;
    expect(firstTenantArg.id).toBe(tenant1);
    expect(secondTenantArg.id).toBe(tenant2);
    expect(firstTenantArg).not.toBe(secondTenantArg);
  });
});
