/**
 * Plan 05-08 Task 1 — bin/modules/coverage-check.mjs per-workload harness tests.
 *
 * `runCoverageCheck(generatedClientPath, baselinePath, opts?)` reads the
 * emitted src/generated/client.ts, counts aliases per workload via path-prefix
 * regex, and compares against a committed baseline JSON. Returns a structured
 * report { totals, byWorkload, deltas, warnings, errors }. Baseline lives at
 * bin/.last-coverage-snapshot.json (committed) and is written on success.
 *
 * Thresholds (from success criteria):
 *   - 0% regression -> silent success
 *   - 1-5% drop per workload -> no warning (noise tolerance)
 *   - 5-10% drop per workload -> warning (reported, no fail)
 *   - >10% drop per workload -> error (throws / non-zero exit)
 *
 * Workload taxonomy: path-prefix regex anchored to the `path:` property of
 * each emitted endpoint. Matches the GAP-GRAPH-API.md workload table.
 *
 * Coverage:
 *   Test 1: Fresh-checkout run against empty baseline -> populates snapshot.
 *   Test 2: Per-workload counting against a crafted client.ts fixture.
 *   Test 3: No regression (current >= baseline) -> no errors.
 *   Test 4: 5-10% drop in one workload -> warning, no throw.
 *   Test 5: >10% drop in one workload -> throws with workload name.
 *   Test 6: Growth (current > baseline) -> no warnings; snapshot updates.
 *   Test 7: Malformed baseline JSON -> throws with helpful message.
 *   Test 8: __beta__-prefixed aliases counted alongside v1 (full catalog).
 *   Test 9: Per-workload deltas correctly signed (positive = growth, negative = drop).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
// @ts-expect-error — .mjs import has no types; runtime shape only.
import { runCoverageCheck, countByWorkload } from '../../bin/modules/coverage-check.mjs';

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05-08-coverage-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Build a minimal client.ts file with the given alias+path pairs. The format
 * matches what openapi-zod-client emits so the coverage checker's regex
 * exercises the real extraction shape.
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

describe('plan 05-08 task 1 — runCoverageCheck', () => {
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

  it('Test 1: fresh-checkout empty baseline -> populates snapshot, no warnings', () => {
    fs.writeFileSync(
      clientPath,
      buildClientFixture([
        { path: '/me/messages', alias: 'list-mail-messages' },
        { path: '/me/events', alias: 'list-calendar-events' },
        { path: '/me/drive/root/children', alias: 'list-drive-children' },
      ])
    );
    // Committed-empty baseline shape — any detected ops are "new".
    writeBaseline(baselinePath, {});

    const report = runCoverageCheck(clientPath, baselinePath);

    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.totals.current).toBe(3);
    expect(report.totals.baseline).toBe(0);
    // Snapshot updated with current counts.
    const snap = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    expect(snap.totals).toBe(3);
    expect(Object.keys(snap.byWorkload).length).toBeGreaterThanOrEqual(1);
  });

  it('Test 2: countByWorkload buckets paths into the GAP-GRAPH-API workload taxonomy', () => {
    const fixture = buildClientFixture([
      { path: '/me/messages', alias: 'list-mail-messages' },
      { path: '/me/messages/{id}', alias: 'get-mail-message' },
      { path: '/users/{id}/messages', alias: 'list-user-messages' },
      { path: '/me/events', alias: 'list-calendar-events' },
      { path: '/me/calendar/events', alias: 'list-calendar-events-v2' },
      { path: '/me/drive/root/children', alias: 'list-drive-children' },
      { path: '/teams/{id}/channels', alias: 'list-team-channels' },
      { path: '/users', alias: 'list-users' },
      { path: '/groups', alias: 'list-groups' },
      { path: '/sites/{id}', alias: 'get-sharepoint-site' },
      { path: '/planner/tasks', alias: 'list-planner-tasks' },
      { path: '/me/todo/lists', alias: 'list-todo-lists' },
      { path: '/security/alerts_v2', alias: '__beta__security-alerts-list' },
      { path: '/search/query', alias: 'search-query' },
      { path: '/subscriptions', alias: 'list-subscriptions' },
    ]);
    fs.writeFileSync(clientPath, fixture);

    const counts = countByWorkload(clientPath);

    // Mail should capture /me/messages + /users/*/messages.
    expect(counts['Mail']).toBeGreaterThanOrEqual(3);
    // Calendars captures /me/events + /me/calendar.
    expect(counts['Calendars']).toBeGreaterThanOrEqual(2);
    // Files captures /me/drive.
    expect(counts['Files']).toBeGreaterThanOrEqual(1);
    // Teams.
    expect(counts['Teams']).toBeGreaterThanOrEqual(1);
    // Users (root only — /users/* ops that are Mail go to Mail, not Users).
    expect(counts['Users']).toBeGreaterThanOrEqual(1);
    // Groups.
    expect(counts['Groups']).toBeGreaterThanOrEqual(1);
    // Sites.
    expect(counts['SharePoint']).toBeGreaterThanOrEqual(1);
    // Planner.
    expect(counts['Planner']).toBeGreaterThanOrEqual(1);
    // ToDo.
    expect(counts['ToDo']).toBeGreaterThanOrEqual(1);
    // Security (beta).
    expect(counts['Security']).toBeGreaterThanOrEqual(1);
    // Search.
    expect(counts['Search']).toBeGreaterThanOrEqual(1);
    // Subscriptions.
    expect(counts['Subscriptions']).toBeGreaterThanOrEqual(1);
  });

  it('Test 3: no regression (current == baseline) -> no errors, no warnings', () => {
    const entries = [
      { path: '/me/messages', alias: 'list-mail-messages' },
      { path: '/me/events', alias: 'list-calendar-events' },
      { path: '/me/drive/root/children', alias: 'list-drive-children' },
    ];
    fs.writeFileSync(clientPath, buildClientFixture(entries));
    const current = countByWorkload(clientPath);
    writeBaseline(baselinePath, current);

    const report = runCoverageCheck(clientPath, baselinePath);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('Test 4: 5-10% drop in a workload -> warning (no throw)', () => {
    // Baseline: 20 Mail ops. Current: 18 Mail ops. Delta = -2/20 = -10% exactly.
    // The spec is "5-10% drop -> warn", ">10% -> error", so -10% lands in the
    // warn band (inclusive upper bound). Use -9% to stay unambiguously in warn.
    // 20 -> 18 is -10% exact — switch to 20 -> 19 (-5%) to stay in warn band.
    // Build 20 Mail ops in baseline, 19 in current.
    const baseEntries = Array.from({ length: 20 }, (_, i) => ({
      path: `/me/messages/{id-${i}}`,
      alias: `mail-op-${i}`,
    }));
    const currEntries = baseEntries.slice(0, 19); // 19/20 = -5%
    writeBaseline(baselinePath, countByWorkload(mkTempClient(tmpDir, baseEntries)));
    fs.writeFileSync(clientPath, buildClientFixture(currEntries));

    const report = runCoverageCheck(clientPath, baselinePath);
    expect(report.errors).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(0);
    // Warning text names the Mail workload.
    expect(report.warnings.some((w) => /Mail/i.test(w))).toBe(true);
  });

  it('Test 5: >10% drop in a workload -> throws with workload name', () => {
    // 20 -> 17 = -15% in Mail. Over threshold -> error.
    const baseEntries = Array.from({ length: 20 }, (_, i) => ({
      path: `/me/messages/{id-${i}}`,
      alias: `mail-op-${i}`,
    }));
    const currEntries = baseEntries.slice(0, 17); // 17/20 = -15%
    writeBaseline(baselinePath, countByWorkload(mkTempClient(tmpDir, baseEntries)));
    fs.writeFileSync(clientPath, buildClientFixture(currEntries));

    expect(() => runCoverageCheck(clientPath, baselinePath)).toThrow(/Mail/i);
    expect(() => runCoverageCheck(clientPath, baselinePath)).toThrow(/regress/i);
  });

  it('Test 6: growth (current > baseline) -> no warnings; snapshot updates', () => {
    const baseEntries = [
      { path: '/me/messages', alias: 'mail-a' },
      { path: '/me/messages/{id}', alias: 'mail-b' },
    ];
    const currEntries = [
      ...baseEntries,
      { path: '/me/events', alias: 'cal-a' },
      { path: '/me/drive/root/children', alias: 'files-a' },
    ];
    writeBaseline(baselinePath, countByWorkload(mkTempClient(tmpDir, baseEntries)));
    fs.writeFileSync(clientPath, buildClientFixture(currEntries));

    const report = runCoverageCheck(clientPath, baselinePath);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    // totals.current > totals.baseline
    expect(report.totals.current).toBeGreaterThan(report.totals.baseline);
    // Snapshot rewritten with growth.
    const snap = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    expect(snap.totals).toBe(report.totals.current);
  });

  it('Test 7: malformed baseline JSON -> throws with a helpful message', () => {
    fs.writeFileSync(clientPath, buildClientFixture([{ path: '/me', alias: 'me-get' }]));
    fs.writeFileSync(baselinePath, '{not valid json}');

    expect(() => runCoverageCheck(clientPath, baselinePath)).toThrow(/baseline|snapshot|JSON/i);
  });

  it('Test 8: __beta__-prefixed aliases counted alongside v1 in their workload bucket', () => {
    const entries = [
      { path: '/me/messages', alias: 'list-mail-messages' },
      { path: '/me/messages', alias: '__beta__me-messages-list' },
      { path: '/security/alerts_v2', alias: '__beta__security-alerts-list' },
      { path: '/security/incidents', alias: '__beta__security-incidents-list' },
    ];
    fs.writeFileSync(clientPath, buildClientFixture(entries));

    const counts = countByWorkload(clientPath);
    // Two Mail entries (one v1, one beta at /me/messages).
    expect(counts['Mail']).toBe(2);
    // Two Security entries.
    expect(counts['Security']).toBe(2);
  });

  it('Test 9: per-workload deltas are correctly signed in the report', () => {
    // Baseline: 25 Mail + 50 Calendars. Current: 26 Mail + 48 Calendars.
    // Mail grows +1 (silent). Calendars drops -2/50 = -4% (silent noise band).
    // Validates the deltas map carries correctly-signed values across
    // growth and modest-drop classifications without triggering errors/warns.
    const baseEntries = [
      ...Array.from({ length: 25 }, (_, i) => ({
        path: `/me/messages/${i}`,
        alias: `mail-op-${i}`,
      })),
      ...Array.from({ length: 50 }, (_, i) => ({
        path: `/me/events/${i}`,
        alias: `cal-op-${i}`,
      })),
    ];
    const currEntries = [
      ...Array.from({ length: 26 }, (_, i) => ({
        path: `/me/messages/${i}`,
        alias: `mail-op-${i}`,
      })),
      ...Array.from({ length: 48 }, (_, i) => ({
        path: `/me/events/${i}`,
        alias: `cal-op-${i}`,
      })),
    ];
    writeBaseline(baselinePath, countByWorkload(mkTempClient(tmpDir, baseEntries)));
    fs.writeFileSync(clientPath, buildClientFixture(currEntries));

    const report = runCoverageCheck(clientPath, baselinePath);
    expect(report.deltas.Mail).toBe(1);
    expect(report.deltas.Calendars).toBe(-2);
    // Both deltas fall in the silent band — Mail grows, Calendars drops -4%.
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});

/**
 * Helper: write a one-shot client.ts to tmpDir and return its path so
 * countByWorkload can read from a distinct file from the test's main
 * clientPath. Used to build baseline snapshots without re-writing the current
 * fixture.
 */
function mkTempClient(tmpDir, entries) {
  const p = path.join(tmpDir, `baseline-client-${crypto.randomUUID()}.ts`);
  fs.writeFileSync(p, buildClientFixture(entries));
  return p;
}
