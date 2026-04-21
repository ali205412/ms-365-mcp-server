/**
 * Plan 05.1-03 — Power Apps pipeline tests.
 *
 * Task 1 tests (1-11):
 *   1.  Prefix invariant — every emitted alias starts with `__pwrapps__`.
 *   2.  Real spec parses as valid OpenAPI 3.0 and has `.openapi === '3.0.0'`.
 *   3.  Real spec contains between 15 and 25 path+method operations.
 *   4.  All emitted aliases are <= 64 chars (sha1-8 truncation applies).
 *   5.  Permissive removal without env — throws.
 *   6.  Permissive removal with env — passes and rewrites snapshot.
 *   7.  Permissive addition — additions pass silently.
 *   8.  Fresh-checkout — absent snapshot creates initial snapshot.
 *   9.  Hand-authored spec NOT present — pipeline throws with
 *       `/hand-authored spec not found/i`.
 *   10. Side-effect registration — importing `power-apps.mjs` adds exactly
 *       one `{name: 'pwrapps', ...}` entry into PRODUCT_PIPELINES; second
 *       import does NOT double-add.
 *   11. NO region-header injection at codegen — emitted endpoints do NOT
 *       carry a pre-baked `x-ms-region` parameter.
 *
 * Task 2 tests (12-14):
 *   12. Path resolution — `runPowerAppsPipeline` resolves `specPath` under
 *       `<openapiDir>/openapi-pwrapps.yaml` and `snapshotPath` under
 *       `<rootDir>/bin/.last-pwrapps-snapshot.json`.
 *   13. Passes `specUrl: null` to `runProductPipeline` (captured via vi.mock).
 *   14. Deps bag — passes expected `prefix`, `churnPolicy='permissive'`,
 *       `churnEnvName='MS365_MCP_ACCEPT_PWRAPPS_CHURN'`, `openapiDir`,
 *       `generatedDir`, `specPath`, `snapshotPath`.
 *
 * Threat mitigations pinned:
 *   - T-5.1-03-c (silent spec drift) — Tests 5-7 pin the permissive-policy
 *     matrix; Test 8 verifies fresh-checkout path.
 *   - T-5.1-03-d (rogue servers: redirect) — runtime dispatch is owned by
 *     plan 5.1-06; the hand-authored YAML's `servers:` is documentation-only.
 *     This suite asserts no runtime-steering via codegen (Test 11: no
 *     pre-baked region header).
 *   - T-5.1-03-e (oversized spec OOM) — the committed spec is <50 KB (19
 *     ops); simplifier depth=3 cap inherited from Phase 5 prevents OOM.
 *   - T-5.1-03-f (wrong-region) — Test 11 pins no x-ms-region header at
 *     codegen; assumption A9 + open question #1 escalate if empirically wrong.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PWRAPPS_FIXTURE = path.resolve(__dirname, 'fixtures', 'mini-pwrapps.yaml');
// Walk up two levels from test/bin/ to the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REAL_PWRAPPS_SPEC = path.join(PROJECT_ROOT, 'openapi', 'openapi-pwrapps.yaml');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05.1-03-pwrapps-${crypto.randomUUID()}`);
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
  fs.copyFileSync(PWRAPPS_FIXTURE, specPath);
}

describe('plan 05.1-03 — Power Apps generator (Task 1 + 2)', () => {
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

  it('Test 1: every emitted alias starts with __pwrapps__ prefix', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-pwrapps.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrapps-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__pwrapps__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_PWRAPPS_CHURN',
      openapiDir,
      generatedDir,
    });

    expect(result.count).toBe(3);
    for (const alias of result.aliases) {
      expect(alias.startsWith('__pwrapps__')).toBe(true);
    }
  }, 60_000);

  it('Test 2: openapi/openapi-pwrapps.yaml parses as valid OpenAPI 3.0', () => {
    const raw = fs.readFileSync(REAL_PWRAPPS_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    expect(doc).toBeDefined();
    expect(doc.openapi).toBe('3.0.0');
    expect(typeof doc.paths).toBe('object');
    expect(doc.paths).not.toBeNull();
    // Must have at least 15 distinct path entries (one line per HTTP route).
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(15);
  });

  it('Test 3: openapi/openapi-pwrapps.yaml contains between 15 and 25 operations', () => {
    const raw = fs.readFileSync(REAL_PWRAPPS_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
    const opCount = Object.values(doc.paths).flatMap((p) =>
      Object.keys(p).filter((k) => METHODS.has(k))
    ).length;
    expect(opCount).toBeGreaterThanOrEqual(15);
    expect(opCount).toBeLessThanOrEqual(25);
  });

  it('Test 4: all emitted aliases are <= 64 chars (sha1-8 truncation applies)', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-pwrapps.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrapps-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__pwrapps__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_PWRAPPS_CHURN',
      openapiDir,
      generatedDir,
    });

    for (const alias of result.aliases) {
      expect(alias.length).toBeLessThanOrEqual(64);
    }
    // At least one alias should be exactly 64 (the 60-char `a...` fixture op
    // with `__pwrapps__` prefix = 71 raw chars → truncate to 64 with sha1-8).
    const truncated = result.aliases.find((a) => a.length === 64);
    expect(truncated).toBeDefined();
    expect(truncated).toMatch(/^__pwrapps__a+-[0-9a-f]{8}$/);
  }, 60_000);

  it('Test 5: permissive churn — removal without env throws', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrapps-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__pwrapps__a', '__pwrapps__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_PWRAPPS_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__pwrapps__a'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_PWRAPPS_CHURN'
      )
    ).toThrow(/disappeared|removed/i);

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__pwrapps__a', '__pwrapps__b']);
  });

  it('Test 6: permissive churn — removal WITH env passes and rewrites snapshot', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrapps-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__pwrapps__a', '__pwrapps__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_PWRAPPS_CHURN', '1');

    expect(() =>
      runProductChurnGuard(
        ['__pwrapps__a'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_PWRAPPS_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__pwrapps__a']);
    expect(snap.count).toBe(1);
  });

  it('Test 7: permissive churn — additions without env pass (silent)', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrapps-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 1,
          ops: ['__pwrapps__a'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_PWRAPPS_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__pwrapps__a', '__pwrapps__c'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_PWRAPPS_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__pwrapps__a', '__pwrapps__c']);
    expect(snap.count).toBe(2);
  });

  it('Test 8: fresh-checkout — absent snapshot file creates initial snapshot', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrapps-snapshot.json');
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    vi.stubEnv('MS365_MCP_ACCEPT_PWRAPPS_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__pwrapps__alpha'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_PWRAPPS_CHURN'
      )
    ).not.toThrow();
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__pwrapps__alpha']);
  });

  it('Test 9: hand-authored spec NOT present — pipeline throws', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-pwrapps.yaml');
    // Intentionally DO NOT stage the fixture — exercise the missing-spec throw.
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrapps-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    await expect(
      runProductPipeline({
        prefix: '__pwrapps__',
        specUrl: null,
        specPath,
        snapshotPath,
        churnPolicy: 'permissive',
        churnEnvName: 'MS365_MCP_ACCEPT_PWRAPPS_CHURN',
        openapiDir,
        generatedDir,
      })
    ).rejects.toThrow(/hand-authored spec not found/i);
  }, 60_000);

  it('Test 10: importing power-apps.mjs registers exactly one pwrapps entry (idempotent)', async () => {
    vi.resetModules();
    const { PRODUCT_PIPELINES } = await import('../../bin/modules/product-registry.mjs');
    // Triple import exercises both ESM module-cache and the explicit
    // `.some(...)` guard in the product module.
    await import('../../bin/modules/power-apps.mjs');
    await import('../../bin/modules/power-apps.mjs');
    await import('../../bin/modules/power-apps.mjs');

    const pwrappsEntries = PRODUCT_PIPELINES.filter((p) => p.name === 'pwrapps');
    expect(pwrappsEntries).toHaveLength(1);
    expect(typeof pwrappsEntries[0].run).toBe('function');

    // Orchestrator re-export reaches the same binding.
    const orchestrator = await import('../../bin/generate-graph-client.mjs');
    expect(orchestrator.PRODUCT_PIPELINES).toBe(PRODUCT_PIPELINES);
  });

  it('Test 11: NO region-header injection at codegen — emitted endpoints carry no x-ms-region parameter', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-pwrapps.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrapps-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    await runProductPipeline({
      prefix: '__pwrapps__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_PWRAPPS_CHURN',
      openapiDir,
      generatedDir,
    });

    const merged = fs.readFileSync(path.join(generatedDir, 'client.ts'), 'utf-8');
    // Research A9: Power Apps auto-routes by OAuth claim; no region header is
    // pre-baked at codegen time. If integration observes wrong-region traffic,
    // plan 5.1-08's GAP-POWER-PLATFORM.md documents the escalation path.
    expect(merged).not.toMatch(/x-ms-region/i);
  }, 60_000);

  // ─── Task 2 tests ───────────────────────────────────────────────────────────

  it('Test 12: runPowerAppsPipeline resolves paths under openapiDir + rootDir', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runPowerAppsPipeline } = await import('../../bin/modules/power-apps.mjs');
    const { runProductPipeline } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );

    const openapiDir = '/test/openapi';
    const generatedDir = '/test/src/generated';
    const rootDir = '/test';

    await runPowerAppsPipeline({ openapiDir, generatedDir, rootDir });

    expect(runProductPipeline).toHaveBeenCalledTimes(1);
    const actualOpts = runProductPipeline.mock.calls[0][0];
    expect(actualOpts.specPath).toBe(path.join(openapiDir, 'openapi-pwrapps.yaml'));
    expect(actualOpts.snapshotPath).toBe(
      path.join(rootDir, 'bin', '.last-pwrapps-snapshot.json')
    );
  });

  it('Test 13: runPowerAppsPipeline passes specUrl: null to runProductPipeline', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runPowerAppsPipeline } = await import('../../bin/modules/power-apps.mjs');
    const { runProductPipeline } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );

    await runPowerAppsPipeline({
      openapiDir: '/test/openapi',
      generatedDir: '/test/src/generated',
      rootDir: '/test',
    });

    const actualOpts = runProductPipeline.mock.calls[0][0];
    // specUrl MUST be null to skip the download step. `undefined` also works
    // at the pipeline level but the wrapper commits to literal null to make
    // the hand-authored-spec contract explicit at the API boundary.
    expect(actualOpts.specUrl).toBeNull();
  });

  it('Test 14: runPowerAppsPipeline delegates with the expected deps bag', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runPowerAppsPipeline } = await import('../../bin/modules/power-apps.mjs');
    const { runProductPipeline } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );

    await runPowerAppsPipeline({
      openapiDir: '/test/openapi',
      generatedDir: '/test/src/generated',
      rootDir: '/test',
    });

    expect(runProductPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: '__pwrapps__',
        specUrl: null,
        churnPolicy: 'permissive',
        churnEnvName: 'MS365_MCP_ACCEPT_PWRAPPS_CHURN',
        openapiDir: '/test/openapi',
        generatedDir: '/test/src/generated',
        specPath: path.join('/test/openapi', 'openapi-pwrapps.yaml'),
        snapshotPath: path.join('/test', 'bin', '.last-pwrapps-snapshot.json'),
      })
    );
  });
});
