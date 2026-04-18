#!/usr/bin/env node
/**
 * One-shot migrator: v1 keytar (OS keychain) → v2 file-based cache.
 *
 * SECUR-07 / D-04 — keytar is removed from v2. This script exists so stdio
 * users upgrading from v1 can preserve their saved tokens without having
 * to re-login. Invoke via `npx ms-365-mcp-server migrate-tokens`.
 *
 * Flow:
 *   1. Detect whether keytar is importable. If not, run
 *      `npm i --no-save --prefix <tmpdir> keytar` and import from there.
 *   2. Read the two v1 entries:
 *        - ms-365-mcp-server / msal-token-cache   → MSAL cache serialize()
 *        - ms-365-mcp-server / selected-account   → JSON{ accountId }
 *   3. Write them to the v2 DUAL-FILE layout (src/auth.ts:82-84 envelope):
 *        - tokenCachePath      (MS365_MCP_TOKEN_CACHE_PATH || fallback)
 *        - selectedAccountPath (MS365_MCP_SELECTED_ACCOUNT_PATH || sibling)
 *      Each file is wrapCache(rawValueFromKeytar) at mode 0o600.
 *   4. If --clear-keytar is set, call keytar.deletePassword for each entry.
 *
 * CRITICAL: src/auth.ts uses a DUAL-FILE layout. loadTokenCache and
 * loadSelectedAccount read DIFFERENT files. Writing both keys to a single
 * combined JSON file would silently break cache loading. The round-trip
 * acceptance test (test/keytar-removal.test.ts Test 12) exercises this
 * exact path.
 *
 * Module design: export `main` so tests can invoke it programmatically.
 * The entry-point check at the bottom runs main() only when invoked as
 * a script (process.argv[1] matches this file's path).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SERVICE = 'ms-365-mcp-server';
const TOKEN_CACHE_ACCOUNT = 'msal-token-cache';
const SELECTED_ACCOUNT_KEY = 'selected-account';

/**
 * wrapCache envelope — MUST match src/auth.ts:82-84 verbatim so that
 * unwrapCache in the runtime reverses this format correctly. Returns a
 * JSON string of `{ _cacheEnvelope: true, data, savedAt }`.
 */
function wrapCache(data) {
  return JSON.stringify({ _cacheEnvelope: true, data, savedAt: Date.now() });
}

/**
 * If a keytar value is already an envelope (v1 always wraps via
 * saveTokenCache → setPassword), preserve it verbatim to keep the
 * original savedAt. If it's a bare string (hand-edited keytar entry,
 * or pre-envelope v1 data), wrap it now.
 */
function ensureWrapped(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed._cacheEnvelope === true && typeof parsed.data === 'string') {
      return raw;
    }
  } catch {
    // not JSON — treat as a bare MSAL serialized string
  }
  return wrapCache(raw);
}

/**
 * Secure write: ensure parent dir exists at 0o700, write file at 0o600,
 * then defensively chmod 0o600 (some FS ignore `mode` in writeFile options).
 */
function writeSecureFile(targetPath, contents) {
  mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  writeFileSync(targetPath, contents, { mode: 0o600 });
  try {
    chmodSync(targetPath, 0o600);
  } catch {
    // Windows may not support chmod; fall through.
  }
}

/**
 * Resolve the token cache path. Mirrors src/auth.ts getTokenCachePath:
 *   - MS365_MCP_TOKEN_CACHE_PATH env var (absolute, trimmed)
 *   - otherwise ~/.ms-365-mcp-token-cache.json (a user-owned default that
 *     works for CLI users across OSes; v1's default was alongside the dist
 *     binary but that path is not writable on read-only-rootfs containers)
 */
function resolveTokenCachePath() {
  const envPath = process.env.MS365_MCP_TOKEN_CACHE_PATH?.trim();
  if (envPath) return path.resolve(envPath);
  return path.join(homedir(), '.ms-365-mcp-token-cache.json');
}

/**
 * Resolve the selected-account path. Mirrors src/auth.ts getSelectedAccountPath:
 *   - MS365_MCP_SELECTED_ACCOUNT_PATH env var
 *   - otherwise .selected-account.json in the same directory as the token cache
 */
function resolveSelectedAccountPath(tokenCachePath) {
  const envPath = process.env.MS365_MCP_SELECTED_ACCOUNT_PATH?.trim();
  if (envPath) return path.resolve(envPath);
  return path.join(path.dirname(tokenCachePath), '.selected-account.json');
}

/**
 * Best-effort dynamic import of keytar. First tries the process's own
 * node_modules. If that fails, runs `npm i --no-save --prefix <tmpdir>`
 * and imports from the temp node_modules. Throws with a remediation
 * message on failure.
 */
async function resolveKeytar() {
  try {
    const mod = await import('keytar');
    return mod.default ?? mod;
  } catch {
    // fall through to temp install
  }

  process.stderr.write(
    'keytar is not installed; bootstrapping a temp copy for one-shot migration...\n'
  );
  const tempDir = mkdtempSync(path.join(tmpdir(), 'ms365-migrate-'));
  const result = spawnSync('npm', ['i', '--no-save', '--prefix', tempDir, 'keytar'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(
      'Failed to install keytar for migration. ' +
        'On Windows, ensure windows-build-tools is installed. ' +
        'On macOS, ensure Xcode Command Line Tools are installed. ' +
        'On Linux, libsecret-1-dev is required (apt install libsecret-1-dev).'
    );
  }
  const tempKeytarPath = path.join(tempDir, 'node_modules', 'keytar');
  const mod = await import(pathToFileURL(tempKeytarPath).href);
  return mod.default ?? mod;
}

/**
 * Main migration entry point. Exported for programmatic invocation from
 * tests and the src/cli.ts subcommand handler. Reads CLI flags from
 * process.argv so no signature change is needed.
 *
 * Returns 0 on success, non-zero on error (caller decides exit code).
 */
export async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const clearKeytar = args.has('--clear-keytar');

  const tokenCachePath = resolveTokenCachePath();
  const selectedAccountPath = resolveSelectedAccountPath(tokenCachePath);

  let keytarModule;
  try {
    keytarModule = await resolveKeytar();
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  const rawMsalCache = await keytarModule.getPassword(SERVICE, TOKEN_CACHE_ACCOUNT);
  const rawSelectedAccount = await keytarModule.getPassword(SERVICE, SELECTED_ACCOUNT_KEY);

  const hasMsalCache = rawMsalCache !== null && rawMsalCache !== undefined;
  const hasSelectedAccount = rawSelectedAccount !== null && rawSelectedAccount !== undefined;

  if (!hasMsalCache && !hasSelectedAccount) {
    process.stdout.write('No v1 OS-keychain entries found for service "' + SERVICE + '".\n');
    process.stdout.write('Nothing to migrate.\n');
    return 0;
  }

  if (dryRun) {
    process.stdout.write('Dry run: would write the following files:\n');
    if (hasMsalCache) {
      process.stdout.write(`  - ${tokenCachePath} (MSAL token cache, mode 0600)\n`);
    }
    if (hasSelectedAccount) {
      process.stdout.write(`  - ${selectedAccountPath} (selected account, mode 0600)\n`);
    }
    return 0;
  }

  let wrote = 0;
  if (hasMsalCache) {
    writeSecureFile(tokenCachePath, ensureWrapped(rawMsalCache));
    process.stdout.write(`Wrote ${tokenCachePath} (MSAL token cache)\n`);
    wrote++;
  }
  if (hasSelectedAccount) {
    writeSecureFile(selectedAccountPath, ensureWrapped(rawSelectedAccount));
    process.stdout.write(`Wrote ${selectedAccountPath} (selected account)\n`);
    wrote++;
  }

  // Defensive: verify the written files are actually at 0o600 on POSIX.
  // On platforms that ignored the chmod above, log a warning so the operator
  // knows to tighten permissions manually.
  if (process.platform !== 'win32') {
    for (const p of [tokenCachePath, selectedAccountPath]) {
      try {
        const mode = statSync(p).mode & 0o777;
        if (mode !== 0o600) {
          process.stderr.write(
            `Warning: ${p} mode is ${mode.toString(8)} (expected 600). ` + `Run: chmod 600 "${p}"\n`
          );
        }
      } catch {
        // File may not exist if we didn't write it — skip.
      }
    }
  }

  process.stdout.write(`Migrated ${wrote} file(s).\n`);

  if (clearKeytar) {
    if (hasMsalCache) {
      await keytarModule.deletePassword(SERVICE, TOKEN_CACHE_ACCOUNT);
    }
    if (hasSelectedAccount) {
      await keytarModule.deletePassword(SERVICE, SELECTED_ACCOUNT_KEY);
    }
    process.stdout.write('OS-keychain entries deleted.\n');
  } else {
    process.stdout.write(
      'Tip: re-run with --clear-keytar to delete the OS-keychain entries ' +
        'after confirming the file cache works.\n'
    );
  }

  return 0;
}

// Entry-point check: run main() only when invoked as a script, not on import.
// This lets tests call `main()` directly without a stray execution on import.
const invokedAsScript = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    const currentUrl = import.meta.url;
    const argvUrl = pathToFileURL(argv1).href;
    return currentUrl === argvUrl;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      process.stderr.write(
        `Migration failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    });
}

// Re-export helpers for tests that want to exercise envelope behavior in isolation.
export { wrapCache, ensureWrapped, resolveTokenCachePath, resolveSelectedAccountPath };
// Unused var suppression for fileURLToPath if removed by later edits
void fileURLToPath;
