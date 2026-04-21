/**
 * Plan 05-01 Task 2 — generate-graph-client.mjs full-coverage orchestration tests.
 *
 * The orchestrator is imported as a module (main() export) and invoked with
 * injected deps so tests do not depend on the real `openapi-zod-client` npx
 * binary (which requires network and takes ~20s) or on the committed
 * openapi/openapi.yaml path. Each test stages a tiny working directory,
 * points the orchestrator at it via the deps bag, and asserts which
 * simplifier was called, what was written, and what exit signal surfaces
 * when prerequisites are missing.
 *
 * Tests:
 *   1. MS365_MCP_FULL_COVERAGE=0 -> legacy createAndSaveSimplifiedOpenAPI called.
 *   2. MS365_MCP_FULL_COVERAGE=1 + MS365_MCP_USE_SNAPSHOT=1 + openapi.yaml present
 *      -> createAndSaveSimplifiedOpenAPIFullSurface called; trimmed YAML has
 *      full path count.
 *   3. Trimmed YAML under full-coverage mode exposes every fixture path so
 *      downstream `openapi-zod-client` will emit a tool per op (=alias).
 *   4. MS365_MCP_FULL_COVERAGE=1 + no snapshot + no openapi.yaml + no network
 *      -> orchestrator throws (T-05-01 fail-closed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { main as generateMain } from '../../bin/generate-graph-client.mjs';

const FIXTURE_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'mini-graph-v1.yaml'
);

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05-01-gen-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'openapi'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'generated'), { recursive: true });
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Copy a minimal endpoints.json into the staged src/ so the legacy path has a
 * usable filter. Uses exactly 2 paths from the fixture to make the post-trim
 * count distinguishable from the full-surface count.
 */
function stageLegacyEndpointsJson(tmpDir) {
  const endpoints = [
    { pathPattern: '/users', method: 'get', toolName: 'users-list', scopes: [] },
    { pathPattern: '/me', method: 'get', toolName: 'me-get', scopes: [] },
  ];
  const p = path.join(tmpDir, 'src', 'endpoints.json');
  fs.writeFileSync(p, JSON.stringify(endpoints, null, 2));
  return p;
}

describe('plan 05-01 task 2 — generate-graph-client.mjs main() orchestrator', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('Test 1: FULL_COVERAGE=0 routes to legacy createAndSaveSimplifiedOpenAPI', async () => {
    // Stage the fixture as openapi/openapi.yaml + src/endpoints.json.
    fs.copyFileSync(FIXTURE_PATH, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    stageLegacyEndpointsJson(tmpDir);

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '0');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');

    const callLog = [];
    await generateMain({
      rootDir: tmpDir,
      // Stub generateMcpTools — the real binary requires network.
      generateMcpTools: () => {
        callLog.push('generateMcpTools');
        return true;
      },
      // Plan 05-03 wired compileEssentialsPreset at the tail of main(); stub
      // to prevent this 05-01 test from running the real compile step against
      // a staged fixture that lacks the 150 preset aliases.
      compileEssentialsPreset: () => {
        callLog.push('compileEssentialsPreset');
        return { count: 0, presetTsPath: '', missing: [] };
      },
      // Wrap simplifier exports so the test can assert which branch ran.
      simplifiers: {
        createAndSaveSimplifiedOpenAPI: (...args) => {
          callLog.push('legacy');
          // Write a stub trimmed file so the orchestrator can proceed.
          fs.writeFileSync(args[2], 'openapi: "3.0.0"\npaths: {}\n');
        },
        createAndSaveSimplifiedOpenAPIFullSurface: () => {
          callLog.push('full-surface');
        },
      },
    });

    expect(callLog).toContain('legacy');
    expect(callLog).not.toContain('full-surface');
    expect(callLog).toContain('generateMcpTools');
  });

  it('Test 2: FULL_COVERAGE=1 + USE_SNAPSHOT=1 routes to full-surface simplifier', async () => {
    fs.copyFileSync(FIXTURE_PATH, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    stageLegacyEndpointsJson(tmpDir);

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');

    const callLog = [];
    let fullSurfaceArgs = null;
    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: () => {
        callLog.push('generateMcpTools');
        return true;
      },
      // Plan 05-02 wired runBetaPipeline into FULL_COVERAGE=1 flow; stub to
      // prevent this test from invoking the real beta codegen (network +
      // openapi-zod-client binary).
      runBetaPipeline: async () => ({ betaCount: 0, aliases: [] }),
      // Post-Phase-5 addition: stubMissingSchemas runs after the beta merge;
      // the real stubber reads client.ts which this test never writes, so
      // inject a no-op.
      stubMissingSchemas: () => ({ stubbed: [] }),
      // Plan 05-08 wired runCoverageCheck into FULL_COVERAGE=1 flow; stub to
      // prevent this test from requiring a real emitted client.ts.
      runCoverageCheck: () => ({
        totals: { current: 0, baseline: 0 },
        byWorkload: {},
        deltas: {},
        warnings: [],
        errors: [],
      }),
      // Plan 05-03 wired compileEssentialsPreset at tail of main(); stub.
      compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
      simplifiers: {
        createAndSaveSimplifiedOpenAPI: () => {
          callLog.push('legacy');
        },
        createAndSaveSimplifiedOpenAPIFullSurface: (openapiFile, outFile, opts) => {
          callLog.push('full-surface');
          fullSurfaceArgs = { openapiFile, outFile, opts };
          fs.writeFileSync(outFile, 'openapi: "3.0.0"\npaths: {}\n');
        },
      },
    });

    expect(callLog).toContain('full-surface');
    expect(callLog).not.toContain('legacy');
    expect(fullSurfaceArgs).not.toBeNull();
    expect(fullSurfaceArgs.openapiFile).toBe(path.join(tmpDir, 'openapi', 'openapi.yaml'));
    expect(fullSurfaceArgs.outFile).toBe(path.join(tmpDir, 'openapi', 'openapi-trimmed.yaml'));
  });

  it('Test 3: full-coverage mode using real simplifier emits all paths in trimmed YAML', async () => {
    // End-to-end through the real simplifier (no generateMcpTools / zod-client call).
    fs.copyFileSync(FIXTURE_PATH, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    const fixtureSpec = yaml.load(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const expectedPathCount = Object.keys(fixtureSpec.paths).length;

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');

    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: () => true,
      // Plan 05-02 wired runBetaPipeline into FULL_COVERAGE=1 flow; stub to
      // prevent this test from invoking the real beta codegen (network +
      // openapi-zod-client binary).
      runBetaPipeline: async () => ({ betaCount: 0, aliases: [] }),
      // Post-Phase-5: stubMissingSchemas requires a real client.ts; no-op here.
      stubMissingSchemas: () => ({ stubbed: [] }),
      // Plan 05-08 wired runCoverageCheck into FULL_COVERAGE=1 flow; stub.
      runCoverageCheck: () => ({
        totals: { current: 0, baseline: 0 },
        byWorkload: {},
        deltas: {},
        warnings: [],
        errors: [],
      }),
      // Plan 05-03 wired compileEssentialsPreset at tail of main(); stub so
      // the test exercises only the simplifier branch under assertion.
      compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
      // No simplifiers override -> real implementation is used.
    });

    const trimmedPath = path.join(tmpDir, 'openapi', 'openapi-trimmed.yaml');
    expect(fs.existsSync(trimmedPath)).toBe(true);

    const trimmed = yaml.load(fs.readFileSync(trimmedPath, 'utf8'));
    const actualPathCount = Object.keys(trimmed.paths).length;
    expect(actualPathCount).toBe(expectedPathCount);
    expect(actualPathCount).toBeGreaterThanOrEqual(10);
  });

  it('Test 4 (T-05-01): FULL_COVERAGE=1 + no snapshot + no file + no network -> throws', async () => {
    // Do NOT stage openapi.yaml. Stage endpoints.json only.
    stageLegacyEndpointsJson(tmpDir);

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '0');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENETUNREACH')));

    await expect(
      generateMain({
        rootDir: tmpDir,
        generateMcpTools: () => true,
      })
    ).rejects.toThrow();
  });

  it('Test 5: USE_SNAPSHOT=1 + file missing + no network -> throws (fail-closed)', async () => {
    // Also fail-closed variant of T-05-01 — snapshot opted-in but nothing on disk.
    stageLegacyEndpointsJson(tmpDir);

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENETUNREACH')));

    await expect(
      generateMain({
        rootDir: tmpDir,
        generateMcpTools: () => true,
      })
    ).rejects.toThrow();
  });
});

/**
 * Plan 05.1-01 Task 2 — PRODUCT_PIPELINES orchestrator wiring tests.
 *
 * These tests extend the plan 05-01 harness above with the per-product
 * pipeline hook (step 4c) and the second stubMissingSchemas pass (step 4d).
 * They assert both invocation count and call ordering to pin the insertion
 * point between the first stub pass and the coverage harness.
 *
 * Tests:
 *   A. FULL_COVERAGE=1 invokes runProductPipelines exactly once.
 *   B. FULL_COVERAGE=0 does NOT invoke runProductPipelines.
 *   C. Ordering: stubMissingSchemas (step 4b) → runProductPipelines (step 4c)
 *      → stubMissingSchemas again (step 4d) → runCoverageCheck (step 5).
 *   D. PRODUCT_PIPELINES is exported as an empty array — plans 5.1-02..06
 *      populate entries without touching the core orchestrator module.
 *   E. .env.example contains the 5 new per-product churn env vars.
 */
describe('plan 05.1-01 task 2 — PRODUCT_PIPELINES orchestrator wiring', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('Test A: FULL_COVERAGE=1 invokes runProductPipelines exactly once', async () => {
    fs.copyFileSync(FIXTURE_PATH, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    stageLegacyEndpointsJson(tmpDir);

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');

    const runProductPipelines = vi.fn(async () => undefined);

    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: () => true,
      runBetaPipeline: async () => ({ betaCount: 0, aliases: [] }),
      runProductPipelines,
      stubMissingSchemas: () => ({ stubbed: [] }),
      runCoverageCheck: () => ({
        totals: { current: 0, baseline: 0 },
        byWorkload: {},
        deltas: {},
        warnings: [],
        errors: [],
      }),
      compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
      simplifiers: {
        createAndSaveSimplifiedOpenAPI: () => undefined,
        createAndSaveSimplifiedOpenAPIFullSurface: (_in, outFile) => {
          fs.writeFileSync(outFile, 'openapi: "3.0.0"\npaths: {}\n');
        },
      },
    });

    expect(runProductPipelines).toHaveBeenCalledTimes(1);
  });

  it('Test B: FULL_COVERAGE=0 does NOT invoke runProductPipelines', async () => {
    fs.copyFileSync(FIXTURE_PATH, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    stageLegacyEndpointsJson(tmpDir);

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '0');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');

    const runProductPipelines = vi.fn(async () => undefined);

    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: () => true,
      runProductPipelines,
      compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
      simplifiers: {
        createAndSaveSimplifiedOpenAPI: (_ep, _in, outFile) => {
          fs.writeFileSync(outFile, 'openapi: "3.0.0"\npaths: {}\n');
        },
        createAndSaveSimplifiedOpenAPIFullSurface: () => undefined,
      },
    });

    expect(runProductPipelines).not.toHaveBeenCalled();
  });

  it('Test C: call ordering is 4b (stub) -> 4c (products) -> 4d (stub again) -> 5 (coverage)', async () => {
    fs.copyFileSync(FIXTURE_PATH, path.join(tmpDir, 'openapi', 'openapi.yaml'));
    stageLegacyEndpointsJson(tmpDir);

    vi.stubEnv('MS365_MCP_FULL_COVERAGE', '1');
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');

    const callLog = [];
    const stubMissingSchemas = vi.fn(() => {
      callLog.push('stubMissingSchemas');
      return { stubbed: [] };
    });
    const runProductPipelines = vi.fn(async () => {
      callLog.push('runProductPipelines');
    });
    const runCoverageCheck = vi.fn(() => {
      callLog.push('runCoverageCheck');
      return {
        totals: { current: 0, baseline: 0 },
        byWorkload: {},
        deltas: {},
        warnings: [],
        errors: [],
      };
    });

    await generateMain({
      rootDir: tmpDir,
      generateMcpTools: () => true,
      runBetaPipeline: async () => ({ betaCount: 0, aliases: [] }),
      runProductPipelines,
      stubMissingSchemas,
      runCoverageCheck,
      compileEssentialsPreset: () => ({ count: 0, presetTsPath: '', missing: [] }),
      simplifiers: {
        createAndSaveSimplifiedOpenAPI: () => undefined,
        createAndSaveSimplifiedOpenAPIFullSurface: (_in, outFile) => {
          fs.writeFileSync(outFile, 'openapi: "3.0.0"\npaths: {}\n');
        },
      },
    });

    // Expected sequence: stubMissingSchemas (4b), runProductPipelines (4c),
    // stubMissingSchemas again (4d), runCoverageCheck (5).
    expect(callLog).toEqual([
      'stubMissingSchemas',
      'runProductPipelines',
      'stubMissingSchemas',
      'runCoverageCheck',
    ]);
  });

  it('Test D: PRODUCT_PIPELINES is exported as an empty array', async () => {
    // Import the orchestrator module directly to inspect the exported registry.
    const mod = await import('../../bin/generate-graph-client.mjs');
    expect(Array.isArray(mod.PRODUCT_PIPELINES)).toBe(true);
    expect(mod.PRODUCT_PIPELINES).toHaveLength(0);
  });

  it('Test E: .env.example declares all 5 per-product churn env vars with default 0', async () => {
    const envExamplePath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      '..',
      '.env.example'
    );
    const content = fs.readFileSync(envExamplePath, 'utf-8');
    for (const envName of [
      'MS365_MCP_ACCEPT_POWERBI_CHURN',
      'MS365_MCP_ACCEPT_PWRAPPS_CHURN',
      'MS365_MCP_ACCEPT_PWRAUTO_CHURN',
      'MS365_MCP_ACCEPT_EXO_CHURN',
      'MS365_MCP_ACCEPT_SPADMIN_CHURN',
    ]) {
      // Must appear uncommented with the default value 0 (strict fail-closed).
      const re = new RegExp(`^${envName}=0\\b`, 'm');
      expect(content).toMatch(re);
    }
  });
});
