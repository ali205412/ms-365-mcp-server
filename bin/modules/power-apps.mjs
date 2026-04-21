import path from 'path';
import { runProductPipeline } from './run-product-pipeline.mjs';
// Import from the leaf registry module (NOT the orchestrator) to avoid an
// ESM circular-import — the orchestrator imports this file for side effects,
// and its `export const PRODUCT_PIPELINES = []` line would otherwise be in
// the temporal dead zone when this module runs its registration push.
// (Pattern established by plan 05.1-02; product-registry.mjs is the leaf.)
import { PRODUCT_PIPELINES } from './product-registry.mjs';

/**
 * Phase 5.1-03 — Power Apps product generator.
 *
 * Thin wrapper around the shared `runProductPipeline` contract (plan 05.1-01)
 * that supplies the Power Apps-specific deps bag: hand-authored spec path
 * (specUrl=null), `__pwrapps__` prefix, snapshot path, and `permissive` churn
 * policy per 05.1-CONTEXT D-04.
 *
 * Side effect on module load: registers `{name: 'pwrapps', run: runPowerAppsPipeline}`
 * into `PRODUCT_PIPELINES`. The registration is idempotent — importing the
 * module twice does NOT push a second entry (mirrors plan 05.1-02's
 * T-5.1-02-f guard; same pattern extended to this product).
 *
 * Geography routing (research Open Question #1 / assumption A9): the gateway
 * relies on Power Apps API platform-level auto-routing based on OAuth token
 * region claim. NO `x-ms-region` header is injected at codegen (Test 11 pins
 * this) or dispatch time. If an integration spike during plan 5.1-06
 * dispatch work reveals explicit routing is needed, escalate before shipping
 * and document the required header via GAP-POWER-PLATFORM.md (plan 5.1-08).
 */

/**
 * Grep-scannable namespace marker applied to every Power Apps alias. Plan 5.1-06
 * dispatch-time routing uses the prefix to pick the Power Apps audience
 * (`https://api.powerapps.com/.default` per 05.1-CONTEXT D-05 table) at request
 * time, so this literal MUST stay in sync with the product-audiences table
 * there.
 */
export const POWER_APPS_PREFIX = '__pwrapps__';

/**
 * Per-product churn-guard snapshot filename. Lives under `<rootDir>/bin/`
 * alongside `.last-beta-snapshot.json`, `.last-powerbi-snapshot.json`, and
 * the future per-product snapshots (plans 5.1-04..05).
 */
export const POWER_APPS_SNAPSHOT_NAME = '.last-pwrapps-snapshot.json';

/**
 * Environment variable name that opts into accepting Power Apps alias removal
 * at regen time. Permissive policy (D-04): additions are silent; removals
 * require `MS365_MCP_ACCEPT_PWRAPPS_CHURN=1` or the regen exits non-zero
 * with a bounded preview of removed aliases.
 */
export const POWER_APPS_CHURN_ENV = 'MS365_MCP_ACCEPT_PWRAPPS_CHURN';

/**
 * Invoke the shared per-product codegen pipeline with the Power Apps deps bag.
 *
 * Resolution:
 *   - `specPath` = `<openapiDir>/openapi-pwrapps.yaml` (hand-authored OpenAPI
 *     3.0 fragment committed to the repo — no upstream download exists).
 *   - `snapshotPath` = `<rootDir>/bin/.last-pwrapps-snapshot.json`.
 *   - `churnPolicy` = 'permissive' — stable Power Platform surface per D-04.
 *   - `specUrl` = `null` — commits to the hand-authored-spec contract at the
 *     API boundary; the pipeline then throws if the spec is missing
 *     (T-5.1-03-c: silent catalog loss is impossible).
 *
 * Threat mitigations pinned by the deps bag (immutable from caller):
 *   - T-5.1-03-c: permissive churn guard fails regen on silent removal.
 *   - T-5.1-03-d: the spec's `servers:` is documentation-only; runtime
 *     dispatch (plan 5.1-06) reads `PRODUCT_AUDIENCES.get('pwrapps').baseUrl`
 *     instead — so a rogue edit to `servers:` cannot redirect live traffic.
 *   - T-5.1-03-e: hand-authored spec is <50 KB (19 ops); simplifier depth=3
 *     cap inherited from Phase 5 prevents OOM.
 *   - T-5.1-07 (from plan 05.1-01): `__pwrapps__` prefix literal is fixed
 *     here; a caller cannot smuggle a malformed prefix into codegen.
 *
 * @param {object} ctx
 * @param {string} ctx.openapiDir   Absolute path to `openapi/`.
 * @param {string} ctx.generatedDir Absolute path to `src/generated/`.
 * @param {string} ctx.rootDir      Project root; snapshot lives under `<rootDir>/bin/`.
 * @returns {Promise<{count: number, aliases: string[]}>}
 */
export async function runPowerAppsPipeline({ openapiDir, generatedDir, rootDir }) {
  const specPath = path.join(openapiDir, 'openapi-pwrapps.yaml');
  const snapshotPath = path.join(rootDir, 'bin', POWER_APPS_SNAPSHOT_NAME);

  return runProductPipeline({
    prefix: POWER_APPS_PREFIX,
    specUrl: null, // hand-authored spec; download step is skipped
    specPath,
    snapshotPath,
    churnPolicy: 'permissive',
    churnEnvName: POWER_APPS_CHURN_ENV,
    openapiDir,
    generatedDir,
  });
}

// Side-effect: register into the orchestrator's PRODUCT_PIPELINES on module
// load. Guarded against double-registration so a second `import` (e.g., from
// a test that calls `vi.resetModules()` then re-imports both the orchestrator
// and this product module) doesn't produce a duplicate entry.
if (!PRODUCT_PIPELINES.some((entry) => entry.name === 'pwrapps')) {
  PRODUCT_PIPELINES.push({ name: 'pwrapps', run: runPowerAppsPipeline });
}
