/**
 * Plan 03-04 Task 2 — src/lib/crypto/kek.ts unit tests (SECUR-01 / D-12).
 *
 * Behaviors covered:
 *   1. Env source: valid 32-byte MS365_MCP_KEK loads; cached on second call
 *   2. Invalid env length (16 bytes) throws
 *   3. Production + both sources empty → throws
 *   4. Key Vault path (mocked) returns secret → decoded + cached
 *   5. Env + Key Vault both set → env wins (D-12)
 *   6. clearKekCache() forces re-read
 *   7. Dev mode (neither source) → warns + returns 32-byte zero buffer
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// MUST mock @azure/keyvault-secrets + @azure/identity BEFORE importing kek.
// The lazy dynamic imports inside loadKek() resolve to these mocks.
const mockGetSecret = vi.fn();
vi.mock('@azure/keyvault-secrets', () => ({
  SecretClient: vi.fn().mockImplementation(() => ({
    getSecret: mockGetSecret,
  })),
}));
vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn().mockImplementation(() => ({})),
}));

// Import AFTER the mocks are registered.
import { loadKek, clearKekCache } from '../../src/lib/crypto/kek.js';

describe('plan 03-04 Task 2 — kek.ts (SECUR-01 / D-12)', () => {
  const validKekB64 = Buffer.alloc(32, 0x42).toString('base64');
  const vaultKekB64 = Buffer.alloc(32, 0x99).toString('base64');

  beforeEach(() => {
    clearKekCache();
    mockGetSecret.mockReset();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    clearKekCache();
    vi.unstubAllEnvs();
  });

  it('loads MS365_MCP_KEK from env (32 bytes) and caches', async () => {
    vi.stubEnv('MS365_MCP_KEK', validKekB64);
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', '');
    vi.stubEnv('NODE_ENV', '');

    const a = await loadKek();
    expect(a.length).toBe(32);
    expect(a[0]).toBe(0x42);

    // Second call should return cached same Buffer.
    const b = await loadKek();
    expect(b).toBe(a);
  });

  it('throws when MS365_MCP_KEK decodes to 16 bytes (not 32)', async () => {
    vi.stubEnv('MS365_MCP_KEK', Buffer.alloc(16, 0).toString('base64'));
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', '');

    await expect(loadKek()).rejects.toThrow(/MS365_MCP_KEK must decode to exactly 32 bytes/);
  });

  it('refuses to start in NODE_ENV=production when neither source is set', async () => {
    vi.stubEnv('MS365_MCP_KEK', '');
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', '');
    vi.stubEnv('NODE_ENV', 'production');

    await expect(loadKek()).rejects.toThrow(/No KEK source available/);
  });

  it('loads KEK from Azure Key Vault when only MS365_MCP_KEYVAULT_URL is set', async () => {
    vi.stubEnv('MS365_MCP_KEK', '');
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', 'https://test-vault.vault.azure.net/');

    mockGetSecret.mockResolvedValueOnce({ value: vaultKekB64 });

    const buf = await loadKek();
    expect(buf.length).toBe(32);
    expect(buf[0]).toBe(0x99);
    expect(mockGetSecret).toHaveBeenCalledWith('mcp-kek');
  });

  it('env MS365_MCP_KEK wins when both env and Key Vault are configured (D-12)', async () => {
    vi.stubEnv('MS365_MCP_KEK', validKekB64); // 0x42 bytes
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', 'https://test-vault.vault.azure.net/');

    mockGetSecret.mockResolvedValueOnce({ value: vaultKekB64 }); // 0x99 bytes

    const buf = await loadKek();
    expect(buf[0]).toBe(0x42); // env value, not vault value
    // Key Vault should not even be reached.
    expect(mockGetSecret).not.toHaveBeenCalled();
  });

  it('clearKekCache() forces the next loadKek to re-read the source', async () => {
    vi.stubEnv('MS365_MCP_KEK', validKekB64);
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', '');

    const first = await loadKek();
    clearKekCache();

    // Stub a different value — re-read should pick it up.
    const differentKek = Buffer.alloc(32, 0x77).toString('base64');
    vi.stubEnv('MS365_MCP_KEK', differentKek);

    const second = await loadKek();
    expect(second).not.toBe(first);
    expect(second[0]).toBe(0x77);
  });

  it('dev mode (non-production, no sources) returns fixed all-zero KEK with a warning', async () => {
    vi.stubEnv('MS365_MCP_KEK', '');
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', '');
    vi.stubEnv('NODE_ENV', 'development');

    const buf = await loadKek();
    expect(buf.length).toBe(32);
    expect(buf.every((b) => b === 0)).toBe(true);
  });

  it('throws when Key Vault returns an empty secret value', async () => {
    vi.stubEnv('MS365_MCP_KEK', '');
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', 'https://test-vault.vault.azure.net/');

    mockGetSecret.mockResolvedValueOnce({ value: undefined });

    await expect(loadKek()).rejects.toThrow(/Key Vault secret mcp-kek has no value/);
  });

  it('throws when Key Vault returns a secret of wrong length', async () => {
    vi.stubEnv('MS365_MCP_KEK', '');
    vi.stubEnv('MS365_MCP_KEYVAULT_URL', 'https://test-vault.vault.azure.net/');

    mockGetSecret.mockResolvedValueOnce({ value: Buffer.alloc(16, 0).toString('base64') });

    await expect(loadKek()).rejects.toThrow(/Key Vault mcp-kek must decode to exactly 32 bytes/);
  });
});
