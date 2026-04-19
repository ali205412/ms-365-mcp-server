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
