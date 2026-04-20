/**
 * Plan 05-04 Task 2 — two-tenant dispatch isolation (integration).
 *
 * Validates cross-tenant leakage is impossible when two tenants hold
 * disjoint enabled_tools_set values. The test drives concurrent `executeGraphTool`
 * invocations for each tenant via `Promise.all` and asserts:
 *   - Tenant A (NULL enabled_tools, preset=essentials-v1) can dispatch
 *     preset tools but not `other-op` / `__beta__*`.
 *   - Tenant B (enabled_tools = "users-list,mail-send" replacement) can
 *     dispatch `users-list` + `mail-send` but NOT `other-op`.
 *   - Neither tenant's rejection envelope references the other's tenantId.
 *   - Repeated interleaved calls (20 iterations) never leak sets between
 *     concurrent requestContext frames (T-05-08 AsyncLocalStorage seam).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type GraphClient from '../../src/graph-client.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  rawPinoLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  enableConsoleLogging: vi.fn(),
}));

vi.mock('../../src/generated/client.js', () => ({
  api: {
    endpoints: [
      { alias: 'mail-send', method: 'POST', path: '/me/sendMail', description: '', parameters: [] },
      { alias: 'users-list', method: 'GET', path: '/users', description: '', parameters: [] },
      { alias: 'other-op', method: 'GET', path: '/other', description: '', parameters: [] },
    ],
  },
}));

vi.mock('../../src/lib/tool-selection/preset-loader.js', () => {
  // Tenant A's preset: mail-send only.
  const PRESET = Object.freeze(new Set<string>(['mail-send']));
  const EMPTY = Object.freeze(new Set<string>());
  return {
    ESSENTIALS_V1_OPS: PRESET,
    DEFAULT_PRESET_VERSION: 'essentials-v1',
    presetFor: (version: string): ReadonlySet<string> =>
      version === 'essentials-v1' ? PRESET : EMPTY,
  };
});

function makeGraphClient(): GraphClient {
  return {
    graphRequest: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
    }),
  } as unknown as GraphClient;
}

function captureHandlers(
  registerGraphTools: typeof import('../../src/graph-tools.js').registerGraphTools
) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<{ content: unknown[]; isError?: boolean }>
  >();
  const toolSpy = vi.spyOn(server, 'tool').mockImplementation(((
    name: string,
    ..._rest: unknown[]
  ) => {
    const handler = _rest[_rest.length - 1];
    if (typeof handler === 'function') {
      handlers.set(
        name,
        handler as (
          args: Record<string, unknown>
        ) => Promise<{ content: unknown[]; isError?: boolean }>
      );
    }
    return { register: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);

  registerGraphTools(server, makeGraphClient(), false);
  toolSpy.mockRestore();
  return handlers;
}

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('plan 05-04 Task 2 — two-tenant dispatch isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 4: disjoint enabled sets produce disjoint dispatch behavior', async () => {
    const { registerGraphTools } = await import('../../src/graph-tools.js');
    const { requestContext } = await import('../../src/request-context.js');
    const { presetFor } = await import('../../src/lib/tool-selection/preset-loader.js');
    const { computeEnabledToolsSet } =
      await import('../../src/lib/tool-selection/enabled-tools-parser.js');

    const handlers = captureHandlers(registerGraphTools);
    const sendMail = handlers.get('mail-send')!;
    const usersList = handlers.get('users-list')!;
    const otherOp = handlers.get('other-op')!;

    // Tenant A: NULL enabled_tools → preset (mail-send only)
    const tenantAEnabled = presetFor('essentials-v1');
    // Tenant B: replacement mode "users-list,mail-send"
    const tenantBEnabled = computeEnabledToolsSet('users-list,mail-send', 'essentials-v1');

    const runAs = async (
      tenantId: string,
      enabled: ReadonlySet<string>,
      handler: typeof sendMail,
      _label: string
    ): Promise<{ isError?: boolean; content: unknown[] }> =>
      requestContext.run(
        { tenantId, enabledToolsSet: enabled, presetVersion: 'essentials-v1' },
        async () => handler({})
      );

    // Tenant A: mail-send passes
    const aMail = await runAs(TENANT_A, tenantAEnabled, sendMail, 'A/mail-send');
    expect(aMail.isError).toBeFalsy();

    // Tenant A: users-list rejects (not in preset)
    const aUsers = await runAs(TENANT_A, tenantAEnabled, usersList, 'A/users-list');
    expect(aUsers.isError).toBe(true);
    const aUsersPayload = JSON.parse((aUsers.content[0] as { text: string }).text);
    expect(aUsersPayload.tenantId).toBe(TENANT_A);
    // Rejection for tenant A MUST NOT mention tenant B
    expect((aUsers.content[0] as { text: string }).text).not.toContain(TENANT_B);

    // Tenant A: other-op rejects
    const aOther = await runAs(TENANT_A, tenantAEnabled, otherOp, 'A/other-op');
    expect(aOther.isError).toBe(true);

    // Tenant B: mail-send passes
    const bMail = await runAs(TENANT_B, tenantBEnabled, sendMail, 'B/mail-send');
    expect(bMail.isError).toBeFalsy();

    // Tenant B: users-list passes
    const bUsers = await runAs(TENANT_B, tenantBEnabled, usersList, 'B/users-list');
    expect(bUsers.isError).toBeFalsy();

    // Tenant B: other-op rejects
    const bOther = await runAs(TENANT_B, tenantBEnabled, otherOp, 'B/other-op');
    expect(bOther.isError).toBe(true);
    const bOtherPayload = JSON.parse((bOther.content[0] as { text: string }).text);
    expect(bOtherPayload.tenantId).toBe(TENANT_B);
    expect((bOther.content[0] as { text: string }).text).not.toContain(TENANT_A);
  });

  it('concurrent interleaved calls never leak sets across AsyncLocalStorage frames', async () => {
    const { registerGraphTools } = await import('../../src/graph-tools.js');
    const { requestContext } = await import('../../src/request-context.js');
    const { presetFor } = await import('../../src/lib/tool-selection/preset-loader.js');
    const { computeEnabledToolsSet } =
      await import('../../src/lib/tool-selection/enabled-tools-parser.js');

    const handlers = captureHandlers(registerGraphTools);
    const usersList = handlers.get('users-list')!;

    const tenantAEnabled = presetFor('essentials-v1'); // mail-send only
    const tenantBEnabled = computeEnabledToolsSet('users-list,mail-send', 'essentials-v1');

    // 20 interleaved calls — half tenant A, half tenant B — all hitting usersList
    const calls: Array<Promise<{ tenant: string; isError: boolean }>> = [];
    for (let i = 0; i < 10; i++) {
      calls.push(
        requestContext.run(
          {
            tenantId: TENANT_A,
            enabledToolsSet: tenantAEnabled,
            presetVersion: 'essentials-v1',
          },
          async () => {
            await new Promise((r) => setTimeout(r, Math.random() * 3));
            const r = await usersList({});
            return { tenant: TENANT_A, isError: Boolean(r.isError) };
          }
        )
      );
      calls.push(
        requestContext.run(
          {
            tenantId: TENANT_B,
            enabledToolsSet: tenantBEnabled,
            presetVersion: 'essentials-v1',
          },
          async () => {
            await new Promise((r) => setTimeout(r, Math.random() * 3));
            const r = await usersList({});
            return { tenant: TENANT_B, isError: Boolean(r.isError) };
          }
        )
      );
    }

    const results = await Promise.all(calls);

    // Tenant A always rejects users-list; tenant B always passes
    const tenantAResults = results.filter((r) => r.tenant === TENANT_A);
    const tenantBResults = results.filter((r) => r.tenant === TENANT_B);

    expect(tenantAResults).toHaveLength(10);
    expect(tenantBResults).toHaveLength(10);
    for (const r of tenantAResults) {
      expect(r.isError).toBe(true);
    }
    for (const r of tenantBResults) {
      expect(r.isError).toBe(false);
    }
  });

  it('tenant A set and tenant B set are not identity-equal (different Set objects)', async () => {
    const { presetFor } = await import('../../src/lib/tool-selection/preset-loader.js');
    const { computeEnabledToolsSet } =
      await import('../../src/lib/tool-selection/enabled-tools-parser.js');
    const aSet = presetFor('essentials-v1');
    const bSet = computeEnabledToolsSet('users-list,mail-send', 'essentials-v1');
    // Must be distinct Set instances — the tenant-isolation invariant
    expect(aSet).not.toBe(bSet);
    // And have different contents
    expect(aSet.size).toBe(1);
    expect(bSet.size).toBe(2);
  });
});
