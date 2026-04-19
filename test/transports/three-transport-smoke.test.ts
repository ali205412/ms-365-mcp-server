/**
 * Plan 03-09 Task 3 — three-transport smoke (TRANS-05, ROADMAP SC#3 transport
 * portion).
 *
 * The SC#3 signal for transports is "one server instance serves a tool call
 * over streamable HTTP AND SSE AND stdio in the same test run". This file
 * drives the two HTTP-layer transports end-to-end against the harness from
 * `test/integration/three-transports.ts`:
 *
 *   - Streamable HTTP at POST /t/:tenantId/mcp     → initialize round-trip
 *   - Legacy SSE        at GET  /t/:tenantId/sse   → initial `event: endpoint`
 *   - Legacy SSE POST   at POST /t/:tenantId/messages → initialize (200) /
 *                                                    tools/list (501)
 *
 * The stdio transport is covered by `test/transports/stdio-tenant.test.ts`
 * (unit-level — vitest process spawn + stdin fixtures are too heavy for a
 * smoke run). SC#3 stdio verification is the manual entry in 03-VALIDATION.md
 * "Manual-Only Verifications".
 *
 * Pitfall 3 check: the test also asserts that a POST to /mcp does NOT return
 * an SSE content-type (proves /mcp and /sse handlers are not being collapsed
 * by Express 5 route matching).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  bootstrapThreeTransportServer,
  type ThreeTransportHarness,
} from '../integration/three-transports.js';

describe('three-transport smoke (TRANS-05, SC#3 transports)', () => {
  let harness: ThreeTransportHarness;

  beforeAll(async () => {
    harness = await bootstrapThreeTransportServer();
  });

  afterAll(async () => {
    if (harness) {
      await harness.cleanup();
    }
  });

  it('Streamable HTTP: POST /t/:id/mcp initialize returns MCP response', async () => {
    const res = await fetch(`${harness.baseUrl}/t/${harness.tenantId}/mcp`, {
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
          clientInfo: { name: 'smoke-test', version: '1.0.0' },
        },
      }),
    });

    expect(res.status).toBe(200);

    // MCP Streamable HTTP may respond as application/json OR text/event-stream
    // depending on the SDK's buffering decision. Accept either.
    const contentType = res.headers.get('content-type') ?? '';
    let body: { jsonrpc?: string; id?: number; result?: { protocolVersion?: string } };
    if (contentType.includes('application/json')) {
      body = (await res.json()) as typeof body;
    } else {
      // Parse the first data: line from the SSE-encoded response.
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

  it('Legacy SSE: GET /t/:id/sse returns event: endpoint within 200ms', async () => {
    const res = await fetch(`${harness.baseUrl}/t/${harness.tenantId}/sse`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('x-accel-buffering')).toBe('no');

    // Read the first chunk within a 200ms budget — proves the endpoint
    // event is flushed immediately and not held by a proxy buffer.
    const reader = res.body!.getReader();
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('sse first-chunk timeout')), 200)
      ),
    ]);
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain('event: endpoint');
    expect(text).toContain(`data: /t/${harness.tenantId}/messages`);

    await reader.cancel();
  });

  it('Legacy SSE: POST /t/:id/messages initialize returns 200 JSON-RPC', async () => {
    const res = await fetch(`${harness.baseUrl}/t/${harness.tenantId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 2,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke-test', version: '1.0.0' },
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
    expect(body.id).toBe(2);
    expect(body.result?.protocolVersion).toBe('2024-11-05');
  });

  it('Legacy SSE: POST /t/:id/messages tools/list returns 501 legacy_sse_limited_support', async () => {
    const res = await fetch(`${harness.baseUrl}/t/${harness.tenantId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 3 }),
    });

    // Non-initialize JSON-RPC methods return 501 per the v2.0 shim contract
    // (see docs/migration-v1-to-v2.md "Breaking Change: Legacy HTTP+SSE Shim").
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error?: string; hint?: string };
    expect(body.error).toBe('legacy_sse_limited_support');
    expect(body.hint).toMatch(/Streamable HTTP/);
  });

  it('Mount-order guard (Pitfall 3): /mcp does NOT produce SSE endpoint frame', async () => {
    // If Express 5 route-ordering collapsed /sse into /mcp, a POST to /mcp
    // could return an event-stream body with `event: endpoint`. Assert the
    // response body (JSON or SSE-encoded JSON-RPC) does NOT carry the
    // `event: endpoint` marker that /sse emits.
    const res = await fetch(`${harness.baseUrl}/t/${harness.tenantId}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 4,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke-test', version: '1.0.0' },
        },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    // The SSE endpoint-event shape is `event: endpoint\ndata: /t/.../messages`.
    // Streamable HTTP's SSE-encoded JSON-RPC uses `event: message` plus data lines.
    expect(text).not.toContain('event: endpoint');
    expect(text).not.toContain('data: /t/' + harness.tenantId + '/messages');
  });

  it('One server instance serves three distinct routes without cross-interference', async () => {
    // Fire one of each (Streamable HTTP + SSE GET + SSE POST) on the same
    // server instance. All three must complete without error. This is the
    // SC#3 end-to-end signal — stdio is skipped here per 03-VALIDATION.md.
    const mcpP = fetch(`${harness.baseUrl}/t/${harness.tenantId}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 5,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke-test', version: '1.0.0' },
        },
      }),
    });
    const ssePostP = fetch(`${harness.baseUrl}/t/${harness.tenantId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 6,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke-test', version: '1.0.0' },
        },
      }),
    });

    const sseRes = await fetch(`${harness.baseUrl}/t/${harness.tenantId}/sse`);
    expect(sseRes.status).toBe(200);
    const reader = sseRes.body!.getReader();
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain('event: endpoint');
    await reader.cancel();

    const [mcpRes, ssePostRes] = await Promise.all([mcpP, ssePostP]);
    expect(mcpRes.status).toBe(200);
    expect(ssePostRes.status).toBe(200);
  });
});
