/**
 * Startup fail-fast validation for prod-mode CORS_ORIGINS (SECUR-04 / plan 01-07).
 *
 * Threat refs from plan 01-07 <threat_model>:
 *   - T-01-07c (Configuration footgun): operator deploys to prod without
 *     setting MS365_MCP_CORS_ORIGINS — server would silently accept every
 *     origin (or leave OAuth flow broken). Fail-fast with exit(78)
 *     (EX_CONFIG) at startup instead of running half-configured.
 *
 * Test strategy — spawn src/index.ts as a child process via `spawnSync` with
 * controlled env vars and assert the process exit code. This mirrors
 * test/cli.test.ts's existing pattern and avoids exposing `main` from
 * src/index.ts (which would change runtime auto-invocation semantics).
 *
 * The `--health-check` flag (plan 01-04) is used to give stdio-mode and
 * dev-mode tests a bounded exit — the probe is cheap, runs only after
 * fail-fast has already decided whether to exit. If fail-fast triggers,
 * exit is 78 regardless of --health-check.
 *
 * These tests MUST FAIL on first run (RED) because src/index.ts has no
 * fail-fast validation yet.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const tsxBin = path.resolve('node_modules', '.bin', 'tsx');
const indexPath = path.resolve('src', 'index.ts');

/**
 * Spawn src/index.ts with a controlled environment. Returns exit status and
 * captured stdout/stderr. The child is given 10s to finish — fail-fast
 * should exit immediately (<1s), and the --health-check probe adds at most
 * a 3s timeout.
 */
function runIndex(
  env: Record<string, string | undefined>,
  extraArgs: string[] = []
): { status: number | null; stdout: string; stderr: string } {
  // Start from a CLEAN env set — inheriting process.env would drag in the
  // parent test runner's NODE_ENV + any CORS vars the developer has locally.
  // We still need PATH / HOME / node-specific vars so the child can actually
  // import modules.
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
  // Suppress OTLP/Prometheus side effects.
  baseEnv.OTEL_EXPORTER_OTLP_ENDPOINT = '';
  baseEnv.MS365_MCP_PROMETHEUS_ENABLED = '';
  // Keep log dir unset so the child never tries to mkdir.
  baseEnv.MS365_MCP_LOG_DIR = '';

  // Only copy non-undefined keys from the override.
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

describe('startup fail-fast — prod HTTP + missing CORS_ORIGINS (SECUR-04, T-01-07c)', () => {
  it('Test 9: prod HTTP mode + missing CORS_ORIGINS exits 78', () => {
    const { status, stdout, stderr } = runIndex(
      {
        NODE_ENV: 'production',
        MS365_MCP_PUBLIC_URL: 'https://mcp.example.com',
        // Both singular + plural unset.
        MS365_MCP_CORS_ORIGINS: '',
        MS365_MCP_CORS_ORIGIN: '',
      },
      ['--http', '127.0.0.1:0']
    );

    expect(status).toBe(78);
    // Error message must mention the env var name so operators can self-serve.
    const combined = stdout + stderr;
    expect(combined).toMatch(/MS365_MCP_CORS_ORIGINS/);
  });

  it('Test 10: prod stdio mode (no --http) does not exit 78 on missing CORS', () => {
    const { status } = runIndex(
      {
        NODE_ENV: 'production',
        MS365_MCP_PUBLIC_URL: '',
        MS365_MCP_CORS_ORIGINS: '',
        MS365_MCP_CORS_ORIGIN: '',
      },
      // --health-check in stdio mode returns 0 immediately per plan 01-04.
      ['--health-check']
    );

    // Stdio mode does not need CORS_ORIGINS — the fail-fast is HTTP-only.
    expect(status).not.toBe(78);
    // --health-check exits 0 in stdio mode.
    expect(status).toBe(0);
  });

  it('Test 11: dev HTTP mode + missing CORS does not exit 78', () => {
    const { status } = runIndex(
      {
        NODE_ENV: 'development',
        MS365_MCP_PUBLIC_URL: '',
        MS365_MCP_CORS_ORIGINS: '',
        MS365_MCP_CORS_ORIGIN: '',
      },
      // --http 127.0.0.1:0 + --health-check: fail-fast skips (isProd=false)
      // and --health-check probes port 0 (never listens). The probe fails
      // quickly with exit 1 — the important assertion is status !== 78.
      ['--http', '127.0.0.1:0', '--health-check']
    );

    // Dev mode permits missing CORS (loopback is auto-permitted at request time).
    expect(status).not.toBe(78);
  });

  it('singular CORS_ORIGIN satisfies the gate (deprecated fallback)', () => {
    // If an operator is still on the deprecated MS365_MCP_CORS_ORIGIN (singular),
    // fail-fast must not trigger — we warn, we don't crash. The deprecation
    // removal is owned by the CHANGELOG / plan 01-08.
    const { status } = runIndex(
      {
        NODE_ENV: 'production',
        MS365_MCP_PUBLIC_URL: 'https://mcp.example.com',
        MS365_MCP_CORS_ORIGINS: '',
        MS365_MCP_CORS_ORIGIN: 'https://legacy.example.com',
      },
      // --health-check ends the spawn quickly after the fail-fast gate has
      // (correctly) let the process continue past validation.
      ['--http', '127.0.0.1:0', '--health-check']
    );

    // The gate should have let the process continue; --health-check then
    // probes port 0 (fails) and exits 1. The assertion is status !== 78.
    expect(status).not.toBe(78);
  });
});
