/**
 * Startup fail-fast validation for prod-mode PUBLIC_URL (D-02 / plan 01-07).
 *
 * Threat refs from plan 01-07 <threat_model>:
 *   - T-01-07d (Configuration footgun): operator deploys to prod without
 *     setting MS365_MCP_PUBLIC_URL — OAuth metadata generation produces
 *     broken issuer URLs (half-started state). Fail-fast with exit(78)
 *     (EX_CONFIG) instead of running in a state where every OAuth flow
 *     silently breaks.
 *
 * Test strategy — spawn src/index.ts as a child process via `spawnSync`
 * with controlled env vars. Mirrors test/startup-validation.test.ts —
 * the two test files split by gate responsibility so a single regression
 * is easy to localise.
 *
 * These tests MUST FAIL on first run (RED) because src/index.ts has no
 * fail-fast validation yet.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const tsxBin = path.resolve('node_modules', '.bin', 'tsx');
const indexPath = path.resolve('src', 'index.ts');

function runIndex(
  env: Record<string, string | undefined>,
  extraArgs: string[] = []
): { status: number | null; stdout: string; stderr: string } {
  const inheritedKeys = [
    'PATH',
    'HOME',
    'NODE_PATH',
    'NODE_OPTIONS',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'SHELL',
    'USER',
    'LOGNAME',
  ];
  const baseEnv: Record<string, string> = {};
  for (const k of inheritedKeys) {
    const v = process.env[k];
    if (v !== undefined) baseEnv[k] = v;
  }
  baseEnv.OTEL_EXPORTER_OTLP_ENDPOINT = '';
  baseEnv.MS365_MCP_PROMETHEUS_ENABLED = '';
  baseEnv.MS365_MCP_LOG_DIR = '';

  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) overrides[k] = v;
  }

  const result = spawnSync(tsxBin, [indexPath, ...extraArgs], {
    env: { ...baseEnv, ...overrides },
    timeout: 10_000,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('startup fail-fast — prod HTTP + missing PUBLIC_URL (D-02, T-01-07d)', () => {
  it('Test 12: prod HTTP mode + missing MS365_MCP_PUBLIC_URL exits 78', () => {
    const { status, stdout, stderr } = runIndex(
      {
        NODE_ENV: 'production',
        // PUBLIC_URL deliberately unset.
        MS365_MCP_PUBLIC_URL: '',
        MS365_MCP_BASE_URL: '',
        // CORS gate passes so only PUBLIC_URL can trip fail-fast.
        MS365_MCP_CORS_ORIGINS: 'https://app.example.com',
      },
      ['--http', '127.0.0.1:0']
    );

    expect(status).toBe(78);
    const combined = stdout + stderr;
    expect(combined).toMatch(/MS365_MCP_PUBLIC_URL/);
  });

  it('Test 13: prod stdio mode (no --http) does not exit 78 on missing PUBLIC_URL', () => {
    const { status } = runIndex(
      {
        NODE_ENV: 'production',
        MS365_MCP_PUBLIC_URL: '',
        MS365_MCP_BASE_URL: '',
        MS365_MCP_CORS_ORIGINS: '',
      },
      // --health-check in stdio mode exits 0 immediately (plan 01-04).
      ['--health-check']
    );

    expect(status).not.toBe(78);
    expect(status).toBe(0);
  });

  it('Test 14: prod HTTP mode + PUBLIC_URL set passes the PUBLIC_URL gate', () => {
    const { status } = runIndex(
      {
        NODE_ENV: 'production',
        MS365_MCP_PUBLIC_URL: 'https://mcp.example.com',
        MS365_MCP_CORS_ORIGINS: 'https://app.example.com',
      },
      // PUBLIC_URL gate passes, CORS gate passes, then --health-check
      // probes port 0 and exits (fail-fast already let the process through).
      // The important assertion is status !== 78.
      ['--http', '127.0.0.1:0', '--health-check']
    );

    expect(status).not.toBe(78);
  });

  it('dev HTTP mode + missing PUBLIC_URL does not exit 78 (dev is permissive)', () => {
    const { status } = runIndex(
      {
        NODE_ENV: 'development',
        MS365_MCP_PUBLIC_URL: '',
        MS365_MCP_BASE_URL: '',
        MS365_MCP_CORS_ORIGINS: '',
      },
      ['--http', '127.0.0.1:0', '--health-check']
    );

    // Dev mode tolerates missing PUBLIC_URL — only prod requires it.
    expect(status).not.toBe(78);
  });

  it('deprecated MS365_MCP_BASE_URL satisfies the PUBLIC_URL gate', () => {
    // MS365_MCP_BASE_URL is the v1 name for PUBLIC_URL; src/server.ts reads it
    // as a fallback. Fail-fast should treat BASE_URL-set as equivalent to
    // PUBLIC_URL-set so that existing deployments don't break on upgrade.
    const { status } = runIndex(
      {
        NODE_ENV: 'production',
        MS365_MCP_PUBLIC_URL: '',
        MS365_MCP_BASE_URL: 'https://legacy.example.com',
        MS365_MCP_CORS_ORIGINS: 'https://app.example.com',
      },
      ['--http', '127.0.0.1:0', '--health-check']
    );

    // Gate should have passed; --health-check decides the final exit (not 78).
    expect(status).not.toBe(78);
  });
});
