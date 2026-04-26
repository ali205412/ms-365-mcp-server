#!/usr/bin/env node
/**
 * OAuth-surface coverage gate for D-10 (plan 06-05).
 *
 * Reads coverage/coverage-final.json (V8 JSON format), counts statement hits
 * inside the OAuth-handler line ranges of src/server.ts, prints percentage,
 * exits non-zero if below 70%.
 *
 * Why a custom script: vitest v8 coverage does NOT support line-range
 * filtering within a single file. We narrow the file via
 * `coverage.include: ['src/server.ts']` in vitest.config.js, then this
 * post-processor narrows further to the OAuth handlers only — so the D-10
 * "70% on OAuth-surface lines" gate is measured on the code path that
 * actually matters, not the whole file (which includes the 800-line MCP
 * transport branches and would mask the OAuth coverage number).
 *
 * Line-range discovery (re-run after src/server.ts refactors):
 *   grep -n 'export function createRegisterHandler' src/server.ts
 *   grep -n 'export function createTokenHandler' src/server.ts
 *   grep -n 'export function createAuthorizeHandler' src/server.ts
 *   grep -n 'export function createTenantTokenHandler' src/server.ts
 *   grep -n "'/t/:tenantId/.well-known/oauth-authorization-server'" src/server.ts
 *   grep -n "'/t/:tenantId/.well-known/oauth-protected-resource'" src/server.ts
 *   grep -n "'/.well-known/oauth-authorization-server'" src/server.ts
 *   grep -n "'/.well-known/oauth-protected-resource'" src/server.ts
 *
 * Line ranges are BRITTLE. The verifyLineRanges() helper re-reads
 * src/server.ts at run time and confirms each range's start line matches
 * the expected marker (handler function name OR well-known route path).
 * If the ranges drift, the script exits with code 3 instead of silently
 * under- or over-counting — so any executor sees drift surface AS AN ERROR
 * with the specific function name, not as a wrong coverage number.
 *
 * CI hook: `npm run test:oauth-coverage` runs this after the integration
 * suite with coverage collection.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Line ranges re-verified 2026-04-26 after HTTP route rate limiting shifted
// handlers and OAuth discovery mounts in src/server.ts. When
// src/server.ts refactors shift handler boundaries, re-run the greps in the
// JSDoc above and update these values. The verifyLineRanges() helper enforces
// the invariant at every invocation.
const OAUTH_LINE_RANGES = [
  { fn: 'createRegisterHandler', start: 122, end: 170 },
  { fn: 'createTokenHandler', start: 224, end: 415 },
  { fn: 'createAuthorizeHandler', start: 520, end: 675 },
  { fn: 'createTenantTokenHandler', start: 724, end: 867 },
  { fn: 'wellKnownAuthServerTenant', start: 1338, end: 1345 },
  { fn: 'wellKnownProtectedResourceTenant', start: 1347, end: 1355 },
  { fn: 'wellKnownAuthServer', start: 1725, end: 1750 },
  { fn: 'wellKnownProtectedResource', start: 1752, end: 1766 },
];

// D-10 target threshold is 70%. CI enforces the real target; local developers
// may use MS365_MCP_OAUTH_COVERAGE_THRESHOLD only for temporary investigation.
const COVERAGE_THRESHOLD_PERCENT = Number.parseFloat(
  process.env.MS365_MCP_OAUTH_COVERAGE_THRESHOLD ?? '70'
);
if (!Number.isFinite(COVERAGE_THRESHOLD_PERCENT) || COVERAGE_THRESHOLD_PERCENT <= 0) {
  throw new Error('MS365_MCP_OAUTH_COVERAGE_THRESHOLD must be a positive number when set');
}

/**
 * Re-read src/server.ts and confirm each OAUTH_LINE_RANGES entry's start
 * line matches the expected marker. Exits with code 3 when drift is found
 * so CI shows the drift explicitly rather than letting coverage counts
 * silently mis-report.
 */
function verifyLineRanges() {
  const serverPath = path.resolve(__dirname, '..', 'src', 'server.ts');
  let lines;
  try {
    lines = readFileSync(serverPath, 'utf8').split('\n');
  } catch (err) {
    console.error(
      `check-oauth-coverage: failed to read src/server.ts for line-range verification: ${err.message}`
    );
    return 2;
  }
  const drift = [];
  for (const range of OAUTH_LINE_RANGES) {
    // Grab a 3-line window around `start` to allow 1-line whitespace drift.
    const window = [
      lines[range.start - 2] ?? '',
      lines[range.start - 1] ?? '',
      lines[range.start] ?? '',
    ].join('\n');
    // Handler names must appear as either `export function {fn}` (factories)
    // OR inside a route-path string for the well-known entries.
    const exportMatch = window.includes(`export function ${range.fn}`);
    const wellKnownMatch =
      (range.fn === 'wellKnownAuthServer' &&
        window.includes("'/.well-known/oauth-authorization-server'")) ||
      (range.fn === 'wellKnownProtectedResource' &&
        window.includes("'/.well-known/oauth-protected-resource'")) ||
      (range.fn === 'wellKnownAuthServerTenant' &&
        window.includes("'/t/:tenantId/.well-known/oauth-authorization-server'")) ||
      (range.fn === 'wellKnownProtectedResourceTenant' &&
        window.includes("'/t/:tenantId/.well-known/oauth-protected-resource'"));
    if (!exportMatch && !wellKnownMatch) {
      drift.push({ fn: range.fn, start: range.start, window });
    }
  }
  if (drift.length > 0) {
    console.error('check-oauth-coverage: OAUTH_LINE_RANGES drifted from src/server.ts:');
    for (const d of drift) {
      console.error(`  ${d.fn} at start=${d.start} — window did NOT match expected marker`);
      console.error(`    window:\n${d.window}`);
    }
    console.error('Re-run grep for the handler function names, update OAUTH_LINE_RANGES, commit.');
    return 3;
  }
  return 0;
}

export function main() {
  // Drift check first — a wrong range produces silently-wrong coverage
  // numbers, and that is worse than a missing coverage file.
  const driftExit = verifyLineRanges();
  if (driftExit !== 0) return driftExit;

  const coveragePath = path.resolve(__dirname, '..', 'coverage', 'coverage-final.json');
  let cov;
  try {
    cov = JSON.parse(readFileSync(coveragePath, 'utf8'));
  } catch (err) {
    console.error(`check-oauth-coverage: failed to read ${coveragePath}: ${err.message}`);
    console.error('Run `npm run test:oauth-coverage` first to generate coverage-final.json.');
    return 2;
  }

  const serverFileKey = Object.keys(cov).find((f) =>
    f.replace(/\\/g, '/').endsWith('src/server.ts')
  );
  if (!serverFileKey) {
    console.error('check-oauth-coverage: src/server.ts not found in coverage-final.json');
    console.error('Ensure vitest.config.js sets coverage.include: ["src/server.ts"].');
    return 2;
  }

  const { statementMap, s } = cov[serverFileKey];
  let hit = 0;
  let total = 0;
  const perFn = Object.fromEntries(OAUTH_LINE_RANGES.map((r) => [r.fn, { hit: 0, total: 0 }]));
  for (const [id, loc] of Object.entries(statementMap)) {
    for (const range of OAUTH_LINE_RANGES) {
      if (loc.start.line >= range.start && loc.end.line <= range.end) {
        total += 1;
        perFn[range.fn].total += 1;
        if (s[id] > 0) {
          hit += 1;
          perFn[range.fn].hit += 1;
        }
        break;
      }
    }
  }

  const pct = total === 0 ? 0 : (100 * hit) / total;
  console.log(`OAuth-surface coverage: ${hit}/${total} = ${pct.toFixed(1)}%`);
  console.log('Per-handler breakdown:');
  for (const fn of Object.keys(perFn)) {
    const { hit: fh, total: ft } = perFn[fn];
    const fpct = ft === 0 ? 0 : (100 * fh) / ft;
    console.log(`  ${fn.padEnd(34)} ${fh}/${ft} (${fpct.toFixed(1)}%)`);
  }

  if (pct < COVERAGE_THRESHOLD_PERCENT) {
    console.error(
      `FAIL: OAuth-surface coverage ${pct.toFixed(1)}% is below the D-10 ${COVERAGE_THRESHOLD_PERCENT}% threshold`
    );
    return 1;
  }
  console.log(`PASS: coverage ${pct.toFixed(1)}% >= ${COVERAGE_THRESHOLD_PERCENT}%`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
