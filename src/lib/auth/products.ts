/**
 * Plan 5.1-06 Task 2 — Product audience table (per 05.1-CONTEXT D-05).
 *
 * Single source of truth for per-product Azure AD audience mapping:
 *   - Power BI            → https://analysis.windows.net/powerbi/api/.default
 *   - Power Apps          → https://api.powerapps.com/.default
 *   - Power Automate      → https://service.flow.microsoft.com/.default
 *   - Exchange Admin      → https://outlook.office365.com/.default
 *   - SharePoint Tenant   → https://{sharepoint_domain}-admin.sharepoint.com/.default
 *
 * The SharePoint entry is tenant-specific — the scope + baseUrl both depend
 * on the tenant's `sharepoint_domain` column (migration 20260801000000).
 * Dispatch (src/lib/dispatch/product-routing.ts) resolves them at request
 * time from the loaded tenant row AND re-validates the value against Zod
 * `/^[a-z0-9-]{1,63}$/` before URL / scope construction (T-5.1-06-c
 * mitigation, defense-in-depth against compromised admin API key / SQL
 * injection at the admin PATCH layer).
 *
 * Exchange Admin base URL also takes a tenantAzureId substitution
 * (`{tenantId}` in `https://outlook.office365.com/adminapi/beta/{tenantId}`)
 * — validated against Zod `/^[0-9a-f-]{1,36}$/i` (UUID shape) to close
 * T-5.1-05-f (path traversal / header injection).
 *
 * Naming note: `sp-admin` is the Product enum member (dashed), while
 * `__spadmin__` is the alias prefix literal (no dash — must match
 * VALID_PREFIX_RE in run-product-pipeline.mjs). extractProductFromAlias
 * translates between the two; tests P5 + P7 pin the exact mapping.
 */

/**
 * Closed union of product identifiers. Extending this type requires a
 * matching PRODUCT_AUDIENCES entry + tests. Admin API PATCH validators
 * (plan 05.1-07) can narrow per-tenant enabled-tools on this shape.
 */
export type Product = 'powerbi' | 'pwrapps' | 'pwrauto' | 'exo' | 'sp-admin';

/**
 * Context passed to function-style scope/baseUrl resolvers. Dispatch layer
 * populates from the loaded tenant row + request state. Static resolvers
 * (Power BI, Power Apps, Power Automate) ignore these fields.
 */
export interface ProductAudienceCtx {
  /** Tenant's SharePoint single-label hostname — required for `sp-admin`. */
  sharepointDomain?: string | null;
  /** Tenant's Azure AD tenant UUID — required for `exo` base URL substitution. */
  tenantAzureId?: string;
}

/**
 * Per-product audience metadata. `scope` and `baseUrl` are either literal
 * strings (for static products) or pure functions of the dispatch context
 * (for tenant-substituted products). The `retryHandler` tag picks the
 * Phase-2 middleware variant at request time — 'exo' surfaces Exchange's
 * @odata.nextLink 5-10min expiry (research Pitfall 10), 'sp-admin' may
 * surface SharePoint-specific throttling headers in a future extension,
 * and 'default' uses the uniform Phase-2 RetryHandler.
 */
export interface ProductAudience {
  readonly product: Product;
  readonly prefix: `__${string}__`;
  readonly scope: string | ((ctx: ProductAudienceCtx) => string);
  readonly baseUrl: string | ((ctx: ProductAudienceCtx) => string);
  readonly retryHandler: 'default' | 'exo' | 'sp-admin';
}

/**
 * Zod-equivalent regex for sharepoint_domain. Single-label hostname:
 * lowercase alphanumeric and dashes only, 1-63 chars. Rejects dots,
 * slashes, uppercase, special chars — any of which would allow an
 * attacker-planted value to redirect the token audience or produce a
 * malformed URL that SharePoint might route unexpectedly.
 *
 * Applied at BOTH admin PATCH (Task 3, src/lib/admin/tenants.ts) AND
 * at dispatch (this module). Defense-in-depth against compromised admin
 * controls or SQL injection bypassing the PATCH validator.
 */
const SHAREPOINT_DOMAIN_RE = /^[a-z0-9-]{1,63}$/;

/**
 * Zod-equivalent regex for Exchange tenantAzureId. Hex + dashes, 1-36
 * chars (UUID shape per RFC 4122, intentionally permissive on version/
 * variant nibbles). T-5.1-05-f mitigation — rejects path-traversal and
 * header-injection payloads that could reach outlook.office365.com/adminapi
 * otherwise.
 */
const EXO_TENANT_AZURE_ID_RE = /^[0-9a-f-]{1,36}$/i;

/**
 * The 5-row audience table. ReadonlyMap to prevent runtime mutation —
 * per D-05, the audience list is part of the security contract and must
 * be git-reviewed, not runtime-mutable.
 *
 * Entries ordered to match 05.1-CONTEXT D-05 Table for visual parity.
 */
export const PRODUCT_AUDIENCES: ReadonlyMap<Product, ProductAudience> = new Map<
  Product,
  ProductAudience
>([
  [
    'powerbi',
    {
      product: 'powerbi',
      prefix: '__powerbi__',
      scope: 'https://analysis.windows.net/powerbi/api/.default',
      baseUrl: 'https://api.powerbi.com/v1.0/myorg',
      retryHandler: 'default',
    },
  ],
  [
    'pwrapps',
    {
      product: 'pwrapps',
      prefix: '__pwrapps__',
      scope: 'https://api.powerapps.com/.default',
      baseUrl: 'https://api.powerapps.com/providers/Microsoft.PowerApps',
      retryHandler: 'default',
    },
  ],
  [
    'pwrauto',
    {
      product: 'pwrauto',
      prefix: '__pwrauto__',
      scope: 'https://service.flow.microsoft.com/.default',
      baseUrl: 'https://service.flow.microsoft.com/providers/Microsoft.ProcessSimple',
      retryHandler: 'default',
    },
  ],
  [
    'exo',
    {
      product: 'exo',
      prefix: '__exo__',
      scope: 'https://outlook.office365.com/.default',
      baseUrl: (ctx) => {
        const { tenantAzureId } = ctx;
        if (!tenantAzureId) {
          throw new Error('invalid tenantAzureId for exo baseUrl (absent)');
        }
        if (!EXO_TENANT_AZURE_ID_RE.test(tenantAzureId)) {
          throw new Error(`invalid tenantAzureId for exo baseUrl: ${tenantAzureId}`);
        }
        return `https://outlook.office365.com/adminapi/beta/${tenantAzureId}`;
      },
      retryHandler: 'exo',
    },
  ],
  [
    'sp-admin',
    {
      product: 'sp-admin',
      prefix: '__spadmin__',
      scope: (ctx) => {
        const { sharepointDomain } = ctx;
        if (!sharepointDomain) {
          throw new Error('sharepoint_domain not configured for tenant');
        }
        if (!SHAREPOINT_DOMAIN_RE.test(sharepointDomain)) {
          throw new Error(`invalid sharepoint_domain: ${sharepointDomain}`);
        }
        return `https://${sharepointDomain}-admin.sharepoint.com/.default`;
      },
      baseUrl: (ctx) => {
        const { sharepointDomain } = ctx;
        if (!sharepointDomain) {
          throw new Error('sharepoint_domain not configured for tenant');
        }
        if (!SHAREPOINT_DOMAIN_RE.test(sharepointDomain)) {
          throw new Error(`invalid sharepoint_domain: ${sharepointDomain}`);
        }
        return `https://${sharepointDomain}-admin.sharepoint.com/_api/SPO.TenantAdministrationOffice365Tenant`;
      },
      retryHandler: 'sp-admin',
    },
  ],
]);

/**
 * Reverse lookup from prefix literal → Product. Built once at module load;
 * consumed by `isProductPrefix` / `extractProductFromAlias` which themselves
 * iterate PRODUCT_AUDIENCES — kept as a plain Map for future O(1) lookup
 * optimization if the 5-entry linear scan ever becomes a hot path.
 */
const PREFIX_TO_PRODUCT: ReadonlyMap<string, Product> = new Map(
  [...PRODUCT_AUDIENCES.values()].map((a) => [a.prefix, a.product] as [string, Product])
);

/**
 * True iff the given alias starts with one of the 5 known product prefixes.
 * Used by dispatch at `executeGraphTool` entry to decide whether to branch
 * into product routing before the existing Graph path.
 *
 * @param alias Fully-qualified tool alias as seen in the MCP tool registry.
 */
export function isProductPrefix(alias: string): boolean {
  for (const audience of PRODUCT_AUDIENCES.values()) {
    if (alias.startsWith(audience.prefix)) return true;
  }
  return false;
}

/**
 * Split a product alias into {product, strippedAlias}. Returns null if the
 * alias doesn't match any known prefix — caller treats null as "not a
 * product call, fall through to Graph path".
 *
 * @param alias Fully-qualified tool alias (e.g., `__powerbi__list-workspaces`).
 * @returns `{product, strippedAlias}` or null.
 */
export function extractProductFromAlias(
  alias: string
): { product: Product; strippedAlias: string } | null {
  for (const audience of PRODUCT_AUDIENCES.values()) {
    if (alias.startsWith(audience.prefix)) {
      return {
        product: audience.product,
        strippedAlias: alias.slice(audience.prefix.length),
      };
    }
  }
  return null;
}

/**
 * Internal helper for tests + external introspection. Not exported as part
 * of the public API — prefer `isProductPrefix` / `extractProductFromAlias`.
 */
export function _prefixToProduct(): ReadonlyMap<string, Product> {
  return PREFIX_TO_PRODUCT;
}
