import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it, vi } from 'vitest';
import type GraphClient from '../../src/graph-client.js';
import { requestContext } from '../../src/request-context.js';
import { registerBulkActionTools } from '../../src/lib/bulk-actions/register.js';
import { BULK_ACTION_TOOL, READ_BULK_RESULT_TOOL } from '../../src/lib/bulk-actions/schema.js';
import { resetBulkResultStoreForTesting } from '../../src/lib/bulk-actions/result-store.js';

interface ToolLikeResult {
  isError?: boolean;
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
  });
});
