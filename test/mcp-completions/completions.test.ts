import { describe, expect, it, vi } from 'vitest';
import { requestContext } from '../../src/request-context.js';
import {
  DISCOVERY_META_TOOL_NAMES,
  DISCOVERY_PRESET_VERSION,
} from '../../src/lib/tenant-surface/surface.js';
import {
  completeAccount,
  completeAlias,
  completeTenantId,
} from '../../src/lib/mcp-completions/handlers.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';

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

    const delegated = await requestContext.run(
      { ...discoveryContext(), flow: 'delegated' },
      () => completeAccount('av', { authManager })
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

    const appOnly = await requestContext.run(
      { ...discoveryContext(), flow: 'app-only' },
      () => completeAccount('a', { authManager })
    );
    const bearer = await requestContext.run(
      { ...discoveryContext(), flow: 'bearer' },
      () => completeAccount('a', { authManager })
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
