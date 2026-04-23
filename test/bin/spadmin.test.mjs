/**
 * Plan 05.1-06 Task 1 — SharePoint Tenant Admin pipeline tests.
 *
 * Tests exercise the hand-authored-spec code path (specUrl=null) + strict
 * churn policy for `__spadmin__`-prefixed aliases. Mirrors the exo.test.mjs
 * harness shape (plan 05.1-05 — strict-product precedent).
 *
 * Task 1 tests:
 *   1.  Real spec `openapi/openapi-spadmin.yaml` parses as valid OpenAPI 3.0
 *       and declares 10-20 operations.
 *   2.  Every emitted alias after runProductPipeline starts with
 *       `__spadmin__` (prefix invariant).
 *   3.  Strict churn — addition without env throws.
 *   4.  Strict churn with env=1 → passes + rewrites snapshot.
 *   5.  Fresh-checkout — absent snapshot creates initial snapshot without
 *       throwing, even under strict policy.
 *   6.  Side-effect registration — importing `sp-admin.mjs` adds exactly one
 *       {name: 'sp-admin', ...} entry into PRODUCT_PIPELINES; multiple
 *       imports do NOT double-add.
 *   7.  Hand-authored spec absent → runProductPipeline throws matching
 *       /hand-authored spec not found/i.
 *   8.  All emitted aliases are <= 64 chars (sha1-8 truncation applies).
 *   9.  Servers[0].url uses sharepoint_domain variable with Zod-shape
 *       description documenting plan 5.1-06's dispatch validation
 *       (T-5.1-06-c defense-in-depth hand-off).
 *   10. runSpAdminPipeline resolves paths under openapiDir + rootDir and
 *       passes the strict deps bag.
 *   11. runSpAdminPipeline passes specUrl: null to runProductPipeline.
 *
 * Threat mitigations pinned by Task 1:
 *   - T-5.1-06-c (sharepoint_domain injection at codegen) — Test 9 pins the
 *     spec-level documentation of the Zod regex. Runtime enforcement is
 *     owned by Task 2 (src/lib/auth/products.ts).
 *   - T-5.1-06-d (alias collision across products) — Test 2 guarantees every
 *     emitted alias carries the `__spadmin__` prefix; collision with other
 *     product prefixes is prevented by construction.
 *   - Strict churn (CONTEXT D-04) — Tests 3, 4 pin the matrix. Operator
 *     explicitly acknowledges every spec bump via MS365_MCP_ACCEPT_SPADMIN_CHURN=1.
 *   - Registry double-registration — Test 6 pins the idempotent side-effect
 *     push (mirrors T-5.1-02-f / T-5.1-03-f / T-5.1-04-f / T-5.1-05 patterns).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPADMIN_FIXTURE = path.resolve(__dirname, 'fixtures', 'mini-spadmin.yaml');
// Walk up two levels from test/bin/ to the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REAL_SPADMIN_SPEC = path.join(PROJECT_ROOT, 'openapi', 'openapi-spadmin.yaml');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05.1-06-spadmin-${crypto.randomUUID()}`);
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
  fs.copyFileSync(SPADMIN_FIXTURE, specPath);
}

describe('plan 05.1-06 task 1 — SharePoint Tenant Admin generator', () => {
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

  it('Test 1: openapi/openapi-spadmin.yaml parses as OpenAPI 3.0 with 10-20 ops', () => {
    const raw = fs.readFileSync(REAL_SPADMIN_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    expect(doc).toBeDefined();
    expect(doc.openapi).toBe('3.0.0');
    expect(typeof doc.paths).toBe('object');
    expect(doc.paths).not.toBeNull();

    const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
    const opCount = Object.values(doc.paths).flatMap((p) =>
      Object.keys(p).filter((k) => METHODS.has(k))
    ).length;
    expect(opCount).toBeGreaterThanOrEqual(10);
    expect(opCount).toBeLessThanOrEqual(20);
  });

  it('Test 2: every emitted alias starts with __spadmin__ prefix', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-spadmin.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-spadmin-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__spadmin__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'strict',
      churnEnvName: 'MS365_MCP_ACCEPT_SPADMIN_CHURN',
      openapiDir,
      generatedDir,
    });

    expect(result.count).toBe(3);
    for (const alias of result.aliases) {
      expect(alias.startsWith('__spadmin__')).toBe(true);
    }
  }, 60_000);

  it('Test 3: strict churn — addition without env throws', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-spadmin-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 1,
          ops: ['__spadmin__a'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_SPADMIN_CHURN', '0');

    // Strict: ANY delta (including additions) throws without env.
    expect(() =>
      runProductChurnGuard(
        ['__spadmin__a', '__spadmin__b'],
        snapshotPath,
        'strict',
        'MS365_MCP_ACCEPT_SPADMIN_CHURN'
      )
    ).toThrow(/strict/i);

    // Snapshot MUST NOT be rewritten on throw.
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__spadmin__a']);
  });

  it('Test 4: strict churn — addition with env=1 passes and rewrites snapshot', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-spadmin-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 1,
          ops: ['__spadmin__a'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_SPADMIN_CHURN', '1');

    expect(() =>
      runProductChurnGuard(
        ['__spadmin__a', '__spadmin__b'],
        snapshotPath,
        'strict',
        'MS365_MCP_ACCEPT_SPADMIN_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__spadmin__a', '__spadmin__b']);
    expect(snap.count).toBe(2);
  });

  it('Test 5: fresh-checkout — absent snapshot creates initial snapshot under strict policy', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-spadmin-snapshot.json');
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    vi.stubEnv('MS365_MCP_ACCEPT_SPADMIN_CHURN', '0');

    // Fresh checkout: no snapshot on disk. Strict policy still creates the
    // initial snapshot without throwing — first runs are always safe.
    expect(() =>
      runProductChurnGuard(
        ['__spadmin__alpha'],
        snapshotPath,
        'strict',
        'MS365_MCP_ACCEPT_SPADMIN_CHURN'
      )
    ).not.toThrow();
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__spadmin__alpha']);
  });

  it('Test 6: importing sp-admin.mjs registers exactly one sp-admin entry (idempotent)', async () => {
    vi.resetModules();
    const { PRODUCT_PIPELINES } = await import('../../bin/modules/product-registry.mjs');
    // Triple import exercises both ESM module-cache and the explicit
    // `.some(...)` guard in the product module.
    await import('../../bin/modules/sp-admin.mjs');
    await import('../../bin/modules/sp-admin.mjs');
    await import('../../bin/modules/sp-admin.mjs');

    const spadminEntries = PRODUCT_PIPELINES.filter((p) => p.name === 'sp-admin');
    expect(spadminEntries).toHaveLength(1);
    expect(typeof spadminEntries[0].run).toBe('function');

    // Orchestrator re-export reaches the same binding.
    const orchestrator = await import('../../bin/generate-graph-client.mjs');
    expect(orchestrator.PRODUCT_PIPELINES).toBe(PRODUCT_PIPELINES);
  });

  it('Test 7: hand-authored spec absent → runProductPipeline throws', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-spadmin.yaml');
    // DO NOT stage the fixture — absence is the test condition.
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-spadmin-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');

    await expect(
      runProductPipeline({
        prefix: '__spadmin__',
        specUrl: null,
        specPath,
        snapshotPath,
        churnPolicy: 'strict',
        churnEnvName: 'MS365_MCP_ACCEPT_SPADMIN_CHURN',
        openapiDir,
        generatedDir,
      })
    ).rejects.toThrow(/hand-authored spec not found/i);
  }, 60_000);

  it('Test 8: all emitted aliases are <= 64 chars (sha1-8 truncation applies)', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-spadmin.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-spadmin-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__spadmin__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'strict',
      churnEnvName: 'MS365_MCP_ACCEPT_SPADMIN_CHURN',
      openapiDir,
      generatedDir,
    });

    for (const alias of result.aliases) {
      expect(alias.length).toBeLessThanOrEqual(64);
    }
    // At least one alias should be exactly 64 (the 60-char fixture op with
    // __spadmin__ prefix = 71 raw chars → truncate to 64 with sha1-8 suffix).
    const truncated = result.aliases.find((a) => a.length === 64);
    expect(truncated).toBeDefined();
    expect(truncated).toMatch(/^__spadmin__a+-[0-9a-f]{8}$/);
  }, 60_000);

  it('Test 9: servers[0].url uses sharepoint_domain variable with Zod-shape description', () => {
    const raw = fs.readFileSync(REAL_SPADMIN_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    expect(Array.isArray(doc.servers)).toBe(true);
    expect(doc.servers.length).toBeGreaterThanOrEqual(1);
    expect(doc.servers[0].url).toContain('{sharepoint_domain}');
    expect(doc.servers[0].url).toContain('-admin.sharepoint.com');

    const spDomainVar = doc.servers[0].variables?.sharepoint_domain;
    expect(spDomainVar).toBeDefined();
    // Documentation must reference the Zod regex that plan 5.1-06 dispatch
    // enforces (T-5.1-06-c defense-in-depth — spec documents the contract,
    // runtime re-validates before URL / scope construction).
    expect(spDomainVar.description).toMatch(/\[a-z0-9-\]\{1,63\}/);
  });

  it('Test 10: runSpAdminPipeline resolves paths under openapiDir + rootDir with strict deps bag', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runSpAdminPipeline } = await import('../../bin/modules/sp-admin.mjs');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');

    const openapiDir = '/test/openapi';
    const generatedDir = '/test/src/generated';
    const rootDir = '/test';

    await runSpAdminPipeline({ openapiDir, generatedDir, rootDir });

    expect(runProductPipeline).toHaveBeenCalledTimes(1);
    expect(runProductPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: '__spadmin__',
        // STRICT policy — distinguishes SP Admin from Power BI/Apps/Automate
        // per CONTEXT D-04. ANY alias delta requires MS365_MCP_ACCEPT_SPADMIN_CHURN=1.
        churnPolicy: 'strict',
        churnEnvName: 'MS365_MCP_ACCEPT_SPADMIN_CHURN',
        openapiDir: '/test/openapi',
        generatedDir: '/test/src/generated',
        specPath: path.join(openapiDir, 'openapi-spadmin.yaml'),
        snapshotPath: path.join(rootDir, 'bin', '.last-spadmin-snapshot.json'),
      })
    );
  });

  it('Test 11: runSpAdminPipeline passes specUrl: null to runProductPipeline', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runSpAdminPipeline } = await import('../../bin/modules/sp-admin.mjs');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');

    await runSpAdminPipeline({
      openapiDir: '/test/openapi',
      generatedDir: '/test/src/generated',
      rootDir: '/test',
    });

    const actualOpts = runProductPipeline.mock.calls[0][0];
    // specUrl MUST be null — commits to the hand-authored-spec contract at
    // the API boundary. Mirror of plan 5.1-05 exo precedent.
    expect(actualOpts.specUrl).toBeNull();
  });
});
