/**
 * Plan 05.1-08 Task 2 — PRODUCT_POLICIES + classifyByAlias + per-product
 * coverage regression tests.
 *
 * Extends `bin/modules/coverage-check.mjs` with:
 *   - classifyByAlias(alias): 'powerbi'|'pwrapps'|'pwrauto'|'exo'|'sp-admin'|null
 *     → alias-based workload discriminator for product aliases. Returns
 *     null for non-product aliases so countByWorkload falls through to
 *     the existing path-regex classifier.
 *   - PRODUCT_POLICIES map keyed by workload — entries for 'exo' and
 *     'sp-admin' with {policy: 'strict', errorThresholdPct: 0,
 *     warnThresholdPct: 0}. Other products (powerbi/pwrapps/pwrauto) plus
 *     Graph workloads use the existing -10% / -5% defaults per D-04.
 *   - classifyDelta(current, baseline, workload) — accepts the workload
 *     name and consults PRODUCT_POLICIES before falling back to default
 *     thresholds. Strict workloads treat ANY drop as an error.
 *   - countByWorkload prefers classifyByAlias(alias) over classifyPath(path)
 *     when the alias carries a product prefix.
 *   - `.planning/research/GAP-POWER-PLATFORM.md` committed with per-product
 *     baseline op counts + regression tolerance policies per D-04.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs import has no types; runtime shape only.
import {
  classifyByAlias,
  classifyDelta,
  countByWorkload,
  runCoverageCheck,
  PRODUCT_POLICIES,
} from '../../bin/modules/coverage-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05-1-08-coverage-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Build a minimal client.ts fixture mirroring openapi-zod-client output so
 * extractEndpoints' regex captures {path, alias} pairs.
 */
function buildClientFixture(entries) {
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
  return `import { makeApi, Zodios } from './hack.js';
import { z } from 'zod';

const endpoints = makeApi([
${body}
]);

export const api = new Zodios(endpoints);
`;
}

function writeBaseline(baselinePath, byWorkload) {
  const totals = Object.values(byWorkload).reduce((a, b) => a + b, 0);
  const payload = {
    generated_at: '2026-04-19T00:00:00Z',
    totals,
    byWorkload,
  };
  fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n');
}

describe('plan 05.1-08 Task 2 — coverage-check product extensions', () => {
  let tmpDir;
  let clientPath;
  let baselinePath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    clientPath = path.join(tmpDir, 'client.ts');
    baselinePath = path.join(tmpDir, '.last-coverage-snapshot.json');
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.unstubAllEnvs();
  });

  describe('C1-C3: classifyByAlias', () => {
    it('C1: __powerbi__ prefix → "powerbi"', () => {
      expect(classifyByAlias('__powerbi__GroupsGetGroups')).toBe('powerbi');
    });

    it('C2: all 4 other product prefixes map correctly', () => {
      expect(classifyByAlias('__pwrapps__list-apps')).toBe('pwrapps');
      expect(classifyByAlias('__pwrauto__list-flows')).toBe('pwrauto');
      expect(classifyByAlias('__exo__get-mailbox')).toBe('exo');
      expect(classifyByAlias('__spadmin__list-sites')).toBe('sp-admin');
    });

    it('C3: non-product aliases return null', () => {
      expect(classifyByAlias('list-mail-messages')).toBeNull();
      expect(classifyByAlias('__beta__security-alerts')).toBeNull();
      expect(classifyByAlias('users.list')).toBeNull();
    });
  });

  describe('C4: countByWorkload prefers alias-based classification for products', () => {
    it('C4: product aliases land in product buckets; Graph aliases in Graph buckets', () => {
      const fixture = buildClientFixture([
        // Product aliases — one per product
        { path: '/workspaces', alias: '__powerbi__GroupsGetGroups' },
        { path: '/apps', alias: '__pwrapps__list-apps' },
        { path: '/environments/{envId}/flows', alias: '__pwrauto__list-flows' },
        { path: '/Mailbox', alias: '__exo__get-mailbox' },
        { path: '/Sites', alias: '__spadmin__list-sites' },
        // Graph aliases
        { path: '/me/messages', alias: 'list-mail-messages' },
        { path: '/me/events', alias: 'list-calendar-events' },
        { path: '/teams/{id}', alias: 'get-team' },
        { path: '/users', alias: 'list-users' },
        { path: '/me/drive/root/children', alias: 'list-drive-children' },
      ]);
      fs.writeFileSync(clientPath, fixture);

      const counts = countByWorkload(clientPath);
      expect(counts['powerbi']).toBe(1);
      expect(counts['pwrapps']).toBe(1);
      expect(counts['pwrauto']).toBe(1);
      expect(counts['exo']).toBe(1);
      expect(counts['sp-admin']).toBe(1);
      // Graph aliases still land in Graph buckets.
      expect(counts['Mail']).toBeGreaterThanOrEqual(1);
      expect(counts['Calendars']).toBeGreaterThanOrEqual(1);
      expect(counts['Teams']).toBeGreaterThanOrEqual(1);
    });
  });

  describe('C5-C10: classifyDelta with workload-aware policies', () => {
    it('C5: -10% drop on powerbi (permissive) → error at -10% threshold', () => {
      // Permissive products use ERROR_THRESHOLD_PCT = -10.
      expect(classifyDelta(9, 10, 'powerbi')).toBe('error');
    });

    it('C6: -10% drop on exo (strict) → error (any drop is error)', () => {
      expect(classifyDelta(9, 10, 'exo')).toBe('error');
    });

    it('C7: flat value on exo (strict) → silent', () => {
      expect(classifyDelta(10, 10, 'exo')).toBe('silent');
    });

    it('C8: growth on exo (strict) → silent (strict policy applies to drops only)', () => {
      expect(classifyDelta(11, 10, 'exo')).toBe('silent');
    });

    it('C8b: -1 drop on sp-admin (strict) → error — ANY drop fails', () => {
      // 14/15 = -6.67% — under Graph's -10% threshold but strict policy says
      // error at any drop.
      expect(classifyDelta(14, 15, 'sp-admin')).toBe('error');
    });

    it('C9: runCoverageCheck throws when strict exo drops 1 of 10 ops', () => {
      // Baseline: 10 exo ops; current: 9 → strict policy fires.
      const baseEntries = Array.from({ length: 10 }, (_, i) => ({
        path: `/Mailbox/${i}`,
        alias: `__exo__op-${i}`,
      }));
      const currEntries = baseEntries.slice(0, 9);
      const baselineFixturePath = path.join(tmpDir, 'baseline-client.ts');
      fs.writeFileSync(baselineFixturePath, buildClientFixture(baseEntries));
      writeBaseline(baselinePath, countByWorkload(baselineFixturePath));
      fs.writeFileSync(clientPath, buildClientFixture(currEntries));

      expect(() => runCoverageCheck(clientPath, baselinePath)).toThrow(/exo/i);
    });

    it('C10: runCoverageCheck warns (no throw) when permissive powerbi drops 5 of 100 (-5%)', () => {
      const baseEntries = Array.from({ length: 100 }, (_, i) => ({
        path: `/workspaces/${i}`,
        alias: `__powerbi__op-${i}`,
      }));
      const currEntries = baseEntries.slice(0, 95); // -5% exact
      const baselineFixturePath = path.join(tmpDir, 'baseline-client.ts');
      fs.writeFileSync(baselineFixturePath, buildClientFixture(baseEntries));
      writeBaseline(baselinePath, countByWorkload(baselineFixturePath));
      fs.writeFileSync(clientPath, buildClientFixture(currEntries));

      const report = runCoverageCheck(clientPath, baselinePath);
      expect(report.errors).toEqual([]);
      expect(report.warnings.length).toBeGreaterThan(0);
      expect(report.warnings.some((w) => /powerbi/i.test(w))).toBe(true);
    });
  });

  describe('C11: PRODUCT_POLICIES shape', () => {
    it('C11: PRODUCT_POLICIES has exo + sp-admin entries (strict); permissive products absent', () => {
      expect(PRODUCT_POLICIES).toBeDefined();
      expect(PRODUCT_POLICIES.exo).toBeDefined();
      expect(PRODUCT_POLICIES.exo.policy).toBe('strict');
      expect(PRODUCT_POLICIES.exo.errorThresholdPct).toBe(0);
      expect(PRODUCT_POLICIES['sp-admin']).toBeDefined();
      expect(PRODUCT_POLICIES['sp-admin'].policy).toBe('strict');
      // Permissive products (powerbi/pwrapps/pwrauto) must NOT be in the
      // policy map — absence → default -10%/-5% applied.
      expect(PRODUCT_POLICIES.powerbi).toBeUndefined();
      expect(PRODUCT_POLICIES.pwrapps).toBeUndefined();
      expect(PRODUCT_POLICIES.pwrauto).toBeUndefined();
    });
  });

  describe('C12: GAP-POWER-PLATFORM.md committed', () => {
    it('C12: file exists and carries Per-Product Baseline section with 5 products', () => {
      const gapPath = path.join(REPO_ROOT, '.planning', 'research', 'GAP-POWER-PLATFORM.md');
      expect(fs.existsSync(gapPath)).toBe(true);
      const content = fs.readFileSync(gapPath, 'utf-8');
      // Required sections
      expect(content).toMatch(/##\s+Per-Product Baseline/);
      expect(content).toMatch(/##\s+Coverage Update Protocol/);
      expect(content).toMatch(/##\s+CI Gating/);
      // Row per product
      expect(content).toMatch(/\|\s*Power BI\s*\|/i);
      expect(content).toMatch(/\|\s*Power Apps\s*\|/i);
      expect(content).toMatch(/\|\s*Power Automate\s*\|/i);
      expect(content).toMatch(/\|\s*Exchange Admin\s*\|/i);
      expect(content).toMatch(/\|\s*SharePoint Admin\s*\|/i);
      // Prefix literals documented
      expect(content).toMatch(/__powerbi__/);
      expect(content).toMatch(/__spadmin__/);
      // Strict/permissive policies documented
      expect(content).toMatch(/STRICT/);
      expect(content).toMatch(/Permissive/i);
    });
  });
});
