import path from 'path';
import { runProductPipeline } from './run-product-pipeline.mjs';
// Import from the leaf registry module (NOT the orchestrator) to avoid an
// ESM circular-import — the orchestrator imports this file for side effects,
// and its `export const PRODUCT_PIPELINES = []` line would otherwise be in
// the temporal dead zone when this module runs its registration push.
// (Pattern established by plan 05.1-02; product-registry.mjs is the leaf.)
import { PRODUCT_PIPELINES } from './product-registry.mjs';

/**
 * Phase 5.1-06 — SharePoint Tenant Admin product generator.
 *
 * Thin wrapper around the shared `runProductPipeline` contract (plan 05.1-01)
 * that supplies the SharePoint Admin-specific deps bag: hand-authored spec
 * path (specUrl=null), `__spadmin__` prefix, snapshot path, and `strict`
 * churn policy per 05.1-CONTEXT D-04.
 *
 * Side effect on module load: registers `{name: 'sp-admin', run:
 * runSpAdminPipeline}` into `PRODUCT_PIPELINES`. The registration is
 * idempotent — importing the module twice does NOT push a second entry
 * (mirrors plan 05.1-02/03/04/05 T-5.1-0X-f patterns).
 *
 * NAMING NOTE: the product enum uses a dash (`sp-admin`) while the alias
 * prefix omits it (`__spadmin__`). The distinction is intentional:
 *   - `sp-admin` is the Product enum member + PRODUCT_AUDIENCES map key +
 *     the `name` field inside PRODUCT_PIPELINES. Dashes are idiomatic for
 *     enum members (per 05.1-CONTEXT D-03's admin selector naming).
 *   - `__spadmin__` is the grep-scannable namespace marker applied to
 *     emitted aliases. Must be a `__<snake_alpha>__` literal per
 *     VALID_PREFIX_RE in run-product-pipeline.mjs — dashes would violate
 *     that regex and cause codegen to throw at plan 05.1-01 step 4c.
 * Keeping the two separate avoids a runtime alias-literal-contains-dash
 * surprise; tests pin both shapes (plan 5.1-06 Task 1 Test 6 + Task 2).
 *
 * Surface scope — 15 flagship SharePoint Tenant Admin REST operations across
 * site-collection, external-sharing, storage, and tenant-settings workflows
 * (VERIFIED 2026-04-20 against learn.microsoft.com/en-us/sharepoint/dev/ +
 * PnP.PowerShell SPO cmdlets):
 *
 *   Site-collection management:
 *     - list-sites              (GET  /GetSiteProperties)
 *     - get-site                (GET  /Sites/GetPropertiesByUrl)
 *     - set-site                (POST /Sites/SetSiteProperties)
 *     - remove-deleted-site     (POST /RemoveDeletedSite)
 *   Site-collection admins:
 *     - list-site-collection-admins   (GET  /GetSiteAdministrators)
 *     - add-site-collection-admin     (POST /SetSiteAdmin)
 *     - remove-site-collection-admin  (POST /RemoveSiteAdmin)
 *   Tenant settings:
 *     - get-tenant-info               (GET  /GetTenantInfo)
 *     - get-tenant-settings           (GET  /)
 *     - set-tenant-settings           (POST /SetTenantSettings)
 *     - set-sharing-capability        (POST /SetSharingCapability)
 *   External users:
 *     - list-external-users           (GET  /GetExternalUsers)
 *     - remove-external-user          (POST /RemoveExternalUser)
 *   Storage:
 *     - get-site-storage-used         (GET  /Sites/GetSiteStorageUsed)
 *     - set-site-storage-quota        (POST /Sites/SetStorageQuota)
 *
 * STRICT churn policy (D-04): ANY alias delta (addition OR removal) fails
 * codegen without `MS365_MCP_ACCEPT_SPADMIN_CHURN=1`. Distinguished from
 * Power BI/Apps/Automate's permissive policy because Microsoft ships
 * SharePoint admin REST updates via narrative docs pages and PnP.PowerShell
 * releases without OpenAPI changelogs. Silent additions could introduce new
 * scope requirements or body shapes that break existing tools.
 *
 * Base URL template (plan 5.1-06 dispatch-layer substitution):
 *   https://{sharepoint_domain}-admin.sharepoint.com/_api/SPO.TenantAdministrationOffice365Tenant
 * `sharepoint_domain` is a single-label hostname (e.g., `contoso`) stored
 * on the `tenants.sharepoint_domain` column (migration 20260801000000).
 * Dispatch validates the value against Zod `/^[a-z0-9-]{1,63}$/` BEFORE
 * URL substitution AND before scope construction (T-5.1-06-c mitigation,
 * defense-in-depth against compromised admin API key or SQL injection).
 *
 * Absent sharepoint_domain → structured MCP tool error
 * 'sp_admin_not_configured' directing operator to PATCH
 * /admin/tenants/{id} with {sharepoint_domain: "<single-label-hostname>"}.
 *
 * Audience scope (plan 5.1-06 runtime dispatch):
 *   `https://{sharepoint_domain}-admin.sharepoint.com/.default`
 * Tenant-specific — MSAL mints a fresh token for the computed scope;
 * composite cache key `${tenantId}:sp-admin` prevents cross-tenant leak
 * (T-5.1-06-b mitigation).
 *
 * Admin consent + RBAC: Sites.FullControl.All (or equivalent) + Global
 * Admin or SharePoint Admin role. App-only flows require Client ID +
 * Certificate (NOT secret) per Microsoft docs — documented operator
 * pre-flight constraint (not enforced by this codegen layer).
 *
 * Out of scope for Phase 5.1:
 *   - CSOM ProcessQuery (XML POST to /_vti_bin/client.svc/ProcessQuery) —
 *     REST-only for this generator.
 *   - Per-site admin operations not surfaced through the tenant-admin
 *     endpoint — those live under Graph /sites/{site-id} (already covered
 *     by the v1 Graph catalog).
 */

/**
 * Grep-scannable namespace marker applied to every SharePoint Admin alias.
 * Plan 5.1-06 dispatch-time routing uses the prefix to pick the SP Admin
 * audience (the computed `https://{sharepoint_domain}-admin.sharepoint.com/.default`
 * per 05.1-CONTEXT D-05 table) at request time, so this literal MUST stay
 * in sync with the product-audiences table in src/lib/auth/products.ts
 * (see the PRODUCT_AUDIENCES['sp-admin'].prefix entry).
 */
export const SP_ADMIN_PREFIX = '__spadmin__';

/**
 * Per-product churn-guard snapshot filename. Lives under `<rootDir>/bin/`
 * alongside `.last-beta-snapshot.json`, `.last-powerbi-snapshot.json`,
 * `.last-pwrapps-snapshot.json`, `.last-pwrauto-snapshot.json`, and
 * `.last-exo-snapshot.json`. Fresh checkouts ship with a committed empty
 * baseline so the first regen doesn't emit a "missing snapshot" stderr.
 */
export const SP_ADMIN_SNAPSHOT_NAME = '.last-spadmin-snapshot.json';

/**
 * Environment variable name that opts into accepting SharePoint Admin alias
 * churn at regen time. STRICT policy (D-04): ANY delta (addition OR removal)
 * requires `MS365_MCP_ACCEPT_SPADMIN_CHURN=1` or the regen exits non-zero
 * with a bounded preview of removed + added aliases (5 of each from the
 * run-product-pipeline strict preview). Matches the preview-API maturity
 * stance — silent additions can blow the alias set.
 */
export const SP_ADMIN_CHURN_ENV = 'MS365_MCP_ACCEPT_SPADMIN_CHURN';

/**
 * Invoke the shared per-product codegen pipeline with the SharePoint Admin
 * deps bag.
 *
 * Resolution:
 *   - `specPath` = `<openapiDir>/openapi-spadmin.yaml` (hand-authored
 *     OpenAPI 3.0 fragment committed to the repo — no upstream download
 *     exists for SharePoint tenant admin REST as of 2026-04-20).
 *   - `snapshotPath` = `<rootDir>/bin/.last-spadmin-snapshot.json`.
 *   - `churnPolicy` = 'strict' — narrative-docs surface per D-04.
 *   - `specUrl` = `null` — commits to the hand-authored-spec contract at the
 *     API boundary; the pipeline throws if the spec is missing
 *     (silent catalog loss is impossible).
 *
 * Threat mitigations pinned by the deps bag (immutable from caller):
 *   - T-5.1-06-d (alias collision across products): shared pipeline's
 *     collision guard runs AFTER prefix injection, ensuring no two products
 *     emit overlapping prefixed aliases. `__spadmin__` is alpha-unique.
 *   - Strict churn: silent upstream additions or removals fail regen until
 *     operator acknowledges via the env var.
 *   - T-5.1-07 (from plan 05.1-01): `__spadmin__` prefix literal is fixed
 *     here; a caller cannot smuggle a malformed prefix into codegen.
 *
 * @param {object} ctx
 * @param {string} ctx.openapiDir   Absolute path to `openapi/`.
 * @param {string} ctx.generatedDir Absolute path to `src/generated/`.
 * @param {string} ctx.rootDir      Project root; snapshot lives under `<rootDir>/bin/`.
 * @returns {Promise<{count: number, aliases: string[]}>}
 */
export async function runSpAdminPipeline({ openapiDir, generatedDir, rootDir }) {
  const specPath = path.join(openapiDir, 'openapi-spadmin.yaml');
  const snapshotPath = path.join(rootDir, 'bin', SP_ADMIN_SNAPSHOT_NAME);

  return runProductPipeline({
    prefix: SP_ADMIN_PREFIX,
    specUrl: null, // hand-authored spec; download step is skipped
    specPath,
    snapshotPath,
    churnPolicy: 'strict',
    churnEnvName: SP_ADMIN_CHURN_ENV,
    openapiDir,
    generatedDir,
  });
}

// Side-effect: register into the orchestrator's PRODUCT_PIPELINES on module
// load. Guarded against double-registration so a second `import` (e.g., from
// a test that calls `vi.resetModules()` then re-imports both the orchestrator
// and this product module) doesn't produce a duplicate entry.
//
// Idempotency mitigation (same pattern as T-5.1-02-f / T-5.1-03-f / T-5.1-04-f /
// plan 05.1-05's idempotent exo registration).
if (!PRODUCT_PIPELINES.some((entry) => entry.name === 'sp-admin')) {
  PRODUCT_PIPELINES.push({ name: 'sp-admin', run: runSpAdminPipeline });
}
