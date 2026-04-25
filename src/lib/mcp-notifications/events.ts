export const AGENTIC_EVENTS_CHANNEL = 'mcp:agentic-events';

export interface RedisFacade {
  publish(channel: string, message: string): Promise<number>;
}

export type McpLogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

export interface McpLogMessage {
  level: McpLogLevel;
  logger?: string;
  data: unknown;
}

interface AgenticEventBase {
  tenantId: string;
  reason?: string;
  ts: string;
}

export type AgenticEvent =
  | (AgenticEventBase & { type: 'tools/list_changed' })
  | (AgenticEventBase & { type: 'resources/list_changed' })
  | (AgenticEventBase & { type: 'resources/updated'; uris: string[] })
  | (AgenticEventBase & { type: 'logging/message'; message: McpLogMessage });

type PublishableAgenticEvent = AgenticEvent extends infer Event
  ? Event extends AgenticEvent
    ? Omit<Event, 'ts'> & { ts?: string }
    : never
  : never;

export async function publishToolsListChanged(
  redis: RedisFacade,
  tenantId: string,
  reason?: string
): Promise<void> {
  await publishAgenticEvent(redis, { type: 'tools/list_changed', tenantId, reason });
}

export async function publishResourcesListChanged(
  redis: RedisFacade,
  tenantId: string,
  reason?: string
): Promise<void> {
  await publishAgenticEvent(redis, { type: 'resources/list_changed', tenantId, reason });
}

export async function publishResourceUpdated(
  redis: RedisFacade,
  tenantId: string,
  uris: string[],
  reason?: string
): Promise<void> {
  await publishAgenticEvent(redis, {
    type: 'resources/updated',
    tenantId,
    uris: [...uris],
    reason,
  });
}

export async function publishMcpLogMessage(
  redis: RedisFacade,
  tenantId: string,
  message: McpLogMessage
): Promise<void> {
  await publishAgenticEvent(redis, {
    type: 'logging/message',
    tenantId,
    message: toJsonSafe(message) as McpLogMessage,
  });
}

async function publishAgenticEvent(
  redis: RedisFacade,
  event: PublishableAgenticEvent
): Promise<void> {
  const payload = toJsonSafe({
    ...event,
    ts: event.ts ?? new Date().toISOString(),
  });
  await redis.publish(AGENTIC_EVENTS_CHANNEL, JSON.stringify(payload));
}

function toJsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
