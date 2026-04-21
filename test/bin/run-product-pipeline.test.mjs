/**
 * Plan 05.1-01 Task 1 — bin/modules/run-product-pipeline.mjs contract tests.
 *
 * These tests cover the shared per-product codegen pipeline that plans
 * 5.1-02..06 (Power BI, Power Apps, Power Automate, Exchange Admin, SharePoint
 * Tenant Admin) will invoke with product-specific dependency bags.
 *
 * The contract owns: spec stage-through / download, full-surface simplifier
 * invocation, `openapi-zod-client` codegen, `__<prefix>__` injection, MCP
 * 64-char sha1-8 truncation, collision guard against the merged `client.ts`,
 * merge via `mergeBetaFragmentIntoClient`, and per-product churn guard with
 * permissive (Power BI/Apps/Automate per 05.1-CONTEXT D-04) vs strict
 * (EXO/SP-Admin per 05.1-CONTEXT D-04) policies.
 *
 * Tests (10 total):
 *   1. Prefix + length invariant — every emitted alias starts with the
 *      configured prefix; none exceed 64 chars.
 *   2. Collision guard — pre-seeded main client.ts containing an identical
 *      prefixed alias causes the pipeline to throw.
 *   3. 64-char truncation — 60-char operationId + 9-char prefix produces a
 *      64-char alias terminating in `-<8 hex>`.
 *   4. Permissive churn WITHOUT env — removal since snapshot throws.
 *   5. Permissive churn WITH env — removal since snapshot passes, snapshot
 *      rewritten.
 *   6. Permissive churn addition — additions do NOT require env.
 *   7. Strict churn addition WITHOUT env — additions throw.
 *   8. Strict churn addition WITH env — additions pass.
 *   9. Fresh-checkout — snapshot file absent, pipeline creates initial
 *      snapshot regardless of policy.
 *  10. Invalid prefix — early validation throws BEFORE any filesystem write.
 *
 * Threat mitigations exercised (plan 05.1-01 threat_model):
 *   - T-5.1-05: DoS via recursive ref — simplifier reuse bounds depth; fixture
 *     is KB-scale so no actual OOM risk. Tested indirectly via E2E run.
 *   - T-5.1-06: Silent upstream feature loss — Tests 4-9 pin the per-product
 *     churn semantics (permissive vs strict, env-gated opt-in).
 *   - T-5.1-07: Invalid/non-wrapped prefix via deps bag — Test 10 pins the
 *     synchronous pre-check that fails BEFORE openapi-zod-client is invoked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  runProductPipeline,
  runProductChurnGuard,
} from '../../bin/modules/run-product-pipeline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_FIXTURE = path.resolve(__dirname, 'fixtures', 'mini-product-spec.yaml');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05.1-01-pp-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'openapi'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src', 'generated'), { recursive: true });
  // The post-processor rewrites `'@zodios/core'` → `'./hack.js'`; stage the
  // hack.ts file so downstream imports resolve when the fragment is loaded.
  fs.writeFileSync(path.join(dir, 'src', 'generated', 'hack.ts'), '// stub');
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Seed the main client.ts with a realistic shape so `mergeBetaFragmentIntoClient`
 * has an endpoints array to splice into. Accepts pre-existing aliases so tests
 * 2 can simulate a prior merge collision.
 */
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

/**
 * Stage the fixture spec so downloadGraphOpenAPI's "file already exists"
 * branch skips the network fetch entirely.
 */
function stageFixtureSpec(specPath) {
  fs.copyFileSync(PRODUCT_FIXTURE, specPath);
}

describe('plan 05.1-01 task 1 — runProductPipeline', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('Test 1: every emitted alias starts with prefix and none exceed 64 chars', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-xtest.yaml');
    stageFixtureSpec(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    const result = await runProductPipeline({
      prefix: '__xtest__',
      specUrl: null, // hand-authored spec already staged
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_XTEST_CHURN',
      openapiDir,
      generatedDir,
    });

    expect(result).toBeDefined();
    expect(result.count).toBe(3);
    expect(result.aliases).toHaveLength(3);
    for (const alias of result.aliases) {
      expect(alias.startsWith('__xtest__')).toBe(true);
      expect(alias.length).toBeLessThanOrEqual(64);
    }

    // Merged client.ts has the three prefixed aliases.
    const merged = fs.readFileSync(path.join(generatedDir, 'client.ts'), 'utf-8');
    const prefixedMatches = [...merged.matchAll(/alias:\s*["']__xtest__[^"']+/g)];
    expect(prefixedMatches.length).toBe(3);
  }, 60_000);

  it('Test 2: collision guard throws when a prefixed alias duplicates main', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-xtest.yaml');
    stageFixtureSpec(specPath);
    // Pre-seed an alias that would collide with the fixture's post-prefix name.
    seedMainClient(generatedDir, ['__xtest__list-things']);

    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    await expect(
      runProductPipeline({
        prefix: '__xtest__',
        specUrl: null,
        specPath,
        snapshotPath,
        churnPolicy: 'permissive',
        churnEnvName: 'MS365_MCP_ACCEPT_XTEST_CHURN',
        openapiDir,
        generatedDir,
      })
    ).rejects.toThrow(/collision.*detected/i);
  }, 60_000);

  it('Test 3: 64-char truncation emits `<head>-<8hex>` and keeps alias<=64', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-xtest.yaml');
    stageFixtureSpec(specPath);
    seedMainClient(generatedDir);

    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    const result = await runProductPipeline({
      prefix: '__xtest__',
      specUrl: null,
      specPath,
      snapshotPath,
      churnPolicy: 'permissive',
      churnEnvName: 'MS365_MCP_ACCEPT_XTEST_CHURN',
      openapiDir,
      generatedDir,
    });

    // The 60-char operationId + __xtest__ (9) = 69 chars raw — must be truncated.
    const longAlias = result.aliases.find((a) => a.length === 64);
    expect(longAlias).toBeDefined();
    expect(longAlias).toMatch(/^__xtest__a+-[0-9a-f]{8}$/);

    // All aliases under the cap.
    for (const alias of result.aliases) {
      expect(alias.length).toBeLessThanOrEqual(64);
    }
  }, 60_000);

  it('Test 4: permissive churn — removal without env throws', () => {
    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        { generated_at: '2026-04-15T00:00:00Z', count: 2, ops: ['__xtest__a', '__xtest__b'] },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_XTEST_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__xtest__a'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_XTEST_CHURN'
      )
    ).toThrow(/removed|disappeared/i);

    // Snapshot untouched on failure.
    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__xtest__a', '__xtest__b']);
  });

  it('Test 5: permissive churn — removal WITH env passes and rewrites snapshot', () => {
    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        { generated_at: '2026-04-15T00:00:00Z', count: 2, ops: ['__xtest__a', '__xtest__b'] },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_XTEST_CHURN', '1');

    expect(() =>
      runProductChurnGuard(
        ['__xtest__a'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_XTEST_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__xtest__a']);
    expect(snap.count).toBe(1);
  });

  it('Test 6: permissive churn — additions WITHOUT env pass (snapshot grows)', () => {
    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        { generated_at: '2026-04-15T00:00:00Z', count: 1, ops: ['__xtest__a'] },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_XTEST_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__xtest__a', '__xtest__b'],
        snapshotPath,
        'permissive',
        'MS365_MCP_ACCEPT_XTEST_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__xtest__a', '__xtest__b']);
  });

  it('Test 7: strict churn — additions WITHOUT env throw', () => {
    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        { generated_at: '2026-04-15T00:00:00Z', count: 1, ops: ['__xtest__a'] },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_XTEST_CHURN', '0');

    expect(() =>
      runProductChurnGuard(
        ['__xtest__a', '__xtest__b'],
        snapshotPath,
        'strict',
        'MS365_MCP_ACCEPT_XTEST_CHURN'
      )
    ).toThrow(/strict/i);

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__xtest__a']);
  });

  it('Test 8: strict churn — additions WITH env pass', () => {
    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        { generated_at: '2026-04-15T00:00:00Z', count: 1, ops: ['__xtest__a'] },
        null,
        2
      ) + '\n'
    );
    vi.stubEnv('MS365_MCP_ACCEPT_XTEST_CHURN', '1');

    expect(() =>
      runProductChurnGuard(
        ['__xtest__a', '__xtest__b'],
        snapshotPath,
        'strict',
        'MS365_MCP_ACCEPT_XTEST_CHURN'
      )
    ).not.toThrow();

    const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    expect(snap.ops).toEqual(['__xtest__a', '__xtest__b']);
  });

  it('Test 9: fresh-checkout — absent snapshot file creates initial snapshot', () => {
    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');
    expect(fs.existsSync(snapshotPath)).toBe(false);
    vi.stubEnv('MS365_MCP_ACCEPT_XTEST_CHURN', '0');

    // Both policies: absent snapshot is always the "create" path.
    for (const policy of /** @type {const} */ (['permissive', 'strict'])) {
      if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath);
      expect(() =>
        runProductChurnGuard(
          ['__xtest__c', '__xtest__a'],
          snapshotPath,
          policy,
          'MS365_MCP_ACCEPT_XTEST_CHURN'
        )
      ).not.toThrow();
      expect(fs.existsSync(snapshotPath)).toBe(true);
      const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
      // Ops are sorted on write for deterministic git diffs.
      expect(snap.ops).toEqual(['__xtest__a', '__xtest__c']);
    }
  });

  it('Test 10: invalid prefix fails synchronously before any filesystem write', async () => {
    const openapiDir = path.join(tmpDir, 'openapi');
    const generatedDir = path.join(tmpDir, 'src', 'generated');
    const specPath = path.join(openapiDir, 'openapi-xtest.yaml');
    stageFixtureSpec(specPath);
    const snapshotPath = path.join(tmpDir, '.last-xtest-snapshot.json');

    // No client.ts seed — proves the early reject does not rely on merge paths.
    await expect(
      runProductPipeline({
        prefix: 'not-wrapped',
        specUrl: null,
        specPath,
        snapshotPath,
        churnPolicy: 'permissive',
        churnEnvName: 'MS365_MCP_ACCEPT_XTEST_CHURN',
        openapiDir,
        generatedDir,
      })
    ).rejects.toThrow(/prefix must match/i);

    // Nothing should have been written: no trimmed yaml, no fragment, no snapshot.
    expect(fs.existsSync(path.join(openapiDir, 'openapi-xtest-trimmed.yaml'))).toBe(false);
    expect(fs.existsSync(path.join(generatedDir, '.client-xtest-fragment.ts'))).toBe(false);
    expect(fs.existsSync(snapshotPath)).toBe(false);
  });
});
