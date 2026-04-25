import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { requestContext } from '../../src/request-context.js';
import {
  DISCOVERY_META_TOOL_NAMES,
  DISCOVERY_PRESET_VERSION,
} from '../../src/lib/tenant-surface/surface.js';
import { parsePromptMarkdown } from '../../src/lib/mcp-prompts/frontmatter.js';
import {
  completeAccount,
  completeAlias,
  completeTenantId,
} from '../../src/lib/mcp-completions/handlers.js';
import MicrosoftGraphServer from '../../src/server.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const COMPLETABLE_PROMPT = `---
name: completion-fixture
description: Prompt with completable args
arguments:
  - name: tenantId
    description: Tenant id
  - name: account
    description: Account username
  - name: alias
    description: Graph alias
---
Use {{tenantId}} {{account}} {{alias}}.
`;

vi.mock('../../src/generated/client.js', () => ({
  api: {
    endpoints: [
      { alias: 'search-tools', method: 'get', path: '/meta/search' },
      { alias: 'get-tool-schema', method: 'get', path: '/meta/schema' },
      { alias: 'execute-tool', method: 'post', path: '/meta/execute' },
      ...Array.from({ length: 25 }, (_, index) => ({
        alias: `mail.generated${String(index).padStart(2, '0')}`,
        method: 'get',
        path: `/me/messages/${index}`,
      })),
      { alias: 'calendar.generated', method: 'get', path: '/me/events' },
    ],
  },
}));

function discoveryContext() {
  return {
    tenantId: TENANT_A,
    enabledToolsSet: DISCOVERY_META_TOOL_NAMES,
    presetVersion: DISCOVERY_PRESET_VERSION,
  };
}

function createGraphServer(
  authManagerOverrides: Record<string, unknown> = {}
): MicrosoftGraphServer {
  return new MicrosoftGraphServer(
    {
      isMultiAccount: vi.fn(async () => true),
      listAccounts: vi.fn(async () => [
        { username: 'alex@example.com' },
        { username: 'avery@example.com' },
      ]),
      ...authManagerOverrides,
    } as never,
    { http: true, orgMode: true },
    [],
    {
      promptDeps: {
        loadPrompts: () => [parsePromptMarkdown(COMPLETABLE_PROMPT, 'completion-fixture.md')],
      },
    } as never
  );
}

function capabilitiesOf(server: McpServer): { completions?: object; logging?: object } {
  return (
    server.server as unknown as {
      getCapabilities: () => { completions?: object; logging?: object };
    }
  ).getCapabilities();
}

async function invokeCompletion(
  server: McpServer,
  params: {
    ref: { type: 'ref/prompt'; name: string } | { type: 'ref/resource'; uri: string };
    argument: { name: string; value: string };
  }
): Promise<{ completion: { values: string[] } }> {
  const handler = (
    server.server as unknown as {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<unknown>>;
    }
  )._requestHandlers.get('completion/complete');
  if (!handler) {
    throw new Error('completion/complete handler not registered on McpServer');
  }
  return handler(
    { method: 'completion/complete', params },
    { requestId: 'test', sendNotification: vi.fn(), sendRequest: vi.fn() }
  ) as Promise<{ completion: { values: string[] } }>;
}

describe('Phase 7 Plan 07-09 Task 2 - MCP completion handlers', () => {
  it('tenantId completion returns the caller tenant id as the only result', () => {
    const result = requestContext.run(discoveryContext(), () => completeTenantId('anything'));

    expect(result).toEqual([TENANT_A]);
  });

  it('account completion calls listAccounts only for account-backed delegated and device-code contexts', async () => {
    const authManager = {
      listAccounts: vi.fn(async () => [
        { username: 'alex@example.com' },
        { username: 'avery@example.com' },
        { username: 'service@example.com' },
      ]),
    };

    const delegated = await requestContext.run({ ...discoveryContext(), flow: 'delegated' }, () =>
      completeAccount('av', { authManager })
    );
    const deviceCode = await requestContext.run(
      { ...discoveryContext(), flow: 'device-code' },
      () => completeAccount('alex', { authManager })
    );

    expect(delegated).toEqual(['avery@example.com']);
    expect(deviceCode).toEqual(['alex@example.com']);
    expect(authManager.listAccounts).toHaveBeenCalledTimes(2);
  });

  it('account completion returns empty results for app-only and bearer requests without listing accounts', async () => {
    const authManager = {
      listAccounts: vi.fn(async () => [{ username: 'alex@example.com' }]),
    };

    const appOnly = await requestContext.run({ ...discoveryContext(), flow: 'app-only' }, () =>
      completeAccount('a', { authManager })
    );
    const bearer = await requestContext.run({ ...discoveryContext(), flow: 'bearer' }, () =>
      completeAccount('a', { authManager })
    );

    expect(appOnly).toEqual([]);
    expect(bearer).toEqual([]);
    expect(authManager.listAccounts).not.toHaveBeenCalled();
  });

  it('alias completion searches discoveryCatalogSet, caps at 20, and excludes visible meta aliases', () => {
    const result = requestContext.run(discoveryContext(), () => completeAlias('mail'));

    expect(result).toHaveLength(20);
    expect(result.every((alias) => alias.startsWith('mail.generated'))).toBe(true);
    expect(result).not.toContain('search-tools');
    expect(result).not.toContain('get-tool-schema');
    expect(result).not.toContain('execute-tool');
  });

  it('missing tenant context returns empty completion results instead of the global registry', () => {
    expect(completeTenantId('')).toEqual([]);
    expect(completeAlias('mail')).toEqual([]);
  });
});

describe('Phase 7 Plan 07-09 Task 3 - MCP completion and logging registration', () => {
  it('createMcpServer advertises logging and completions only for discovery tenants', () => {
    const discoveryMcp = createGraphServer().createMcpServer({
      id: TENANT_A,
      preset_version: DISCOVERY_PRESET_VERSION,
      enabled_tools_set: DISCOVERY_META_TOOL_NAMES,
      allowed_scopes: ['Mail.Read'],
    } as never);
    const discoveryHandlers = (
      discoveryMcp.server as unknown as { _requestHandlers: Map<string, unknown> }
    )._requestHandlers;

    expect(capabilitiesOf(discoveryMcp).logging).toEqual({});
    expect(capabilitiesOf(discoveryMcp).completions).toEqual({});
    expect(discoveryHandlers.has('logging/setLevel')).toBe(true);
    expect(discoveryHandlers.has('completion/complete')).toBe(true);

    const staticEnabled = Object.freeze(new Set(['mail.generated00']));
    const staticMcp = createGraphServer().createMcpServer({
      id: TENANT_B,
      preset_version: 'essentials-v1',
      enabled_tools_set: staticEnabled,
      allowed_scopes: ['Mail.Read'],
    } as never);
    const staticHandlers = (
      staticMcp.server as unknown as { _requestHandlers: Map<string, unknown> }
    )._requestHandlers;

    expect(capabilitiesOf(staticMcp).logging).toBeUndefined();
    expect(capabilitiesOf(staticMcp).completions).toBeUndefined();
    expect(staticHandlers.has('logging/setLevel')).toBe(false);
    expect(staticHandlers.has('completion/complete')).toBe(false);
  });

  it('prompt tenantId, account, and alias arguments are SDK-completable', async () => {
    const authManager = {
      listAccounts: vi.fn(async () => [
        { username: 'alex@example.com' },
        { username: 'avery@example.com' },
      ]),
    };
    const mcp = createGraphServer(authManager).createMcpServer({
      id: TENANT_A,
      preset_version: DISCOVERY_PRESET_VERSION,
      enabled_tools_set: DISCOVERY_META_TOOL_NAMES,
      allowed_scopes: ['Mail.Read'],
    } as never);

    const ctx = { ...discoveryContext(), flow: 'delegated' as const };
    const tenant = await requestContext.run(ctx, () =>
      invokeCompletion(mcp, {
        ref: { type: 'ref/prompt', name: 'completion-fixture' },
        argument: { name: 'tenantId', value: '' },
      })
    );
    const account = await requestContext.run(ctx, () =>
      invokeCompletion(mcp, {
        ref: { type: 'ref/prompt', name: 'completion-fixture' },
        argument: { name: 'account', value: 'av' },
      })
    );
    const alias = await requestContext.run(ctx, () =>
      invokeCompletion(mcp, {
        ref: { type: 'ref/prompt', name: 'completion-fixture' },
        argument: { name: 'alias', value: 'mail' },
      })
    );

    expect(tenant.completion.values).toEqual([TENANT_A]);
    expect(account.completion.values).toEqual(['avery@example.com']);
    expect(alias.completion.values).toHaveLength(20);
    expect(alias.completion.values.every((value) => value.startsWith('mail.generated'))).toBe(true);
    expect(alias.completion.values).not.toContain('search-tools');
  });

  it('endpoint schema resource alias variable completes from discoveryCatalogSet, not visible meta tools', async () => {
    const mcp = createGraphServer().createMcpServer({
      id: TENANT_A,
      preset_version: DISCOVERY_PRESET_VERSION,
      enabled_tools_set: DISCOVERY_META_TOOL_NAMES,
      allowed_scopes: ['Mail.Read'],
    } as never);

    const result = await requestContext.run(discoveryContext(), () =>
      invokeCompletion(mcp, {
        ref: { type: 'ref/resource', uri: 'mcp://endpoint/{alias}.schema.json' },
        argument: { name: 'alias', value: 'mail' },
      })
    );

    expect(result.completion.values).toHaveLength(20);
    expect(result.completion.values.every((value) => value.startsWith('mail.generated'))).toBe(
      true
    );
    expect(result.completion.values).not.toContain('search-tools');
    expect(result.completion.values).not.toEqual([...DISCOVERY_META_TOOL_NAMES].slice(0, 20));
  });
});
