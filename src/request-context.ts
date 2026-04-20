import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Phase 3 plan 03-05 addition: authentication flow carried in request
 * context. Populated by:
 *   - delegated  — 03-06 OAuth callback after MSAL acquire
 *   - app-only   — 03-06 client-credentials middleware
 *   - bearer     — 03-06 bearer pass-through middleware
 *   - device-code — stdio interactive auth (AuthManager.acquireTokenByDeviceCode)
 */
export type AuthFlow = 'delegated' | 'app-only' | 'bearer' | 'device-code';

export interface RequestContext {
  accessToken?: string; // was required — now OPTIONAL (non-HTTP callers may not set it)
  refreshToken?: string;
  // Phase 1 additions:
  requestId?: string;
  tenantId?: string | null; // Phase 1 placeholder; set by 03-08 loadTenant middleware
  // Phase 2 additions (plan 02-01 scaffold; populated by 02-02 RetryHandler):
  retryCount?: number; // Number of retries performed by RetryHandler (02-02)
  lastStatus?: number; // HTTP status of the final response returned by the pipeline
  // Reserved for Phase 6 auto-batch coalescer (D-07); 02-01 only declares the shape.
  graph?: {
    coalesce?: boolean;
  };
  // Phase 3 plan 03-05 additions — populated by 03-06 auth middlewares:
  flow?: AuthFlow; // which identity flow produced this request
  authClientId?: string; // tenant-row client_id that authenticated the call (audit correlation)
  // Phase 5 plan 05-04 additions — populated by server.ts at /t/:tenantId/mcp
  // entry (HTTP mode) + src/index.ts at stdio bootstrap (stdio mode). Consumed
  // by dispatch-guard (src/lib/tool-selection/dispatch-guard.ts) at the top
  // of executeGraphTool (src/graph-tools.ts). TENANT-08 isolation.
  enabledToolsSet?: ReadonlySet<string>;
  presetVersion?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestTokens(): RequestContext | undefined {
  return requestContext.getStore();
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

/**
 * Return the current request's auth flow (delegated | app-only | bearer |
 * device-code), or undefined outside a request context. Used by audit
 * writers (03-10) and per-flow OTel spans.
 */
export function getFlow(): AuthFlow | undefined {
  return requestContext.getStore()?.flow;
}

/**
 * Phase 5 plan 05-04 helper: surface the tenant triple (id, enabled set,
 * preset version) for dispatch-guard invocation inside `executeGraphTool`.
 * Returns the three fields that the guard needs, leaving other context
 * fields private to their respective consumers.
 *
 * Outside an active request context, all three fields are undefined —
 * callers MUST treat that as a fail-closed signal (checkDispatch does).
 */
export function getRequestTenant(): {
  id?: string;
  enabledToolsSet?: ReadonlySet<string>;
  presetVersion?: string;
} {
  const ctx = requestContext.getStore();
  return {
    id: ctx?.tenantId ?? undefined,
    enabledToolsSet: ctx?.enabledToolsSet,
    presetVersion: ctx?.presetVersion,
  };
}
