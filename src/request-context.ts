import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  accessToken?: string; // was required — now OPTIONAL (non-HTTP callers may not set it)
  refreshToken?: string;
  // Phase 1 additions:
  requestId?: string;
  tenantId?: string | null; // null in Phase 1 single-tenant; set by Phase 3 router
  // Phase 2 additions (plan 02-01 scaffold; populated by 02-02 RetryHandler):
  retryCount?: number; // Number of retries performed by RetryHandler (02-02)
  lastStatus?: number; // HTTP status of the final response returned by the pipeline
  // Reserved for Phase 6 auto-batch coalescer (D-07); 02-01 only declares the shape.
  graph?: {
    coalesce?: boolean;
  };
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestTokens(): RequestContext | undefined {
  return requestContext.getStore();
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
