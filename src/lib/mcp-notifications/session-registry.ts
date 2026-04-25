import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import logger from '../../logger.js';
import {
  AGENTIC_EVENTS_CHANNEL,
  type AgenticEvent,
  type McpLogMessage,
} from './events.js';
import {
  defaultResourceNotificationCoalescer,
  type ResourceNotificationCoalescer,
} from './coalesce.js';

export type McpNotificationSurface = 'discovery' | 'static';

export interface RegisteredMcpSession {
  tenantId: string;
  sessionId: string;
  server: Pick<
    McpServer,
    'sendToolListChanged' | 'sendResourceListChanged' | 'sendResourceUpdated' | 'sendLoggingMessage'
  >;
  transport: StreamableHTTPServerTransport;
  surface: McpNotificationSurface;
}

export interface RegisterSessionInput extends RegisteredMcpSession {}

export interface RedisSubscriberLike {
  subscribe(channel: string): Promise<number>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
}

export interface RedisWithOptionalDuplicate extends Partial<RedisSubscriberLike> {
  duplicate?: () => RedisSubscriberLike;
}

export type ResourceSubscriptionChecker = (
  tenantId: string,
  sessionId: string,
  uri: string
) => boolean | Promise<boolean>;

export interface McpSessionRegistryOptions {
  coalescer?: ResourceNotificationCoalescer;
  isResourceSubscribed?: ResourceSubscriptionChecker;
}

export class McpSessionRegistry {
  private readonly sessions = new Map<string, RegisteredMcpSession>();
  private readonly coalescer: ResourceNotificationCoalescer;
  private isResourceSubscribed?: ResourceSubscriptionChecker;

  constructor(options: McpSessionRegistryOptions = {}) {
    this.coalescer = options.coalescer ?? defaultResourceNotificationCoalescer;
    this.isResourceSubscribed = options.isResourceSubscribed;
  }

  setResourceSubscriptionChecker(checker: ResourceSubscriptionChecker | undefined): void {
    this.isResourceSubscribed = checker;
  }

  registerSession(input: RegisterSessionInput): RegisteredMcpSession {
    this.sessions.set(input.sessionId, input);
    return input;
  }

  getSession(sessionId: string): RegisteredMcpSession | undefined {
    return this.sessions.get(sessionId);
  }

  unregisterSession(sessionId: string): RegisteredMcpSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      this.coalescer.clearSession(session.tenantId, sessionId);
    }
    return session;
  }

  async deliverToolsListChanged(tenantId: string): Promise<void> {
    await Promise.all(
      this.matchingDiscoverySessions(tenantId).map((session) =>
        Promise.resolve(session.server.sendToolListChanged())
      )
    );
  }

  async deliverResourcesListChanged(tenantId: string): Promise<void> {
    await Promise.all(
      this.matchingDiscoverySessions(tenantId).map((session) =>
        Promise.resolve(session.server.sendResourceListChanged())
      )
    );
  }

  async deliverResourceUpdated(tenantId: string, uris: readonly string[]): Promise<void> {
    const sends: Array<Promise<void>> = [];
    for (const session of this.matchingDiscoverySessions(tenantId)) {
      for (const uri of uris) {
        if (this.isResourceSubscribed) {
          const subscribed = await this.isResourceSubscribed(tenantId, session.sessionId, uri);
          if (!subscribed) continue;
        }
        if (!this.coalescer.shouldDeliver(tenantId, session.sessionId, uri)) {
          continue;
        }
        sends.push(Promise.resolve(session.server.sendResourceUpdated({ uri })));
      }
    }
    await Promise.all(sends);
  }

  async deliverLoggingMessage(tenantId: string, message: McpLogMessage): Promise<void> {
    await Promise.all(
      this.matchingDiscoverySessions(tenantId).map((session) =>
        session.server.sendLoggingMessage(message, session.sessionId)
      )
    );
  }

  listSessions(): RegisteredMcpSession[] {
    return [...this.sessions.values()];
  }

  private matchingDiscoverySessions(tenantId: string): RegisteredMcpSession[] {
    return [...this.sessions.values()].filter(
      (session) => session.tenantId === tenantId && session.surface === 'discovery'
    );
  }
}

export const mcpSessionRegistry = new McpSessionRegistry();

export function registerSession(input: RegisterSessionInput): RegisteredMcpSession {
  return mcpSessionRegistry.registerSession(input);
}

export function getSession(sessionId: string): RegisteredMcpSession | undefined {
  return mcpSessionRegistry.getSession(sessionId);
}

export function unregisterSession(sessionId: string): RegisteredMcpSession | undefined {
  return mcpSessionRegistry.unregisterSession(sessionId);
}

export function duplicateRedisForAgenticSubscription(
  redis: RedisWithOptionalDuplicate
): RedisSubscriberLike {
  if (typeof redis.duplicate === 'function') {
    return redis.duplicate();
  }
  if (isRedisSubscriber(redis)) {
    return redis;
  }
  throw new Error('Redis subscriber must expose subscribe/on or duplicate()');
}

export async function subscribeToAgenticEvents(
  redis: RedisWithOptionalDuplicate,
  registry: McpSessionRegistry = mcpSessionRegistry
): Promise<RedisSubscriberLike> {
  const subscriber = duplicateRedisForAgenticSubscription(redis);
  await subscriber.subscribe(AGENTIC_EVENTS_CHANNEL);
  subscriber.on('message', (channel, message) => {
    if (channel !== AGENTIC_EVENTS_CHANNEL) return;
    void dispatchAgenticEvent(registry, message);
  });
  return subscriber;
}

async function dispatchAgenticEvent(registry: McpSessionRegistry, message: string): Promise<void> {
  let event: AgenticEvent;
  try {
    event = JSON.parse(message) as AgenticEvent;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, messageLength: message.length },
      'mcp-notifications: malformed agentic event ignored'
    );
    return;
  }

  try {
    switch (event.type) {
      case 'tools/list_changed':
        await registry.deliverToolsListChanged(event.tenantId);
        return;
      case 'resources/list_changed':
        await registry.deliverResourcesListChanged(event.tenantId);
        return;
      case 'resources/updated':
        await registry.deliverResourceUpdated(event.tenantId, event.uris);
        return;
      case 'logging/message':
        await registry.deliverLoggingMessage(event.tenantId, event.message);
        return;
    }
  } catch (err) {
    logger.error(
      { tenantId: event.tenantId, type: event.type, err: (err as Error).message },
      'mcp-notifications: event delivery failed'
    );
  }
}

function isRedisSubscriber(value: RedisWithOptionalDuplicate): value is RedisSubscriberLike {
  return typeof value.subscribe === 'function' && typeof value.on === 'function';
}
