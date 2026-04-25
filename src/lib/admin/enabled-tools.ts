/**
 * Admin PATCH /admin/tenants/:id/enabled-tools (plan 05-07, COVRG-04, D-21).
 *
 * Clone of src/lib/admin/tenants.ts PATCH pattern with 05-07-specific
 * extensions:
 *   - Zod body: {add?, remove?, set?} with a `.refine` mutual-exclusion
 *     check (exactly one key per call).
 *   - Selector validation against the generated tool registry via
 *     validateSelectors (Plan 05-04) — Levenshtein suggestions on miss.
 *     Runs BEFORE the transaction opens so invalid input never touches the
 *     DB.
 *   - Transactional UPDATE tenants.enabled_tools + writeAudit in one
 *     Postgres txn (same pattern as tenants.ts PATCH /:id).
 *   - Post-commit publish on Redis channel `mcp:tool-selection-invalidate`
 *     via publishToolSelectionInvalidation (Plan 05-06). Redis publish
 *     failure logs warn + continues — TTL fallback is the safety net.
 *   - Response 200 with the updated tenant row (read-back through
 *     deps.pgPool + tenantRowToWire from tenants.ts).
 *
 * Phase 5.1 extension (plan 05.1-08, D-04):
 *   - Audit meta gains a `product` discriminator when selectors target a
 *     Phase 5.1 product (via `__<product>__` alias prefix, `<product>:*`
 *     workload selector, or `preset:<product>-essentials` preset name).
 *     Operators query `meta->>'product' = 'powerbi'` to enumerate all
 *     PBI-scoped mutations across the audit trail. Returns 'mixed' when
 *     two or more products appear in the same PATCH, or null for
 *     Graph-only mutations. The raw selector text still NEVER lands in
 *     meta (T-05-17 redaction); only the product discriminator.
 *
 * Auth: reuses the Phase 4 dual-stack middleware (req.admin populated by
 * createAdminAuthMiddleware at router mount).
 *
 * RBAC: reuses the same canActOnTenant decision as tenants.ts — tenant-
 * scoped admin may only act on their own tenant; cross-tenant access is
 * denied with 404 (information hiding per D-13).
 *
 * Redaction (D-01, T-05-07c / T-05-17): the raw enabled_tools text never
 * lands in audit_log.meta or in pino info logs. Audit meta carries only
 * {before_length, after_length, operation, product} — categorical fields
 * safe for grep + retention. Operators greping `action = 'admin.tenant.
 * enabled-tools-change' AND tenant_id = $X` get the full change history
 * without seeing the selector strings themselves.
 *
 * Threat dispositions (plan 05-07 <threat_model> + plan 05.1-08):
 *   - T-05-15 (PATCH body shape tampering): Zod `.refine` exactly-one gate.
 *   - T-05-16 (cross-tenant PATCH): canActOnTenant RBAC + 404 on deny.
 *   - T-05-17 (selector text in audit/logs): meta carries length+operation
 *     +product only; pino info log carries {tenantId, actor, operation}.
 *   - T-05-18 (DoS via huge PATCH): array max=500, selector max=256 chars,
 *     set max=16384 chars via Zod — Levenshtein cost bounded.
 *   - T-5.1-08-e (audit blind-spot for product mutations): meta.product
 *     discriminator enables per-product audit queries. Mitigated by
 *     inferProductFromSelectors below.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTransaction } from '../postgres.js';
import { writeAudit } from '../audit.js';
import { publishToolSelectionInvalidation } from '../tool-selection/tool-selection-invalidation.js';
import {
  publishResourcesListChanged,
  publishToolsListChanged,
} from '../mcp-notifications/events.js';
import { validateSelectors } from '../tool-selection/registry-validator.js';
import { parseSelectorList } from '../tool-selection/selector-ast.js';
import {
  problemBadRequest,
  problemInternal,
  problemNotFound,
  problemJson,
} from './problem-json.js';
import { tenantRowToWire } from './tenants.js';
import type { AdminRouterDeps } from './router.js';
import logger from '../../logger.js';

/**
 * Same GUID regex as src/lib/admin/tenants.ts — copied verbatim to keep the
 * tenant-id validation surface consistent across /admin/tenants endpoints.
 */
const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin identity attached by the dual-stack middleware (plan 04-04). Local
 * shape mirrors the one in tenants.ts to avoid a cross-module import of an
 * internal interface.
 */
interface AdminContext {
  actor: string;
  source: 'entra' | 'api-key';
  tenantScoped: string | null;
}

// Express 5's IRouterMatcher infers P from the path literal. Using
// `Request<any, any, any, any>` sidesteps the overload mismatch for custom
// handler signatures; admin.* and req.id are declaration-merged globally in
// src/lib/admin/auth/dual-stack.ts, so RequestWithAdmin stays a thin alias.
type RequestWithAdmin = Request<any, any, any, any>;

/**
 * RBAC decision: true iff `admin` is allowed to act on `tenantId`. Global
 * admin (tenantScoped=null) always allowed; tenant-scoped admin matches on
 * its scope id. Keeps the Phase 4 cross-tenant denial semantics intact.
 */
function canActOnTenant(admin: AdminContext, tenantId: string): boolean {
  if (admin.tenantScoped === null) return true;
  return admin.tenantScoped === tenantId;
}

/**
 * Wire schema for PATCH body. Exactly one of `add` / `remove` / `set`
 * must be present per call — enforced via `.refine`.
 *
 * Bounds (T-05-18 DoS defense):
 *   - Array max 500 entries × max 256 chars per selector.
 *   - `set` string max 16384 chars (matches registry-validator Zod guard
 *     scaled by typical operator-authored selector string length).
 * `set` may be null to explicitly reset to NULL (preset default); empty
 * string is treated identically for operator ergonomics.
 */
const EnabledToolsPatchZod = z
  .object({
    add: z.array(z.string().min(1).max(256)).max(500).optional(),
    remove: z.array(z.string().min(1).max(256)).max(500).optional(),
    set: z.string().max(16384).optional().nullable(),
  })
  .refine(
    (v) =>
      [v.add !== undefined, v.remove !== undefined, v.set !== undefined].filter(Boolean).length ===
      1,
    { message: 'Exactly one of add, remove, set must be provided' }
  );

type PatchBody = z.infer<typeof EnabledToolsPatchZod>;

/**
 * Compute the new enabled_tools text from the existing value + the patch
 * operation. Pure function — easy to unit-test; used inside the txn after
 * the SELECT FOR UPDATE returns the current row.
 *
 * Semantics:
 *   - `set`: explicit replacement. Empty string or null → NULL (reverts to
 *     preset default per D-19 / D-20). Any other string → verbatim.
 *   - `add`: append to existing CSV; dedup while preserving insertion order.
 *     Empty final result → NULL (consistent with `set: ''` semantics).
 *   - `remove`: drop listed selectors from existing CSV. Empty result → NULL.
 *
 * Returning NULL on empty intentionally — a tenant with no enabled_tools
 * row resolves via the preset path (loadTenant + enabled-tools-parser).
 * An explicit empty-string row would disable ALL tools, which is never the
 * intent of a patch that emptied the list.
 */
function computeNewEnabledTools(before: string | null, patch: PatchBody): string | null {
  if (patch.set !== undefined) {
    return patch.set === '' || patch.set === null ? null : patch.set;
  }
  const existing = (before ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (patch.add !== undefined) {
    const merged = [...new Set([...existing, ...patch.add])];
    return merged.length === 0 ? null : merged.join(',');
  }
  if (patch.remove !== undefined) {
    const removeSet = new Set(patch.remove);
    const filtered = existing.filter((s) => !removeSet.has(s));
    return filtered.length === 0 ? null : filtered.join(',');
  }
  return before;
}

/**
 * Extract the flat list of selector strings to validate against the
 * registry. For `set` mode we run the full `parseSelectorList` grammar
 * first so grammar violations (`;` separator, illegal chars) surface as
 * 400 before we bother with Levenshtein + DB work. For `add` / `remove`
 * the caller already supplies a flat array, and validateSelectors's
 * internal join+re-parse is cheap.
 *
 * Returns null + writes a 400 response when the AST rejects the input.
 */
function extractSelectorsForValidation(
  patch: PatchBody,
  res: Response,
  instance: string | undefined
): string[] | null {
  try {
    if (patch.add !== undefined) return patch.add;
    if (patch.remove !== undefined) return patch.remove;
    const setStr = patch.set ?? '';
    if (setStr === '') return [];
    return parseSelectorList(setStr).map((s) => s.raw);
  } catch (err) {
    problemBadRequest(res, `Selector parse error: ${(err as Error).message}`, instance);
    return null;
  }
}

/**
 * Phase 5.1 audit discriminator (plan 05.1-08, T-5.1-08-e).
 *
 * Scans the mutation's selector list for Phase 5.1 product references via
 * any of three shapes:
 *   1. `__<product>__` alias prefix (e.g. `__powerbi__GroupsGetGroups`)
 *   2. `<product>:*` workload selector (e.g. `powerbi:*`, `sp-admin:*`)
 *   3. `preset:<product>-essentials` preset name (e.g. `preset:powerbi-essentials`)
 *
 * Returns the matched product name when exactly one product is present
 * across the entire PATCH, `'mixed'` when two or more products appear
 * (so operators know to disambiguate), or `null` when every selector
 * targets Graph / cross-product surface.
 *
 * Discriminator lives in `audit_log.meta.product` (NOT raw selector text,
 * per T-05-17 redaction) so per-product audit queries are first-class:
 *   SELECT * FROM audit_log
 *   WHERE action = 'admin.tenant.enabled-tools-change'
 *     AND meta->>'product' = 'powerbi';
 *
 * Pure function — no side effects; cheap O(n*5) with n=selectors, 5=products.
 * The 3-map shape below matches the audit-meta contract 1:1 with
 * PRODUCT_AUDIENCES (src/lib/auth/products.ts) and PRODUCT_POLICIES
 * (bin/modules/coverage-check.mjs) so all three surfaces agree on the
 * product set. A future product addition MUST update all three maps.
 */
const PRODUCT_PREFIX_MAP: Record<string, string> = {
  __powerbi__: 'powerbi',
  __pwrapps__: 'pwrapps',
  __pwrauto__: 'pwrauto',
  __exo__: 'exo',
  __spadmin__: 'sp-admin',
};
const PRODUCT_PRESET_MAP: Record<string, string> = {
  'preset:powerbi-essentials': 'powerbi',
  'preset:pwrapps-essentials': 'pwrapps',
  'preset:pwrauto-essentials': 'pwrauto',
  'preset:exo-essentials': 'exo',
  'preset:sp-admin-essentials': 'sp-admin',
};
const PRODUCT_WORKLOAD_MAP: Record<string, string> = {
  'powerbi:*': 'powerbi',
  'pwrapps:*': 'pwrapps',
  'pwrauto:*': 'pwrauto',
  'exo:*': 'exo',
  'sp-admin:*': 'sp-admin',
};

export function inferProductFromSelectors(selectors: string[]): string | null {
  const found = new Set<string>();
  for (const raw of selectors) {
    const s = raw.startsWith('+') ? raw.slice(1) : raw;
    // Workload selector (e.g., 'powerbi:*')
    if (PRODUCT_WORKLOAD_MAP[s]) {
      found.add(PRODUCT_WORKLOAD_MAP[s]);
      continue;
    }
    // Preset selector (e.g., 'preset:powerbi-essentials')
    if (PRODUCT_PRESET_MAP[s]) {
      found.add(PRODUCT_PRESET_MAP[s]);
      continue;
    }
    // Alias prefix (e.g., '__powerbi__GroupsGetGroups') — iterate the 5-entry
    // map; prefixes are alpha-unique so the first match is definitive.
    for (const prefix of Object.keys(PRODUCT_PREFIX_MAP)) {
      if (s.startsWith(prefix)) {
        found.add(PRODUCT_PREFIX_MAP[prefix]);
        break;
      }
    }
  }
  if (found.size === 0) return null;
  if (found.size === 1) return [...found][0];
  return 'mixed';
}

/**
 * Build the /admin/tenants/:id/enabled-tools sub-router. Mounted on the
 * SAME `/tenants` base as createTenantsRoutes — Express composes routers
 * by path+method pattern, so the longer-suffix match (`/:id/enabled-tools`)
 * is picked over the `/:id` PATCH handler in tenants.ts. Verified with
 * integration tests.
 */
export function createEnabledToolsRoutes(deps: AdminRouterDeps): Router {
  const r = Router();

  r.patch('/:id/enabled-tools', async (req: RequestWithAdmin, res: Response) => {
    const admin = req.admin;
    if (!admin) {
      problemInternal(res, req.id);
      return;
    }

    const id = req.params.id;
    if (!TENANT_GUID.test(id)) {
      problemNotFound(res, 'tenant', req.id);
      return;
    }
    if (!canActOnTenant(admin, id)) {
      // Cross-tenant access: 404 (information hiding per D-13) rather than 403.
      problemNotFound(res, 'tenant', req.id);
      return;
    }

    const parsed = EnabledToolsPatchZod.safeParse(req.body);
    if (!parsed.success) {
      problemBadRequest(res, parsed.error.issues.map((e) => e.message).join('; '), req.id);
      return;
    }
    const patch = parsed.data;

    const selectorsToValidate = extractSelectorsForValidation(patch, res, req.id);
    if (selectorsToValidate === null) return; // 400 already written

    // Registry validation runs BEFORE the transaction opens so invalid input
    // never locks a row or wastes a COMMIT. Empty set skips validation for
    // the `{set: ''}` → NULL path; set of selectors is checked against the
    // registry with Levenshtein-ranked suggestions on miss.
    if (selectorsToValidate.length > 0) {
      const validation = validateSelectors(selectorsToValidate);
      if (!validation.ok) {
        problemJson(res, 400, 'unknown_selector', {
          title: 'Unknown selector',
          detail: 'one or more selectors do not match the registry',
          instance: req.id,
          extensions: {
            invalid: validation.invalid,
            suggestions: validation.suggestions,
          },
        });
        return;
      }
    }

    const operation: 'add' | 'remove' | 'set' =
      patch.add !== undefined ? 'add' : patch.remove !== undefined ? 'remove' : 'set';

    // Phase 5.1 audit discriminator (T-5.1-08-e). Computed once outside
    // the txn so the value is stable across retries and visible in logs
    // on audit-write failure.
    const product = inferProductFromSelectors(selectorsToValidate);

    let existed = true;
    let beforeText: string | null = null;
    let afterText: string | null = null;

    try {
      await withTransaction(async (client) => {
        const sel = await client.query<{ id: string; enabled_tools: string | null }>(
          `SELECT id, enabled_tools FROM tenants WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (sel.rows.length === 0) {
          existed = false;
          return;
        }
        beforeText = sel.rows[0].enabled_tools;
        afterText = computeNewEnabledTools(beforeText, patch);

        await client.query(
          `UPDATE tenants SET enabled_tools = $1, updated_at = NOW() WHERE id = $2`,
          [afterText, id]
        );

        await writeAudit(client, {
          tenantId: id,
          actor: admin.actor,
          action: 'admin.tenant.enabled-tools-change',
          target: id,
          ip: req.ip ?? null,
          requestId: req.id ?? 'unknown',
          result: 'success',
          meta: {
            before_length: beforeText?.length ?? 0,
            after_length: afterText?.length ?? 0,
            operation,
            product,
          },
        });
      });
    } catch (err) {
      logger.error(
        { err: (err as Error).message, tenantId: id },
        'admin-enabled-tools: patch transaction failed'
      );
      problemInternal(res, req.id);
      return;
    }

    if (!existed) {
      problemNotFound(res, 'tenant', req.id);
      return;
    }

    // Post-commit invalidation publish. NEVER run inside the txn — pub/sub
    // is side-effectful and we want the COMMIT to be the durable anchor.
    // Redis transient unavailability is tolerated: pub/sub is the fast path,
    // per-tenant BM25 TTL (Plan 05-06) is the correctness fallback.
    try {
      await publishToolSelectionInvalidation(deps.redis, id, 'enabled-tools-change');
    } catch (err) {
      logger.warn(
        { tenantId: id, err: (err as Error).message },
        'admin-enabled-tools: publishToolSelectionInvalidation failed; TTL fallback'
      );
    }
    try {
      await publishToolsListChanged(deps.redis, id, 'enabled-tools-change');
      await publishResourcesListChanged(deps.redis, id, 'enabled-tools-change');
    } catch (err) {
      logger.warn(
        { tenantId: id, err: (err as Error).message },
        'admin-enabled-tools: agentic list-change publish failed; clients may refresh on next request'
      );
    }

    // Read the updated row back through the pool (fresh snapshot, not the
    // txn connection which is now released) and shape to the public wire.
    try {
      const { rows } = await deps.pgPool.query(
        `SELECT id, mode, client_id, client_secret_ref, tenant_id, cloud_type,
                redirect_uri_allowlist, cors_origins, allowed_scopes, enabled_tools,
                preset_version, slug, disabled_at, created_at, updated_at
         FROM tenants WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) {
        problemNotFound(res, 'tenant', req.id);
        return;
      }
      logger.info({ tenantId: id, actor: admin.actor, operation }, 'admin-enabled-tools: updated');
      res.status(200).json(tenantRowToWire(rows[0]));
    } catch (err) {
      logger.error(
        { err: (err as Error).message, tenantId: id },
        'admin-enabled-tools: read-back after patch failed'
      );
      problemInternal(res, req.id);
    }
  });

  return r;
}
