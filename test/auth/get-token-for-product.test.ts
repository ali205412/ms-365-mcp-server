/**
 * Plan 05.1-06 Task 2 — AuthManager.getTokenForProduct tests.
 *
 * Exercises:
 *   - Per-product MSAL acquireTokenSilent with the correct .default scope.
 *   - Composite cache key ${tenantId}:${product} isolation.
 *   - 60-second safety buffer on the expiry check.
 *   - Error propagation when MSAL throws (cache NOT populated).
 *   - evictProductTokensForTenant — drops only matching tenant entries.
 *
 * Tests A1-A6 (6 tests). Uses vi.hoisted + vi.mock for @azure/msal-node so
 * we never touch real MSAL.
 *
 * Threat mitigations pinned:
 *   - T-5.1-06-a (product-token audience confusion): Test A1 verifies the
 *     product-specific `.default` scope flows through to acquireTokenSilent.
 *   - T-5.1-06-b (cross-tenant product-cache leak): Test A6 verifies
 *     eviction isolates by tenant.
 *   - T-5.1-06-f (disabled-tenant stale cache): Test A6 surfaces the
 *     eviction API hook that TenantPool.disable must call (deferred wiring
 *     to Phase 3 TENANT-07).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { msalHoisted, loggerHoisted } = vi.hoisted(() => {
  return {
    msalHoisted: {
      acquireTokenSilent: vi.fn(),
      getTokenCache: vi.fn(() => ({
        getAllAccounts: vi.fn(async () => [
          { homeAccountId: 'home-1', username: 'user@example.com' },
        ]),
        deserialize: vi.fn(),
        serialize: vi.fn(() => ''),
        removeAccount: vi.fn(),
      })),
    },
    loggerHoisted: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('@azure/msal-node', () => ({
  PublicClientApplication: vi.fn().mockImplementation(() => msalHoisted),
}));

vi.mock('../../src/logger.js', () => ({
  default: loggerHoisted,
}));

// Mock cloud-config to avoid importing endpoints.json chain in AuthManager.
vi.mock('../../src/cloud-config.js', () => ({
  getCloudEndpoints: () => ({
    authority: 'https://login.microsoftonline.com',
    graphApi: 'https://graph.microsoft.com',
  }),
  getDefaultClientId: () => 'fake-client-id',
}));

import AuthManager from '../../src/auth.js';

function makeAuthManager() {
  const am = new AuthManager(
    {
      auth: {
        clientId: 'fake-client-id',
        authority: 'https://login.microsoftonline.com/common',
      },
    },
    []
  );
  return am;
}

describe('plan 05.1-06 Task 2 — AuthManager.getTokenForProduct', () => {
  beforeEach(() => {
    msalHoisted.acquireTokenSilent.mockReset();
    loggerHoisted.error.mockReset();
  });

  it('Test A1: cache miss → calls acquireTokenSilent with product scope; writes cache', async () => {
    msalHoisted.acquireTokenSilent.mockResolvedValueOnce({
      accessToken: 'pbi-token-1',
      expiresOn: new Date(Date.now() + 30 * 60_000),
    });

    const am = makeAuthManager();
    const token = await am.getTokenForProduct('tenant-a', 'powerbi');

    expect(token).toBe('pbi-token-1');
    expect(msalHoisted.acquireTokenSilent).toHaveBeenCalledTimes(1);
    const call = msalHoisted.acquireTokenSilent.mock.calls[0][0];
    expect(call.scopes).toEqual(['https://analysis.windows.net/powerbi/api/.default']);
  });

  it('Test A2: cache hit (valid expiry) → returns cached token; does NOT call MSAL', async () => {
    msalHoisted.acquireTokenSilent.mockResolvedValueOnce({
      accessToken: 'pbi-token-cached',
      expiresOn: new Date(Date.now() + 30 * 60_000),
    });

    const am = makeAuthManager();
    const t1 = await am.getTokenForProduct('tenant-a', 'powerbi');
    expect(t1).toBe('pbi-token-cached');
    expect(msalHoisted.acquireTokenSilent).toHaveBeenCalledTimes(1);

    // Second call within the expiry window — must be served from cache.
    const t2 = await am.getTokenForProduct('tenant-a', 'powerbi');
    expect(t2).toBe('pbi-token-cached');
    expect(msalHoisted.acquireTokenSilent).toHaveBeenCalledTimes(1); // no increment
  });

  it('Test A3: cache hit (expired within 60s buffer) → calls MSAL again', async () => {
    msalHoisted.acquireTokenSilent
      .mockResolvedValueOnce({
        accessToken: 'pbi-token-near-expiry',
        // Expires in 30s — within the 60s safety buffer.
        expiresOn: new Date(Date.now() + 30_000),
      })
      .mockResolvedValueOnce({
        accessToken: 'pbi-token-refreshed',
        expiresOn: new Date(Date.now() + 30 * 60_000),
      });

    const am = makeAuthManager();
    const t1 = await am.getTokenForProduct('tenant-a', 'powerbi');
    expect(t1).toBe('pbi-token-near-expiry');

    const t2 = await am.getTokenForProduct('tenant-a', 'powerbi');
    // Near-expiry cache was skipped → a second MSAL call happened.
    expect(t2).toBe('pbi-token-refreshed');
    expect(msalHoisted.acquireTokenSilent).toHaveBeenCalledTimes(2);
  });

  it('Test A4: sp-admin with absent sharepointDomain → throws before calling MSAL', async () => {
    const am = makeAuthManager();
    await expect(am.getTokenForProduct('tenant-a', 'sp-admin')).rejects.toThrow(
      /sharepoint_domain not configured/i
    );
    // MSAL must NOT be called when the product scope can't be computed.
    expect(msalHoisted.acquireTokenSilent).not.toHaveBeenCalled();
  });

  it('Test A5: MSAL throws → propagates error with logger.error; does NOT cache', async () => {
    msalHoisted.acquireTokenSilent.mockRejectedValueOnce(new Error('AADSTS something bad'));

    const am = makeAuthManager();
    await expect(am.getTokenForProduct('tenant-a', 'powerbi')).rejects.toThrow(/AADSTS/);
    expect(loggerHoisted.error).toHaveBeenCalled();

    // Next call with fresh MSAL success: must hit MSAL again (cache was NOT
    // populated on the failed acquire).
    msalHoisted.acquireTokenSilent.mockResolvedValueOnce({
      accessToken: 'recovered-token',
      expiresOn: new Date(Date.now() + 30 * 60_000),
    });
    const t2 = await am.getTokenForProduct('tenant-a', 'powerbi');
    expect(t2).toBe('recovered-token');
    expect(msalHoisted.acquireTokenSilent).toHaveBeenCalledTimes(2);
  });

  it('Test A6: evictProductTokensForTenant drops matching tenant entries only', async () => {
    msalHoisted.acquireTokenSilent.mockImplementation(async (req: { scopes: string[] }) => ({
      accessToken: `token-for-${req.scopes[0]}`,
      expiresOn: new Date(Date.now() + 30 * 60_000),
    }));

    const am = makeAuthManager();
    // Seed cache with 3 entries.
    await am.getTokenForProduct('tenantA', 'powerbi');
    await am.getTokenForProduct('tenantA', 'exo', {
      tenantAzureId: '12345678-1234-4567-8901-123456789012',
    });
    await am.getTokenForProduct('tenantB', 'powerbi');
    expect(msalHoisted.acquireTokenSilent).toHaveBeenCalledTimes(3);

    // Evict tenantA → tenantA entries gone; tenantB entry unaffected.
    am.evictProductTokensForTenant('tenantA');

    // tenantA re-fetch must call MSAL again.
    msalHoisted.acquireTokenSilent.mockClear();
    await am.getTokenForProduct('tenantA', 'powerbi');
    expect(msalHoisted.acquireTokenSilent).toHaveBeenCalledTimes(1);

    // tenantB cached — no MSAL call.
    msalHoisted.acquireTokenSilent.mockClear();
    const tB = await am.getTokenForProduct('tenantB', 'powerbi');
    expect(tB).toBe('token-for-https://analysis.windows.net/powerbi/api/.default');
    expect(msalHoisted.acquireTokenSilent).not.toHaveBeenCalled();
  });
});
