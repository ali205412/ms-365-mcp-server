/**
 * Plan 01-08 — SECUR-07 (keytar removal) + OPS-10 (Docker Compose + reverse-proxy refs).
 *
 * These assertions verify the clean-break per D-04:
 *   1. package.json / src/auth.ts / tsup external all free of keytar
 *   2. bin/check-keytar-leftovers.cjs + bin/migrate-tokens.mjs exist and are executable
 *   3. src/cli.ts registers the migrate-tokens subcommand
 *   4. CHANGELOG.md documents the breaking change
 *   5. examples/docker-compose/docker-compose.yml is security-hardened
 *   6. examples/reverse-proxy/Caddyfile disables SSE buffering
 *   7. Round-trip migration from staged v1 keytar → file cache → AuthManager.loadTokenCache works
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO = path.resolve(__dirname, '..');

describe('keytar removal (SECUR-07)', () => {
  it('Test 1: package.json has no keytar key', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    expect(pkg.dependencies?.keytar).toBeUndefined();
    expect(pkg.optionalDependencies?.keytar).toBeUndefined();
  });

  it('Test 2: package-lock.json has no node_modules/keytar entry (soft-assert)', () => {
    const lockPath = path.join(REPO, 'package-lock.json');
    if (!fs.existsSync(lockPath)) return; // nothing to assert
    const body = fs.readFileSync(lockPath, 'utf8');
    // Quoted key form is the canonical npm v3 lockfile path for the installed dep.
    expect(body).not.toContain('"node_modules/keytar"');
  });

  it('Test 3: src/auth.ts source does not reference keytar', () => {
    const src = fs.readFileSync(path.join(REPO, 'src', 'auth.ts'), 'utf8');
    expect(src.toLowerCase()).not.toContain('keytar');
  });

  it('Test 4: src/auth.ts source does not reference getKeytar', () => {
    const src = fs.readFileSync(path.join(REPO, 'src', 'auth.ts'), 'utf8');
    expect(src).not.toContain('getKeytar');
  });

  it.skipIf(process.platform === 'win32')(
    'Test 5: bin/check-keytar-leftovers.cjs exists and is executable',
    () => {
      const p = path.join(REPO, 'bin', 'check-keytar-leftovers.cjs');
      expect(fs.existsSync(p)).toBe(true);
      expect(() => fs.accessSync(p, fs.constants.X_OK)).not.toThrow();
    }
  );

  it.skipIf(process.platform === 'win32')(
    'Test 6: bin/migrate-tokens.mjs exists and is executable',
    () => {
      const p = path.join(REPO, 'bin', 'migrate-tokens.mjs');
      expect(fs.existsSync(p)).toBe(true);
      expect(() => fs.accessSync(p, fs.constants.X_OK)).not.toThrow();
    }
  );

  it('Test 7: src/cli.ts registers the migrate-tokens subcommand', () => {
    const src = fs.readFileSync(path.join(REPO, 'src', 'cli.ts'), 'utf8');
    expect(src).toContain('migrate-tokens');
  });

  it('Test 8: importing src/auth.js does not throw at module load', async () => {
    vi.resetModules();
    await expect(import('../src/auth.js')).resolves.toBeDefined();
  });

  it('Test 9: CHANGELOG.md exists and mentions keytar', () => {
    const changelogPath = path.join(REPO, 'CHANGELOG.md');
    expect(fs.existsSync(changelogPath)).toBe(true);
    const body = fs.readFileSync(changelogPath, 'utf8').toLowerCase();
    expect(body).toContain('keytar');
  });

  it('Test 10: examples/docker-compose/docker-compose.yml has the full security-hardening posture', () => {
    const p = path.join(REPO, 'examples', 'docker-compose', 'docker-compose.yml');
    expect(fs.existsSync(p)).toBe(true);
    const body = fs.readFileSync(p, 'utf8');
    expect(body).toContain('read_only: true');
    expect(body).toContain('cap_drop:');
    expect(body).toContain('security_opt:');
    expect(body).toContain('no-new-privileges');
    expect(body).toContain('tmpfs');
  });

  it('Test 11: examples/reverse-proxy/Caddyfile disables SSE buffering', () => {
    const p = path.join(REPO, 'examples', 'reverse-proxy', 'Caddyfile');
    expect(fs.existsSync(p)).toBe(true);
    const body = fs.readFileSync(p, 'utf8');
    expect(body).toContain('flush_interval');
  });
});

describe('migrate-tokens round-trip (BLOCKER 1 acceptance)', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    delete process.env.MS365_MCP_TOKEN_CACHE_PATH;
    delete process.env.MS365_MCP_SELECTED_ACCOUNT_PATH;
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('Test 12: staged v1 keytar payload round-trips through bin/migrate-tokens.mjs to AuthManager', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms365-migrate-rt-'));
    const tokenCachePath = path.join(tmpDir, '.token-cache.json');
    const selectedAccountPath = path.join(tmpDir, '.selected-account.json');

    // 1. Stage a fake v1 MSAL cache payload + selected-account payload.
    //    These are the exact shapes v1 saveTokenCache / saveSelectedAccount wrote to keytar:
    //    each is already wrapCache(...)-wrapped at write time. The migrator must preserve
    //    the envelope verbatim (the ensureWrapped helper detects pre-wrapped input).
    const now = Date.now();
    const rawMsalCacheInner = JSON.stringify({
      AccessToken: {},
      IdToken: {},
      RefreshToken: {},
      Account: {
        'home-id.tenant-id': {
          username: 'user@example.com',
          home_account_id: 'home-id.tenant-id',
        },
      },
    });
    const stagedMsalCachePayload = JSON.stringify({
      _cacheEnvelope: true,
      data: rawMsalCacheInner,
      savedAt: now,
    });
    const stagedSelectedAccountPayload = JSON.stringify({
      _cacheEnvelope: true,
      data: JSON.stringify({ accountId: 'home-id.tenant-id' }),
      savedAt: now,
    });

    // 2. Mock keytar so the migrator reads the staged values.
    vi.doMock('keytar', () => ({
      default: {
        getPassword: vi.fn(async (service: string, account: string) => {
          if (service !== 'ms-365-mcp-server') return null;
          if (account === 'msal-token-cache') return stagedMsalCachePayload;
          if (account === 'selected-account') return stagedSelectedAccountPayload;
          return null;
        }),
        setPassword: vi.fn(async () => {}),
        deletePassword: vi.fn(async () => true),
      },
      getPassword: vi.fn(async (service: string, account: string) => {
        if (service !== 'ms-365-mcp-server') return null;
        if (account === 'msal-token-cache') return stagedMsalCachePayload;
        if (account === 'selected-account') return stagedSelectedAccountPayload;
        return null;
      }),
      setPassword: vi.fn(async () => {}),
      deletePassword: vi.fn(async () => true),
    }));

    process.env.MS365_MCP_TOKEN_CACHE_PATH = tokenCachePath;
    process.env.MS365_MCP_SELECTED_ACCOUNT_PATH = selectedAccountPath;

    // 3. Invoke the migrator's main() directly. We import it as an ESM module.
    //    bin/migrate-tokens.mjs exports `main` so tests can call it without spawnSync.
    vi.resetModules();
    const migrator = await import('../bin/migrate-tokens.mjs');
    expect(typeof migrator.main).toBe('function');
    await migrator.main();

    // 4. Assert the DUAL-FILE layout is written with envelope + 0o600 mode.
    expect(fs.existsSync(tokenCachePath)).toBe(true);
    expect(fs.existsSync(selectedAccountPath)).toBe(true);

    const tokenCacheBody = JSON.parse(fs.readFileSync(tokenCachePath, 'utf8'));
    expect(tokenCacheBody._cacheEnvelope).toBe(true);
    expect(typeof tokenCacheBody.data).toBe('string');
    expect(tokenCacheBody.data).toBe(rawMsalCacheInner);

    const selectedAccountBody = JSON.parse(fs.readFileSync(selectedAccountPath, 'utf8'));
    expect(selectedAccountBody._cacheEnvelope).toBe(true);
    expect(typeof selectedAccountBody.data).toBe('string');
    const innerAccount = JSON.parse(selectedAccountBody.data);
    expect(innerAccount.accountId).toBe('home-id.tenant-id');

    if (process.platform !== 'win32') {
      const tokenCacheMode = fs.statSync(tokenCachePath).mode & 0o777;
      expect(tokenCacheMode).toBe(0o600);
      const accountMode = fs.statSync(selectedAccountPath).mode & 0o777;
      expect(accountMode).toBe(0o600);
    }

    // 5. Instantiate AuthManager + round-trip load the migrated cache. The selected-account
    //    payload must thread through loadSelectedAccount → selectedAccountId.
    vi.resetModules();
    const authMod = await import('../src/auth.js');
    const AuthManager = authMod.default;
    const auth = await AuthManager.create([]);
    await auth.loadTokenCache();
    expect(auth.getSelectedAccountId()).toBe('home-id.tenant-id');

    vi.doUnmock('keytar');
  });
});
