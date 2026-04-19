/**
 * Plan 03-09 Task 1 — Legacy MCP HTTP+SSE shim (TRANS-02).
 *
 * Tests the MCP 2024-11-05 SSE shim:
 *   - GET /t/:tenantId/sse opens the stream with `event: endpoint` and
 *     keeps it alive with `:\n\n` every 30s (vi fake timers).
 *   - POST /t/:tenantId/messages handles `initialize` (200 JSON-RPC) and
 *     returns 501 legacy_sse_limited_support for other methods.
 *   - SSE response headers include the Pitfall 8 mitigation set
 *     (Content-Type: text/event-stream, Cache-Control: no-cache, no-transform,
 *     Connection: keep-alive, X-Accel-Buffering: no).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createLegacySseGetHandler,
  createLegacySsePostHandler,
} from '../../src/lib/transports/legacy-sse.js';
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

function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/t/:tenantId', (req, _res, next) => {
    (req as express.Request & { tenant?: TenantRow }).tenant = {
      ...FAKE_TENANT,
      id: req.params.tenantId,
    };
    next();
  });
  const buildMcpServer = (_tenant: TenantRow) =>
    new McpServer({ name: 'test-mcp', version: '2.0.0' });
  app.get('/t/:tenantId/sse', createLegacySseGetHandler({ buildMcpServer }));
  app.post('/t/:tenantId/messages', createLegacySsePostHandler({ buildMcpServer }));
  return app;
}

describe('Legacy MCP HTTP+SSE shim (TRANS-02)', () => {
  let server: http.Server | undefined;
  let baseUrl = '';

  beforeEach(async () => {
    const app = buildApp();
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

  it('GET /t/:tenantId/sse sets SSE headers (Pitfall 8 mitigation)', async () => {
    const res = await fetch(`${baseUrl}/t/${FAKE_TENANT.id}/sse`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    expect(res.headers.get('cache-control')).toMatch(/no-transform/);
    expect(res.headers.get('connection')).toMatch(/keep-alive/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    // Drain the stream to release the connection.
    await res.body?.cancel();
  });

  it('GET /t/:tenantId/sse emits initial `event: endpoint` frame', async () => {
    const res = await fetch(`${baseUrl}/t/${FAKE_TENANT.id}/sse`);
    const reader = res.body!.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain('event: endpoint');
    expect(text).toContain(`data: /t/${FAKE_TENANT.id}/messages`);
    await reader.cancel();
  });

  it('GET /t/:tenantId/sse writes keepalive `:\\n\\n` after 30s (fake timers)', async () => {
    // Build an isolated app where we can spy on res.write directly.
    const writes: string[] = [];
    const stubApp = express();
    stubApp.use(express.json());
    stubApp.use('/t/:tenantId', (req, _res, next) => {
      (req as express.Request & { tenant?: TenantRow }).tenant = {
        ...FAKE_TENANT,
        id: req.params.tenantId,
      };
      next();
    });
    const buildMcpServer = (_tenant: TenantRow) =>
      new McpServer({ name: 'test-mcp', version: '2.0.0' });
    stubApp.get('/t/:tenantId/sse', (req, res, next) => {
      // Intercept res.write BEFORE the handler runs.
      const orig = res.write.bind(res);
      res.write = ((chunk: string | Buffer, ...rest: unknown[]): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return orig(chunk as Buffer, ...(rest as Parameters<typeof res.write>));
      }) as typeof res.write;
      createLegacySseGetHandler({ buildMcpServer })(req, res, next);
    });

    const probe = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(stubApp).listen(0, () => resolve(s));
    });
    try {
      const addr = probe.address() as AddressInfo;
      vi.useFakeTimers({ toFake: ['setInterval'] });
      const resP = fetch(`http://127.0.0.1:${addr.port}/t/${FAKE_TENANT.id}/sse`);
      const res = await resP;

      // Drain the initial `event: endpoint` frame.
      const reader = res.body!.getReader();
      await reader.read();

      // Advance 31s to fire the 30s keepalive interval at least once.
      vi.advanceTimersByTime(31_000);
      // Give the event loop a tick for the write to flush.
      vi.useRealTimers();
      await new Promise((r) => setTimeout(r, 20));

      // At least one keepalive `:\n\n` frame must have been written.
      const keepaliveWritten = writes.some((w) => w === ':\n\n');
      expect(keepaliveWritten).toBe(true);

      await reader.cancel();
    } finally {
      vi.useRealTimers();
      await new Promise<void>((r) => probe.close(() => r()));
    }
  });

  it('POST /t/:tenantId/messages with initialize returns 200 JSON-RPC response', async () => {
    const res = await fetch(`${baseUrl}/t/${FAKE_TENANT.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const body = (await res.json()) as {
      jsonrpc?: string;
      id?: number;
      result?: { protocolVersion?: string };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result?.protocolVersion).toBe('2024-11-05');
  });

  it('POST /t/:tenantId/messages with tools/list returns 501 legacy_sse_limited_support', async () => {
    const res = await fetch(`${baseUrl}/t/${FAKE_TENANT.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error?: string; hint?: string };
    expect(body.error).toBe('legacy_sse_limited_support');
  });

  it('returns 500 loadTenant_middleware_missing when req.tenant is absent', async () => {
    const noLoadApp = express();
    noLoadApp.use(express.json());
    const buildMcpServer = (_tenant: TenantRow) =>
      new McpServer({ name: 'test-mcp', version: '2.0.0' });
    noLoadApp.get('/sse', createLegacySseGetHandler({ buildMcpServer }));
    noLoadApp.post('/messages', createLegacySsePostHandler({ buildMcpServer }));

    const probe = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(noLoadApp).listen(0, () => resolve(s));
    });
    try {
      const addr = probe.address() as AddressInfo;
      const getRes = await fetch(`http://127.0.0.1:${addr.port}/sse`);
      expect(getRes.status).toBe(500);
      const getBody = (await getRes.json()) as { error?: string };
      expect(getBody.error).toBe('loadTenant_middleware_missing');

      const postRes = await fetch(`http://127.0.0.1:${addr.port}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      expect(postRes.status).toBe(500);
    } finally {
      await new Promise<void>((r) => probe.close(() => r()));
    }
  });
});
