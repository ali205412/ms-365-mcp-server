import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import type GraphClient from '../../src/graph-client.js';
import { requestContext } from '../../src/request-context.js';
import { registerBulkActionTools } from '../../src/lib/bulk-actions/register.js';
import { BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL } from '../../src/lib/bulk-actions/schema.js';
import { resetBulkResultStoreForTesting } from '../../src/lib/bulk-actions/result-store.js';

interface ToolLikeResult {
  isError?: boolean;
  _meta?: Record<string, unknown>;
  structuredContent?: { data?: unknown };
  content: Array<{ type: 'text'; text: string }>;
}

type Handler = (
  params: Record<string, unknown>,
  extra?: { signal?: AbortSignal }
) => Promise<ToolLikeResult>;

function makeServer() {
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    server: {
      tool(
        name: string,
        _description: string,
        _schema: unknown,
        _annotations: unknown,
        handler: Handler
      ) {
        handlers.set(name, handler);
      },
    },
  };
}

async function withTenant<T>(enabled: string[], fn: () => Promise<T>): Promise<T> {
  return requestContext.run(
    {
      tenantId: 'tenant-a',
      enabledToolsSet: new Set(enabled),
      enabledToolsExplicit: true,
      presetVersion: 'custom',
      ownerSubject: 'owner-a',
    },
    fn
  );
}

function dataFrom(result: ToolLikeResult): unknown {
  return result.structuredContent?.data ?? JSON.parse(result.content[0].text);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function graphClientStub(): GraphClient {
  return {} as unknown as GraphClient;
}

function mcpServerStub(server: unknown): McpServer {
  return server as McpServer;
}

describe('generic bulk-action tool', () => {
  it('registers synthetic tools and executes read aliases through the shared alias callback', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    const executeToolAlias = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify({ id: 'safe-id' }) }],
    }));
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias,
    });
    expect(handlers.has(BULK_ACTION_TOOL)).toBe(true);
    expect(handlers.has(READ_BULK_RESULT_TOOL)).toBe(true);

    const preview = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () =>
        handlers.get(BULK_ACTION_TOOL)!({
          mode: 'preview',
          outputMode: 'ids',
          items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }],
        })
    );
    const result = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () =>
        handlers.get(BULK_ACTION_TOOL)!({
          mode: 'execute',
          outputMode: 'ids',
          confirmation: asRecord(dataFrom(preview)).confirmation,
          items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }],
        })
    );
    expect(result.isError).not.toBe(true);
    expect(executeToolAlias).toHaveBeenCalledTimes(1);
    const payload = asRecord(dataFrom(result));
    expect((payload.items as Record<string, unknown>[])[0]).toMatchObject({
      id: 'read-1',
      toolName: 'get-chat',
      status: 'succeeded',
    });
    expect(JSON.stringify(payload)).not.toContain('chat-id');
  });

  it('honors enabled-tools registration filters per synthetic alias', () => {
    const { server, handlers } = makeServer();
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias: vi.fn(),
      enabledToolsPattern: /^bulk-action$/,
      enabledToolsSet: new Set([BULK_ACTION_TOOL]),
    });
    expect(handlers.has(BULK_ACTION_TOOL)).toBe(true);
    expect(handlers.has(READ_BULK_RESULT_TOOL)).toBe(false);
  });

  it('requires plan-bound confirmation before high-risk writes and injects internal static confirmation only after match', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    const executeToolAlias = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify({ id: 'deleted-id' }) }],
    }));
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias,
    });

    const preview = await withTenant([BULK_ACTION_TOOL, 'delete-onedrive-file'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'preview',
        outputMode: 'summary',
        items: [
          {
            id: 'delete-1',
            toolName: 'delete-onedrive-file',
            parameters: { driveId: 'drive', driveItemId: 'item' },
          },
        ],
      })
    );
    const confirmation = asRecord(dataFrom(preview)).confirmation as Record<string, unknown>;
    expect(confirmation.planDigest).toEqual(expect.any(String));

    const rejected = await withTenant([BULK_ACTION_TOOL, 'delete-onedrive-file'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'execute',
        outputMode: 'summary',
        confirmation: { ...confirmation, planDigest: '0'.repeat(64) },
        items: [
          {
            id: 'delete-1',
            toolName: 'delete-onedrive-file',
            parameters: { driveId: 'drive', driveItemId: 'item' },
          },
        ],
      })
    );
    expect(rejected.isError).toBe(true);
    expect(executeToolAlias).not.toHaveBeenCalled();

    await withTenant([BULK_ACTION_TOOL, 'delete-onedrive-file'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'execute',
        outputMode: 'summary',
        confirmation,
        items: [
          {
            id: 'delete-1',
            toolName: 'delete-onedrive-file',
            parameters: { driveId: 'drive', driveItemId: 'item' },
          },
        ],
      })
    );
    expect(executeToolAlias).toHaveBeenCalledTimes(1);
    expect(executeToolAlias.mock.calls[0][0].parameters).toMatchObject({
      confirmation: true,
      confirmationId: 'confirm:delete-onedrive-file:high',
    });
  });

  it('stores and reads sanitized full results without leaking unsafe fields', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias: vi.fn(async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: 'safe-id',
              displayName: 'Private Person',
              userPrincipalName: 'private@example.com',
              webUrl: 'https://example.invalid/private',
              subject: 'Private subject',
            }),
          },
        ],
      })),
    });

    const preview = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () =>
        handlers.get(BULK_ACTION_TOOL)!({
          mode: 'preview',
          outputMode: 'full',
          items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }],
        })
    );
    const executed = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () =>
        handlers.get(BULK_ACTION_TOOL)!({
          mode: 'execute',
          outputMode: 'full',
          confirmation: asRecord(dataFrom(preview)).confirmation,
          items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }],
        })
    );
    const payload = asRecord(dataFrom(executed));
    expect(payload.resultId).toEqual(expect.stringMatching(/^bulk_/));
    const read = await withTenant([BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'], async () =>
      handlers.get(READ_BULK_RESULT_TOOL)!({ resultId: payload.resultId, limit: 10 })
    );
    const serialized = JSON.stringify(dataFrom(read));
    expect(serialized).toContain('safe-id');
    expect(serialized).not.toContain('Private Person');
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('example.invalid');
    expect(serialized).not.toContain('Private subject');
    expect(JSON.stringify(payload)).not.toContain('safe-id');
  });

  it('treats non-JSON text tool responses as opaque metadata', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias: vi.fn(async () => ({
        content: [
          { type: 'text', text: 'Transcript body with private@example.com and private words' },
        ],
      })),
    });

    const preview = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () =>
        handlers.get(BULK_ACTION_TOOL)!({
          mode: 'preview',
          outputMode: 'full',
          items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }],
        })
    );
    const executed = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () =>
        handlers.get(BULK_ACTION_TOOL)!({
          mode: 'execute',
          outputMode: 'full',
          confirmation: asRecord(dataFrom(preview)).confirmation,
          items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }],
        })
    );
    const payload = asRecord(dataFrom(executed));
    const read = await withTenant([BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'], async () =>
      handlers.get(READ_BULK_RESULT_TOOL)!({ resultId: payload.resultId, limit: 10 })
    );
    const serialized = JSON.stringify(dataFrom(read));
    expect(serialized).toContain('rawTextResponse');
    expect(serialized).toContain('byteCount');
    expect(serialized).not.toContain('Transcript body');
    expect(serialized).not.toContain('private words');
  });

  it('stops scheduling remaining items after throttling metadata', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    const executeToolAlias = vi.fn(async () => ({
      isError: true,
      _meta: { errorCode: 'TooManyRequests', retryAfterSeconds: 60 },
      content: [{ type: 'text', text: JSON.stringify({ error: 'throttled' }) }],
    }));
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias: executeToolAlias as never,
    });

    const items = [
      { id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'a' } },
      { id: 'read-2', toolName: 'get-chat', parameters: { chatId: 'b' } },
    ];
    const preview = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({ mode: 'preview', outputMode: 'errors', items })
    );
    const result = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'execute',
        outputMode: 'errors',
        confirmation: asRecord(dataFrom(preview)).confirmation,
        items,
      })
    );
    const payload = asRecord(dataFrom(result));
    expect(executeToolAlias).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(payload)).toContain('graph_throttled');
  });

  it('propagates GraphClient-shaped 429 retry metadata into failed bulk items', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    const executeToolAlias = vi.fn(async () => ({
      isError: true,
      _meta: { graph: { code: 'TooManyRequests', statusCode: 429, retryAfterSeconds: 7 } },
      content: [{ type: 'text', text: JSON.stringify({ code: 'TooManyRequests' }) }],
    }));
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias: executeToolAlias as never,
    });

    const items = [
      { id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'a' } },
      { id: 'read-2', toolName: 'get-chat', parameters: { chatId: 'b' } },
    ];
    const preview = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({ mode: 'preview', outputMode: 'errors', items })
    );
    const result = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'execute',
        outputMode: 'errors',
        confirmation: asRecord(dataFrom(preview)).confirmation,
        items,
      })
    );
    const serialized = JSON.stringify(dataFrom(result));
    expect(executeToolAlias).toHaveBeenCalledTimes(1);
    expect(serialized).toContain('graph_throttled');
    expect(serialized).toContain('"retryAfterSeconds":7');
  });

  it('sanitizes thrown alias errors in bulk item output', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    const executeToolAlias = vi.fn(async () => {
      throw new Error('raw-token-123 private@example.com should stay private');
    });
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias,
    });

    const items = [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }];
    const preview = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({ mode: 'preview', outputMode: 'errors', items })
    );
    const result = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'execute',
        outputMode: 'errors',
        confirmation: asRecord(dataFrom(preview)).confirmation,
        items,
      })
    );
    const serialized = JSON.stringify(dataFrom(result));
    expect(result.isError).not.toBe(true);
    expect(serialized).toContain('graph_item_failed');
    expect(serialized).not.toContain('raw-token-123');
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('should stay private');
  });

  it('returns a typed error instead of throwing for malformed confirmation expiry', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    const executeToolAlias = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify({ id: 'safe-id' }) }],
    }));
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias,
    });

    const result = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'execute',
        outputMode: 'summary',
        confirmation: { confirmed: true, planDigest: '0'.repeat(64), expiresAt: 'not-a-date' },
        items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }],
      })
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(dataFrom(result))).toContain('invalid_bulk_item');
    expect(executeToolAlias).not.toHaveBeenCalled();
  });

  it('blocks full output execution when read-bulk-result is not registered for the tenant', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    const executeToolAlias = vi.fn(async () => ({
      content: [{ type: 'text', text: JSON.stringify({ id: 'safe-id' }) }],
    }));
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias,
      enabledToolsSet: new Set([BULK_ACTION_TOOL]),
    });

    const result = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'execute',
        outputMode: 'full',
        items: [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'chat-id' } }],
      })
    );
    expect(result.isError).toBe(true);
    expect(JSON.stringify(dataFrom(result))).toContain('result_store_unavailable');
    expect(executeToolAlias).not.toHaveBeenCalled();
  });

  it('marks an in-flight aborted item as cancelled', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    const controller = new AbortController();
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias: vi.fn(async () => {
        controller.abort();
        return { content: [{ type: 'text', text: JSON.stringify({ id: 'late-id' }) }] };
      }),
    });

    const items = [{ id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'a' } }];
    const preview = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({ mode: 'preview', outputMode: 'errors', items })
    );
    const result = await withTenant([BULK_ACTION_TOOL, 'get-chat'], async () =>
      handlers.get(BULK_ACTION_TOOL)!(
        {
          mode: 'execute',
          outputMode: 'errors',
          confirmation: asRecord(dataFrom(preview)).confirmation,
          items,
        },
        { signal: controller.signal }
      )
    );
    expect(JSON.stringify(dataFrom(result))).toContain('cancelled');
  });
});
