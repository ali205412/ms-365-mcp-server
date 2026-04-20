/**
 * Plan 05-02 Task 2 — churn guard + orchestrator wiring tests.
 *
 * Tests 1-4 exercise `runChurnGuard` directly (snapshot diff semantics).
 * Tests 5-6 exercise the orchestrator integration in
 * `bin/generate-graph-client.mjs`:
 *   - FULL_COVERAGE=1 invokes runBetaPipeline after generateMcpTools.
 *   - FULL_COVERAGE=0 does NOT invoke runBetaPipeline (no temp fragment,
 *     no snapshot touch).
 *
 * Threat coverage: T-05-04 (silent feature loss). Preview is capped at 10
 * names; only committed snapshot aliases are ever printed (never raw spec
 * content).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs import has no types; runtime shape only.
import { runChurnGuard } from '../../bin/modules/beta.mjs';
// @ts-expect-error — .mjs import has no types; runtime shape only.
import { main as generateMain } from '../../bin/generate-graph-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V1_FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'mini-graph-v1.yaml');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05-02-churn-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeSnapshotFixture(snapshotPath, ops) {
  const payload = {
    generated_at: '2026-04-15T00:00:00Z',
    beta_count: ops.length,
    beta_ops: ops,
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(payload, null, 2) + '\n');
}

describe('plan 05-02 task 2 — runChurnGuard', () => {
  let tmpDir;
  let snapshotPath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    snapshotPath = path.join(tmpDir, '.last-beta-snapshot.json');
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.unstubAllEnvs();
  });

  it('Test 1: removed op + ACCEPT_BETA_CHURN unset -> throws with op name in message', () => {
    writeSnapshotFixture(snapshotPath, ['__beta__op-a', '__beta__op-b']);
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    expect(() => runChurnGuard(['__beta__op-a'], snapshotPath)).toThrow(
      /Beta churn detected: 1 op\(s\) disappeared/
    );
    expect(() => runChurnGuard(['__beta__op-a'], snapshotPath)).toThrow(/__beta__op-b/);
    // Snapshot untouched on failure (the throw happens before the write).
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.beta_ops).toEqual(['__beta__op-a', '__beta__op-b']);
  });

  it('Test 2: removed op + ACCEPT_BETA_CHURN=1 -> no throw, snapshot rewritten', () => {
    writeSnapshotFixture(snapshotPath, ['__beta__op-a', '__beta__op-b']);
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '1');

    expect(() => runChurnGuard(['__beta__op-a'], snapshotPath)).not.toThrow();
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.beta_ops).toEqual(['__beta__op-a']);
    expect(snap.beta_count).toBe(1);
  });

  it('Test 3: empty baseline -> any current ops are "new", not "removed"; snapshot populates', () => {
    // Committed empty baseline shape -- beta_ops: [].
    writeSnapshotFixture(snapshotPath, []);
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    expect(() =>
      runChurnGuard(['__beta__op-a', '__beta__op-b', '__beta__op-c'], snapshotPath)
    ).not.toThrow();
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.beta_ops).toEqual(['__beta__op-a', '__beta__op-b', '__beta__op-c']);
    expect(snap.beta_count).toBe(3);
  });

  it('Test 4: addition only (no removal) -> no throw regardless of env; snapshot grows', () => {
    writeSnapshotFixture(snapshotPath, ['__beta__op-a', '__beta__op-b']);
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    expect(() =>
      runChurnGuard(['__beta__op-a', '__beta__op-b', '__beta__op-c'], snapshotPath)
    ).not.toThrow();
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.beta_ops).toEqual(['__beta__op-a', '__beta__op-b', '__beta__op-c']);
  });

  it('Test 4b: removal preview is capped at 10 names (T-05-04 bounded output)', () => {
    const prev = Array.from(
      { length: 15 },
      (_, i) => `__beta__removed-${String(i).padStart(2, '0')}`
    );
    writeSnapshotFixture(snapshotPath, prev);
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    try {
      runChurnGuard([], snapshotPath);
      expect.fail('expected throw');
    } catch (err) {
      const msg = err.message;
      // Preview text mentions 15 total and hides the last 5.
      expect(msg).toMatch(/15 op\(s\) disappeared/);
      expect(msg).toMatch(/and 5 more/);
      // First 10 names are listed; names 11-15 are not.
      for (let i = 0; i < 10; i++) {
        expect(msg).toContain(`__beta__removed-${String(i).padStart(2, '0')}`);
      }
      for (let i = 10; i < 15; i++) {
        expect(msg).not.toContain(`__beta__removed-${String(i).padStart(2, '0')}`);
      }
    }
  });

  it('Test 4c: missing snapshot file -> initial creation path (no error)', () => {
    // No snapshot file on disk at all.
    expect(fs.existsSync(snapshotPath)).toBe(false);
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    expect(() => runChurnGuard(['__beta__new-op'], snapshotPath)).not.toThrow();
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.beta_ops).toEqual(['__beta__new-op']);
  });
});

describe('plan 05-02 task 2 — generate-graph-client.mjs wiring', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, 'openapi'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src', 'generated'), { recursive: true });
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('Test 5: FULL_COVERAGE=1 invokes runBetaPipeline after generateMcpTools', async () => {
    // Stage fixtures — openapi.yaml as both v1 and (copied) beta source so
    // the snapshot-mode download short-circuits.
    fs.copyFileSync(V1_FIXTURE, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    fs.copyFileSync(V1_FIXTURE, path.join(tmpDir, 'openapi', 'openapi-beta.yaml'));

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    const callLog = [];
    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: (_spec, generatedDir) => {
        callLog.push('generateMcpTools');
        // Emit a minimal but valid client.ts so the beta merge has a target.
        const stub = `import { makeApi, Zodios } from './hack.js';
import { z } from 'zod';

const endpoints = makeApi([
  {
    method: "get",
    path: "/users",
    alias: "users.list",
    requestFormat: "json",
    response: z.object({}).passthrough(),
  },
]);

export const api = new Zodios(endpoints);
`;
        fs.writeFileSync(path.join(generatedDir, 'client.ts'), stub);
        fs.writeFileSync(path.join(generatedDir, 'hack.ts'), '// stub');
      },
      runBetaPipeline: async () => {
        callLog.push('runBetaPipeline');
        return { betaCount: 0, aliases: [] };
      },
      // Plan 05-03 wired compileEssentialsPreset at tail of main(); stub so
      // this test focuses on the beta pipeline ordering invariant.
      compileEssentialsPreset: () => {
        callLog.push('compileEssentialsPreset');
        return { count: 0, presetTsPath: '', missing: [] };
      },
    });

    // generateMcpTools must run first; runBetaPipeline must run after.
    const generateIdx = callLog.indexOf('generateMcpTools');
    const betaIdx = callLog.indexOf('runBetaPipeline');
    expect(generateIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeGreaterThanOrEqual(0);
    expect(betaIdx).toBeGreaterThan(generateIdx);
  });

  it('Test 6: FULL_COVERAGE=0 does NOT invoke runBetaPipeline', async () => {
    fs.copyFileSync(V1_FIXTURE, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    // Stage an endpoints.json so the legacy (non-full-coverage) simplifier
    // has a filter input.
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'endpoints.json'),
      JSON.stringify(
        [{ pathPattern: '/me', method: 'get', toolName: 'me-get', scopes: [] }],
        null,
        2
      )
    );

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '0');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');

    const callLog = [];
    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: () => {
        callLog.push('generateMcpTools');
      },
      runBetaPipeline: async () => {
        callLog.push('runBetaPipeline');
        return { betaCount: 0, aliases: [] };
      },
      // Plan 05-03 wired compileEssentialsPreset at tail of main(); stub so
      // this test focuses on the FULL_COVERAGE=0 branch-selection invariant.
      compileEssentialsPreset: () => {
        callLog.push('compileEssentialsPreset');
        return { count: 0, presetTsPath: '', missing: [] };
      },
    });

    expect(callLog).toContain('generateMcpTools');
    expect(callLog).not.toContain('runBetaPipeline');
    // No temp fragment created when FULL_COVERAGE=0.
    expect(fs.existsSync(path.join(tmpDir, 'src', 'generated', '.client-beta-fragment.ts'))).toBe(
      false
    );
  });
});
