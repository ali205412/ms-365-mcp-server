import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { requestContext } from '../../src/request-context.js';
import MicrosoftGraphServer from '../../src/server.js';
import { presetFor } from '../../src/lib/tool-selection/preset-loader.js';

const STATIC_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const STATIC_PRESET_VERSION = 'essentials-v1';
const STATIC_SURFACE_MIN = 150;
const STATIC_SURFACE_MAX = 204;
const PHASE_7_MEMORY_TOOLS = [
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
const DISCOVERY_META_TOOLS = ['search-tools', 'get-tool-schema', 'execute-tool'] as const;

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
    { requestId: 'static-regression', sendNotification: vi.fn(), sendRequest: vi.fn() }
  );
}

describe('Phase 7 Plan 07-10 — AC-09/10/11 static surface regression', () => {
  it('AC-09 AC-11: essentials-v1 tenant tools/list stays in the static budget with no memory tools', async () => {
    const staticEnabled = presetFor(STATIC_PRESET_VERSION);
    expect(staticEnabled.size).toBeGreaterThanOrEqual(STATIC_SURFACE_MIN);
    expect(staticEnabled.size).toBeLessThanOrEqual(STATIC_SURFACE_MAX);

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

    expect(names.length).toBeGreaterThanOrEqual(STATIC_SURFACE_MIN);
    expect(names.length).toBeLessThanOrEqual(STATIC_SURFACE_MAX);
    for (const name of [...PHASE_7_MEMORY_TOOLS, ...DISCOVERY_META_TOOLS]) {
      expect(names).not.toContain(name);
    }
  });

  it('operator docs describe default discovery create path, opt-in migration, rollback, and pgvector gate', () => {
    const doc = readFileSync('docs/discovery-mode.md', 'utf8');
    const readme = readFileSync('README.md', 'utf8');
    const env = readFileSync('.env.example', 'utf8');

    expect(readme).toContain('docs/discovery-mode.md');
    expect(env).toContain('MS365_MCP_PGVECTOR_ENABLED=0');
    expect(doc).toContain('node bin/migrate-tenant-to-discovery.mjs --tenant-id <uuid> --dry-run');
    expect(doc).toContain('PATCH /admin/tenants/{id}');
    expect(doc).toContain('"preset_version": "essentials-v1"');
    expect(doc).toContain('MS365_MCP_PGVECTOR_ENABLED');
    expect(doc).toMatch(/new tenants.*discovery-v1/is);
    expect(doc).toMatch(/existing tenants.*stay pinned/is);

    for (const name of [...DISCOVERY_META_TOOLS, ...PHASE_7_MEMORY_TOOLS]) {
      expect(doc).toContain(name);
    }
  });
});
