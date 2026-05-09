/**
 * Plan 05.1-06 Task 2 — product-routing dispatch tests.
 *
 * Exercises:
 *   - resolveProductDispatch (pure): prefix → {product, scope, baseUrl,
 *     retryHandler} resolution.
 *   - Structured MCP error envelopes with `mcpError.code` on missing
 *     sharepoint_domain / invalid tenantAzureId.
 *   - executeProductTool: end-to-end delegation to authManager.getTokenForProduct
 *     and graphClient.graphRequest with product baseUrl + accessToken.
 *
 * Tests R1-R6 (6 tests). Uses fake AuthManager + GraphClient mocks.
 *
 * Threat mitigations pinned:
 *   - T-5.1-06-c (sharepoint_domain injection): Test R2 pins structured
 *     error with actionable hint.
 *   - T-5.1-06-e (sp_admin_not_configured returns 500 instead of structured
 *     error): Test R2 + R6 pin the `.mcpError.code === 'sp_admin_not_configured'`
 *     + `isError: true` + `content[0].text` JSON envelope.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  resolveProductDispatch,
  executeProductTool,
} from '../../src/lib/dispatch/product-routing.js';
import type AuthManager from '../../src/auth.js';
import type GraphClient from '../../src/graph-client.js';

describe('plan 05.1-06 Task 2 — product dispatch routing', () => {
  it('Test R1: resolveProductDispatch("__powerbi__list-workspaces", {}) returns full plan', () => {
    const plan = resolveProductDispatch('__powerbi__list-workspaces', {});
    expect(plan).toEqual({
      product: 'powerbi',
      strippedAlias: 'list-workspaces',
      scope: 'https://analysis.windows.net/powerbi/api/.default',
      baseUrl: 'https://api.powerbi.com/v1.0/myorg',
      retryHandler: 'default',
    });
  });

  it('Test R2: sp-admin dispatch with absent sharepointDomain throws mcpError sp_admin_not_configured', () => {
    let caught: unknown = null;
    try {
      resolveProductDispatch('__spadmin__list-sites', { sharepointDomain: undefined });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const typed = caught as Error & { mcpError?: { code: string; hint: string } };
    expect(typed.mcpError).toBeDefined();
    expect(typed.mcpError!.code).toBe('sp_admin_not_configured');
    expect(typed.mcpError!.hint).toMatch(/admin.*PATCH.*sharepoint_domain/i);
  });

  it('Test R3: exo dispatch with malformed tenantAzureId throws mcpError product_dispatch_invalid', () => {
    let caught: unknown = null;
    try {
      resolveProductDispatch('__exo__get-mailbox', { tenantAzureId: 'not-a-uuid' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const typed = caught as Error & { mcpError?: { code: string; hint: string } };
    expect(typed.mcpError).toBeDefined();
    expect(typed.mcpError!.code).toBe('product_dispatch_invalid');
  });

  it('Test R4: resolveProductDispatch("list-mail-messages", {}) returns null (not a product alias)', () => {
    expect(resolveProductDispatch('list-mail-messages', {})).toBeNull();
    expect(resolveProductDispatch('__beta__users', {})).toBeNull();
    expect(resolveProductDispatch('get-me', {})).toBeNull();
  });

  it('Test R5: executeProductTool acquires product token + calls graphRequest with product baseUrl', async () => {
    const fakeGraphRequest = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ value: ['workspace-1'] }) }],
    });
    const fakeGetTokenForProduct = vi.fn().mockResolvedValue('pbi-access-token');

    const authManager = {
      getTokenForProduct: fakeGetTokenForProduct,
    } as unknown as AuthManager;
    const graphClient = {
      graphRequest: fakeGraphRequest,
    } as unknown as GraphClient;

    const result = await executeProductTool(
      '__powerbi__list-workspaces',
      { $top: '10' },
      authManager,
      graphClient,
      { tenantId: 'tenantA' }
    );

    expect(fakeGetTokenForProduct).toHaveBeenCalledWith('tenantA', 'powerbi', {
      sharepointDomain: undefined,
      tenantAzureId: undefined,
    });
    expect(fakeGraphRequest).toHaveBeenCalledTimes(1);
    const [path, options] = fakeGraphRequest.mock.calls[0];
    expect(path).toBe('list-workspaces');
    expect(options.accessToken).toBe('pbi-access-token');
    expect(options.baseUrl).toBe('https://api.powerbi.com/v1.0/myorg');
    expect(options.retryHandler).toBe('default');
    // Normal result passes through unchanged.
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('workspace-1');
  });

  it('Test R5b: executeProductTool uses generated endpoint path and method when provided', async () => {
    const fakeGraphRequest = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ value: [] }) }],
    });
    const authManager = {
      getTokenForProduct: vi.fn().mockResolvedValue('pbi-access-token'),
    } as unknown as AuthManager;
    const graphClient = {
      graphRequest: fakeGraphRequest,
    } as unknown as GraphClient;

    await executeProductTool(
      '__powerbi__Groups_GetGroups',
      {},
      authManager,
      graphClient,
      { tenantId: 'tenantA' },
      { path: '/groups', method: 'GET' }
    );

    const [path, options] = fakeGraphRequest.mock.calls[0];
    expect(path).toBe('/groups');
    expect(options.method).toBe('GET');
    expect(options.baseUrl).toBe('https://api.powerbi.com/v1.0/myorg');
  });

  it('Test R6: executeProductTool for sp-admin missing sharepoint_domain returns structured MCP error', async () => {
    const fakeGetTokenForProduct = vi.fn();
    const fakeGraphRequest = vi.fn();
    const authManager = {
      getTokenForProduct: fakeGetTokenForProduct,
    } as unknown as AuthManager;
    const graphClient = {
      graphRequest: fakeGraphRequest,
    } as unknown as GraphClient;

    const result = await executeProductTool('__spadmin__list-sites', {}, authManager, graphClient, {
      tenantId: 'tenantA',
      sharepointDomain: null,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe('sp_admin_not_configured');
    expect(parsed.hint).toMatch(/admin.*PATCH.*sharepoint_domain/i);

    // Dispatch never reached auth / graph — the structured error short-circuits.
    expect(fakeGetTokenForProduct).not.toHaveBeenCalled();
    expect(fakeGraphRequest).not.toHaveBeenCalled();
  });

  it('Test R7: executeProductTool for sp-admin with sharepoint_domain resolves computed scope + baseUrl', async () => {
    const fakeGraphRequest = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"value":[]}' }],
    });
    const fakeGetTokenForProduct = vi.fn().mockResolvedValue('sp-token');
    const authManager = {
      getTokenForProduct: fakeGetTokenForProduct,
    } as unknown as AuthManager;
    const graphClient = {
      graphRequest: fakeGraphRequest,
    } as unknown as GraphClient;

    await executeProductTool('__spadmin__list-sites', {}, authManager, graphClient, {
      tenantId: 'tenantA',
      sharepointDomain: 'contoso',
    });

    expect(fakeGetTokenForProduct).toHaveBeenCalledWith('tenantA', 'sp-admin', {
      sharepointDomain: 'contoso',
      tenantAzureId: undefined,
    });
    const [, options] = fakeGraphRequest.mock.calls[0];
    expect(options.baseUrl).toBe(
      'https://contoso-admin.sharepoint.com/_api/SPO.TenantAdministrationOffice365Tenant'
    );
    expect(options.accessToken).toBe('sp-token');
    expect(options.retryHandler).toBe('sp-admin');
  });
});
