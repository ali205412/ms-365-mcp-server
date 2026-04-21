import path from 'path';
import { runProductPipeline } from './run-product-pipeline.mjs';
// Import from the leaf registry module (NOT the orchestrator) to avoid an
// ESM circular-import — the orchestrator imports this file for side effects,
// and its `export const PRODUCT_PIPELINES = []` line would otherwise be in
// the temporal dead zone when this module runs its registration push.
// (Pattern established by plan 05.1-02; product-registry.mjs is the leaf.)
import { PRODUCT_PIPELINES } from './product-registry.mjs';

/**
 * Phase 5.1-04 — Power Automate (Flow) product generator.
 *
 * Thin wrapper around the shared `runProductPipeline` contract (plan 05.1-01)
 * that supplies the Power Automate-specific deps bag: hand-authored spec
 * path (specUrl=null), `__pwrauto__` prefix, snapshot path, and `permissive`
 * churn policy per 05.1-CONTEXT D-04.
 *
 * Side effect on module load: registers `{name: 'pwrauto', run:
 * runPowerAutomatePipeline}` into `PRODUCT_PIPELINES`. The registration is
 * idempotent — importing the module twice does NOT push a second entry
 * (T-5.1-04-f mitigation; mirrors plan 05.1-02's T-5.1-02-f and plan
 * 05.1-03's T-5.1-03-f patterns).
 *
 * Flow DSL escape hatch (research §Spec Sources → Power Automate): the
 * Flow workflow definition JSON is a recursive expression language that
 * Zod cannot express without reimplementing Microsoft's Logic Apps DSL.
 * The hand-authored spec (`openapi/openapi-pwrauto.yaml`) therefore types
 * `Flow.properties.properties.definition` and
 * `Flow.properties.properties.connectionReferences` as
 * `{type: object, additionalProperties: true}`. `openapi-zod-client`
 * emits `z.record(z.any())` or `z.object({}).passthrough()` for this
 * shape (same pattern Phase 5 used for Graph `extensions` dynamic
 * properties). The gateway forwards opaque JSON to Microsoft's Flow
 * runtime; semantic validation happens there (T-5.1-04-d acceptance).
 *
 * Audience scope (plan 5.1-06 owns runtime dispatch): the Power Automate
 * audience is `https://service.flow.microsoft.com/.default`. Note that
 * paths may route through either `service.flow.microsoft.com` (canonical
 * management plane) or `api.flow.microsoft.com` (regional host); this
 * duality is resolved at dispatch time — codegen does not bake regional
 * hosts into the emitted client.
 */

/**
 * Grep-scannable namespace marker applied to every Power Automate alias.
 * Plan 5.1-06 dispatch-time routing uses the prefix to pick the Power
 * Automate audience (`https://service.flow.microsoft.com/.default` per
 * 05.1-CONTEXT D-05 table) at request time, so this literal MUST stay in
 * sync with the product-audiences table there.
 */
export const POWER_AUTOMATE_PREFIX = '__pwrauto__';

/**
 * Per-product churn-guard snapshot filename. Lives under `<rootDir>/bin/`
 * alongside `.last-beta-snapshot.json`, `.last-powerbi-snapshot.json`,
 * `.last-pwrapps-snapshot.json`, and the future per-product snapshots
 * (plans 5.1-05..06).
 */
export const POWER_AUTOMATE_SNAPSHOT_NAME = '.last-pwrauto-snapshot.json';

/**
 * Environment variable name that opts into accepting Power Automate alias
 * removal at regen time. Permissive policy (D-04): additions are silent;
 * removals require `MS365_MCP_ACCEPT_PWRAUTO_CHURN=1` or the regen exits
 * non-zero with a bounded preview of removed aliases.
 */
export const POWER_AUTOMATE_CHURN_ENV = 'MS365_MCP_ACCEPT_PWRAUTO_CHURN';

/**
 * Invoke the shared per-product codegen pipeline with the Power Automate
 * deps bag.
 *
 * Resolution:
 *   - `specPath` = `<openapiDir>/openapi-pwrauto.yaml` (hand-authored
 *     OpenAPI 3.0 fragment committed to the repo — no upstream download
 *     exists for Power Automate Flow management as of 2026-04-20).
 *   - `snapshotPath` = `<rootDir>/bin/.last-pwrauto-snapshot.json`.
 *   - `churnPolicy` = 'permissive' — stable Power Platform surface per D-04.
 *   - `specUrl` = `null` — commits to the hand-authored-spec contract at the
 *     API boundary; the pipeline throws if the spec is missing
 *     (T-5.1-04-c: silent catalog loss is impossible).
 *
 * Threat mitigations pinned by the deps bag (immutable from caller):
 *   - T-5.1-04-c: permissive churn guard fails regen on silent removal.
 *   - T-5.1-04-d: Flow DSL `definition` + `connectionReferences` are typed
 *     as open objects in the spec → z.record(z.any()) at codegen. Gateway
 *     forwards opaque JSON; Microsoft's Flow runtime owns semantic
 *     validation. Documented accept per research §Anti-Patterns.
 *   - T-5.1-04-e: hand-authored spec is <50 KB (20 ops); simplifier depth=3
 *     cap inherited from Phase 5 prevents OOM.
 *   - T-5.1-07 (from plan 05.1-01): `__pwrauto__` prefix literal is fixed
 *     here; a caller cannot smuggle a malformed prefix into codegen.
 *
 * @param {object} ctx
 * @param {string} ctx.openapiDir   Absolute path to `openapi/`.
 * @param {string} ctx.generatedDir Absolute path to `src/generated/`.
 * @param {string} ctx.rootDir      Project root; snapshot lives under `<rootDir>/bin/`.
 * @returns {Promise<{count: number, aliases: string[]}>}
 */
export async function runPowerAutomatePipeline({ openapiDir, generatedDir, rootDir }) {
  const specPath = path.join(openapiDir, 'openapi-pwrauto.yaml');
  const snapshotPath = path.join(rootDir, 'bin', POWER_AUTOMATE_SNAPSHOT_NAME);

  return runProductPipeline({
    prefix: POWER_AUTOMATE_PREFIX,
    specUrl: null, // hand-authored spec; download step is skipped
    specPath,
    snapshotPath,
    churnPolicy: 'permissive',
    churnEnvName: POWER_AUTOMATE_CHURN_ENV,
    openapiDir,
    generatedDir,
  });
}

// Side-effect: register into the orchestrator's PRODUCT_PIPELINES on module
// load. Guarded against double-registration so a second `import` (e.g., from
// a test that calls `vi.resetModules()` then re-imports both the orchestrator
// and this product module) doesn't produce a duplicate entry.
//
// T-5.1-04-f mitigation — idempotent push.
if (!PRODUCT_PIPELINES.some((entry) => entry.name === 'pwrauto')) {
  PRODUCT_PIPELINES.push({ name: 'pwrauto', run: runPowerAutomatePipeline });
}
