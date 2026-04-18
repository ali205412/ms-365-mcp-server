import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  accessToken?: string; // was required — now OPTIONAL (non-HTTP callers may not set it)
  refreshToken?: string;
  // Phase 1 additions:
  requestId?: string;
  tenantId?: string | null; // null in Phase 1 single-tenant; set by Phase 3 router
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestTokens(): RequestContext | undefined {
  return requestContext.getStore();
}

export function getRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
