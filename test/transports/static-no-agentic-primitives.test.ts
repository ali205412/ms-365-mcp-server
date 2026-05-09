import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { requestContext } from '../../src/request-context.js';
import MicrosoftGraphServer from '../../src/server.js';
import { presetFor } from '../../src/lib/tool-selection/preset-loader.js';

const STATIC_TENANT_ID = '33333333-3333-4333-8333-333333333333';
const STATIC_PRESET_VERSION = 'essentials-v1';
const AGENTIC_TOOL_NAMES = [
  'search-tools',
  'get-tool-schema',
  'execute-tool',
  'bookmark-tool',
  'list-bookmarks',
  'unbookmark-tool',
  'save-recipe',
  'list-recipes',
  'run-recipe',
  'record-fact',
  'recall-facts',
  'forget-fact',
] as const;

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  rawPinoLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  enableConsoleLogging: vi.fn(),
}));

vi.mock('../../src/generated/client.js', async () => {
  const { readFileSync } = await import('node:fs');
  const preset = JSON.parse(
    readFileSync(new URL('../../src/presets/essentials-v1.json', import.meta.url), 'utf8')
  ) as { ops: string[] };
  return {
    api: {
      endpoints: preset.ops.map((alias) => ({
        alias,
        method: 'get',
        path: `/${alias.replaceAll('.', '/')}`,
        parameters: [],
      })),
    },
  };
});

interface ToolEntry {
  name: string;
}

interface ListToolsResponse {
  tools: ToolEntry[];
}

function createGraphServer(): MicrosoftGraphServer {
  return new MicrosoftGraphServer(
    {
      isMultiAccount: vi.fn(async () => false),
      listAccounts: vi.fn(async () => []),
    } as never,
    { http: true, orgMode: true }
  );
}

function capabilitiesOf(server: McpServer): { completions?: object; logging?: object } {
  return (
    server.server as unknown as {
      getCapabilities: () => { completions?: object; logging?: object };
    }
  ).getCapabilities();
}

async function invokeToolsList(server: McpServer): Promise<ListToolsResponse> {
  const handlers = (
    server.server as unknown as {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<ListToolsResponse>>;
    }
  )._requestHandlers;
  const handler = handlers.get('tools/list');
  if (!handler) throw new Error('tools/list handler not registered');
  return handler(
    { method: 'tools/list', params: {} },
    { requestId: 'static-transport-regression', sendNotification: vi.fn(), sendRequest: vi.fn() }
  );
}

describe('Phase 7 Plan 07-10 — static tenants do not expose agentic primitives', () => {
  it('AC-10: static tenant has no resources, prompts, completions, logging, or memory tools', async () => {
    const staticEnabled = presetFor(STATIC_PRESET_VERSION);
    const mcp = createGraphServer().createMcpServer({
      id: STATIC_TENANT_ID,
      preset_version: STATIC_PRESET_VERSION,
      enabled_tools_set: staticEnabled,
      allowed_scopes: ['User.Read'],
    } as never);

    const list = await requestContext.run(
      {
        tenantId: STATIC_TENANT_ID,
        enabledToolsSet: staticEnabled,
        presetVersion: STATIC_PRESET_VERSION,
      },
      () => invokeToolsList(mcp)
    );
    const names = list.tools.map((tool) => tool.name);
    for (const name of AGENTIC_TOOL_NAMES) {
      expect(names).not.toContain(name);
    }

    const registeredTools = (mcp as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    for (const name of AGENTIC_TOOL_NAMES) {
      expect(registeredTools[name]).toBeUndefined();
    }

    const handlers = (
      mcp.server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;
    expect(handlers.has('resources/list')).toBe(false);
    expect(handlers.has('resources/read')).toBe(false);
    expect(handlers.has('prompts/list')).toBe(false);
    expect(handlers.has('prompts/get')).toBe(false);
    expect(handlers.has('completion/complete')).toBe(false);
    expect(handlers.has('logging/setLevel')).toBe(false);
    expect(capabilitiesOf(mcp).completions).toBeUndefined();
    expect(capabilitiesOf(mcp).logging).toBeUndefined();
  });
});
