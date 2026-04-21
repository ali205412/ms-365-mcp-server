import path from 'path';
import { runProductPipeline } from './run-product-pipeline.mjs';
// Import from the leaf registry module (NOT the orchestrator) to avoid an
// ESM circular-import — the orchestrator imports this file for side effects,
// and its `export const PRODUCT_PIPELINES = []` line would otherwise be in
// the temporal dead zone when this module runs its registration push.
import { PRODUCT_PIPELINES } from './product-registry.mjs';

/**
 * Phase 5.1-02 — Power BI product generator.
 *
 * Thin wrapper around the shared `runProductPipeline` contract (plan 05.1-01)
 * that supplies the Power BI-specific deps bag: upstream spec URL, prefix,
 * snapshot path, and `permissive` churn policy per 05.1-CONTEXT D-04.
 *
 * Side effect on module load: registers `{name: 'powerbi', run: runPowerBIPipeline}`
 * into `PRODUCT_PIPELINES`. The registration is idempotent — importing the
 * module twice does NOT push a second entry (T-5.1-02-f mitigation).
 */

/**
 * Upstream Power BI OpenAPI spec URL. Pinned to microsoft/PowerBI-CSharp's
 * Swagger 2.0 definition — same source the official Power BI SDKs consume.
 * The committed `openapi/openapi-powerbi.yaml` is a redocly-bundled YAML
 * copy of this JSON so MS365_MCP_USE_SNAPSHOT=1 regens work offline.
 *
 * Security note (T-5.1-02-c): this URL is a static module-level constant,
 * NOT read from env. A tenant cannot steer codegen at a rogue spec URL.
 */
export const POWERBI_SPEC_URL =
  'https://raw.githubusercontent.com/microsoft/PowerBI-CSharp/master/sdk/swaggers/swagger.json';

/**
 * Grep-scannable namespace marker applied to every Power BI alias. Plan 5.1-06
 * dispatch-time routing uses the prefix to pick the Power BI audience
 * (`https://analysis.windows.net/powerbi/api/.default`) at request time, so
 * this literal MUST stay in sync with the product-audiences table there.
 */
export const POWERBI_PREFIX = '__powerbi__';

/**
 * Per-product churn-guard snapshot filename. Lives under `<rootDir>/bin/`
 * alongside `.last-beta-snapshot.json` and the other per-product snapshots.
 */
export const POWERBI_SNAPSHOT_NAME = '.last-powerbi-snapshot.json';

/**
 * Environment variable name that opts into accepting Power BI alias removal
 * at regen time. Permissive policy (D-04): additions are silent; removals
 * require `MS365_MCP_ACCEPT_POWERBI_CHURN=1` or the regen exits non-zero
 * with a bounded preview of removed aliases.
 */
export const POWERBI_CHURN_ENV = 'MS365_MCP_ACCEPT_POWERBI_CHURN';

/**
 * Invoke the shared per-product codegen pipeline with the Power BI deps bag.
 *
 * Resolution:
 *   - `specPath` = `<openapiDir>/openapi-powerbi.yaml` (pinned Swagger 2.0
 *     committed to the repo).
 *   - `snapshotPath` = `<rootDir>/bin/.last-powerbi-snapshot.json`.
 *   - `churnPolicy` = 'permissive' — stable Power Platform surface per D-04.
 *
 * Threat mitigations pinned by the deps bag (immutable from caller):
 *   - T-5.1-02-c: permissive churn guard fails regen on silent removal.
 *   - T-5.1-02-d: shared pipeline's collision guard blocks alias duplication.
 *   - T-5.1-07 (from plan 05.1-01): `__powerbi__` prefix literal is fixed
 *     here; a caller cannot smuggle a malformed prefix into codegen.
 *
 * @param {object} ctx
 * @param {string} ctx.openapiDir   Absolute path to `openapi/`.
 * @param {string} ctx.generatedDir Absolute path to `src/generated/`.
 * @param {string} ctx.rootDir      Project root; snapshot lives under `<rootDir>/bin/`.
 * @returns {Promise<{count: number, aliases: string[]}>}
 */
export async function runPowerBIPipeline({ openapiDir, generatedDir, rootDir }) {
  const specPath = path.join(openapiDir, 'openapi-powerbi.yaml');
  const snapshotPath = path.join(rootDir, 'bin', POWERBI_SNAPSHOT_NAME);

  return runProductPipeline({
    prefix: POWERBI_PREFIX,
    specUrl: POWERBI_SPEC_URL,
    specPath,
    snapshotPath,
    churnPolicy: 'permissive',
    churnEnvName: POWERBI_CHURN_ENV,
    openapiDir,
    generatedDir,
  });
}

// Side-effect: register into the orchestrator's PRODUCT_PIPELINES on module
// load. Guarded against double-registration so a second `import` (e.g., from
// a test that calls `vi.resetModules()` then re-imports both the orchestrator
// and the product module) doesn't produce a duplicate entry.
//
// T-5.1-02-f mitigation — idempotent push.
if (!PRODUCT_PIPELINES.some((entry) => entry.name === 'powerbi')) {
  PRODUCT_PIPELINES.push({ name: 'powerbi', run: runPowerBIPipeline });
}
