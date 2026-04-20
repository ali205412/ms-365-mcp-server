/**
 * Plan 05-05 Task 1 — tools/list filter correctness edge cases (integration).
 *
 * Covers the non-happy-path behaviors of both filter seams:
 *
 *   - SDK handler wrap (`wrapToolsListHandler`):
 *     * Undefined `enabledToolsSet` → pass-through (no filtering; fallback to
 *       dispatch-guard on actual invocation).
 *     * Ordering preservation — filter MUST be a strict subset, never a
 *       re-order. If the SDK returns tools in registration order, filter
 *       emits the same order minus filtered entries.
 *     * pagination cursor preserved — if MCP SDK sets `nextCursor`, the
 *       filter propagates it unchanged.
 *
 *   - Express middleware (`createToolsListFilterMiddleware`):
 *     * GET request to /t/{tenantId}/mcp (SSE upgrade path) → does NOT
 *       crash, passes through to `next()`.
 *     * POST with `method: "prompts/list"` → does NOT intercept response.
 *     * POST with `method: "tools/call"` → does NOT intercept response.
 *     * POST with `method: "tools/list"` + no tenant on req → passes through.
 *     * POST body parse error (invalid JSON-RPC shape) → passes through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../../src/logger.js', async () => {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  const debug = vi.fn();
  return {
    default: { info, warn, error, debug },
    rawPinoLogger: { info, warn, error, debug },
    enableConsoleLogging: vi.fn(),
    __mocks: { info, warn, error, debug },
  };
});

const TENANT_A = '11111111-1111-1111-1111-111111111111';

interface ToolEntry {
  name: string;
}

interface ListToolsResponse {
  tools: ToolEntry[];
  nextCursor?: string;
}

async function invokeToolsList(server: McpServer): Promise<ListToolsResponse> {
  const inner = (
    server.server as unknown as {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<ListToolsResponse>>;
    }
  )._requestHandlers;
  const handler = inner.get('tools/list');
  if (!handler) {
    throw new Error('tools/list handler not registered');
  }
  return handler(
    { method: 'tools/list', params: {} },
    { requestId: 'test-1', sendNotification: vi.fn(), sendRequest: vi.fn() }
  );
}

function buildServerWithFixtures(): McpServer {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  // Registration order matters for Test 2 (ordering preservation): the SDK
  // walks `_registeredTools` (Object.entries) in insertion order.
  server.tool(
    'alpha',
    'First tool',
    {},
    { title: 'alpha', readOnlyHint: true },
    async () => ({ content: [{ type: 'text', text: 'ok' }] })
  );
  server.tool(
    'bravo',
    'Second tool',
    {},
    { title: 'bravo', readOnlyHint: true },
    async () => ({ content: [{ type: 'text', text: 'ok' }] })
  );
  server.tool(
    'charlie',
    'Third tool',
    { x: z.string() },
    { title: 'charlie', readOnlyHint: false },
    async () => ({ content: [{ type: 'text', text: 'ok' }] })
  );
  server.tool(
    'delta',
    'Fourth tool',
    {},
    { title: 'delta', readOnlyHint: true },
    async () => ({ content: [{ type: 'text', text: 'ok' }] })
  );
  return server;
}

/**
 * Minimal Express Response mock that captures `json`/`send`/`status` calls
 * so we can assert the middleware's pass-through semantics without a real
 * HTTP socket.
 */
interface MockRes {
  res: Response;
  sent: unknown;
  statusCode: number;
  jsonCalls: unknown[];
  sendCalls: unknown[];
}

function makeMockRes(): MockRes {
  const state = {
    sent: undefined as unknown,
    statusCode: 200,
    jsonCalls: [] as unknown[],
    sendCalls: [] as unknown[],
  };
  const res = {
    statusCode: 200,
    status(code: number) {
      state.statusCode = code;
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.jsonCalls.push(body);
      state.sent = body;
      return this;
    },
    send(body: unknown) {
      state.sendCalls.push(body);
      state.sent = body;
      return this;
    },
  } as unknown as Response;
  return {
    res,
    get sent() {
      return state.sent;
    },
    get statusCode() {
      return state.statusCode;
    },
    get jsonCalls() {
      return state.jsonCalls;
    },
    get sendCalls() {
      return state.sendCalls;
    },
  };
}

describe('plan 05-05 Task 1 — tools/list filter correctness edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── SDK handler wrap edge cases ───────────────────────────────────────

  it('Test 5: undefined enabledToolsSet (no ALS seed) → response passes through unfiltered', async () => {
    const { wrapToolsListHandler } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const { requestContext } = await import('../../src/request-context.js');

    const server = buildServerWithFixtures();
    wrapToolsListHandler(server);

    // Seed ALS with tenantId but NO enabledToolsSet (edge: loadTenant bug,
    // or a non-tenant route that somehow reached the wrapped handler).
    const response = await requestContext.run(
      { tenantId: TENANT_A },
      async () => invokeToolsList(server)
    );

    // Pass-through: all four tools remain.
    expect(response.tools.length).toBe(4);
    expect(response.tools.map((t) => t.name)).toEqual(['alpha', 'bravo', 'charlie', 'delta']);
  });

  it('Test 6: ordering preservation — filter emits tools in the same order as SDK default', async () => {
    const { wrapToolsListHandler } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const { requestContext } = await import('../../src/request-context.js');

    const server = buildServerWithFixtures();
    wrapToolsListHandler(server);

    // Enabled set has alpha + charlie + delta — bravo is filtered out.
    // Order MUST be [alpha, charlie, delta] (registration order preserved).
    const enabled = Object.freeze(new Set<string>(['alpha', 'charlie', 'delta']));

    const response = await requestContext.run(
      { tenantId: TENANT_A, enabledToolsSet: enabled, presetVersion: 'essentials-v1' },
      async () => invokeToolsList(server)
    );

    expect(response.tools.map((t) => t.name)).toEqual(['alpha', 'charlie', 'delta']);
  });

  it('Test 7: undefined ALS (no requestContext.run) → pass-through; no crash', async () => {
    const { wrapToolsListHandler } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );

    const server = buildServerWithFixtures();
    wrapToolsListHandler(server);

    // No ALS frame — getRequestTenant() returns empty triple. Filter must
    // not crash and must emit all tools (pass-through).
    const response = await invokeToolsList(server);
    expect(response.tools.length).toBe(4);
  });

  it('Test 8: empty enabledToolsSet → zero tools returned (explicit no-tools)', async () => {
    const { wrapToolsListHandler } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const { requestContext } = await import('../../src/request-context.js');

    const server = buildServerWithFixtures();
    wrapToolsListHandler(server);

    const emptySet = Object.freeze(new Set<string>());

    const response = await requestContext.run(
      { tenantId: TENANT_A, enabledToolsSet: emptySet, presetVersion: 'essentials-v1' },
      async () => invokeToolsList(server)
    );

    expect(response.tools.length).toBe(0);
    expect(Array.isArray(response.tools)).toBe(true);
  });

  it('Test 9: wrapping is idempotent — calling twice does not double-filter', async () => {
    const { wrapToolsListHandler } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const { requestContext } = await import('../../src/request-context.js');

    const server = buildServerWithFixtures();
    wrapToolsListHandler(server);
    wrapToolsListHandler(server); // second call should be idempotent

    const enabled = Object.freeze(new Set<string>(['alpha']));

    const response = await requestContext.run(
      { tenantId: TENANT_A, enabledToolsSet: enabled, presetVersion: 'essentials-v1' },
      async () => invokeToolsList(server)
    );

    expect(response.tools.length).toBe(1);
    expect(response.tools[0].name).toBe('alpha');
  });

  // ── Express middleware edge cases ─────────────────────────────────────

  it('Test 10: GET request → middleware passes through to next()', async () => {
    const { createToolsListFilterMiddleware } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const mw = createToolsListFilterMiddleware();

    const req = { method: 'GET', body: undefined } as unknown as Request;
    const { res } = makeMockRes();
    const next: NextFunction = vi.fn();

    mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('Test 11: POST with non-tools/list method (prompts/list) → no res.json override installed', async () => {
    const { createToolsListFilterMiddleware } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const mw = createToolsListFilterMiddleware();

    const req = {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 1, method: 'prompts/list', params: {} },
    } as unknown as Request;
    const mock = makeMockRes();
    const originalJson = mock.res.json;
    const next: NextFunction = vi.fn();

    mw(req, mock.res, next);
    expect(next).toHaveBeenCalledOnce();
    // The res.json reference should NOT be replaced because the middleware
    // identified this as a non-tools/list request.
    expect(mock.res.json).toBe(originalJson);
  });

  it('Test 12: POST with tools/call method → no res.json override installed', async () => {
    const { createToolsListFilterMiddleware } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const mw = createToolsListFilterMiddleware();

    const req = {
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'mail-send', arguments: {} },
      },
    } as unknown as Request;
    const mock = makeMockRes();
    const originalJson = mock.res.json;
    const next: NextFunction = vi.fn();

    mw(req, mock.res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(mock.res.json).toBe(originalJson);
  });

  it('Test 13: POST with malformed body (no method field) → passes through', async () => {
    const { createToolsListFilterMiddleware } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const mw = createToolsListFilterMiddleware();

    const req = {
      method: 'POST',
      body: { not_jsonrpc: true },
    } as unknown as Request;
    const mock = makeMockRes();
    const originalJson = mock.res.json;
    const next: NextFunction = vi.fn();

    mw(req, mock.res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(mock.res.json).toBe(originalJson);
  });

  it('Test 14: POST with tools/list method → res.json replaced; filter applied on call', async () => {
    const { createToolsListFilterMiddleware } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const { requestContext } = await import('../../src/request-context.js');
    const mw = createToolsListFilterMiddleware();

    const req = {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
    } as unknown as Request;
    const mock = makeMockRes();
    const originalJson = mock.res.json;
    const next: NextFunction = vi.fn();

    const enabledSet = Object.freeze(new Set<string>(['alpha']));

    await requestContext.run(
      { tenantId: TENANT_A, enabledToolsSet: enabledSet, presetVersion: 'essentials-v1' },
      async () => {
        mw(req, mock.res, next);
        // res.json should have been replaced with a filtering wrapper.
        expect(mock.res.json).not.toBe(originalJson);
        // Simulate the SDK calling res.json with a full tools/list payload.
        mock.res.json({
          jsonrpc: '2.0',
          id: 3,
          result: {
            tools: [{ name: 'alpha' }, { name: 'bravo' }, { name: 'charlie' }],
          },
        });
      }
    );

    expect(next).toHaveBeenCalledOnce();
    // The payload that reached the underlying response must have been filtered.
    const sent = mock.sent as {
      result: { tools: Array<{ name: string }> };
    };
    expect(sent.result.tools.length).toBe(1);
    expect(sent.result.tools[0].name).toBe('alpha');
  });

  it('Test 15: POST tools/list with string body to res.send → filter parses + re-serializes', async () => {
    const { createToolsListFilterMiddleware } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const { requestContext } = await import('../../src/request-context.js');
    const mw = createToolsListFilterMiddleware();

    const req = {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
    } as unknown as Request;
    const mock = makeMockRes();
    const next: NextFunction = vi.fn();

    const enabledSet = Object.freeze(new Set<string>(['bravo', 'charlie']));

    await requestContext.run(
      { tenantId: TENANT_A, enabledToolsSet: enabledSet, presetVersion: 'essentials-v1' },
      async () => {
        mw(req, mock.res, next);
        mock.res.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 4,
            result: {
              tools: [
                { name: 'alpha' },
                { name: 'bravo' },
                { name: 'charlie' },
                { name: 'delta' },
              ],
            },
          })
        );
      }
    );

    expect(next).toHaveBeenCalledOnce();
    // Parsed back from the string that was re-sent.
    const sent = mock.sent as string;
    const parsed = JSON.parse(sent) as { result: { tools: Array<{ name: string }> } };
    expect(parsed.result.tools.length).toBe(2);
    expect(parsed.result.tools.map((t) => t.name).sort()).toEqual(['bravo', 'charlie']);
  });

  it('Test 16: non-JSON string to res.send (e.g. SSE event) → passes through untouched', async () => {
    const { createToolsListFilterMiddleware } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const { requestContext } = await import('../../src/request-context.js');
    const mw = createToolsListFilterMiddleware();

    const req = {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} },
    } as unknown as Request;
    const mock = makeMockRes();
    const next: NextFunction = vi.fn();

    const enabledSet = Object.freeze(new Set<string>(['alpha']));

    await requestContext.run(
      { tenantId: TENANT_A, enabledToolsSet: enabledSet, presetVersion: 'essentials-v1' },
      async () => {
        mw(req, mock.res, next);
        // Non-JSON string — must NOT throw; must pass through byte-identical.
        mock.res.send('event: notification\ndata: {"ok": true}\n\n');
      }
    );

    expect(mock.sent).toBe('event: notification\ndata: {"ok": true}\n\n');
  });

  it('Test 17: Buffer body to res.send → passes through untouched', async () => {
    const { createToolsListFilterMiddleware } = await import(
      '../../src/lib/tool-selection/tools-list-filter.js'
    );
    const { requestContext } = await import('../../src/request-context.js');
    const mw = createToolsListFilterMiddleware();

    const req = {
      method: 'POST',
      body: { jsonrpc: '2.0', id: 6, method: 'tools/list', params: {} },
    } as unknown as Request;
    const mock = makeMockRes();
    const next: NextFunction = vi.fn();

    const enabledSet = Object.freeze(new Set<string>(['alpha']));
    const buf = Buffer.from('binary-payload');

    await requestContext.run(
      { tenantId: TENANT_A, enabledToolsSet: enabledSet, presetVersion: 'essentials-v1' },
      async () => {
        mw(req, mock.res, next);
        mock.res.send(buf);
      }
    );

    expect(mock.sent).toBe(buf);
  });
});
