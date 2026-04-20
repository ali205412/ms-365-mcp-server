import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { downloadGraphOpenAPI } from './download-openapi.mjs';
import { createAndSaveSimplifiedOpenAPIFullSurface } from './simplified-openapi.mjs';

/**
 * Microsoft Graph beta OpenAPI spec URL. Pinned to the master branch of
 * msgraph-metadata — this is the SAME source the Microsoft Graph SDKs
 * consume. ~65 MB YAML as of 2026-04-20.
 */
const BETA_URL =
  'https://raw.githubusercontent.com/microsoftgraph/msgraph-metadata/master/openapi/beta/openapi.yaml';

/**
 * MCP SEP-986 tool-name length limit. Enforced on post-prefix aliases so the
 * downstream `McpServer.tool(...)` registration call never fails with a
 * length-violation error.
 */
const MCP_TOOL_NAME_MAX = 64;

/**
 * __beta__ prefix applied to every beta-sourced alias. Grep-scannable marker
 * survives through logs, MCP client UIs, and audit rows (CONTEXT D-18).
 */
const BETA_PREFIX = '__beta__';

/**
 * Default churn-guard snapshot location (relative to the repo root). The
 * orchestrator passes an absolute path via opts.snapshotPath; this default is
 * only used when the pipeline is invoked without overrides.
 */
const DEFAULT_SNAPSHOT_PATH = 'bin/.last-beta-snapshot.json';

/**
 * Run the Microsoft Graph beta codegen pipeline.
 *
 * 1. Download the beta spec (honors `opts.useSnapshot` or
 *    `MS365_MCP_USE_SNAPSHOT=1` via `downloadGraphOpenAPI`).
 * 2. Simplify + trim with the same depth-cap policy used by v1 full-surface.
 * 3. Invoke `openapi-zod-client` against the trimmed beta spec, emitting a
 *    temporary `.client-beta-fragment.ts` under `generatedDir`.
 * 4. Post-process the fragment: apply the same `hack.js` + `.passthrough()`
 *    + errors-array strip + HTML-entity decode treatment used by the v1
 *    post-processor, PLUS the `__beta__` prefix on every `alias:` entry.
 * 5. Enforce MCP SEP-986 (length <= 64) and no-collision invariants against
 *    the already-emitted main `client.ts`.
 * 6. Merge the beta `makeApi([...])` endpoint entries into the main file's
 *    endpoints array.
 * 7. Run the churn guard (diff beta aliases against the committed snapshot;
 *    fail unless `MS365_MCP_ACCEPT_BETA_CHURN=1` is set).
 * 8. Write the updated snapshot (sorted beta_ops list).
 *
 * @param {string} openapiDir   Directory holding openapi-beta.yaml +
 *                              openapi-beta-trimmed.yaml.
 * @param {string} generatedDir Directory holding the main client.ts that the
 *                              v1 pipeline already populated.
 * @param {object} [opts]
 * @param {string} [opts.snapshotPath]  Override the snapshot file path (tests).
 * @param {boolean} [opts.useSnapshot]  Force snapshot-mode (tests). Equivalent
 *                                      to `MS365_MCP_USE_SNAPSHOT=1` scoped to
 *                                      this invocation.
 * @returns {Promise<{betaCount: number, aliases: string[]}>}
 */
export async function runBetaPipeline(openapiDir, generatedDir, opts = {}) {
  try {
    console.log('Beta pipeline: downloading spec, simplifying, prefixing...');

    const betaOpenapiFile = path.join(openapiDir, 'openapi-beta.yaml');
    const betaTrimmedFile = path.join(openapiDir, 'openapi-beta-trimmed.yaml');
    const mainClientPath = path.join(generatedDir, 'client.ts');
    const tempBetaClientPath = path.join(generatedDir, '.client-beta-fragment.ts');

    // 1. Download beta spec. downloadGraphOpenAPI honors MS365_MCP_USE_SNAPSHOT.
    // For test-friendly explicit opts, temporarily apply that env.
    const prevSnapshotEnv = process.env.MS365_MCP_USE_SNAPSHOT;
    if (opts.useSnapshot) {
      process.env.MS365_MCP_USE_SNAPSHOT = '1';
    }
    try {
      await downloadGraphOpenAPI(openapiDir, betaOpenapiFile, BETA_URL, false);
    } finally {
      if (opts.useSnapshot) {
        if (prevSnapshotEnv === undefined) {
          delete process.env.MS365_MCP_USE_SNAPSHOT;
        } else {
          process.env.MS365_MCP_USE_SNAPSHOT = prevSnapshotEnv;
        }
      }
    }

    // 2. Simplify. Same full-surface policy used for v1 -- filter-nothing,
    // depth-cap-everything. Reusing the existing simplifier keeps OOM + cycle
    // mitigations (T-05-02) consistent between v1 and beta.
    createAndSaveSimplifiedOpenAPIFullSurface(betaOpenapiFile, betaTrimmedFile);

    // 3. Codegen. Same invocation shape as generate-mcp-tools.mjs; output goes
    // to a temp fragment so the main client.ts stays the merge target.
    console.log('Beta pipeline: running openapi-zod-client on beta spec...');
    execSync(
      `npx -y openapi-zod-client "${betaTrimmedFile}" -o "${tempBetaClientPath}" --with-description --strict-objects --additional-props-default-value=false`,
      { stdio: 'inherit' }
    );

    // 4. Post-process: same fixups as generate-mcp-tools.mjs + __beta__ prefix.
    let code = fs.readFileSync(tempBetaClientPath, 'utf-8');
    code = code.replace(/'@zodios\/core';/, "'./hack.js';");
    code = code.replace(/\.strict\(\)/g, '.passthrough()');
    code = code.replace(/,?\s*errors:\s*\[[\s\S]*?],?(?=\s*})/g, '');
    // HTML-entity decoding (mirrors generate-mcp-tools.mjs lines 40-52) —
    // openapi-zod-client HTML-encodes special chars in path patterns.
    code = code.replace(/&#x3D;/g, '=');
    code = code.replace(/&#x27;/g, "'");
    code = code.replace(/&#x28;/g, '(');
    code = code.replace(/&#x29;/g, ')');
    code = code.replace(/&#x3A;/g, ':');
    // Function-style path fixup (same as generate-mcp-tools.mjs line 52).
    code = code.replace(/(path:\s*)'(\/[^']*\([^)]*=':[\w]+'\)[^']*)'/g, '$1`$2`');

    // __beta__ prefix on every alias. Anchored to `[a-z]` so numerics,
    // uppercase, or already-prefixed aliases are left alone (Threat T-05-03
    // mitigation — no bait-and-switch possible via upstream casing tricks).
    code = code.replace(/(alias:\s*["'])([a-z][^"']*)/g, `$1${BETA_PREFIX}$2`);
    fs.writeFileSync(tempBetaClientPath, code);

    // 5. Extract beta aliases + enforce invariants.
    // Length guard (Pitfall 3 / SEP-986): truncate oversize aliases with
    // short sha1 suffix to preserve uniqueness. Microsoft's beta operationIds
    // push many past 64 chars after __beta__ prefix (~11k of 8.9k total beta
    // ops). Truncation is deterministic; hash suffix closes the collision risk.
    code = code.replace(/alias:\s*["']([^"']+)["']/g, (full, alias) => {
      if (alias.length <= MCP_TOOL_NAME_MAX) return full;
      const suffix = crypto
        .createHash('sha1')
        .update(alias)
        .digest('hex')
        .slice(0, 8);
      const keep = MCP_TOOL_NAME_MAX - suffix.length - 1; // reserve dash
      const truncated = `${alias.slice(0, keep)}-${suffix}`;
      return `alias: '${truncated}'`;
    });
    fs.writeFileSync(tempBetaClientPath, code);

    const betaAliases = [...code.matchAll(/alias:\s*["'](__beta__[^"']*)/g)].map((m) => m[1]);
    const stillOversize = betaAliases.filter((a) => a.length > MCP_TOOL_NAME_MAX);
    if (stillOversize.length > 0) {
      throw new Error(
        `Beta truncation failed for ${stillOversize.length} aliases (first: ${stillOversize[0]})`
      );
    }

    // Collision guard. v1 aliases are already in mainClientPath. After prefix,
    // the combined alias set MUST be unique (Pitfall 2).
    if (fs.existsSync(mainClientPath)) {
      const mainCode = fs.readFileSync(mainClientPath, 'utf-8');
      const mainAliases = [...mainCode.matchAll(/alias:\s*["']([^"']+)/g)]
        .map((m) => m[1])
        .filter((a) => !a.startsWith(BETA_PREFIX));
      const combined = [...mainAliases, ...betaAliases];
      if (new Set(combined).size !== combined.length) {
        throw new Error('Alias collision detected after __beta__ prefix injection');
      }
      // Log expected overlaps — stripped form matching v1 aliases is healthy;
      // the prefix is resolving exactly the collision Microsoft Graph v1/beta
      // share via duplicated operationIds.
      const mainSet = new Set(mainAliases);
      const stripped = betaAliases.map((a) => a.slice(BETA_PREFIX.length));
      const expectedOverlap = stripped.filter((a) => mainSet.has(a));
      if (expectedOverlap.length > 0) {
        console.log(
          `Beta pipeline: ${expectedOverlap.length} v1.0/beta operationId overlap(s) resolved by ${BETA_PREFIX} prefix`
        );
      }
    }

    // 6. Merge beta fragment into main client.ts.
    mergeBetaFragmentIntoClient(mainClientPath, tempBetaClientPath);

    // 7. Churn guard against committed snapshot.
    const snapshotPath = opts.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
    runChurnGuard(betaAliases, snapshotPath);

    // 8. Clean up temp fragment — the beta endpoints now live in client.ts.
    if (fs.existsSync(tempBetaClientPath)) {
      fs.unlinkSync(tempBetaClientPath);
    }

    console.log(`Beta pipeline: ${betaAliases.length} beta operation(s) merged into client.ts`);
    return { betaCount: betaAliases.length, aliases: betaAliases };
  } catch (error) {
    throw new Error(`Error in beta pipeline: ${error.message}`);
  }
}

/**
 * Append the beta pipeline's `makeApi([ ... beta entries ])` endpoints into
 * the main client.ts's endpoints array. Regex-based — the fragment file is
 * a known shape produced by `openapi-zod-client` so the anchor
 * `const endpoints = makeApi([ ... ]);` is unique and stable.
 *
 * @param {string} mainPath     Path to main src/generated/client.ts.
 * @param {string} fragmentPath Path to the temp beta fragment.
 */
export function mergeBetaFragmentIntoClient(mainPath, fragmentPath) {
  const main = fs.readFileSync(mainPath, 'utf-8');
  const fragment = fs.readFileSync(fragmentPath, 'utf-8');

  const fragMatch = fragment.match(/const\s+endpoints\s*=\s*makeApi\(\s*\[([\s\S]*)\]\s*\)\s*;/);
  if (!fragMatch) {
    throw new Error('Beta fragment missing makeApi endpoints array anchor');
  }
  const betaEntries = fragMatch[1].trim();
  if (betaEntries.length === 0) {
    // No beta ops to merge (edge case — empty beta spec).
    return;
  }

  const mainMatch = main.match(/const\s+endpoints\s*=\s*makeApi\(\s*\[([\s\S]*)\]\s*\)\s*;/);
  if (!mainMatch) {
    throw new Error('Main client.ts missing makeApi endpoints array anchor');
  }

  // Extract beta schema declarations — everything BEFORE the endpoints array
  // definition in the fragment. These are `const microsoft_graph_* = z...` and
  // helper type declarations. Without them the endpoints reference undefined
  // schema identifiers at runtime. De-duplicate against main's existing const
  // names so we only ADD symbols that main doesn't already define.
  const endpointsIdx = fragment.indexOf('const endpoints =');
  const betaPrelude = endpointsIdx > 0 ? fragment.slice(0, endpointsIdx) : '';
  const mainDefined = new Set(
    [...main.matchAll(/^const\s+([a-zA-Z_][\w]*)\s*=/gm)].map((m) => m[1])
  );
  // Walk beta const declarations; keep only ones not in main. Import lines are
  // skipped — main's existing `import { z } from 'zod'` covers the beta ones.
  const newConsts = [];
  const constRegex = /^const\s+([a-zA-Z_][\w]*)\s*=\s*([\s\S]*?);$/gm;
  let cm;
  while ((cm = constRegex.exec(betaPrelude)) !== null) {
    if (!mainDefined.has(cm[1])) {
      newConsts.push(cm[0]);
    }
  }
  const betaSchemaBlock = newConsts.length > 0 ? newConsts.join('\n') + '\n' : '';

  // Inject schemas BEFORE the main endpoints array and append endpoints INTO
  // the array. Two separate replaces so both payloads land deterministically.
  let merged = main.replace(
    /(const\s+endpoints\s*=\s*makeApi\(\s*\[)([\s\S]*)(\]\s*\)\s*;)/,
    (_full, open, body, close) => {
      const trimmed = body.replace(/\s+$/, '');
      const needsComma = trimmed.length > 0 && !trimmed.trimEnd().endsWith(',');
      const separator = needsComma ? ',\n  ' : '\n  ';
      return `${open}${trimmed}${separator}${betaEntries}\n${close}`;
    }
  );
  if (betaSchemaBlock.length > 0) {
    merged = merged.replace(
      /(const\s+endpoints\s*=\s*makeApi\()/,
      `${betaSchemaBlock}\n$1`
    );
  }

  fs.writeFileSync(mainPath, merged);
}

/**
 * Diff the fresh beta op list against the committed snapshot. Fails the build
 * (throws) when ≥1 previously-known op has disappeared and
 * `MS365_MCP_ACCEPT_BETA_CHURN=1` is NOT set (CONTEXT D-18).
 *
 * Fresh-checkout behavior: if the snapshot is absent OR its `beta_ops` array
 * is empty (the committed baseline shape), any detected ops are "new" not
 * "removed" — the pipeline succeeds and populates the snapshot.
 *
 * The updated snapshot is always written on success (sorted beta_ops for
 * deterministic git diffs).
 *
 * @param {string[]} betaAliases  Fresh beta alias list (unsorted).
 * @param {string}   snapshotPath Target snapshot file.
 */
export function runChurnGuard(betaAliases, snapshotPath) {
  const acceptChurn = process.env.MS365_MCP_ACCEPT_BETA_CHURN === '1';
  const sorted = [...betaAliases].sort();

  if (!fs.existsSync(snapshotPath)) {
    console.log(`Beta pipeline: creating initial snapshot at ${snapshotPath}`);
    writeSnapshot(snapshotPath, sorted);
    return;
  }

  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Beta churn guard: snapshot at ${snapshotPath} is not valid JSON: ${error.message}`
    );
  }
  const prevOps = Array.isArray(prev.beta_ops) ? prev.beta_ops : [];
  const prevSet = new Set(prevOps);
  const currSet = new Set(sorted);
  const removed = [...prevSet].filter((op) => !currSet.has(op));

  if (removed.length > 0 && !acceptChurn) {
    // Preview up to 10 names. Only committed snapshot aliases are printed —
    // no raw upstream spec content reaches stderr (T-05-04 mitigation).
    const preview = removed.slice(0, 10).join('\n  - ');
    const tail = removed.length > 10 ? `\n  ... and ${removed.length - 10} more` : '';
    throw new Error(
      `Beta churn detected: ${removed.length} op(s) disappeared from upstream spec since last snapshot.\n` +
        `Preview:\n  - ${preview}${tail}\n` +
        `To accept: re-run with MS365_MCP_ACCEPT_BETA_CHURN=1`
    );
  }

  if (removed.length > 0) {
    console.log(
      `Beta pipeline: ${removed.length} op(s) removed (MS365_MCP_ACCEPT_BETA_CHURN=1 set — proceeding)`
    );
  }

  writeSnapshot(snapshotPath, sorted);
}

function writeSnapshot(snapshotPath, sortedOps) {
  const payload = {
    generated_at: new Date().toISOString(),
    beta_count: sortedOps.length,
    beta_ops: sortedOps,
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(payload, null, 2) + '\n');
}
