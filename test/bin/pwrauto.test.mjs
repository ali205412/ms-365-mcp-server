/**
 * Plan 05.1-04 — Power Automate pipeline tests.
 *
 * Task 1 tests (1-12):
 *   1.  Prefix invariant — every emitted alias starts with `__pwrauto__`.
 *   2.  Real spec parses as valid OpenAPI 3.0 and has `.openapi === '3.0.0'`.
 *   3.  Real spec contains between 15 and 25 path+method operations.
 *   4.  Flow DSL escape-hatch present in spec — Flow.properties.properties.
 *       properties.definition.additionalProperties === true.
 *   5.  Emitted client.ts fragment (fixture) contains `z.record(z.any())` OR
 *       `z.object({}).passthrough()` for the Flow DSL body shape.
 *   6.  All emitted aliases are <= 64 chars (sha1-8 truncation applies).
 *   7.  Permissive removal without env — throws.
 *   8.  Permissive removal with env — passes and rewrites snapshot.
 *   9.  Permissive addition — additions pass silently.
 *   10. Fresh-checkout — absent snapshot creates initial snapshot.
 *   11. Hand-authored spec NOT present — pipeline throws with
 *       `/hand-authored spec not found/i`.
 *   12. Side-effect registration — importing `power-automate.mjs` adds exactly
 *       one `{name: 'pwrauto', ...}` entry into PRODUCT_PIPELINES; multiple
 *       imports do NOT double-add.
 *
 * Task 2 tests (13-15):
 *   13. Path resolution — `runPowerAutomatePipeline` resolves `specPath` under
 *       `<openapiDir>/openapi-pwrauto.yaml` and `snapshotPath` under
 *       `<rootDir>/bin/.last-pwrauto-snapshot.json`.
 *   14. Passes `specUrl: null` to `runProductPipeline` (captured via vi.mock).
 *   15. Deps bag — passes expected `prefix`, `churnPolicy='permissive'`,
 *       `churnEnvName='MS365_MCP_ACCEPT_PWRAUTO_CHURN'`, `openapiDir`,
 *       `generatedDir`, `specPath`, `snapshotPath`.
 *
 * Threat mitigations pinned:
 *   - T-5.1-04-c (silent spec drift) — Tests 7-9 pin the permissive-policy
 *     matrix; Test 10 verifies fresh-checkout path.
 *   - T-5.1-04-d (Flow DSL injection via opaque body) — Tests 4-5 pin that
 *     the escape hatch is intentional at both the spec and codegen layers.
 *     The gateway forwards opaque JSON to Microsoft's Flow runtime; semantic
 *     validation is Microsoft's responsibility. Documented design per
 *     05.1-RESEARCH §Anti-Patterns.
 *   - T-5.1-04-f (registry double-registration) — Test 12 pins idempotent
 *     side-effect push (mirrors T-5.1-02-f / T-5.1-03-f patterns).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PWRAUTO_FIXTURE = path.resolve(__dirname, 'fixtures', 'mini-pwrauto.yaml');
// Walk up two levels from test/bin/ to the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REAL_PWRAUTO_SPEC = path.join(PROJECT_ROOT, 'openapi', 'openapi-pwrauto.yaml');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05.1-04-pwrauto-${crypto.randomUUID()}`);
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
  fs.copyFileSync(PWRAUTO_FIXTURE, specPath);
}

describe('plan 05.1-04 — Power Automate generator (Task 1 + 2)', () => {
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

  it('Test 1: every emitted alias starts with __pwrauto__ prefix', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-pwrauto.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrauto-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__pwrauto__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_PWRAUTO_CHURN',
      openapiDir,
      generatedDir,
    });

    expect(result.count).toBe(3);
    for (const alias of result.aliases) {
      expect(alias.startsWith('__pwrauto__')).toBe(true);
    }
  }, 60_000);

  it('Test 2: openapi/openapi-pwrauto.yaml parses as valid OpenAPI 3.0', () => {
    const raw = fs.readFileSync(REAL_PWRAUTO_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    expect(doc).toBeDefined();
    expect(doc.openapi).toBe('3.0.0');
    expect(typeof doc.paths).toBe('object');
    expect(doc.paths).not.toBeNull();
    // Must have at least 15 distinct path entries (one line per HTTP route).
    expect(Object.keys(doc.paths).length).toBeGreaterThanOrEqual(15);
  });

  it('Test 3: openapi/openapi-pwrauto.yaml contains between 15 and 25 operations', () => {
    const raw = fs.readFileSync(REAL_PWRAUTO_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
    const opCount = Object.values(doc.paths).flatMap((p) =>
      Object.keys(p).filter((k) => METHODS.has(k))
    ).length;
    expect(opCount).toBeGreaterThanOrEqual(15);
    expect(opCount).toBeLessThanOrEqual(25);
  });

  it('Test 4: Flow DSL escape hatch — Flow.properties.properties.definition is open', () => {
    const raw = fs.readFileSync(REAL_PWRAUTO_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    // Walk Flow schema → properties (Flow obj) → properties (Flow outer obj
    // properties map) → definition (Flow DSL body).
    const flow = doc.components && doc.components.schemas && doc.components.schemas.Flow;
    expect(flow).toBeDefined();
    const innerProps = flow.properties && flow.properties.properties;
    expect(innerProps).toBeDefined();
    // `definition` is the recursive Flow DSL body; must be additionalProperties: true
    // so openapi-zod-client emits z.record(z.any()) or z.object({}).passthrough().
    const definition = innerProps.properties && innerProps.properties.definition;
    expect(definition).toBeDefined();
    expect(definition.additionalProperties).toBe(true);
    // `connectionReferences` is the opaque tenant-specific connection map.
    const connRefs = innerProps.properties && innerProps.properties.connectionReferences;
    expect(connRefs).toBeDefined();
    expect(connRefs.additionalProperties).toBe(true);
  });

  it('Test 5: emitted client.ts for Flow DSL bodies uses z.record(z.any()) or z.object({}).passthrough()', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-pwrauto.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrauto-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    await runProductPipeline({
      prefix: '__pwrauto__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_PWRAUTO_CHURN',
      openapiDir,
      generatedDir,
    });

    // After merge, the Flow DSL body type from the `trigger-flow` op must be
    // in the emitted client.ts. `openapi-zod-client` emits either
    // `z.record(z.any())` or `z.object({}).passthrough()` for
    // `{type: object, additionalProperties: true}` schemas depending on CLI
    // flags; both are valid (the post-processor rewrites `.strict()` →
    // `.passthrough()` which is why the object-form often wins in practice).
    const merged = fs.readFileSync(path.join(generatedDir, 'client.ts'), 'utf-8');
    expect(merged).toMatch(/z\.(?:record\(z\.any\(\)\)|object\(\{\}\)\.passthrough\(\))/);
  }, 60_000);

  it('Test 6: all emitted aliases are <= 64 chars (sha1-8 truncation applies)', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-pwrauto.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrauto-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__pwrauto__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_PWRAUTO_CHURN',
      openapiDir,
      generatedDir,
    });

    for (const alias of result.aliases) {
      expect(alias.length).toBeLessThanOrEqual(64);
    }
    // At least one alias should be exactly 64 (the 60-char `a...` fixture op
    // with `__pwrauto__` prefix = 71 raw chars → truncate to 64 with sha1-8).
    const truncated = result.aliases.find((a) => a.length === 64);
    expect(truncated).toBeDefined();
    expect(truncated).toMatch(/^__pwrauto__a+-[0-9a-f]{8}$/);
  }, 60_000);

  it('Test 7: permissive churn — removal without env throws', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrauto-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__pwrauto__a', '__pwrauto__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_PWRAUTO_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__pwrauto__a'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_PWRAUTO_CHURN'
      )
    ).toThrow(/disappeared|removed/i);

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__pwrauto__a', '__pwrauto__b']);
  });

  it('Test 8: permissive churn — removal WITH env passes and rewrites snapshot', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrauto-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__pwrauto__a', '__pwrauto__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_PWRAUTO_CHURN', '1');

    expect(() =>
      runProductChurnGuard(
        ['__pwrauto__a'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_PWRAUTO_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__pwrauto__a']);
    expect(snap.count).toBe(1);
  });

  it('Test 9: permissive churn — additions without env pass (silent)', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrauto-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 1,
          ops: ['__pwrauto__a'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_PWRAUTO_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__pwrauto__a', '__pwrauto__c'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_PWRAUTO_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__pwrauto__a', '__pwrauto__c']);
    expect(snap.count).toBe(2);
  });

  it('Test 10: fresh-checkout — absent snapshot file creates initial snapshot', async () => {
    const { runProductChurnGuard } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );
    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrauto-snapshot.json');
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    vi.stubEnv('MS365_MCP_ACCEPT_PWRAUTO_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__pwrauto__alpha'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_PWRAUTO_CHURN'
      )
    ).not.toThrow();
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__pwrauto__alpha']);
  });

  it('Test 11: hand-authored spec NOT present — pipeline throws', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-pwrauto.yaml');
    // Intentionally DO NOT stage the fixture — exercise the missing-spec throw.
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-pwrauto-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    await expect(
      runProductPipeline({
        prefix: '__pwrauto__',
        specUrl: null,
        specPath,
        snapshotPath,
        churnPolicy: 'permissive',
        churnEnvName: 'MS365_MCP_ACCEPT_PWRAUTO_CHURN',
        openapiDir,
        generatedDir,
      })
    ).rejects.toThrow(/hand-authored spec not found/i);
  }, 60_000);

  it('Test 12: importing power-automate.mjs registers exactly one pwrauto entry (idempotent)', async () => {
    vi.resetModules();
    const { PRODUCT_PIPELINES } = await import('../../bin/modules/product-registry.mjs');
    // Triple import exercises both ESM module-cache and the explicit
    // `.some(...)` guard in the product module.
    await import('../../bin/modules/power-automate.mjs');
    await import('../../bin/modules/power-automate.mjs');
    await import('../../bin/modules/power-automate.mjs');

    const pwrautoEntries = PRODUCT_PIPELINES.filter((p) => p.name === 'pwrauto');
    expect(pwrautoEntries).toHaveLength(1);
    expect(typeof pwrautoEntries[0].run).toBe('function');

    // Orchestrator re-export reaches the same binding.
    const orchestrator = await import('../../bin/generate-graph-client.mjs');
    expect(orchestrator.PRODUCT_PIPELINES).toBe(PRODUCT_PIPELINES);
  });

  // ─── Task 2 tests ───────────────────────────────────────────────────────────

  it('Test 13: runPowerAutomatePipeline resolves paths under openapiDir + rootDir', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runPowerAutomatePipeline } = await import(
      '../../bin/modules/power-automate.mjs'
    );
    const { runProductPipeline } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );

    const openapiDir = '/test/openapi';
    const generatedDir = '/test/src/generated';
    const rootDir = '/test';

    await runPowerAutomatePipeline({ openapiDir, generatedDir, rootDir });

    expect(runProductPipeline).toHaveBeenCalledTimes(1);
    const actualOpts = runProductPipeline.mock.calls[0][0];
    expect(actualOpts.specPath).toBe(path.join(openapiDir, 'openapi-pwrauto.yaml'));
    expect(actualOpts.snapshotPath).toBe(
      path.join(rootDir, 'bin', '.last-pwrauto-snapshot.json')
    );
  });

  it('Test 14: runPowerAutomatePipeline passes specUrl: null to runProductPipeline', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runPowerAutomatePipeline } = await import(
      '../../bin/modules/power-automate.mjs'
    );
    const { runProductPipeline } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );

    await runPowerAutomatePipeline({
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

  it('Test 15: runPowerAutomatePipeline delegates with the expected deps bag', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runPowerAutomatePipeline } = await import(
      '../../bin/modules/power-automate.mjs'
    );
    const { runProductPipeline } = await import(
      '../../bin/modules/run-product-pipeline.mjs'
    );

    await runPowerAutomatePipeline({
      openapiDir: '/test/openapi',
      generatedDir: '/test/src/generated',
      rootDir: '/test',
    });

    expect(runProductPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: '__pwrauto__',
        specUrl: null,
        churnPolicy: 'permissive',
        churnEnvName: 'MS365_MCP_ACCEPT_PWRAUTO_CHURN',
        openapiDir: '/test/openapi',
        generatedDir: '/test/src/generated',
        specPath: path.join('/test/openapi', 'openapi-pwrauto.yaml'),
        snapshotPath: path.join('/test', 'bin', '.last-pwrauto-snapshot.json'),
      })
    );
  });
});
