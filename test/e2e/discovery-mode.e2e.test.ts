import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import {
  DISCOVERY_META_TOOL_NAMES,
  DISCOVERY_PRESET_VERSION,
} from '../../src/lib/tenant-surface/surface.js';
import { resolveDiscoveryCatalog } from '../../src/lib/discovery-catalog/catalog.js';
import { presetFor } from '../../src/lib/tool-selection/preset-loader.js';

const RUN_E2E = process.env.MS365_MCP_E2E === '1';
const describeE2E = RUN_E2E ? describe : describe.skip;
const DISCOVERY_TENANT_ID = '11111111-1111-4111-8111-111111111111';
const STATIC_TENANT_ID = '22222222-2222-4222-8222-222222222222';
const GRAPH_ALIAS = 'me.messages.ListMessages';
const PRODUCT_ALIAS = '__powerbi__Groups_GetGroups';
const DISCOVERY_TOOL_NAMES = [
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

vi.mock('../../src/generated/client.js', () => ({
  api: {
    endpoints: [
      {
        alias: GRAPH_ALIAS,
        method: 'get',
        path: '/me/messages',
        description: 'List messages in the signed-in user mailbox.',
        parameters: [],
      },
      {
        alias: 'me.messages.SendMail',
        method: 'post',
        path: '/me/sendMail',
        description: 'Send mail as the signed-in user.',
        parameters: [],
      },
      {
        alias: 'users.ListUsers',
        method: 'get',
        path: '/users',
        description: 'List users in the tenant.',
        parameters: [],
      },
      {
        alias: PRODUCT_ALIAS,
        method: 'get',
        path: '/groups',
        description: 'List Power BI workspaces.',
        parameters: [],
      },
    ],
  },
}));

interface JsonRpcToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

interface DiscoveryE2EHarness {
  server: Server;
  baseUrl: string;
  graphRequests: unknown[];
  initialize(tenantId?: string): Promise<string>;
  rpc<T = unknown>(sessionId: string, method: string, params?: unknown): Promise<T>;
  callTool(sessionId: string, name: string, args?: Record<string, unknown>): Promise<JsonRpcToolResult>;
  waitForEvent(type: string, predicate: (event: Record<string, unknown>) => boolean): Promise<number>;
  patchTenantPreset(tenantId: string, presetVersion: string): Promise<void>;
  close(): Promise<void>;
}

describeE2E('Phase 7 Plan 07-10 discovery-mode E2E smoke (set MS365_MCP_E2E=1 to run)', () => {
  let harness: DiscoveryE2EHarness;
  let sessionId: string;

  beforeAll(async () => {
    harness = await createDiscoveryE2EHarness();
    sessionId = await harness.initialize();
  });

  afterAll(async () => {
    await harness?.close();
  });

  it('AC-01 AC-09 AC-10 AC-11: tools/list returns exactly 12 discovery tools and static remains tool-only', async () => {
    const list = await harness.rpc<{ tools: Array<{ name: string }> }>(sessionId, 'tools/list', {});
    const names = list.tools.map((tool) => tool.name).sort();

    expect(names).toEqual([...DISCOVERY_TOOL_NAMES].sort());
    expect(names).toHaveLength(12);

    const staticSession = await harness.initialize(STATIC_TENANT_ID);
    const staticList = await harness.rpc<{ tools: Array<{ name: string }> }>(
      staticSession,
      'tools/list',
      {}
    );
    const staticNames = staticList.tools.map((tool) => tool.name);
    expect(staticNames).not.toContain('bookmark-tool');
    expect(staticNames).not.toContain('search-tools');
    await expect(harness.rpc(staticSession, 'resources/list', {})).rejects.toThrow();
    await expect(harness.rpc(staticSession, 'prompts/list', {})).rejects.toThrow();
    await expect(
      harness.rpc(staticSession, 'completion/complete', {
        ref: { type: 'ref/prompt', name: 'inbox-triage' },
        argument: { name: 'alias', value: 'me' },
      })
    ).rejects.toThrow();
  });

  it('AC-02 AC-03: resources/list/read and prompts/list/get are available for discovery tenants', async () => {
    const resources = await harness.rpc<{ resources: Array<{ uri: string }> }>(
      sessionId,
      'resources/list',
      {}
    );
    expect(resources.resources.map((resource) => resource.uri)).toContain(
      'mcp://catalog/navigation-guide.md'
    );

    const templates = await harness.rpc<{ resourceTemplates: Array<{ uriTemplate: string }> }>(
      sessionId,
      'resources/templates/list',
      {}
    );
    expect(templates.resourceTemplates.some((template) => template.uriTemplate.includes('endpoint'))).toBe(
      true
    );

    const read = await harness.rpc<{ contents: Array<{ text: string }> }>(sessionId, 'resources/read', {
      uri: 'mcp://catalog/navigation-guide.md',
    });
    expect(read.contents[0]!.text).toContain('search-tools');

    const prompts = await harness.rpc<{ prompts: Array<{ name: string }> }>(
      sessionId,
      'prompts/list',
      {}
    );
    expect(prompts.prompts).toHaveLength(10);
    const prompt = await harness.rpc<{ messages: Array<{ content: { text: string } }> }>(
      sessionId,
      'prompts/get',
      { name: 'inbox-triage', arguments: { account: 'alex@example.com', since: 'today' } }
    );
    expect(prompt.messages[0]!.content.text).toContain('alex@example.com');
  });

  it('AC-04 AC-05: search-tools -> get-tool-schema -> execute-tool targets generated Graph/product aliases via discoveryCatalogSet', async () => {
    const discoveryCatalogSet = resolveDiscoveryCatalog({
      presetVersion: DISCOVERY_PRESET_VERSION,
      enabledToolsSet: DISCOVERY_META_TOOL_NAMES,
      registryAliases: [GRAPH_ALIAS, PRODUCT_ALIAS, ...DISCOVERY_TOOL_NAMES],
    }).discoveryCatalogSet;
    expect(discoveryCatalogSet.has(GRAPH_ALIAS)).toBe(true);
    expect(discoveryCatalogSet.has(PRODUCT_ALIAS)).toBe(true);
    expect(DISCOVERY_META_TOOL_NAMES.has(GRAPH_ALIAS)).toBe(false);

    const search = await harness.callTool(sessionId, 'search-tools', {
      query: 'messages',
      limit: 10,
    });
    const searchBody = JSON.parse(search.content[0]!.text) as {
      tools: Array<{ name: string }>;
    };
    expect(searchBody.tools.map((tool) => tool.name)).toContain(GRAPH_ALIAS);

    const schema = await harness.callTool(sessionId, 'get-tool-schema', { tool_name: GRAPH_ALIAS });
    expect(schema.isError).toBeFalsy();
    expect(schema.content[0]!.text).toContain(GRAPH_ALIAS);

    const executed = await harness.callTool(sessionId, 'execute-tool', {
      tool_name: GRAPH_ALIAS,
      parameters: {},
    });
    expect(executed.isError).toBeFalsy();
    expect(JSON.parse(executed.content[0]!.text)).toMatchObject({ value: [{ id: 'msg-1' }] });
    expect(harness.graphRequests.length).toBeGreaterThan(0);
  });

  it('AC-06 AC-08: bookmark-tool/save-recipe/run-recipe/record-fact survive reconnect and emit resources/updated under 2000 ms', async () => {
    const bookmarkStarted = Date.now();
    const bookmark = await harness.callTool(sessionId, 'bookmark-tool', {
      alias: GRAPH_ALIAS,
      label: 'mail list',
      note: 'starter bookmark',
    });
    expect(bookmark.isError).toBeFalsy();
    const bookmarkElapsed = await harness.waitForEvent('resources/updated', (event) =>
      JSON.stringify(event).includes(`mcp://tenant/${DISCOVERY_TENANT_ID}/bookmarks.json`)
    );
    expect(bookmarkElapsed).toBeLessThan(2000);
    expect(Date.now() - bookmarkStarted).toBeLessThan(2000);

    const bookmarks = await harness.callTool(sessionId, 'list-bookmarks', {});
    expect(bookmarks.content[0]!.text).toContain(GRAPH_ALIAS);

    await expect(
      harness.callTool(sessionId, 'save-recipe', {
        name: 'list recent mail',
        alias: GRAPH_ALIAS,
        params: {},
        note: 'E2E recipe',
      })
    ).resolves.toMatchObject({ isError: undefined });
    const runRecipe = await harness.callTool(sessionId, 'run-recipe', {
      name: 'list recent mail',
    });
    expect(runRecipe.isError).toBeFalsy();

    const factText = 'Prefer concise mailbox summaries in reconnect tests.';
    const fact = await harness.callTool(sessionId, 'record-fact', {
      scope: 'mailbox',
      fact: factText,
    });
    expect(fact.isError).toBeFalsy();

    const reconnected = await harness.initialize();
    const recalled = await harness.callTool(reconnected, 'recall-facts', { scope: 'mailbox' });
    expect(recalled.content[0]!.text).toContain(factText);
  });

  it('AC-07: admin PATCH publishes tools/list_changed under 2000 ms', async () => {
    const started = Date.now();
    await harness.patchTenantPreset(DISCOVERY_TENANT_ID, 'essentials-v1');
    const elapsed = await harness.waitForEvent('tools/list_changed', (event) =>
      JSON.stringify(event).includes(DISCOVERY_TENANT_ID)
    );
    expect(elapsed).toBeLessThan(2000);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

async function createDiscoveryE2EHarness(): Promise<DiscoveryE2EHarness> {
  throw new Error('discovery E2E harness not implemented');
}

void presetFor;
