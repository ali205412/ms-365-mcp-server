/**
 * Plan 05-08 Task 2 — orchestrator wiring + docs/coverage-report.md tests.
 *
 * Verifies:
 *   - MS365_MCP_FULL_COVERAGE=1 invokes runCoverageCheck AFTER runBetaPipeline.
 *   - MS365_MCP_FULL_COVERAGE=0 does NOT invoke runCoverageCheck.
 *   - Coverage report is written to docs/coverage-report.md under rootDir.
 *   - Report markdown contains per-workload table, deltas, thresholds.
 *   - Coverage regression propagates as an orchestrator-level throw.
 *
 * Step-4 ordering contract (documented in generate-graph-client.mjs JSDoc):
 *     downloadGraphOpenAPI ->
 *     simplify (full-surface or legacy) ->
 *     generateMcpTools ->
 *     runBetaPipeline ->
 *     runCoverageCheck       (step 5 - added by this plan)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs import has no types; runtime shape only.
import { main as generateMain } from '../../bin/generate-graph-client.mjs';
// @ts-expect-error — .mjs import has no types; runtime shape only.
import { renderMarkdownReport } from '../../bin/modules/coverage-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V1_FIXTURE = path.resolve(__dirname, '..', 'fixtures', 'mini-graph-v1.yaml');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05-08-orch-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'openapi'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'generated'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeStubClient(generatedDir, entries) {
  const body = entries
    .map(
      (e) => `  {
    method: "${e.method || 'get'}",
    path: "${e.path}",
    alias: "${e.alias}",
    requestFormat: "json",
    response: z.object({}).passthrough(),
  }`
    )
    .join(',\n');
  const content = `import { makeApi, Zodios } from './hack.js';
import { z } from 'zod';

const endpoints = makeApi([
${body}
]);

export const api = new Zodios(endpoints);
`;
  fs.writeFileSync(path.join(generatedDir, 'client.ts'), content);
  fs.writeFileSync(path.join(generatedDir, 'hack.ts'), '// stub');
}

describe('plan 05-08 task 2 — generate-graph-client.mjs coverage wiring', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fs.copyFileSync(V1_FIXTURE, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    fs.copyFileSync(V1_FIXTURE, path.join(tmpDir, 'openapi', 'openapi-beta.yaml'));
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('Test 1: FULL_COVERAGE=1 invokes runCoverageCheck AFTER runBetaPipeline', async () => {
    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    const callLog = [];
    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: (_spec, generatedDir) => {
        callLog.push('generateMcpTools');
        writeStubClient(generatedDir, [
          { path: '/me/messages', alias: 'list-mail' },
          { path: '/me/events', alias: 'list-cal' },
        ]);
      },
      runBetaPipeline: async () => {
        callLog.push('runBetaPipeline');
        return { betaCount: 0, aliases: [] };
      },
      // Plan 05.1-02+ populate PRODUCT_PIPELINES at module load. Stub the
      // iterator so the real per-product pipelines (which require staged
      // hand-authored specs — e.g. openapi/openapi-pwrapps.yaml from
      // plan 05.1-03) don't run during this ordering-invariant test.
      runProductPipelines: async () => {},
      compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
      runCoverageCheck: () => {
        callLog.push('runCoverageCheck');
        return {
          totals: { current: 2, baseline: 0 },
          byWorkload: { Mail: 1, Calendars: 1 },
          deltas: { Mail: 1, Calendars: 1 },
          warnings: [],
          errors: [],
        };
      },
    });

    // Ordering: generateMcpTools -> runBetaPipeline -> runCoverageCheck.
    const idxGen = callLog.indexOf('generateMcpTools');
    const idxBeta = callLog.indexOf('runBetaPipeline');
    const idxCov = callLog.indexOf('runCoverageCheck');
    expect(idxGen).toBeGreaterThanOrEqual(0);
    expect(idxBeta).toBeGreaterThan(idxGen);
    expect(idxCov).toBeGreaterThan(idxBeta);
  });

  it('Test 2: FULL_COVERAGE=0 does NOT invoke runCoverageCheck', async () => {
    // Stage endpoints.json for legacy path.
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
      compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
      runCoverageCheck: () => {
        callLog.push('runCoverageCheck');
        return {
          totals: { current: 0, baseline: 0 },
          byWorkload: {},
          deltas: {},
          warnings: [],
          errors: [],
        };
      },
    });

    expect(callLog).toContain('generateMcpTools');
    expect(callLog).not.toContain('runBetaPipeline');
    expect(callLog).not.toContain('runCoverageCheck');
  });

  it('Test 3: FULL_COVERAGE=1 writes docs/coverage-report.md under rootDir', async () => {
    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: (_spec, generatedDir) => {
        writeStubClient(generatedDir, [
          { path: '/me/messages', alias: 'list-mail' },
          { path: '/me/events', alias: 'list-cal' },
          { path: '/me/drive/root/children', alias: 'list-drive' },
          { path: '/teams/{id}/channels', alias: 'list-channels' },
        ]);
      },
      runBetaPipeline: async () => ({ betaCount: 0, aliases: [] }),
      runProductPipelines: async () => {},
      compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
    });

    const reportPath = path.join(tmpDir, 'docs', 'coverage-report.md');
    expect(fs.existsSync(reportPath)).toBe(true);
    const md = fs.readFileSync(reportPath, 'utf-8');
    // Header + table structure.
    expect(md).toMatch(/# Microsoft Graph Coverage Report/);
    expect(md).toMatch(/## Per-Workload Coverage/);
    expect(md).toMatch(/\| Workload \| Current \|/);
    // Each of the written workloads should appear in the report.
    expect(md).toMatch(/\| Mail \|/);
    expect(md).toMatch(/\| Calendars \|/);
    expect(md).toMatch(/\| Files \|/);
    expect(md).toMatch(/\| Teams \|/);
    // Thresholds section documented for CI consumers.
    expect(md).toMatch(/## Thresholds/);
  });

  it('Test 4: coverage regression (>10% drop) in orchestrator throws', async () => {
    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');
    vi.stubEnv('MS365_MCP_ACCEPT_BETA_CHURN', '0');

    // Pre-populate a large Mail baseline so current=2 trips the -80% regression.
    const baselinePath = path.join(tmpDir, 'bin', '.last-coverage-snapshot.json');
    const baselineByWorkload = {};
    baselineByWorkload['Mail'] = 10;
    const baselineTotals = 10;
    fs.writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          generated_at: '2026-04-19T00:00:00Z',
          totals: baselineTotals,
          byWorkload: baselineByWorkload,
        },
        null,
        2
      ) + '\n'
    );

    await expect(
      generateMain({
        rootDir: tmpDir,
        generateMcpTools: (_spec, generatedDir) => {
          // Only 2 Mail ops vs. baseline 10 -> -80% regression.
          writeStubClient(generatedDir, [
            { path: '/me/messages', alias: 'mail-a' },
            { path: '/me/messages/{id}', alias: 'mail-b' },
          ]);
        },
        runBetaPipeline: async () => ({ betaCount: 0, aliases: [] }),
        runProductPipelines: async () => {},
        compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
      })
    ).rejects.toThrow(/Coverage regression|regress/i);
  });

  it('Test 5: renderMarkdownReport emits the threshold section and tables', () => {
    const report = {
      totals: { current: 100, baseline: 80 },
      byWorkload: { Mail: 40, Calendars: 30, Files: 20, Teams: 10 },
      deltas: { Mail: 10, Calendars: -2, Files: 15, Teams: -3 },
      warnings: [],
      errors: [],
    };

    const md = renderMarkdownReport(report, { generatedAt: '2026-04-19T12:00:00Z' });

    expect(md).toMatch(/2026-04-19T12:00:00Z/);
    expect(md).toMatch(/Current total ops \| \*\*100\*\*/);
    expect(md).toMatch(/Baseline total ops \| 80/);
    expect(md).toMatch(/\| Mail \| 40 \|/);
    expect(md).toMatch(/\+10/);
    expect(md).toMatch(/## Thresholds/);
    expect(md).toMatch(/-5%/);
    expect(md).toMatch(/-10%/);
  });
});

describe('plan 05-08 task 2 — package.json verify:coverage script', () => {
  it('Test 6: package.json declares verify:coverage', async () => {
    // Read the real repo package.json (walk up from this file).
    const repoRoot = path.resolve(__dirname, '..', '..');
    const pkgPath = path.join(repoRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts['verify:coverage']).toBeDefined();
    // Script should wire through the orchestrator with FULL_COVERAGE=1 so the
    // coverage harness actually runs. USE_SNAPSHOT accepted because the repo
    // commits snapshot YAML.
    expect(pkg.scripts['verify:coverage']).toMatch(/MS365_MCP_FULL_COVERAGE/);
  });
});
