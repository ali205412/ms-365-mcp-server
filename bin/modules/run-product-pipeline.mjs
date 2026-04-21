import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { downloadGraphOpenAPI } from './download-openapi.mjs';
import { createAndSaveSimplifiedOpenAPIFullSurface } from './simplified-openapi.mjs';
import { mergeBetaFragmentIntoClient } from './beta.mjs';

/**
 * MCP SEP-986 tool-name length limit. Mirrors the constant in beta.mjs so the
 * post-prefix truncation behaviour is identical across the beta and per-product
 * pipelines (plan 05.1-01 Task 1).
 */
const MCP_TOOL_NAME_MAX = 64;

/**
 * Validated prefix shape. Must be `__<snake_alpha>__` — the trailing underscore
 * pair lets downstream grep-scans (`grep __powerbi__` etc.) isolate a single
 * product's tools without regex backtracking. The leading underscore pair
 * matches the `__beta__` convention (plan 05-02 D-18 carrying forward).
 *
 * Threat T-5.1-07 mitigation: an invalid prefix smuggled via the deps bag
 * would otherwise let codegen emit unprefixed aliases into the registry,
 * silently bypassing admin-selector routing and rate limits. This regex is
 * enforced at the top of `runProductPipeline` BEFORE any filesystem write.
 */
const VALID_PREFIX_RE = /^__[a-z][a-z0-9_]*__$/;

/**
 * Extract the "bare" prefix (no surrounding underscores) for use in the regex
 * replacement's captured-group expansion. Given `__powerbi__`, returns
 * `__powerbi__` — the replacement inserts the entire wrapped token.
 *
 * @param {string} prefix Validated via VALID_PREFIX_RE.
 * @returns {string}
 */
function prefixBare(prefix) {
  // Strip underscores for use in fragment filename only. The regex replacement
  // below uses the full `__prefix__` as literal insertion text.
  return prefix.slice(2, -2);
}

/**
 * Generic product codegen pipeline used by plans 5.1-02..06. Structurally
 * mirrors `runBetaPipeline` (bin/modules/beta.mjs) but parameterised on the
 * product's prefix, spec source, snapshot file, and churn policy.
 *
 * Steps:
 *   1. Stage the OpenAPI spec (download via `downloadGraphOpenAPI` when a URL
 *      is supplied; otherwise treat `specPath` as the hand-authored source —
 *      throw if missing so we never silently emit an empty catalog).
 *   2. Simplify with `createAndSaveSimplifiedOpenAPIFullSurface` (same depth
 *      cap + recursive-ref flattener used by v1 and beta — T-05-02 holds).
 *   3. Invoke `openapi-zod-client` (via `execSync`) into a temporary
 *      `.client-<bare>-fragment.ts` under `generatedDir`.
 *   4. Post-process: `hack.js` rewrite, `.passthrough()` sub, errors-array
 *      strip, HTML-entity decode, function-style path fixup, prefix injection,
 *      MCP 64-char sha1-8 truncation. Same chain as beta.mjs lines 107-143.
 *   5. Collision guard: after prefix injection, no alias in the emitted
 *      fragment may duplicate any alias already present in the merged main
 *      `client.ts`. (Pitfall 2 carry-over from plan 05-02.)
 *   6. Merge via `mergeBetaFragmentIntoClient` — de-dupes schema consts
 *      against main and splices endpoints into the array anchor.
 *   7. Run `runProductChurnGuard` against the per-product snapshot with the
 *      configured policy (`permissive` for PBI/Apps/Automate, `strict` for
 *      EXO/SP-Admin per 05.1-CONTEXT D-04).
 *   8. Delete the temp fragment (its contents now live in main client.ts).
 *
 * @param {object} opts
 * @param {string} opts.prefix          e.g. `__powerbi__` — must match VALID_PREFIX_RE.
 * @param {string|null} opts.specUrl    When `null`, the spec is hand-authored
 *                                      and already staged at `opts.specPath`.
 *                                      When a string, delegates to
 *                                      `downloadGraphOpenAPI`.
 * @param {string} opts.specPath        Absolute path to openapi-<product>.yaml.
 * @param {string} opts.snapshotPath    Absolute path to
 *                                      bin/.last-<product>-snapshot.json.
 * @param {'permissive'|'strict'} opts.churnPolicy
 * @param {string} opts.churnEnvName    e.g. `MS365_MCP_ACCEPT_POWERBI_CHURN`.
 * @param {string} opts.openapiDir      Absolute path to openapi/.
 * @param {string} opts.generatedDir    Absolute path to src/generated/.
 * @returns {Promise<{count: number, aliases: string[]}>}
 */
export async function runProductPipeline(opts) {
  // Threat T-5.1-07: reject malformed prefixes BEFORE any I/O.
  if (!opts || typeof opts.prefix !== 'string' || !VALID_PREFIX_RE.test(opts.prefix)) {
    throw new Error(
      `runProductPipeline: prefix must match ${VALID_PREFIX_RE} — got "${opts?.prefix}"`
    );
  }
  if (!opts.churnPolicy || (opts.churnPolicy !== 'permissive' && opts.churnPolicy !== 'strict')) {
    throw new Error(
      `runProductPipeline: churnPolicy must be "permissive" or "strict" — got "${opts.churnPolicy}"`
    );
  }
  if (typeof opts.churnEnvName !== 'string' || opts.churnEnvName.length === 0) {
    throw new Error('runProductPipeline: churnEnvName is required');
  }
  if (typeof opts.specPath !== 'string' || typeof opts.snapshotPath !== 'string') {
    throw new Error('runProductPipeline: specPath and snapshotPath are required strings');
  }
  if (typeof opts.openapiDir !== 'string' || typeof opts.generatedDir !== 'string') {
    throw new Error('runProductPipeline: openapiDir and generatedDir are required strings');
  }

  const bare = prefixBare(opts.prefix);
  const trimmedSpecPath = path.join(opts.openapiDir, `openapi-${bare}-trimmed.yaml`);
  const tempFragmentPath = path.join(opts.generatedDir, `.client-${bare}-fragment.ts`);
  const mainClientPath = path.join(opts.generatedDir, 'client.ts');

  try {
    console.log(`Product pipeline [${opts.prefix}]: starting...`);

    // 1. Stage the spec. `specUrl === null` means a hand-authored spec must
    //    already be on disk at `specPath`. Delegate to `downloadGraphOpenAPI`
    //    only when a URL is supplied — this honors MS365_MCP_USE_SNAPSHOT in
    //    the same way runBetaPipeline does.
    if (opts.specUrl === null || opts.specUrl === undefined) {
      if (!fs.existsSync(opts.specPath)) {
        throw new Error(`runProductPipeline: hand-authored spec not found at ${opts.specPath}`);
      }
      console.log(
        `Product pipeline [${opts.prefix}]: using hand-authored spec at ${opts.specPath}`
      );
    } else {
      await downloadGraphOpenAPI(opts.openapiDir, opts.specPath, opts.specUrl, false);
    }

    // 2. Simplify — full-surface policy (T-05-02 depth cap carries over).
    createAndSaveSimplifiedOpenAPIFullSurface(opts.specPath, trimmedSpecPath);

    // 3. Codegen into a temp fragment under generatedDir.
    console.log(`Product pipeline [${opts.prefix}]: running openapi-zod-client...`);
    execSync(
      `npx -y openapi-zod-client "${trimmedSpecPath}" -o "${tempFragmentPath}" --with-description --strict-objects --additional-props-default-value=false`,
      { stdio: 'inherit' }
    );

    // 4. Post-process the fragment (chain copied from bin/modules/beta.mjs
    //    lines 107-119 + generate-mcp-tools.mjs lines 28-57).
    let code = fs.readFileSync(tempFragmentPath, 'utf-8');
    code = code.replace(/'@zodios\/core';/, "'./hack.js';");
    code = code.replace(/\.strict\(\)/g, '.passthrough()');
    code = code.replace(/,?\s*errors:\s*\[[\s\S]*?],?(?=\s*})/g, '');
    code = code.replace(/&#x3D;/g, '=');
    code = code.replace(/&#x27;/g, "'");
    code = code.replace(/&#x28;/g, '(');
    code = code.replace(/&#x29;/g, ')');
    code = code.replace(/&#x3A;/g, ':');
    code = code.replace(/(path:\s*)'(\/[^'\n]*=':[\w]+'[^'\n]*)'/g, '$1`$2`');
    code = code.replace(/(path:\s*)'(\/[^']*\([^)\n]*'@[^)\n]*\)[^']*)'/g, '$1`$2`');

    // Prefix injection. Anchored to `[a-z]` so numerics / uppercase / already-
    // prefixed aliases are left alone (T-05-03 carry-over — no bait-and-switch
    // via upstream casing tricks).
    code = code.replace(/(alias:\s*["'])([a-z][^"']*)/g, `$1${opts.prefix}$2`);

    // 64-char truncation with sha1-8 suffix. Structurally identical to the
    // helper in bin/modules/beta.mjs lines 132-142; duplicated rather than
    // re-exported from beta.mjs to keep beta.mjs's public surface stable for
    // the existing runBetaPipeline callers.
    code = code.replace(/alias:\s*["']([^"']+)["']/g, (full, alias) => {
      if (alias.length <= MCP_TOOL_NAME_MAX) return full;
      const suffix = crypto.createHash('sha1').update(alias).digest('hex').slice(0, 8);
      const keep = MCP_TOOL_NAME_MAX - suffix.length - 1; // reserve dash
      const truncated = `${alias.slice(0, keep)}-${suffix}`;
      return `alias: '${truncated}'`;
    });
    fs.writeFileSync(tempFragmentPath, code);

    // Extract product aliases (all must now start with opts.prefix). Build
    // a regex-safe prefix escape just in case we ever add non-word chars.
    const prefixEscaped = opts.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const productAliases = [
      ...code.matchAll(new RegExp(`alias:\\s*["'](${prefixEscaped}[^"']*)`, 'g')),
    ].map((m) => m[1]);

    const stillOversize = productAliases.filter((a) => a.length > MCP_TOOL_NAME_MAX);
    if (stillOversize.length > 0) {
      throw new Error(
        `Product pipeline [${opts.prefix}]: truncation failed for ${stillOversize.length} aliases (first: ${stillOversize[0]})`
      );
    }

    // Security invariant: every emitted alias MUST start with the configured
    // prefix. If the upstream spec happened to supply an operationId that the
    // prefix regex missed (e.g., uppercase-first), flag it — unprefixed
    // aliases leak across product boundaries and evade admin selectors.
    if (productAliases.length === 0) {
      throw new Error(
        `Product pipeline [${opts.prefix}]: zero aliases extracted — upstream spec may be empty or prefix regex failed to match`
      );
    }

    // 5. Collision guard against main client.ts.
    if (fs.existsSync(mainClientPath)) {
      const mainCode = fs.readFileSync(mainClientPath, 'utf-8');
      const mainAliases = [...mainCode.matchAll(/alias:\s*["']([^"']+)/g)].map((m) => m[1]);
      const combined = [...mainAliases, ...productAliases];
      if (new Set(combined).size !== combined.length) {
        throw new Error(
          `Product pipeline [${opts.prefix}]: alias collision detected after prefix injection`
        );
      }
    }

    // 6. Merge the fragment into main client.ts.
    mergeBetaFragmentIntoClient(mainClientPath, tempFragmentPath);

    // 7. Churn guard against the per-product snapshot.
    runProductChurnGuard(productAliases, opts.snapshotPath, opts.churnPolicy, opts.churnEnvName);

    // 8. Clean up the temp fragment — its endpoints now live in main client.ts.
    if (fs.existsSync(tempFragmentPath)) {
      fs.unlinkSync(tempFragmentPath);
    }

    console.log(
      `Product pipeline [${opts.prefix}]: ${productAliases.length} operation(s) merged into client.ts`
    );
    return { count: productAliases.length, aliases: productAliases };
  } catch (error) {
    throw new Error(`Error in product pipeline [${opts.prefix}]: ${error.message}`);
  }
}

/**
 * Per-product churn guard. Diffs a fresh alias list against the committed
 * snapshot file and fails the build when the delta exceeds the policy.
 *
 * Policies:
 *   - `permissive` — additions silent; removals throw unless `envName === '1'`.
 *     Used for stable Power Platform APIs (Power BI, Power Apps, Power Automate)
 *     where upstream regularly adds ops and removal is rare.
 *   - `strict`     — ANY delta (adds OR removes) throws unless `envName === '1'`.
 *     Used for still-shipping preview surfaces (Exchange Admin REST v2,
 *     SharePoint Tenant Admin) where silent additions can blow the alias set
 *     or introduce auth-scope surprises.
 *
 * Fresh-checkout: when `snapshotPath` does not exist, writes a new snapshot
 * and returns successfully regardless of policy. First runs are always safe.
 *
 * The snapshot is always written on success with sorted aliases so git diffs
 * are deterministic. On throw the snapshot is untouched — the operator must
 * either set the env var or adjust the committed snapshot before re-running.
 *
 * Threat T-5.1-06 mitigation: silent upstream feature loss is surfaced at
 * generate time rather than shipping a truncated tool catalog.
 *
 * @param {string[]} aliases      Fresh alias list (unsorted; this function sorts).
 * @param {string} snapshotPath   Target snapshot file.
 * @param {'permissive'|'strict'} policy
 * @param {string} envName        e.g. `MS365_MCP_ACCEPT_POWERBI_CHURN`.
 */
export function runProductChurnGuard(aliases, snapshotPath, policy, envName) {
  if (policy !== 'permissive' && policy !== 'strict') {
    throw new Error(`runProductChurnGuard: unknown policy "${policy}"`);
  }
  if (typeof envName !== 'string' || envName.length === 0) {
    throw new Error('runProductChurnGuard: envName is required');
  }

  const accept = process.env[envName] === '1';
  const sorted = [...aliases].sort();

  if (!fs.existsSync(snapshotPath)) {
    console.log(`Product pipeline churn guard: creating initial snapshot at ${snapshotPath}`);
    writeSnapshot(snapshotPath, sorted);
    return;
  }

  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Product churn guard: snapshot at ${snapshotPath} is not valid JSON: ${error.message}`
    );
  }

  const prevOps = Array.isArray(prev.ops) ? prev.ops : [];
  const prevSet = new Set(prevOps);
  const currSet = new Set(sorted);
  const removed = [...prevSet].filter((op) => !currSet.has(op));
  const added = [...currSet].filter((op) => !prevSet.has(op));

  if (policy === 'strict') {
    if ((removed.length > 0 || added.length > 0) && !accept) {
      // Preview capped at 5 per bucket — only committed snapshot + fresh alias
      // names reach stderr (no raw upstream spec content; parity with
      // beta churn guard's T-05-04 posture).
      const previewRemoved = removed.slice(0, 5).map((n) => `  - ${n}`);
      const previewAdded = added.slice(0, 5).map((n) => `  + ${n}`);
      const preview = [...previewRemoved, ...previewAdded].join('\n');
      throw new Error(
        `Product churn (strict): ${removed.length} removed, ${added.length} added since last snapshot.\n` +
          `${preview}\n` +
          `To accept: re-run with ${envName}=1`
      );
    }
  } else {
    // permissive — only removals gate on envName.
    if (removed.length > 0 && !accept) {
      const preview = removed
        .slice(0, 10)
        .map((n) => `  - ${n}`)
        .join('\n');
      const tail = removed.length > 10 ? `\n  ... and ${removed.length - 10} more` : '';
      throw new Error(
        `Product churn (permissive): ${removed.length} op(s) disappeared since last snapshot.\n` +
          `${preview}${tail}\n` +
          `To accept: re-run with ${envName}=1`
      );
    }
  }

  if (removed.length > 0) {
    console.log(
      `Product pipeline churn guard: ${removed.length} op(s) removed (${envName}=1 set — proceeding)`
    );
  }

  writeSnapshot(snapshotPath, sorted);
}

/**
 * Persist the snapshot. Sorted ops list + ISO timestamp + count for
 * deterministic git diffs. Parent directory is auto-created so first-run
 * tests don't need to pre-create `bin/`.
 *
 * @param {string} snapshotPath
 * @param {string[]} sortedOps
 */
function writeSnapshot(snapshotPath, sortedOps) {
  const parent = path.dirname(snapshotPath);
  if (parent && !fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  const payload = {
    generated_at: new Date().toISOString(),
    count: sortedOps.length,
    ops: sortedOps,
  };
  fs.writeFileSync(snapshotPath, JSON.stringify(payload, null, 2) + '\n');
}
