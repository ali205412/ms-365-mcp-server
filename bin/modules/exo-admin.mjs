import path from 'path';
import { runProductPipeline } from './run-product-pipeline.mjs';
// Import from the leaf registry module (NOT the orchestrator) to avoid an
// ESM circular-import — the orchestrator imports this file for side effects,
// and its `export const PRODUCT_PIPELINES = []` line would otherwise be in
// the temporal dead zone when this module runs its registration push.
// (Pattern established by plan 05.1-02; product-registry.mjs is the leaf.)
import { PRODUCT_PIPELINES } from './product-registry.mjs';

/**
 * Phase 5.1-05 — Exchange Online Admin REST v2 product generator.
 *
 * Thin wrapper around the shared `runProductPipeline` contract (plan 05.1-01)
 * that supplies the Exchange Admin-specific deps bag: hand-authored spec
 * path (specUrl=null), `__exo__` prefix, snapshot path, and `strict` churn
 * policy per 05.1-CONTEXT D-04.
 *
 * Side effect on module load: registers `{name: 'exo', run: runExoAdminPipeline}`
 * into `PRODUCT_PIPELINES`. The registration is idempotent — importing the
 * module twice does NOT push a second entry (mirrors plan 05.1-02's
 * T-5.1-02-f, 05.1-03's T-5.1-03-f, and 05.1-04's T-5.1-04-f patterns).
 *
 * Surface scope — 10 cmdlets across 6 public-preview REST v2 endpoints per
 * admin-api-endpoints-reference (VERIFIED 2026-04-20):
 *   - /OrganizationConfig (get-organization-config)
 *   - /AcceptedDomain (get-accepted-domain)
 *   - /Mailbox (get-mailbox, set-mailbox)
 *   - /MailboxFolderPermission (get/add/set/remove-mailbox-folder-permission)
 *   - /DistributionGroupMember (get-distribution-group-member)
 *   - /DynamicDistributionGroupMember (get-dynamic-distribution-group-member)
 *
 * Cmdlets NOT in REST v2 are catalogued in
 * `.planning/research/GAP-EXCHANGE-ADMIN.md` (~240 cmdlets — future-backlog).
 *
 * STRICT churn policy (D-04): ANY alias delta (addition OR removal) fails
 * codegen without `MS365_MCP_ACCEPT_EXO_CHURN=1`. Distinguished from Power
 * BI/Apps/Automate's permissive policy because the REST v2 surface is public
 * preview — silent upstream additions can introduce new auth scopes,
 * X-AnchorMailbox rules, or CmdletInput shapes that break existing tools.
 * Operators explicitly opt into every spec bump by setting the env var and
 * updating `openapi-exo.yaml`.
 *
 * CmdletInput envelope (plan 5.1-06 owns dispatch-layer wiring): POST/PUT
 * bodies follow Microsoft's `{CmdletInput:{CmdletName:<cmd>,Parameters:{...}}}`
 * shape — NOT native OData. The hand-authored spec models this envelope
 * shape in `components.requestBodies.CmdletInputBody`; plan 5.1-06 dispatch
 * validates caller-supplied CmdletName matches the operation's expected
 * cmdlet (T-5.1-05-e mitigation against cmdlet-smuggling).
 *
 * X-AnchorMailbox routing (plan 5.1-06 owns dispatch-layer wiring): every
 * operation declares the header as REQUIRED with regex pattern validating
 * the two valid shapes. Delegated flows inject `AAD-UPN:<caller UPN>`;
 * app-only global endpoints inject the system-mailbox constant
 * `APP:SystemMailbox{bb558c35-97f1-4cb9-8ff7-d53741dc928c}@<tenantDomain>`.
 *
 * Tenant URL substitution (plan 5.1-06 owns the Zod guard): the base URL
 * `https://outlook.office365.com/adminapi/beta/{tenantId}` has `{tenantId}`
 * substituted at dispatch. Plan 5.1-06 validates tenantId against
 * `/^[0-9a-f-]{1,36}$/i` (UUID shape) BEFORE substitution — T-5.1-05-f
 * mitigation against path-traversal / header-injection.
 *
 * Cloud parametrization (plan 5.1-06 owns cloud-config.ts extension): base
 * URL varies by cloud (commercial / GCC / GCC High / DoD / China). Spec
 * commits commercial / GCC URL; plan 5.1-06 extends
 * `src/cloud-config.ts` with `exchangeAdminBaseUrl` for the remaining
 * clouds. Not a codegen concern.
 *
 * Audience scope (plan 5.1-06 owns runtime dispatch): Exchange Admin audience
 * is `https://outlook.office365.com/.default`. App-only scope
 * `Exchange.ManageAsAppV2`; delegated scope `Exchange.ManageV2`.
 *
 * @odata.nextLink expiry (research Pitfall 10): Exchange pagination tokens
 * expire in 5-10 minutes. Phase-2 PageIterator (MWARE-04) must eagerly
 * fetch; per-tool `llmTip` should surface this for __exo__ ops. Plan
 * 5.1-06 wires `retryHandler: 'exo'` in PRODUCT_AUDIENCES.
 */

/**
 * Grep-scannable namespace marker applied to every Exchange Admin alias.
 * Plan 5.1-06 dispatch-time routing uses the prefix to pick the Exchange
 * audience (`https://outlook.office365.com/.default` per 05.1-CONTEXT D-05
 * table) at request time, so this literal MUST stay in sync with the
 * product-audiences table there.
 */
export const EXO_PREFIX = '__exo__';

/**
 * Per-product churn-guard snapshot filename. Lives under `<rootDir>/bin/`
 * alongside `.last-beta-snapshot.json`, `.last-powerbi-snapshot.json`,
 * `.last-pwrapps-snapshot.json`, `.last-pwrauto-snapshot.json`, and the
 * future `.last-spadmin-snapshot.json` (plan 5.1-06).
 */
export const EXO_SNAPSHOT_NAME = '.last-exo-snapshot.json';

/**
 * Environment variable name that opts into accepting Exchange Admin alias
 * churn at regen time. STRICT policy (D-04): ANY delta (addition OR
 * removal) requires `MS365_MCP_ACCEPT_EXO_CHURN=1` or the regen exits
 * non-zero with a bounded preview of removed + added aliases. Matches the
 * preview-API maturity stance — silent additions can blow the alias set.
 */
export const EXO_CHURN_ENV = 'MS365_MCP_ACCEPT_EXO_CHURN';

/**
 * Invoke the shared per-product codegen pipeline with the Exchange Admin
 * deps bag.
 *
 * Resolution:
 *   - `specPath` = `<openapiDir>/openapi-exo.yaml` (hand-authored OpenAPI
 *     3.0 fragment committed to the repo — no upstream download exists for
 *     Exchange REST v2 as of 2026-04-20).
 *   - `snapshotPath` = `<rootDir>/bin/.last-exo-snapshot.json`.
 *   - `churnPolicy` = 'strict' — public-preview surface per D-04.
 *   - `specUrl` = `null` — commits to the hand-authored-spec contract at the
 *     API boundary; the pipeline throws if the spec is missing
 *     (T-5.1-05-c: silent catalog loss is impossible).
 *
 * Threat mitigations pinned by the deps bag (immutable from caller):
 *   - T-5.1-05-c: strict churn guard fails regen on silent addition OR
 *     removal. No spec bump slips in without operator acknowledgment.
 *   - T-5.1-05-d: X-AnchorMailbox emitted at codegen as a required header
 *     parameter; dispatch (plan 5.1-06) cannot omit the routing header
 *     without a Zod validation failure at caller-surface time.
 *   - T-5.1-05-e: CmdletInput envelope emitted at codegen; dispatch cannot
 *     construct malformed bodies. CmdletName per-op validation owned by
 *     plan 5.1-06.
 *   - T-5.1-05-f: tenantId Zod regex `/^[0-9a-f-]{1,36}$/i` documented in
 *     the spec's servers.variables.tenantId.description; plan 5.1-06
 *     enforces at dispatch before URL substitution.
 *   - T-5.1-05-g: Exchange @odata.nextLink 5-10min expiry flagged in spec
 *     header — Phase-2 PageIterator (MWARE-04) must eagerly fetch for
 *     __exo__ ops.
 *   - T-5.1-07 (from plan 05.1-01): `__exo__` prefix literal is fixed
 *     here; a caller cannot smuggle a malformed prefix into codegen.
 *
 * @param {object} ctx
 * @param {string} ctx.openapiDir   Absolute path to `openapi/`.
 * @param {string} ctx.generatedDir Absolute path to `src/generated/`.
 * @param {string} ctx.rootDir      Project root; snapshot lives under `<rootDir>/bin/`.
 * @returns {Promise<{count: number, aliases: string[]}>}
 */
export async function runExoAdminPipeline({ openapiDir, generatedDir, rootDir }) {
  const specPath = path.join(openapiDir, 'openapi-exo.yaml');
  const snapshotPath = path.join(rootDir, 'bin', EXO_SNAPSHOT_NAME);

  return runProductPipeline({
    prefix: EXO_PREFIX,
    specUrl: null, // hand-authored spec; download step is skipped
    specPath,
    snapshotPath,
    churnPolicy: 'strict',
    churnEnvName: EXO_CHURN_ENV,
    openapiDir,
    generatedDir,
  });
}

// Side-effect: register into the orchestrator's PRODUCT_PIPELINES on module
// load. Guarded against double-registration so a second `import` (e.g., from
// a test that calls `vi.resetModules()` then re-imports both the orchestrator
// and this product module) doesn't produce a duplicate entry.
//
// Idempotency mitigation (same pattern as T-5.1-02-f / T-5.1-03-f / T-5.1-04-f).
if (!PRODUCT_PIPELINES.some((entry) => entry.name === 'exo')) {
  PRODUCT_PIPELINES.push({ name: 'exo', run: runExoAdminPipeline });
}
