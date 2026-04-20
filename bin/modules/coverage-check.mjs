/**
 * Plan 05-08 — Coverage verification harness.
 *
 * Counts emitted aliases in src/generated/client.ts by workload (via path-
 * prefix regex) and diffs against a committed baseline at
 * bin/.last-coverage-snapshot.json. Classifies per-workload deltas into:
 *
 *   >= 0                        -> silent (no warning, no error)
 *   drop in (-5%, 0%]           -> silent (noise tolerance)
 *   drop in (-10%, -5%]         -> warning (reported, non-fatal)
 *   drop <= -10%                -> error (throws)
 *
 * Percentages are computed as (current - baseline) / baseline. Absolute
 * drops against a zero baseline are treated as growth (no regression
 * possible). The updated snapshot is always written on success (sorted
 * byWorkload keys for deterministic git diffs).
 *
 * Plan 05-02 contract: invoked AFTER runBetaPipeline so the alias set
 * includes both v1 and __beta__-prefixed beta ops. The workload taxonomy
 * mirrors GAP-GRAPH-API.md — path-prefix regex captures both surfaces in
 * the same workload bucket.
 *
 * Security note (T-05-04 parallel): this module never echoes raw upstream
 * spec content. Warning/error messages only name workloads + counts drawn
 * from the committed snapshot shape. Bounded output (10 lines per section).
 */
import fs from 'fs';

/**
 * Per-workload classification rules. Ordered from most-specific to least-
 * specific so paths that match multiple buckets land in the first rule they
 * hit (e.g. /users/*\/messages is Mail, not Users).
 *
 * Patterns use anchored path prefixes. Each entry captures the workload
 * taxonomy from GAP-GRAPH-API.md (HIGH + MED priority workloads are
 * enumerated; LOW workloads fall through to 'Other').
 */
const WORKLOAD_RULES = [
  // Mail — /me/messages, /me/mailFolders, /users/*\/messages, /users/*\/mailFolders
  { workload: 'Mail', pattern: /^\/(me|users\/[^/]+)\/(messages|mailFolders)/ },
  // Calendars — /me/events, /me/calendar, /users/*\/events, /users/*\/calendar, /me/calendarGroups
  {
    workload: 'Calendars',
    pattern: /^\/(me|users\/[^/]+)\/(events|calendar|calendarGroups|calendarView)/,
  },
  // Personal Contacts — /me/contacts, /users/*\/contacts, /me/contactFolders
  { workload: 'Contacts', pattern: /^\/(me|users\/[^/]+)\/(contacts|contactFolders)/ },
  // Files/OneDrive — /me/drive, /users/*\/drive, /drives, /shares
  {
    workload: 'Files',
    pattern: /^\/(me|users\/[^/]+)\/drive(s)?(\/|$)|^\/drives(\/|$)|^\/shares(\/|$)/,
  },
  // OneNote — /me/onenote, /users/*\/onenote, /groups/*\/onenote
  { workload: 'OneNote', pattern: /^\/(me|users\/[^/]+|groups\/[^/]+|sites\/[^/]+)\/onenote/ },
  // Planner — /me/planner, /planner, /groups/*\/planner
  { workload: 'Planner', pattern: /^\/(me\/planner|planner|groups\/[^/]+\/planner)/ },
  // ToDo — /me/todo, /users/*\/todo
  { workload: 'ToDo', pattern: /^\/(me|users\/[^/]+)\/todo/ },
  // Teams — /teams, /me/joinedTeams, /chats, /communications
  {
    workload: 'Teams',
    pattern: /^\/(teams|chats|communications)(\/|$)|^\/(me|users\/[^/]+)\/(joinedTeams|chats)/,
  },
  // SharePoint — /sites
  { workload: 'SharePoint', pattern: /^\/sites(\/|$)/ },
  // Groups — /groups (but not /groups/*\/planner or /groups/*\/onenote, which are handled above)
  { workload: 'Groups', pattern: /^\/groups(\/|$)/ },
  // Search — /search
  { workload: 'Search', pattern: /^\/search(\/|$)/ },
  // Subscriptions (Change Notifications) — /subscriptions
  { workload: 'Subscriptions', pattern: /^\/subscriptions(\/|$)/ },
  // Security — /security
  { workload: 'Security', pattern: /^\/security(\/|$)/ },
  // Compliance — /compliance
  { workload: 'Compliance', pattern: /^\/compliance(\/|$)/ },
  // Reports — /reports
  { workload: 'Reports', pattern: /^\/reports(\/|$)/ },
  // Applications — /applications, /servicePrincipals, /oauth2PermissionGrants
  {
    workload: 'Applications',
    pattern: /^\/(applications|servicePrincipals|oauth2PermissionGrants)(\/|$)/,
  },
  // Identity — /identity, /identityGovernance, /directory, /directoryObjects, /directoryRoles
  {
    workload: 'Identity',
    pattern:
      /^\/(identity|identityGovernance|directory|directoryObjects|directoryRoles|domains|invitations|organization|roleManagement)(\/|$)/,
  },
  // Intune / Device Management — /deviceManagement, /deviceAppManagement, /devices
  {
    workload: 'Intune',
    pattern: /^\/(deviceManagement|deviceAppManagement|devices)(\/|$)/,
  },
  // Excel — /me/drive/*\/workbook
  { workload: 'Excel', pattern: /\/workbook(\/|$)/ },
  // Copilot — /copilot, /me/copilot
  { workload: 'Copilot', pattern: /^\/(copilot|(me|users\/[^/]+)\/copilot)(\/|$)/ },
  // People / Workplace — /me/people, /users/*\/people, /employeeExperience
  {
    workload: 'People',
    pattern: /^\/(me|users\/[^/]+)\/people(\/|$)|^\/employeeExperience(\/|$)/,
  },
  // Users — /users (catch-all for /users/* paths that did NOT match a more-
  // specific bucket above). The /me root hits here too.
  { workload: 'Users', pattern: /^\/(users|me)(\/|$)/ },
];

/**
 * Extract `{method, path, alias}` triples from an openapi-zod-client-emitted
 * client.ts. The regex matches the three properties that appear adjacent in
 * every endpoint entry. `(path:\s*["']([^"']+)["'])` and
 * `(alias:\s*["']([^"']+)["'])` are anchored to the string-literal form —
 * template-literal paths (the function-style backtick rewrite in
 * generate-mcp-tools.mjs line 52) are a post-processing artifact for paths
 * with single quotes; those paths still carry aliases we can count.
 *
 * Returns a flat list of { path, alias } objects ordered by their appearance
 * in the source file.
 */
export function extractEndpoints(clientCode) {
  // Match each endpoint entry as a braced object containing path + alias
  // properties (order within the object is emitter-stable: method -> path ->
  // alias). Tolerate single-quoted, double-quoted, and template-literal paths.
  const endpointRe =
    /\{\s*method:\s*["'][a-z]+["'][\s\S]*?path:\s*(?:["']([^"']+)["']|`([^`]+)`)[\s\S]*?alias:\s*["']([^"']+)["']/g;
  const results = [];
  let match;
  while ((match = endpointRe.exec(clientCode)) !== null) {
    const path = match[1] ?? match[2];
    const alias = match[3];
    results.push({ path, alias });
  }
  return results;
}

/**
 * Classify a single path into a workload bucket using WORKLOAD_RULES in order.
 * Returns the matched workload name, or 'Other' if none matches.
 */
export function classifyPath(path) {
  for (const rule of WORKLOAD_RULES) {
    if (rule.pattern.test(path)) {
      return rule.workload;
    }
  }
  return 'Other';
}

/**
 * Read a client.ts file and return a { workload: count } map. Only workloads
 * with at least one op are included (no zero-keys pollution). Counts every
 * alias — v1 and __beta__-prefixed — because the prefix is orthogonal to
 * the workload taxonomy.
 */
export function countByWorkload(clientPath) {
  const code = fs.readFileSync(clientPath, 'utf-8');
  const endpoints = extractEndpoints(code);
  const counts = {};
  for (const ep of endpoints) {
    const workload = classifyPath(ep.path);
    counts[workload] = (counts[workload] ?? 0) + 1;
  }
  return counts;
}

/**
 * Thresholds (percent drop from baseline per workload):
 *   WARN lower bound (exclusive): -5% — anything better is silent tolerance.
 *   ERROR lower bound (inclusive): -10% — anything <= -10% throws.
 */
const WARN_THRESHOLD_PCT = -5;
const ERROR_THRESHOLD_PCT = -10;

/**
 * Classify a per-workload delta into silent / warning / error.
 *
 * @param {number} current   Current op count (>= 0).
 * @param {number} baseline  Baseline op count (>= 0).
 * @returns {'silent'|'warn'|'error'}
 */
export function classifyDelta(current, baseline) {
  if (baseline === 0) return 'silent'; // Cannot regress against zero — any value is growth.
  if (current >= baseline) return 'silent'; // Growth or flat.
  const pct = ((current - baseline) / baseline) * 100;
  if (pct <= ERROR_THRESHOLD_PCT) return 'error';
  if (pct <= WARN_THRESHOLD_PCT) return 'warn';
  return 'silent';
}

/**
 * Run the coverage check against a generated client.ts and a baseline JSON.
 * Writes the updated baseline on success (throws on any error classification).
 *
 * @param {string} clientPath    Path to src/generated/client.ts.
 * @param {string} baselinePath  Path to .last-coverage-snapshot.json.
 * @param {object} [opts]
 * @param {boolean} [opts.writeSnapshot=true]  Set false to skip snapshot write
 *                                              (e.g. dry-run validation).
 * @returns {{
 *   totals: { current: number, baseline: number },
 *   byWorkload: Record<string, number>,
 *   deltas: Record<string, number>,
 *   warnings: string[],
 *   errors: string[]
 * }}
 */
export function runCoverageCheck(clientPath, baselinePath, opts = {}) {
  const writeSnapshotFlag = opts.writeSnapshot !== false;

  if (!fs.existsSync(clientPath)) {
    throw new Error(`Coverage check: generated client not found at ${clientPath}`);
  }

  const current = countByWorkload(clientPath);
  const currentTotal = Object.values(current).reduce((a, b) => a + b, 0);

  let baselineData = { totals: 0, byWorkload: {} };
  if (fs.existsSync(baselinePath)) {
    try {
      baselineData = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    } catch (error) {
      throw new Error(
        `Coverage check: baseline snapshot at ${baselinePath} is not valid JSON: ${error.message}`
      );
    }
  }
  const baselineCounts =
    baselineData.byWorkload && typeof baselineData.byWorkload === 'object'
      ? baselineData.byWorkload
      : {};
  const baselineTotal = Number.isFinite(baselineData.totals)
    ? baselineData.totals
    : Object.values(baselineCounts).reduce((a, b) => a + b, 0);

  // Compute per-workload deltas across the union of keys in both maps.
  const allKeys = new Set([...Object.keys(current), ...Object.keys(baselineCounts)]);
  const deltas = {};
  const warnings = [];
  const errors = [];

  for (const workload of allKeys) {
    const cur = current[workload] ?? 0;
    const base = baselineCounts[workload] ?? 0;
    deltas[workload] = cur - base;

    const classification = classifyDelta(cur, base);
    if (classification === 'error') {
      const pct = ((cur - base) / base) * 100;
      errors.push(
        `${workload}: regressed from ${base} to ${cur} (${pct.toFixed(1)}% drop, threshold ${ERROR_THRESHOLD_PCT}%)`
      );
    } else if (classification === 'warn') {
      const pct = ((cur - base) / base) * 100;
      warnings.push(
        `${workload}: dropped from ${base} to ${cur} (${pct.toFixed(1)}%, below warn threshold ${WARN_THRESHOLD_PCT}%)`
      );
    }
  }

  const report = {
    totals: { current: currentTotal, baseline: baselineTotal },
    byWorkload: current,
    deltas,
    warnings,
    errors,
  };

  if (errors.length > 0) {
    // Bounded preview (up to 10 lines) — parallels runChurnGuard (T-05-04 style).
    const preview = errors.slice(0, 10).join('\n  - ');
    const tail = errors.length > 10 ? `\n  ... and ${errors.length - 10} more` : '';
    throw new Error(
      `Coverage regression: ${errors.length} workload(s) exceeded the ${ERROR_THRESHOLD_PCT}% regression threshold.\n` +
        `  - ${preview}${tail}`
    );
  }

  if (writeSnapshotFlag) {
    writeBaseline(baselinePath, current, currentTotal);
  }

  return report;
}

/**
 * Write a baseline snapshot in a deterministic, diff-friendly shape (workload
 * keys sorted alphabetically).
 */
function writeBaseline(baselinePath, byWorkload, totals) {
  const sortedKeys = Object.keys(byWorkload).sort();
  const sorted = {};
  for (const k of sortedKeys) {
    sorted[k] = byWorkload[k];
  }
  const payload = {
    generated_at: new Date().toISOString(),
    totals,
    byWorkload: sorted,
  };
  // Ensure the snapshot's parent directory exists. Rule-1 deviation from the
  // initial implementation: a fresh bin/ without a prior snapshot would trip
  // ENOENT on writeFileSync. Mirrors the robust behavior of writeSnapshot in
  // runBetaPipeline's churn guard (bin/modules/beta.mjs).
  const parent = baselinePath.replace(/[^/\\]+$/, '');
  if (parent && !fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n');
}

/**
 * Render a markdown coverage report.
 *
 * @param {object} report        Result of runCoverageCheck.
 * @param {object} [meta]
 * @param {string} [meta.generatedAt]  ISO timestamp for the "generated" stamp.
 * @returns {string}
 */
export function renderMarkdownReport(report, meta = {}) {
  const generatedAt = meta.generatedAt ?? new Date().toISOString();
  const lines = [];
  lines.push(`# Microsoft Graph Coverage Report`);
  lines.push('');
  lines.push(`_Generated ${generatedAt} by bin/modules/coverage-check.mjs_`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| Current total ops | **${report.totals.current}** |`);
  lines.push(`| Baseline total ops | ${report.totals.baseline} |`);
  const delta = report.totals.current - report.totals.baseline;
  const deltaSign = delta >= 0 ? '+' : '';
  lines.push(`| Delta | ${deltaSign}${delta} |`);
  lines.push('');
  lines.push(`## Per-Workload Coverage`);
  lines.push('');
  lines.push(`| Workload | Current | Baseline | Delta | Status |`);
  lines.push(`|---|---:|---:|---:|---|`);
  // Sort workloads by current count descending, then alphabetically.
  const keys = Object.keys(report.byWorkload).sort((a, b) => {
    const dc = (report.byWorkload[b] ?? 0) - (report.byWorkload[a] ?? 0);
    if (dc !== 0) return dc;
    return a.localeCompare(b);
  });
  // Also include baseline-only keys (drops to zero) — classify them as errors
  // already so they appear here too.
  const allKeys = new Set([...keys, ...Object.keys(report.deltas)]);
  const sortedAll = [...allKeys].sort((a, b) => {
    const dc = (report.byWorkload[b] ?? 0) - (report.byWorkload[a] ?? 0);
    if (dc !== 0) return dc;
    return a.localeCompare(b);
  });
  for (const workload of sortedAll) {
    const cur = report.byWorkload[workload] ?? 0;
    const wDelta = report.deltas[workload] ?? 0;
    const baseline = cur - wDelta;
    const classification = classifyDelta(cur, baseline);
    const status = classification === 'error' ? 'ERROR' : classification === 'warn' ? 'WARN' : 'OK';
    const deltaStr = (wDelta >= 0 ? '+' : '') + wDelta;
    lines.push(`| ${workload} | ${cur} | ${baseline} | ${deltaStr} | ${status} |`);
  }
  lines.push('');
  if (report.warnings.length > 0) {
    lines.push(`## Warnings (${report.warnings.length})`);
    lines.push('');
    for (const w of report.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push('');
  }
  if (report.errors.length > 0) {
    lines.push(`## Errors (${report.errors.length})`);
    lines.push('');
    for (const e of report.errors) {
      lines.push(`- ${e}`);
    }
    lines.push('');
  }
  lines.push(`## Thresholds`);
  lines.push('');
  lines.push(`- Drops within **${WARN_THRESHOLD_PCT}%** of baseline are tolerated (noise).`);
  lines.push(
    `- Drops between **${WARN_THRESHOLD_PCT}%** and **${ERROR_THRESHOLD_PCT}%** emit a warning.`
  );
  lines.push(`- Drops at or below **${ERROR_THRESHOLD_PCT}%** fail the build.`);
  lines.push('');
  return lines.join('\n');
}
