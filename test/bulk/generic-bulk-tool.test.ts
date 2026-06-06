import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import type GraphClient from '../../src/graph-client.js';
import { requestContext } from '../../src/request-context.js';
import { registerBulkActionTools } from '../../src/lib/bulk-actions/register.js';
import { BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL } from '../../src/lib/bulk-actions/schema.js';
import { resetBulkResultStoreForTesting } from '../../src/lib/bulk-actions/result-store.js';

vi.mock('../../src/generated/client.js', async () => {
  const { z } = await import('zod');
  return {
    api: {
      endpoints: [
        {
          alias: 'get-chat',
          method: 'GET',
          path: '/chats/:chatId',
          parameters: [
            { name: 'chatId', type: 'Path', schema: z.string() },
            {
              name: 'select',
              type: 'Query',
              schema: z.union([z.string(), z.array(z.string())]).optional(),
            },
          ],
        },
        {
          alias: 'list-chats',
          method: 'GET',
          path: '/chats',
          parameters: [
            { name: 'top', type: 'Query', schema: z.number().optional() },
            { name: 'count', type: 'Query', schema: z.boolean().optional() },
          ],
        },
        {
          alias: 'get-meeting-transcript-content',
          method: 'GET',
          path: '/me/onlineMeetings/:meetingId/transcripts/:transcriptId/content',
          parameters: [
            { name: 'meetingId', type: 'Path', schema: z.string() },
            { name: 'transcriptId', type: 'Path', schema: z.string() },
          ],
        },
        {
          alias: 'delete-onedrive-file',
          method: 'DELETE',
          path: '/drives/:driveId/items/:driveItemId',
          parameters: [
            { name: 'driveId', type: 'Path', schema: z.string() },
            { name: 'driveItemId', type: 'Path', schema: z.string() },
          ],
        },
      ],
    },
  };
});

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
  return withTenantContext({ enabled }, fn);
}

async function withTenantContext<T>(
  input: {
    enabled: string[];
    tenantId?: string;
    ownerSubject?: string;
    enabledToolsExplicit?: boolean;
    presetVersion?: string;
  },
  fn: () => Promise<T>
): Promise<T> {
  return requestContext.run(
    {
      tenantId: input.tenantId ?? 'tenant-a',
      enabledToolsSet: new Set(input.enabled),
      enabledToolsExplicit: input.enabledToolsExplicit ?? true,
      presetVersion: input.presetVersion ?? 'custom',
      ownerSubject: input.ownerSubject ?? 'owner-a',
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

  it('rejects plan-bound confirmation without the preview expiry during execution', async () => {
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

    const items = [
      {
        id: 'delete-1',
        toolName: 'delete-onedrive-file',
        parameters: { driveId: 'drive', driveItemId: 'item' },
      },
    ];
    const preview = await withTenant([BULK_ACTION_TOOL, 'delete-onedrive-file'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({ mode: 'preview', outputMode: 'summary', items })
    );
    const confirmation = asRecord(dataFrom(preview)).confirmation as Record<string, unknown>;

    const result = await withTenant([BULK_ACTION_TOOL, 'delete-onedrive-file'], async () =>
      handlers.get(BULK_ACTION_TOOL)!({
        mode: 'execute',
        outputMode: 'summary',
        confirmation: { planDigest: confirmation.planDigest, confirmed: true },
        items,
      })
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(dataFrom(result))).toContain('invalid_bulk_item');
    expect(executeToolAlias).not.toHaveBeenCalled();
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

  it('blocks discovery-v1 writes unless enabled tools were explicitly selected', async () => {
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

    const result = await withTenantContext(
      {
        enabled: [BULK_ACTION_TOOL, 'delete-onedrive-file'],
        enabledToolsExplicit: false,
        presetVersion: 'discovery-v1',
      },
      async () =>
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

    expect(JSON.stringify(dataFrom(result))).toContain('discovery_write_not_enabled');
    expect(executeToolAlias).not.toHaveBeenCalled();
  });

  it('fails closed when a different owner or tenant reads stored full results', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias: vi.fn(async () => ({
        content: [{ type: 'text', text: JSON.stringify({ id: 'safe-id' }) }],
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
    const resultId = asRecord(dataFrom(executed)).resultId;

    const ownerMismatch = await withTenantContext(
      { enabled: [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'], ownerSubject: 'owner-b' },
      async () => handlers.get(READ_BULK_RESULT_TOOL)!({ resultId, limit: 10 })
    );
    const tenantMismatch = await withTenantContext(
      { enabled: [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'], tenantId: 'tenant-b' },
      async () => handlers.get(READ_BULK_RESULT_TOOL)!({ resultId, limit: 10 })
    );

    expect(ownerMismatch.isError).toBe(true);
    expect(JSON.stringify(dataFrom(ownerMismatch))).toContain('owner_mismatch');
    expect(tenantMismatch.isError).toBe(true);
    expect(JSON.stringify(dataFrom(tenantMismatch))).toContain('tenant_mismatch');
  });

  it('makes result cursors single-use to prevent replay', async () => {
    resetBulkResultStoreForTesting();
    const { server, handlers } = makeServer();
    registerBulkActionTools(mcpServerStub(server), {
      graphClient: graphClientStub(),
      readOnly: false,
      orgMode: true,
      executeToolAlias: vi.fn(async ({ parameters }) => ({
        content: [{ type: 'text', text: JSON.stringify({ id: asRecord(parameters).chatId }) }],
      })),
    });

    const items = [
      { id: 'read-1', toolName: 'get-chat', parameters: { chatId: 'a' } },
      { id: 'read-2', toolName: 'get-chat', parameters: { chatId: 'b' } },
    ];
    const preview = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () => handlers.get(BULK_ACTION_TOOL)!({ mode: 'preview', outputMode: 'full', items })
    );
    const executed = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () =>
        handlers.get(BULK_ACTION_TOOL)!({
          mode: 'execute',
          outputMode: 'full',
          confirmation: asRecord(dataFrom(preview)).confirmation,
          items,
        })
    );
    const resultId = asRecord(dataFrom(executed)).resultId;
    const firstPage = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () => handlers.get(READ_BULK_RESULT_TOOL)!({ resultId, limit: 1 })
    );
    const cursor = asRecord(dataFrom(firstPage)).nextCursor;

    const replayOne = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () => handlers.get(READ_BULK_RESULT_TOOL)!({ resultId, cursor, limit: 1 })
    );
    const replayTwo = await withTenant(
      [BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'],
      async () => handlers.get(READ_BULK_RESULT_TOOL)!({ resultId, cursor, limit: 1 })
    );

    expect(replayOne.isError).not.toBe(true);
    expect(replayTwo.isError).toBe(true);
    expect(JSON.stringify(dataFrom(replayTwo))).toContain('invalid_cursor');
  });

  it('truncates oversized per-item full data while preserving safe ids', async () => {
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
              ...Object.fromEntries(
                Array.from({ length: 80 }, (_, index) => [`safeField${index}`, 'x'.repeat(1000)])
              ),
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
    const read = await withTenant([BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL, 'get-chat'], async () =>
      handlers.get(READ_BULK_RESULT_TOOL)!({
        resultId: asRecord(dataFrom(executed)).resultId,
        limit: 10,
      })
    );
    const serialized = JSON.stringify(dataFrom(read));
    expect(serialized).toContain('truncated');
    expect(serialized).toContain('safe-id');
    expect(serialized).not.toContain('x'.repeat(1000));
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
