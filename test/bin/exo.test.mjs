/**
 * Plan 05.1-05 — Exchange Admin REST v2 pipeline tests.
 *
 * Task 1 tests (spec + GAP + fixture artifacts, all present in the Task 1 RED
 * commit):
 *   1.  Prefix invariant — every emitted alias starts with `__exo__`.
 *   2.  Real spec parses as valid OpenAPI 3.0 and has `.openapi === '3.0.0'`.
 *   3.  Real spec contains exactly 10 operations (6 endpoints × 10 cmdlets).
 *   4.  CmdletInput envelope shape — components.requestBodies.CmdletInputBody
 *       has CmdletInput.properties with required CmdletName (string) and
 *       Parameters (object, additionalProperties: true).
 *   5.  X-AnchorMailbox required header — components.parameters.XAnchorMailbox
 *       is required with the documented pattern; every operation $refs it.
 *   6.  CmdletInput emitted at codegen for set-mailbox — merged client.ts
 *       carries the envelope structure.
 *   7.  X-AnchorMailbox header schema emitted at codegen — merged client.ts
 *       carries the header in the set-mailbox / get-organization-config ops.
 *   8.  All emitted aliases are <= 64 chars (sha1-8 truncation applies).
 *   9.  Servers entry declares the tenantId-templated URL with UUID-shape
 *       description — documents plan 5.1-06's Zod validation at dispatch.
 *   10. GAP-EXCHANGE-ADMIN.md structural sanity (>=2 KB, headings present).
 *   11. GAP-EXCHANGE-ADMIN.md functional-area sections (>=5) and cmdlet
 *       lines (>=50).
 *   12. Fresh-checkout — absent snapshot creates initial snapshot.
 *
 * Strict churn matrix (Task 1 contract enforced by runProductChurnGuard;
 * Task 2 code binds it via `churnPolicy: 'strict'`):
 *   13. Strict addition without env — throws.
 *   14. Strict addition with env=1 — passes; snapshot rewrites.
 *   15. Strict removal without env — throws.
 *   16. Strict removal with env=1 — passes; snapshot rewrites.
 *   17. Strict no-change — prev and curr identical; env NOT set — passes.
 *
 * Task 2 tests (wrapper + registry):
 *   18. Path resolution — runExoAdminPipeline resolves specPath under
 *       <openapiDir>/openapi-exo.yaml and snapshotPath under
 *       <rootDir>/bin/.last-exo-snapshot.json.
 *   19. Passes specUrl: null to runProductPipeline (captured via vi.mock).
 *   20. Deps bag — passes expected prefix='__exo__', churnPolicy='strict',
 *       churnEnvName='MS365_MCP_ACCEPT_EXO_CHURN', openapiDir, generatedDir,
 *       specPath, snapshotPath.
 *   21. Side-effect registration — importing `exo-admin.mjs` adds exactly one
 *       {name: 'exo', ...} entry into PRODUCT_PIPELINES; multiple imports do
 *       NOT double-add.
 *
 * Threat mitigations pinned:
 *   - T-5.1-05-c (silent upstream endpoint addition with undocumented auth) —
 *     Tests 13-17 pin the strict-policy matrix. Operator explicitly
 *     acknowledges every spec bump.
 *   - T-5.1-05-d (X-AnchorMailbox header smuggling / omission) — Tests 5, 7
 *     pin spec declaration and codegen emission of the required header.
 *   - T-5.1-05-e (CmdletInput cmdlet-name smuggling) — Tests 4, 6 pin
 *     envelope shape at spec and codegen layers. Dispatch-layer enforcement
 *     of cmdlet-name match is plan 5.1-06's responsibility.
 *   - T-5.1-05-f ({tenantId} path injection) — Test 9 pins the servers
 *     declaration + UUID-shape documentation that plan 5.1-06 will
 *     Zod-enforce.
 *   - Registry double-registration — Test 21 pins the idempotent side-effect
 *     push (mirrors T-5.1-02-f / T-5.1-03-f / T-5.1-04-f patterns).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXO_FIXTURE = path.resolve(__dirname, 'fixtures', 'mini-exo.yaml');
// Walk up two levels from test/bin/ to the project root.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const REAL_EXO_SPEC = path.join(PROJECT_ROOT, 'openapi', 'openapi-exo.yaml');
const REAL_GAP_FILE = path.join(PROJECT_ROOT, '.planning', 'research', 'GAP-EXCHANGE-ADMIN.md');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05.1-05-exo-${crypto.randomUUID()}`);
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
  fs.copyFileSync(EXO_FIXTURE, specPath);
}

describe('plan 05.1-05 — Exchange Admin REST v2 generator (Task 1 + 2)', () => {
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

  it('Test 1: every emitted alias starts with __exo__ prefix', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-exo.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__exo__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'strict',
      churnEnvName: 'MS365_MCP_ACCEPT_EXO_CHURN',
      openapiDir,
      generatedDir,
    });

    expect(result.count).toBe(3);
    for (const alias of result.aliases) {
      expect(alias.startsWith('__exo__')).toBe(true);
    }
  }, 60_000);

  it('Test 2: openapi/openapi-exo.yaml parses as valid OpenAPI 3.0', () => {
    const raw = fs.readFileSync(REAL_EXO_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    expect(doc).toBeDefined();
    expect(doc.openapi).toBe('3.0.0');
    expect(typeof doc.paths).toBe('object');
    expect(doc.paths).not.toBeNull();
  });

  it('Test 3: openapi/openapi-exo.yaml contains exactly 10 operations', () => {
    const raw = fs.readFileSync(REAL_EXO_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
    const opCount = Object.values(doc.paths).flatMap((p) =>
      Object.keys(p).filter((k) => METHODS.has(k))
    ).length;
    // Plan 5.1-05 surface: 6 endpoints × 10 cmdlets (reconciled from
    // admin-api-endpoints-reference: Get/Add/Set/Remove MailboxFolderPermission
    // is 4 cmdlets, not 3 as the research doc initially estimated).
    expect(opCount).toBe(10);
    // Exactly 6 path entries — one per REST v2 endpoint.
    expect(Object.keys(doc.paths).length).toBe(6);
  });

  it('Test 4: CmdletInput envelope shape — CmdletName + Parameters required', () => {
    const raw = fs.readFileSync(REAL_EXO_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    const body = doc.components?.requestBodies?.CmdletInputBody;
    expect(body).toBeDefined();
    expect(body.required).toBe(true);
    const schema = body.content['application/json'].schema;
    expect(schema.type).toBe('object');
    expect(schema.required).toContain('CmdletInput');
    const cmdletInput = schema.properties.CmdletInput;
    expect(cmdletInput).toBeDefined();
    expect(cmdletInput.type).toBe('object');
    expect(cmdletInput.required).toEqual(expect.arrayContaining(['CmdletName', 'Parameters']));
    expect(cmdletInput.properties.CmdletName.type).toBe('string');
    expect(cmdletInput.properties.Parameters.type).toBe('object');
    expect(cmdletInput.properties.Parameters.additionalProperties).toBe(true);
  });

  it('Test 5: X-AnchorMailbox required on every operation', () => {
    const raw = fs.readFileSync(REAL_EXO_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    const xam = doc.components?.parameters?.XAnchorMailbox;
    expect(xam).toBeDefined();
    expect(xam.required).toBe(true);
    expect(xam.in).toBe('header');
    expect(xam.name).toBe('X-AnchorMailbox');
    // Pattern accepts AAD-UPN and APP:SystemMailbox shapes (plan 5.1-06
    // dispatch injects per auth context).
    expect(xam.schema.pattern).toMatch(/AAD-UPN/);
    expect(xam.schema.pattern).toMatch(/APP:SystemMailbox/);

    // Every operation $refs the XAnchorMailbox parameter.
    const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch']);
    for (const [p, methods] of Object.entries(doc.paths)) {
      for (const [m, op] of Object.entries(methods)) {
        if (!METHODS.has(m)) continue;
        const params = op.parameters || [];
        const refs = params.map((pp) => pp.$ref).filter(Boolean);
        expect(refs).toContain('#/components/parameters/XAnchorMailbox');
      }
    }
  });

  it('Test 6: CmdletInput envelope emitted at codegen for set-mailbox', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-exo.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    await runProductPipeline({
      prefix: '__exo__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'strict',
      churnEnvName: 'MS365_MCP_ACCEPT_EXO_CHURN',
      openapiDir,
      generatedDir,
    });

    // After the merge, the emitted client.ts must carry the CmdletInput
    // envelope as an object schema containing CmdletName (string) and
    // Parameters (passthrough/record). Plan 5.1-06 dispatch will validate
    // CmdletName match at request time (T-5.1-05-e mitigation).
    const merged = fs.readFileSync(path.join(generatedDir, 'client.ts'), 'utf-8');
    expect(merged).toMatch(/CmdletInput/);
    expect(merged).toMatch(/CmdletName/);
    expect(merged).toMatch(/Parameters/);
  }, 60_000);

  it('Test 7: X-AnchorMailbox header schema emitted at codegen', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-exo.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    await runProductPipeline({
      prefix: '__exo__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'strict',
      churnEnvName: 'MS365_MCP_ACCEPT_EXO_CHURN',
      openapiDir,
      generatedDir,
    });

    const merged = fs.readFileSync(path.join(generatedDir, 'client.ts'), 'utf-8');
    // openapi-zod-client emits header parameters with `type: "Header"` and
    // the original header name. The X-AnchorMailbox header must survive
    // post-processing so dispatch (plan 5.1-06) can inject it.
    expect(merged).toMatch(/X-AnchorMailbox/);
  }, 60_000);

  it('Test 8: all emitted aliases are <= 64 chars (sha1-8 truncation applies)', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-exo.yaml');
    stageFixture(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');
    const result = await runProductPipeline({
      prefix: '__exo__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'strict',
      churnEnvName: 'MS365_MCP_ACCEPT_EXO_CHURN',
      openapiDir,
      generatedDir,
    });

    for (const alias of result.aliases) {
      expect(alias.length).toBeLessThanOrEqual(64);
    }
    // At least one alias should be exactly 64 (the 60-char `a...` fixture op
    // with `__exo__` prefix = 67 raw chars → truncate to 64 with sha1-8).
    const truncated = result.aliases.find((a) => a.length === 64);
    expect(truncated).toBeDefined();
    expect(truncated).toMatch(/^__exo__a+-[0-9a-f]{8}$/);
  }, 60_000);

  it('Test 9: servers[0].url uses tenantId variable with UUID description', () => {
    const raw = fs.readFileSync(REAL_EXO_SPEC, 'utf-8');
    const doc = yaml.load(raw);
    expect(Array.isArray(doc.servers)).toBe(true);
    expect(doc.servers.length).toBeGreaterThanOrEqual(1);
    expect(doc.servers[0].url).toBe('https://outlook.office365.com/adminapi/beta/{tenantId}');
    const tenantIdVar = doc.servers[0].variables?.tenantId;
    expect(tenantIdVar).toBeDefined();
    // Documentation must reference the Zod UUID shape that plan 5.1-06 will
    // enforce at dispatch (T-5.1-05-f mitigation).
    expect(tenantIdVar.description).toMatch(/UUID/i);
  });

  it('Test 10: GAP-EXCHANGE-ADMIN.md exists with structural sanity (>=2 KB)', () => {
    expect(fs.existsSync(REAL_GAP_FILE)).toBe(true);
    const stat = fs.statSync(REAL_GAP_FILE);
    expect(stat.size).toBeGreaterThanOrEqual(2 * 1024);
  });

  it('Test 11: GAP-EXCHANGE-ADMIN.md has required functional-area sections and cmdlet count', () => {
    const raw = fs.readFileSync(REAL_GAP_FILE, 'utf-8');
    // At least these sections must appear.
    expect(raw).toMatch(/## Cmdlets Not Yet in REST v2/);
    expect(raw).toMatch(/### Transport Rules/);
    expect(raw).toMatch(/### Retention Policies/);
    expect(raw).toMatch(/### Anti-Spam/);
    expect(raw).toMatch(/### eDiscovery/);
    expect(raw).toMatch(/### Mobile Device Management/);
    // Count functional-area subsections — must be >=5.
    const subsectionRegex = /^### /gm;
    const subsectionCount = (raw.match(subsectionRegex) || []).length;
    expect(subsectionCount).toBeGreaterThanOrEqual(5);
    // Cmdlet lines — each is `- <Get|Set|New|Remove|...>-<Word>`. Must
    // catalogue >=50 cmdlets total. (The precise count will drift as
    // Microsoft ships coverage; the floor pins "this gap file is real
    // research, not a stub".)
    const cmdletLines = (raw.match(/^- [A-Z][a-zA-Z]+-[A-Z][a-zA-Z]+/gm) || []).length;
    expect(cmdletLines).toBeGreaterThanOrEqual(50);
  });

  it('Test 12: fresh-checkout — absent snapshot file creates initial snapshot', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
    vi.stubEnv('MS365_MCP_ACCEPT_EXO_CHURN', '0');

    // Fresh checkout: no snapshot on disk. Strict policy still creates the
    // initial snapshot without throwing — first runs are always safe.
    expect(() =>
      runProductChurnGuard(['__exo__alpha'], snapshotPath, 'strict', 'MS365_MCP_ACCEPT_EXO_CHURN')
    ).not.toThrow();
    expect(fs.existsSync(snapshotPath)).toBe(true);
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__exo__alpha']);
  });

  // ─── Strict churn matrix (Tests 13-17) ─────────────────────────────────────

  it('Test 13: strict churn — addition without env throws', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 1,
          ops: ['__exo__a'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_EXO_CHURN', '0');

    // Strict: ANY delta (including additions) throws without env.
    expect(() =>
      runProductChurnGuard(
        ['__exo__a', '__exo__b'],
        snapshotPath,
        'strict',
        'MS365_MCP_ACCEPT_EXO_CHURN'
      )
    ).toThrow(/strict/i);

    // Snapshot MUST NOT be rewritten on throw.
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__exo__a']);
  });

  it('Test 14: strict churn — addition with env=1 passes and rewrites snapshot', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 1,
          ops: ['__exo__a'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_EXO_CHURN', '1');

    expect(() =>
      runProductChurnGuard(
        ['__exo__a', '__exo__b'],
        snapshotPath,
        'strict',
        'MS365_MCP_ACCEPT_EXO_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__exo__a', '__exo__b']);
    expect(snap.count).toBe(2);
  });

  it('Test 15: strict churn — removal without env throws', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__exo__a', '__exo__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_EXO_CHURN', '0');

    expect(() =>
      runProductChurnGuard(['__exo__a'], snapshotPath, 'strict', 'MS365_MCP_ACCEPT_EXO_CHURN')
    ).toThrow(/strict/i);

    // Snapshot MUST NOT be rewritten on throw.
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__exo__a', '__exo__b']);
  });

  it('Test 16: strict churn — removal with env=1 passes and rewrites snapshot', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__exo__a', '__exo__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_EXO_CHURN', '1');

    expect(() =>
      runProductChurnGuard(['__exo__a'], snapshotPath, 'strict', 'MS365_MCP_ACCEPT_EXO_CHURN')
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__exo__a']);
    expect(snap.count).toBe(1);
  });

  it('Test 17: strict churn — no-change passes without env', async () => {
    const { runProductChurnGuard } = await import('../../bin/modules/run-product-pipeline.mjs');
    const snapshotPath = path.join(tmpDir, 'bin', '.last-exo-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          generated_at: '2026-04-15T00:00:00Z',
          count: 2,
          ops: ['__exo__a', '__exo__b'],
        },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_EXO_CHURN', '0');

    // No delta: strict must pass.
    expect(() =>
      runProductChurnGuard(
        ['__exo__a', '__exo__b'],
        snapshotPath,
        'strict',
        'MS365_MCP_ACCEPT_EXO_CHURN'
      )
    ).not.toThrow();
  });

  // ─── Task 2 tests (wrapper + registry) ─────────────────────────────────────

  it('Test 18: runExoAdminPipeline resolves paths under openapiDir + rootDir', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runExoAdminPipeline } = await import('../../bin/modules/exo-admin.mjs');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');

    const openapiDir = '/test/openapi';
    const generatedDir = '/test/src/generated';
    const rootDir = '/test';

    await runExoAdminPipeline({ openapiDir, generatedDir, rootDir });

    expect(runProductPipeline).toHaveBeenCalledTimes(1);
    const actualOpts = runProductPipeline.mock.calls[0][0];
    expect(actualOpts.specPath).toBe(path.join(openapiDir, 'openapi-exo.yaml'));
    expect(actualOpts.snapshotPath).toBe(path.join(rootDir, 'bin', '.last-exo-snapshot.json'));
  });

  it('Test 19: runExoAdminPipeline passes specUrl: null to runProductPipeline', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runExoAdminPipeline } = await import('../../bin/modules/exo-admin.mjs');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');

    await runExoAdminPipeline({
      openapiDir: '/test/openapi',
      generatedDir: '/test/src/generated',
      rootDir: '/test',
    });

    const actualOpts = runProductPipeline.mock.calls[0][0];
    // specUrl MUST be null — commits to the hand-authored-spec contract at
    // the API boundary. The pipeline throws /hand-authored spec not found/i
    // if the spec is missing (T-5.1-05-c silent catalog loss mitigation).
    expect(actualOpts.specUrl).toBeNull();
  });

  it('Test 20: runExoAdminPipeline delegates with the expected deps bag (strict policy)', async () => {
    vi.resetModules();
    vi.doMock('../../bin/modules/run-product-pipeline.mjs', () => ({
      runProductPipeline: vi.fn().mockResolvedValue({ count: 0, aliases: [] }),
      runProductChurnGuard: vi.fn(),
    }));

    const { runExoAdminPipeline } = await import('../../bin/modules/exo-admin.mjs');
    const { runProductPipeline } = await import('../../bin/modules/run-product-pipeline.mjs');

    await runExoAdminPipeline({
      openapiDir: '/test/openapi',
      generatedDir: '/test/src/generated',
      rootDir: '/test',
    });

    expect(runProductPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: '__exo__',
        specUrl: null,
        // STRICT policy — distinguishes Exchange Admin from Power
        // BI/Apps/Automate. Plan 5.1-CONTEXT D-04 — any alias delta
        // (add OR remove) requires operator acknowledgment via
        // MS365_MCP_ACCEPT_EXO_CHURN=1.
        churnPolicy: 'strict',
        churnEnvName: 'MS365_MCP_ACCEPT_EXO_CHURN',
        openapiDir: '/test/openapi',
        generatedDir: '/test/src/generated',
        specPath: path.join('/test/openapi', 'openapi-exo.yaml'),
        snapshotPath: path.join('/test', 'bin', '.last-exo-snapshot.json'),
      })
    );
  });

  it('Test 21: importing exo-admin.mjs registers exactly one exo entry (idempotent)', async () => {
    vi.resetModules();
    const { PRODUCT_PIPELINES } = await import('../../bin/modules/product-registry.mjs');
    // Triple import exercises both ESM module-cache and the explicit
    // `.some(...)` guard in the product module.
    await import('../../bin/modules/exo-admin.mjs');
    await import('../../bin/modules/exo-admin.mjs');
    await import('../../bin/modules/exo-admin.mjs');

    const exoEntries = PRODUCT_PIPELINES.filter((p) => p.name === 'exo');
    expect(exoEntries).toHaveLength(1);
    expect(typeof exoEntries[0].run).toBe('function');

    // Orchestrator re-export reaches the same binding.
    const orchestrator = await import('../../bin/generate-graph-client.mjs');
    expect(orchestrator.PRODUCT_PIPELINES).toBe(PRODUCT_PIPELINES);
  });
});
