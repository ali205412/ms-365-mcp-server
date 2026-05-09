import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  McpError,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { assertTenantResourceOwner, parseMcpResourceUri } from '../mcp-resources/uri.js';
import type { RedisResourceSubscriptionStore } from './resource-subscriptions.js';

export interface RegisterResourceSubscriptionHandlersDeps {
  tenantId: string;
  store: RedisResourceSubscriptionStore;
}

export function registerResourceSubscriptionHandlers(
  server: McpServer,
  deps: RegisterResourceSubscriptionHandlersDeps
): void {
  server.server.registerCapabilities({
    resources: { listChanged: true, subscribe: true },
  });

  server.server.setRequestHandler(SubscribeRequestSchema, async (request, extra) => {
    const sessionId = requireSessionId(extra.sessionId);
    const uri = validateSubscriptionUri(request.params.uri, deps.tenantId);
    await deps.store.subscribe(deps.tenantId, sessionId, uri);
    return {};
  });

  server.server.setRequestHandler(UnsubscribeRequestSchema, async (request, extra) => {
    const sessionId = requireSessionId(extra.sessionId);
    const uri = validateSubscriptionUri(request.params.uri, deps.tenantId);
    await deps.store.unsubscribe(deps.tenantId, sessionId, uri);
    return {};
  });
}

function requireSessionId(sessionId: string | undefined): string {
  if (!sessionId) {
    throw new McpError(ErrorCode.InvalidParams, 'resources/subscribe requires an active session.', {
      code: 'session_required',
    });
  }
  return sessionId;
}

function validateSubscriptionUri(uri: string, tenantId: string): string {
  const parsed = assertTenantResourceOwner(parseMcpResourceUri(uri), tenantId);
  if (!parsed.ok) {
    throw new McpError(ErrorCode.InvalidParams, parsed.message, { code: parsed.code });
  }
  return uri;
}
