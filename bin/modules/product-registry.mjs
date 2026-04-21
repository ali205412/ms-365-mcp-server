/**
 * Phase 5.1 per-product pipeline registry module.
 *
 * Extracted from bin/generate-graph-client.mjs so the per-product modules
 * (bin/modules/power-bi.mjs and, in plans 5.1-03..06, pwrapps.mjs /
 * pwrauto.mjs / exo.mjs / sp-admin.mjs) can import the registry WITHOUT
 * creating a circular ESM dependency with the orchestrator.
 *
 * Why a separate module:
 *   bin/generate-graph-client.mjs imports each product module at top-of-file
 *   to trigger side-effect registration. If the registry lived IN the
 *   orchestrator, the product modules' `import { PRODUCT_PIPELINES } from
 *   '../generate-graph-client.mjs'` would encounter `PRODUCT_PIPELINES` in
 *   the ESM temporal dead zone (imports are hoisted but the `export const
 *   PRODUCT_PIPELINES = []` body runs AFTER the product imports complete).
 *
 *   Moving the registry to its own leaf module breaks the cycle: both the
 *   orchestrator and each product module import `PRODUCT_PIPELINES` from
 *   this file; neither depends on the other.
 *
 * Invariants enforced via the registry contract:
 *   - Sequential iteration only (step 4c). Parallel merge into
 *     `src/generated/client.ts` is UNSAFE — `mergeBetaFragmentIntoClient`
 *     reads + rewrites the same file.
 *   - Each product module guards against double-registration
 *     (T-5.1-02-f mitigation in power-bi.mjs's idempotent `push`).
 */

/**
 * Module-level registry of per-product codegen pipelines. Plans 5.1-02..06
 * each export a module under `bin/modules/` that side-effect-pushes a
 * `{name, run}` entry on first import.
 *
 * Entry shape:
 *   {
 *     name: string,
 *     run: async ({openapiDir, generatedDir, rootDir}) => Promise<{count, aliases}>
 *   }
 */
export const PRODUCT_PIPELINES = [];
