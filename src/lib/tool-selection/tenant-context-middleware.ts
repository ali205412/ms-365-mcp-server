/**
 * Tenant context middleware (plan 05-04, TENANT-08).
 *
 * Mounted on /t/:tenantId/* routes between `loadTenant` and `authSelector`.
 * Seeds `requestContext` with the tenant triple (id, enabled_tools_set,
 * preset_version) so downstream `executeGraphTool` calls can resolve the
 * dispatch gate without direct access to `req.tenant`.
 *
 * Why a dedicated middleware:
 *   - The `authSelector` + `bearer` middlewares already own their own
 *     `requestContext.run()` calls (Phase 3 plan 03-06). Each reads
 *     `getRequestTokens() ?? {}` to preserve the existing ALS frame and
 *     appends auth-specific fields. Seeding the tenant triple FIRST means
 *     those spread-copies automatically carry the triple forward without
 *     touching 03-06 code paths.
 *   - Dispatch-guard reads the triple from ALS via `getRequestTenant()`;
 *     executeGraphTool never touches `req.tenant` directly (stdio mode
 *     cannot — there is no Express request). ALS is the only common
 *     surface between stdio + HTTP modes.
 *
 * Order guarantee (plan 05-04 PATTERNS + 03-09):
 *   app.use('/t/:tenantId', loadTenant);
 *   app.post('/t/:tenantId/mcp', seedTenantContext, authSelector, streamableHttp);
 *
 * No tenant on req.tenant → 500 `loadTenant_middleware_missing`. Matches
 * the same invariant assertion used by streamable-http and auth-selector.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { TenantRow } from '../tenant/tenant-row.js';
import { requestContext, getRequestTokens } from '../../request-context.js';

/**
 * Factory (no deps for now; accepts an options arg for forward-compat with
 * other plans that may layer per-tenant metrics / audit wiring here).
 */
export function createSeedTenantContextMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const tenant = (
      req as Request & {
        tenant?: TenantRow & { enabled_tools_set?: ReadonlySet<string> };
      }
    ).tenant;

    if (!tenant) {
      res.status(500).json({ error: 'loadTenant_middleware_missing' });
      return;
    }

    const existing = getRequestTokens() ?? {};
    requestContext.run(
      {
        ...existing,
        tenantId: tenant.id,
        enabledToolsSet: tenant.enabled_tools_set,
        presetVersion: tenant.preset_version,
      },
      () => next()
    );
  };
}
