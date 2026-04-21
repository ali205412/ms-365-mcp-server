/**
 * Plan 05.1-02 Task 1 + Task 2 — Power BI pipeline tests.
 *
 * Task 1 tests (1-9):
 *  1. Prefix invariant — every emitted alias starts with `__powerbi__`
 *  2. 64-char invariant — no alias exceeds MCP SEP-986 limit
 *  3. Short-id round-trip — `WorkspacesGetDatasetsInGroupAsAdmin` is NOT truncated
 *  4. Long-id truncation — 60-char operationId produces `__powerbi__aaaaa...-<8hex>`
 *  5. Permissive churn without env — removal throws
 *  6. Permissive churn with env — removal accepted, snapshot rewritten
 *  7. Permissive addition — additions pass silently (no env needed)
 *  8. Fresh-checkout — absent snapshot file creates initial snapshot
 *  9. Side-effect registration — importing `power-bi.mjs` pushes exactly one
 *     `{name: 'powerbi'}` entry into `PRODUCT_PIPELINES`
 *
 * Task 2 tests (10-12):
 * 10. Idempotent registration — double-importing does NOT double-register
 * 11. Path resolution — `runPowerBIPipeline` resolves snapshotPath under
 *     `<rootDir>/bin/.last-powerbi-snapshot.json` and specPath under
 *     `<openapiDir>/openapi-powerbi.yaml`
 * 12. Deps bag — `runProductPipeline` is called with exactly the expected
 *     opts (prefix, specUrl, churnPolicy='permissive', churnEnvName=
 *     'MS365_MCP_ACCEPT_POWERBI_CHURN', openapiDir, generatedDir, specPath,
 *     snapshotPath)
 *
 * Threat mitigations pinned:
 *  - T-5.1-02-c (PBI spec-drift silent feature loss) — Tests 5-7 pin the
 *    permissive-policy matrix; Test 8 verifies fresh-checkout path.
 *  - T-5.1-02-d (alias collision) — inherited from plan 5.1-01's generic
 *    collision guard; Tests 1+3 assert Power BI-specific prefix uniqueness.
 *  - T-5.1-02-f (registry double-registration) — Test 10 pins idempotency.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POWERBI_FIXTURE = path.resolve(__dirname, 'fixtures', 'mini-powerbi.yaml');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05.1-02-pbi-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'openapi'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'generated'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  // Stage hack.ts so the post-processor's rewrite target resolves downstream.
  fs.writeFileSync(path.join(dir, 'src', 'generated', 'hack.ts'), '// stub');
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function seedMainClient(generatedDir, existingAliases = []) {
  const entries = existingAliases
    .map(
      (alias) =>
        `  {
    method: "get",
    path: "/stub-${alias}",
    alias: "${alias}",
    requestFormat: "json",
    response: z.object({}).passthrough(),
  }`
    )
    .join(',\n');
  const body = `import { makeApi, Zodios } from './hack.js';
import { z } from 'zod';

const endpoints = makeApi([
${entries}
]);

export const api = new Zodios(endpoints);
`;
  fs.writeFileSync(path.join(generatedDir, 'client.ts'), body);
}

function stageFixture(specPath) {
  fs.copyFileSync(POWERBI_FIXTURE, specPath);
}

describe('plan 05.1-02 — Power BI generator (Task 1 + 2)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('Test 1: every emitted alias starts with __powerbi__ prefix', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-powerbi.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-powerbi-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__powerbi__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_POWERBI_CHURN',
      openapiDir,
      generatedDir,
    });

    expect(result.count).toBe(3);
    for (const alias of result.aliases) {
      expect(alias.startsWith('__powerbi__')).toBe(true);
    }
  }, 60_000);

  it('Test 2: no emitted alias exceeds MCP 64-char limit', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-powerbi.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-powerbi-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__powerbi__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_POWERBI_CHURN',
      openapiDir,
      generatedDir,
    });

    for (const alias of result.aliases) {
      expect(alias.length).toBeLessThanOrEqual(64);
    }
  }, 60_000);

  it('Test 3: WorkspacesGetDatasetsInGroupAsAdmin is emitted verbatim (no truncation)', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-powerbi.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-powerbi-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__powerbi__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_POWERBI_CHURN',
      openapiDir,
      generatedDir,
    });

    // The openapi-zod-client generator lowercases the first character of
    // operationIds (Wave 1 pipeline's regex anchor is `[a-z]`), so the alias
    // appears as `__powerbi__workspacesGetDatasetsInGroupAsAdmin` (48 chars).
    const safeShortAlias = result.aliases.find(
      (a) => a.toLowerCase().includes('workspacesgetdatasetsingroupasadmin')
    );
    expect(safeShortAlias).toBeDefined();
    // Verbatim: prefix (11) + operationId (37 for lowercase variant) = 48 chars.
    expect(safeShortAlias.length).toBeLessThan(64);
    // No sha1-8 trailing hash — verbatim round-trip.
    expect(safeShortAlias).not.toMatch(/-[0-9a-f]{8}$/);
  }, 60_000);

  it('Test 4: 60-char operationId produces 64-char truncated alias with sha1-8 suffix', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-powerbi.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-powerbi-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__powerbi__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_POWERBI_CHURN',
      openapiDir,
      generatedDir,
    });

    // The 60-char "a..." operationId + __powerbi__ (11) = 71 chars raw → truncate to 64.
    const truncated = result.aliases.find((a) => a.length === 64);
    expect(truncated).toBeDefined();
    expect(truncated).toMatch(/^__powerbi__a+-[0-9a-f]{8}$/);
  }, 60_000);

  it('Test 5: permissive churn — removal without env throws', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-powerbi-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__powerbi__a', '__powerbi__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_POWERBI_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__powerbi__a'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_POWERBI_CHURN'
      )
    ).toThrow(/disappeared|removed/i);

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__powerbi__a', '__powerbi__b']);
  });

  it('Test 6: permissive churn — removal WITH env passes and rewrites snapshot', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-powerbi-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__powerbi__a', '__powerbi__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_POWERBI_CHURN', '1');

    expect(() =>
      runProductChurnGuard(
        ['__powerbi__a'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_POWERBI_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__powerbi__a']);
    expect(snap.count).toBe(1);
  });

  it('Test 7: permissive churn — additions without env pass (additions silent)', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-powerbi-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 1,
          ops: ['__powerbi__a'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_POWERBI_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__powerbi__a', '__powerbi__c'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_POWERBI_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__powerbi__a', '__powerbi__c']);
    expect(snap.count).toBe(2);
  });

  it('Test 8: fresh-checkout creates initial snapshot regardless of policy', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-powerbi-snapshot.json');
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    vi.stubEnv('MS365_MCP_ACCEPT_POWERBI_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__powerbi__alpha'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_POWERBI_CHURN'
      )
    ).not.toThrow();
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__powerbi__alpha']);
  });

  it('Test 9: importing bin/modules/power-bi.mjs registers exactly one entry in PRODUCT_PIPELINES', async () => {
    // The orchestrator imports `./modules/power-bi.mjs` for its side effect,
    // so by the time we can observe `PRODUCT_PIPELINES`, the Power BI entry
    // is already present. Assert the observable contract: exactly one entry
    // with name 'powerbi' and a callable `run` function.
    vi.resetModules();
    // Import the leaf registry directly — same binding the orchestrator re-exports.
    const { PRODUCT_PIPELINES } = await import('../../bin/modules/product-registry.mjs');
    await import('../../bin/modules/power-bi.mjs');

    const powerbiEntries = PRODUCT_PIPELINES.filter((p) => p.name === 'powerbi');
    expect(powerbiEntries).toHaveLength(1);
    expect(typeof powerbiEntries[0].run).toBe('function');

    // Also reachable via the orchestrator's re-export (backwards compat).
    const orchestrator = await import('../../bin/generate-graph-client.mjs');
    expect(orchestrator.PRODUCT_PIPELINES).toBe(PRODUCT_PIPELINES);
  });

  // ─── Task 2 tests ───────────────────────────────────────────────────────────

  it('Test 10: double-importing power-bi.mjs does NOT double-register (idempotent)', async () => {
    vi.resetModules();
    const { PRODUCT_PIPELINES } = await import('../../bin/modules/product-registry.mjs');

    // Three imports in sequence; ESM module cache should only initialise once,
    // but even if a test runner thwarts the cache (vi.resetModules between calls),
    // the module's `.some(entry => entry.name === 'powerbi')` guard must keep
    // the registry at exactly 1 entry.
    await import('../../bin/modules/power-bi.mjs');
    await import('../../bin/modules/power-bi.mjs');
    await import('../../bin/modules/power-bi.mjs');

    const powerbiEntries = PRODUCT_PIPELINES.filter((p) => p.name === 'powerbi');
    expect(powerbiEntries).toHaveLength(1);
  });

  it('Test 11: runPowerBIPipeline resolves paths under openapiDir + rootDir', async () => {
    vi.resetModules();

    // Mock runProductPipeline BEFORE the wrapper imports it, so the wrapper's
    // deps-bag is captured without actually running codegen. Hoisted-mock is
    // critical: the wrapper's top-level import is statically analysed.
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runPowerBIPipeline } = await import('../../bin/modules/power-bi.mjs');
    const { runProductPipeline } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );

    const openapiDir = '/test/openapi';
    const generatedDir = '/test/src/generated';
    const rootDir = '/test';

    await runPowerBIPipeline({ openapiDir, generatedDir, rootDir });

    expect(runProductPipeline).toHaveBeenCalledTimes(1);
    const actualOpts = runProductPipeline.mock.calls[0][0];
    expect(actualOpts.specPath).toBe(path.join(openapiDir, 'openapi-powerbi.yaml'));
    expect(actualOpts.snapshotPath).toBe(
      path.join(rootDir, 'bin', '.last-powerbi-snapshot.json')
    );
  });

  it('Test 12: runPowerBIPipeline delegates with the expected deps bag', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runPowerBIPipeline, POWERBI_SPEC_URL } = await import(
      '../../bin/modules/power-bi.mjs'
    );
    const { runProductPipeline } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );

    await runPowerBIPipeline({
      openapiDir: '/test/openapi',
      generatedDir: '/test/src/generated',
      rootDir: '/test',
    });

    expect(runProductPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: '__powerbi__',
        specUrl: POWERBI_SPEC_URL,
        churnPolicy: 'permissive',
        churnEnvName: 'MS365_MCP_ACCEPT_POWERBI_CHURN',
        openapiDir: '/test/openapi',
        generatedDir: '/test/src/generated',
        specPath: path.join('/test/openapi', 'openapi-powerbi.yaml'),
        snapshotPath: path.join('/test', 'bin', '.last-powerbi-snapshot.json'),
      })
    );
    // Assert the spec URL is the committed upstream GitHub raw URL.
    expect(POWERBI_SPEC_URL).toBe(
      'https://raw.githubusercontent.com/microsoft/PowerBI-CSharp/master/sdk/swaggers/swagger.json'
    );
  });
});
