import { describe, expect, it, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { requestContext } from '../../src/request-context.js';
import {
  DISCOVERY_META_TOOL_NAMES,
  DISCOVERY_PRESET_VERSION,
} from '../../src/lib/tenant-surface/surface.js';
import { readMcpResource } from '../../src/lib/mcp-resources/read.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const memoryMocks = vi.hoisted(() => ({
  listBookmarks: vi.fn(),
  listRecipes: vi.fn(),
  recallFacts: vi.fn(),
}));

vi.mock('../../src/generated/client.js', () => ({
  api: {
    endpoints: [
      {
        alias: 'list-mail-messages',
        method: 'get',
        path: '/me/messages',
        description: 'List messages in the signed-in user mailbox.',
        parameters: [],
      },
      {
        alias: '__powerbi__Groups_GetGroups',
        method: 'get',
        path: '/groups',
        description: 'List Power BI workspaces.',
        parameters: [],
      },
      {
        alias: 'search-tools',
        method: 'get',
        path: '/meta/search-tools',
        description: 'Visible discovery meta tool that must not be in discoveryCatalogSet.',
        parameters: [],
      },
    ],
  },
}));

vi.mock('../../src/lib/memory/bookmarks.js', () => ({
  listBookmarks: memoryMocks.listBookmarks,
  getBookmarkCountsByAlias: vi.fn(async () => new Map()),
}));

vi.mock('../../src/lib/memory/recipes.js', () => ({
  listRecipes: memoryMocks.listRecipes,
}));

vi.mock('../../src/lib/memory/facts.js', () => ({
  recallFacts: memoryMocks.recallFacts,
}));

function readText(result: Awaited<ReturnType<typeof readMcpResource>>): string {
  return result.contents[0].text;
}

function discoveryContext() {
  return {
    tenantId: TENANT_A,
    enabledToolsSet: DISCOVERY_META_TOOL_NAMES,
    presetVersion: DISCOVERY_PRESET_VERSION,
  };
}

describe('Phase 7 Plan 07-11 Task 2 - MCP resource read dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    memoryMocks.listBookmarks.mockResolvedValue([{ alias: 'list-mail-messages' }]);
    memoryMocks.listRecipes.mockResolvedValue([{ name: 'morning inbox' }]);
    memoryMocks.recallFacts.mockResolvedValue([{ scope: 'mailbox', content: 'prefer concise' }]);
  });

  it('reads static catalog markdown resources with text/markdown MIME type', async () => {
    const result = await readMcpResource('mcp://catalog/navigation-guide.md', {});

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].uri).toBe('mcp://catalog/navigation-guide.md');
    expect(result.contents[0].mimeType).toBe('text/markdown');
    expect(readText(result)).toContain('search-tools');
  });

  it('builds catalog scope-map.json from endpoints.json as alias-to-scopes JSON', async () => {
    const result = await readMcpResource('mcp://catalog/scope-map.json', {});
    const body = JSON.parse(readText(result)) as Record<string, string[]>;

    expect(result.contents[0].mimeType).toBe('application/json');
    expect(body['list-mail-messages']).toContain('Mail.Read');
    expect(body['send-mail']).toContain('Mail.Send');
  });

  it('reads endpoint schema resources with the same schema shape as get-tool-schema', async () => {
    const result = await requestContext.run(discoveryContext(), () =>
      readMcpResource('mcp://endpoint/list-mail-messages.schema.json', { orgMode: true })
    );
    const body = JSON.parse(readText(result)) as {
      name: string;
      method: string;
      path: string;
      parameters: unknown[];
    };

    expect(result.contents[0].mimeType).toBe('application/json');
    expect(body).toMatchObject({
      name: 'list-mail-messages',
      method: 'GET',
      path: '/me/messages',
    });
    expect(body.parameters).toEqual([]);
  });

  it('allows discovery endpoint schemas for generated aliases outside the 12 visible tools', async () => {
    const result = await requestContext.run(discoveryContext(), () =>
      readMcpResource('mcp://endpoint/__powerbi__Groups_GetGroups.schema.json', {
        orgMode: true,
      })
    );
    const body = JSON.parse(readText(result)) as { name: string };

    expect(body.name).toBe('__powerbi__Groups_GetGroups');
    expect(DISCOVERY_META_TOOL_NAMES.has('__powerbi__Groups_GetGroups')).toBe(false);
  });

  it('rejects endpoint schemas that are not in the effective discovery catalog', async () => {
    await expect(
      requestContext.run(discoveryContext(), () =>
        readMcpResource('mcp://endpoint/search-tools.schema.json', { orgMode: true })
      )
    ).rejects.toMatchObject({
      data: { code: 'invalid_resource_uri' },
    });
  });

  it('calls tenant memory services with the caller tenant id after owner validation', async () => {
    await requestContext.run(discoveryContext(), async () => {
      await readMcpResource(`mcp://tenant/${TENANT_A}/bookmarks.json`, {});
      await readMcpResource(`mcp://tenant/${TENANT_A}/recipes.json`, {});
      await readMcpResource(`mcp://tenant/${TENANT_A}/facts.json`, {});
    });

    expect(memoryMocks.listBookmarks).toHaveBeenCalledWith(TENANT_A);
    expect(memoryMocks.listRecipes).toHaveBeenCalledWith(TENANT_A);
    expect(memoryMocks.recallFacts).toHaveBeenCalledWith(TENANT_A, { limit: 100 });
  });

  it('fails closed on tenant URI mismatch before tenant view reads', async () => {
    await expect(
      requestContext.run(discoveryContext(), () =>
        readMcpResource(`mcp://tenant/${TENANT_B}/bookmarks.json`, {})
      )
    ).rejects.toMatchObject({
      data: { code: 'tenant_resource_mismatch' },
    });

    expect(memoryMocks.listBookmarks).not.toHaveBeenCalled();
  });
});

describe('Phase 7 Plan 07-11 Task 3 - MCP resource registration', () => {
  it('has a server fixture available for registration tests', () => {
    expect(new McpServer({ name: 'resources-test', version: '0.0.0' })).toBeInstanceOf(McpServer);
  });
});
