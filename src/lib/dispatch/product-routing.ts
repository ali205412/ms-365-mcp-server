/**
 * Plan 5.1-06 Task 2 — product-prefix dispatch router.
 *
 * Decouples `executeGraphTool` from per-product logic. When a tool alias
 * carries a known product prefix (`__powerbi__` / `__pwrapps__` /
 * `__pwrauto__` / `__exo__` / `__spadmin__`), the router:
 *
 *   1. Strips the prefix → bare alias used as the request path.
 *   2. Resolves product audience (scope + baseUrl + retryHandler) from
 *      PRODUCT_AUDIENCES, applying the context-dependent Zod regex guards
 *      for sp-admin (sharepoint_domain) and exo (tenantAzureId) BEFORE URL
 *      construction (T-5.1-06-c + T-5.1-05-f defense-in-depth).
 *   3. Acquires a per-product access token via AuthManager.getTokenForProduct
 *      — composite cache key `${tenantId}:${product}` prevents cross-tenant
 *      leak (T-5.1-06-b).
 *   4. Delegates the HTTP call to the existing GraphClient machinery with
 *      the product's baseUrl override — same Phase-2 middleware pipeline
 *      (retry/throttle/ETag/odata-error) applies uniformly, tagged by
 *      `retryHandler` for future per-product variants (research Pitfall 10).
 *
 * Structured MCP errors (T-5.1-06-e mitigation):
 *   - Missing sharepoint_domain → `mcpError.code = 'sp_admin_not_configured'`
 *     with a hint directing operators to PATCH /admin/tenants/{id}.
 *   - Malformed tenantAzureId or sharepoint_domain →
 *     `mcpError.code = 'product_dispatch_invalid'`.
 *   - executeProductTool wraps either error into the MCP
 *     `{isError: true, content: [{type: 'text', text: JSON.stringify(...)}]}`
 *     shape so callers see a structured tool error, never an HTTP 500.
 */
import type AuthManager from '../../auth.js';
import type GraphClient from '../../graph-client.js';
import {
  PRODUCT_AUDIENCES,
  extractProductFromAlias,
  type Product,
  type ProductAudienceCtx,
} from '../auth/products.js';
import logger from '../../logger.js';

/**
 * Dispatch context passed by the caller (executeGraphTool). Populated from
 * the AsyncLocalStorage request context which loadTenant middleware seeds
 * with `tenantAzureId` (Azure AD tenant UUID) and `sharepointDomain`
 * (tenants.sharepoint_domain column).
 */
export interface ProductDispatchCtx extends ProductAudienceCtx {
  /** May be `null` when the tenant's `sharepoint_domain` column is unset. */
  sharepointDomain?: string | null;
}

/**
 * Full dispatch plan — the inputs a downstream graphRequest call needs.
 */
export interface ProductDispatchPlan {
  product: Product;
  strippedAlias: string;
  scope: string;
  baseUrl: string;
  retryHandler: 'default' | 'exo' | 'sp-admin';
}

/**
 * Resolve a dispatch plan for a `__<product>__*`-aliased tool call. Pure
 * function — no I/O. Returns `null` when the alias has no known product
 * prefix (caller falls through to the Graph path unchanged).
 *
 * @throws An Error decorated with `.mcpError = {code, hint}` when the
 *   product's scope/baseUrl resolvers throw (missing sharepoint_domain,
 *   malformed tenantAzureId). The caller is expected to wrap in a
 *   structured MCP tool-error envelope.
 */
export function resolveProductDispatch(
  alias: string,
  ctx: ProductDispatchCtx
): ProductDispatchPlan | null {
  const extracted = extractProductFromAlias(alias);
  if (!extracted) return null;
  const audience = PRODUCT_AUDIENCES.get(extracted.product);
  if (!audience) return null;

  // Normalise `null` to `undefined` for the shared ProductAudienceCtx shape
  // — the audience resolvers treat both as "absent" but the runtime regex
  // check is strict about the string shape.
  const audCtx: ProductAudienceCtx = {
    sharepointDomain: ctx.sharepointDomain ?? undefined,
    tenantAzureId: ctx.tenantAzureId,
  };

  try {
    const scope = typeof audience.scope === 'function' ? audience.scope(audCtx) : audience.scope;
    const baseUrl =
      typeof audience.baseUrl === 'function' ? audience.baseUrl(audCtx) : audience.baseUrl;
    return {
      product: extracted.product,
      strippedAlias: extracted.strippedAlias,
      scope,
      baseUrl,
      retryHandler: audience.retryHandler,
    };
  } catch (err) {
    // T-5.1-06-e mitigation — attach structured MCP error metadata so
    // executeProductTool can render a useful tool error instead of a 500.
    const original = err as Error;
    const code =
      extracted.product === 'sp-admin' ? 'sp_admin_not_configured' : 'product_dispatch_invalid';
    const hint =
      extracted.product === 'sp-admin'
        ? 'Admin must PATCH /admin/tenants/{id} with {sharepoint_domain: "<single-label-hostname>"} before __spadmin__* tools will work.'
        : `Product ${extracted.product} dispatch failed: ${original.message}`;
    const decorated = new Error(original.message) as Error & {
      mcpError?: { code: string; hint: string };
    };
    decorated.mcpError = { code, hint };
    throw decorated;
  }
}

/**
 * MCP `CallToolResult`-shaped response. Duplicated (not imported) because
 * src/graph-tools.ts currently owns the local CallToolResult type — the
 * shape is stable across MCP SDK versions (`content: Array<{type, text}>`
 * + optional `isError` + optional `_meta`). Pinning the shape here avoids
 * an import cycle between dispatch and graph-tools.
 */
export interface ProductCallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  _meta?: Record<string, unknown>;
  isError?: true;
}

/**
 * Minimal GraphClient surface the dispatch path uses — narrows the full
 * GraphClient class so callers can pass either the real client or a
 * testing stub without structural typing surprises.
 *
 * `graphRequest` already accepts `accessToken` via its options bag
 * (src/graph-client.ts GraphRequestOptions). `baseUrl` + `retryHandler`
 * flow through the open index signature — the real `graphRequest` ignores
 * them today (Phase 5.1 does not yet wire custom baseUrl substitution
 * into the pipeline); the caller passes them so downstream Phase-2
 * middleware extensions can act on them when the retryHandler tag is
 * consulted (research Pitfall 10 for Exchange nextLink expiry).
 */
interface GraphClientRequestable {
  graphRequest: (
    endpoint: string,
    options: {
      accessToken?: string;
      baseUrl?: string;
      retryHandler?: string;
      params?: Record<string, unknown>;
      [key: string]: unknown;
    }
  ) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
    _meta?: unknown;
  }>;
}

/**
 * Minimal AuthManager surface — narrows to just the product-token API.
 * Mirrors the narrowing pattern from src/graph-client.ts's MsalWithRefresh.
 */
interface AuthManagerProductTokenable {
  getTokenForProduct: (
    tenantId: string,
    product: Product,
    opts?: ProductAudienceCtx
  ) => Promise<string>;
}

/**
 * Execute a product-prefix-routed tool call. Strips the prefix, resolves
 * the dispatch plan, acquires a product access token, and delegates the
 * HTTP call to the provided GraphClient.
 *
 * On resolver error (missing sharepoint_domain / invalid tenantAzureId):
 * returns an MCP CallToolResult with `isError: true` carrying the
 * structured `error` / `message` / `hint` in `content[0].text` JSON —
 * never throws (caller always sees a well-formed tool response envelope).
 *
 * On auth/transport error: same wrapping. The AuthManager's own
 * logger.error call surfaces the root cause for ops triage.
 *
 * @param toolAlias Fully-qualified tool alias (e.g., `__spadmin__list-sites`).
 * @param params    MCP tool call parameters (pass-through to graphRequest).
 * @param authManager
 * @param graphClient
 * @param ctx       Request-context-derived dispatch context.
 */
export async function executeProductTool(
  toolAlias: string,
  params: Record<string, unknown>,
  authManager: AuthManager | AuthManagerProductTokenable,
  graphClient: GraphClient | GraphClientRequestable,
  ctx: ProductDispatchCtx & { tenantId: string }
): Promise<ProductCallToolResult> {
  const { tenantId, ...dispatchCtx } = ctx;
  try {
    const plan = resolveProductDispatch(toolAlias, dispatchCtx);
    if (!plan) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'not_a_product_alias', alias: toolAlias }),
          },
        ],
        isError: true,
      };
    }

    const token = await (authManager as AuthManagerProductTokenable).getTokenForProduct(
      tenantId,
      plan.product,
      {
        sharepointDomain: dispatchCtx.sharepointDomain ?? undefined,
        tenantAzureId: dispatchCtx.tenantAzureId,
      }
    );

    const response = await (graphClient as GraphClientRequestable).graphRequest(
      plan.strippedAlias,
      {
        accessToken: token,
        baseUrl: plan.baseUrl,
        retryHandler: plan.retryHandler,
        params,
      }
    );

    logger.info({ product: plan.product, alias: toolAlias, tenantId }, 'product tool dispatched');

    const out: ProductCallToolResult = {
      content: response.content.map((item) => ({ type: 'text' as const, text: item.text })),
    };
    if (response._meta) {
      out._meta = response._meta as Record<string, unknown>;
    }
    if (response.isError) {
      out.isError = true;
    }
    return out;
  } catch (err) {
    const error = err as Error & { mcpError?: { code: string; hint: string } };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.mcpError?.code ?? 'product_dispatch_error',
            message: error.message,
            hint: error.mcpError?.hint,
          }),
        },
      ],
      isError: true,
    };
  }
}
