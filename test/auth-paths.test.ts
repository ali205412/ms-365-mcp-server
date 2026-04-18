import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// Portable tmpdir-based paths so these tests pass on Windows + BSD + macOS +
// Linux alike. Previously this suite used a hardcoded POSIX tmp path which
// failed on Windows (Plan 01-09 / Test-portability fix).
const TEST_TOKEN_CACHE = path.join(os.tmpdir(), 'ms365-mcp-test-cache', '.token-cache.json');
const TEST_SELECTED_ACCOUNT = path.join(
  os.tmpdir(),
  'ms365-mcp-test-cache',
  '.selected-account.json'
);

describe('token cache path configuration', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importHelpers() {
    const mod = await import('../src/auth.js');
    return {
      getTokenCachePath: mod.getTokenCachePath,
      getSelectedAccountPath: mod.getSelectedAccountPath,
    };
  }

  describe('getTokenCachePath', () => {
    it('should return default path when env var is not set', async () => {
      vi.stubEnv('MS365_MCP_TOKEN_CACHE_PATH', '');
      const { getTokenCachePath } = await importHelpers();
      const result = getTokenCachePath();
      expect(result).toContain('.token-cache.json');
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should return env var path when set', async () => {
      vi.stubEnv('MS365_MCP_TOKEN_CACHE_PATH', TEST_TOKEN_CACHE);
      const { getTokenCachePath } = await importHelpers();
      const result = getTokenCachePath();
      expect(result).toBe(TEST_TOKEN_CACHE);
    });

    it('should trim whitespace from env var', async () => {
      vi.stubEnv('MS365_MCP_TOKEN_CACHE_PATH', `  ${TEST_TOKEN_CACHE}  `);
      const { getTokenCachePath } = await importHelpers();
      const result = getTokenCachePath();
      expect(result).toBe(TEST_TOKEN_CACHE);
    });

    it('should return default path when env var is undefined', async () => {
      delete process.env.MS365_MCP_TOKEN_CACHE_PATH;
      const { getTokenCachePath } = await importHelpers();
      const result = getTokenCachePath();
      expect(result).toContain('.token-cache.json');
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('getSelectedAccountPath', () => {
    it('should return default path when env var is not set', async () => {
      vi.stubEnv('MS365_MCP_SELECTED_ACCOUNT_PATH', '');
      const { getSelectedAccountPath } = await importHelpers();
      const result = getSelectedAccountPath();
      expect(result).toContain('.selected-account.json');
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should return env var path when set', async () => {
      vi.stubEnv('MS365_MCP_SELECTED_ACCOUNT_PATH', TEST_SELECTED_ACCOUNT);
      const { getSelectedAccountPath } = await importHelpers();
      const result = getSelectedAccountPath();
      expect(result).toBe(TEST_SELECTED_ACCOUNT);
    });

    it('should trim whitespace from env var', async () => {
      vi.stubEnv('MS365_MCP_SELECTED_ACCOUNT_PATH', `  ${TEST_SELECTED_ACCOUNT}  `);
      const { getSelectedAccountPath } = await importHelpers();
      const result = getSelectedAccountPath();
      expect(result).toBe(TEST_SELECTED_ACCOUNT);
    });

    it('should return default path when env var is undefined', async () => {
      delete process.env.MS365_MCP_SELECTED_ACCOUNT_PATH;
      const { getSelectedAccountPath } = await importHelpers();
      const result = getSelectedAccountPath();
      expect(result).toContain('.selected-account.json');
      expect(path.isAbsolute(result)).toBe(true);
    });
  });
});
