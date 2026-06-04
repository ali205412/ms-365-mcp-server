import type { Request } from 'express';
import { requestContext } from '../request-context.js';

type RequestWithTenant = Request & {
  id?: unknown;
  tenant?: {
    id?: unknown;
  };
};

export interface RequestLogProps {
  requestId: string | null;
  tenantId: string | null;
}

export function requestLogProps(req: Request): RequestLogProps {
  const request = req as RequestWithTenant;
  const requestId = typeof request.id === 'string' ? request.id : null;
  const tenantId = tenantIdFromRequest(request) ?? tenantIdFromContext() ?? null;

  return { requestId, tenantId };
}

function tenantIdFromRequest(req: RequestWithTenant): string | undefined {
  const id = req.tenant?.id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

function tenantIdFromContext(): string | undefined {
  const tenantId = requestContext.getStore()?.tenantId;
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : undefined;
}
