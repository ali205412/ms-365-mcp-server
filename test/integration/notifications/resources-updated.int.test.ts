import { describe, expect, it, vi } from 'vitest';
import {
  ErrorCode,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  type SubscribeRequest,
  type UnsubscribeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { publishResourceUpdated } from '../../../src/lib/mcp-notifications/events.js';
import {
  McpSessionRegistry,
  subscribeToAgenticEvents,
} from '../../../src/lib/mcp-notifications/session-registry.js';
import {
  RedisResourceSubscriptionStore,
  resourceSubscriptionKey,
} from '../../../src/lib/mcp-notifications/resource-subscriptions.js';
import { registerResourceSubscriptionHandlers } from '../../../src/lib/mcp-notifications/register-handlers.js';
import { MemoryRedisFacade } from '../../../src/lib/redis-facade.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const SESSION_SUBSCRIBED = 'session-subscribed';
const SESSION_UNSUBSCRIBED = 'session-unsubscribed';
const BOOKMARKS_URI = `mcp://tenant/${TENANT_A}/bookmarks.json`;
const FACTS_URI = `mcp://tenant/${TENANT_A}/facts.json`;
const OTHER_TENANT_BOOKMARKS_URI = `mcp://tenant/${TENANT_B}/bookmarks.json`;

interface SentNotification {
  method: string;
  params?: unknown;
}

function makeServer(sent: SentNotification[]) {
  return {
    sendToolListChanged: vi.fn(),
    sendResourceListChanged: vi.fn(),
    sendResourceUpdated: vi.fn((params: unknown) => {
      sent.push({ method: 'notifications/resources/updated', params });
    }),
    sendLoggingMessage: vi.fn(),
  };
}

function registerFakeSession(registry: McpSessionRegistry, sessionId: string): SentNotification[] {
  const sent: SentNotification[] = [];
  registry.registerSession({
    tenantId: TENANT_A,
    sessionId,
    server: makeServer(sent) as never,
    transport: {} as never,
    surface: 'discovery',
  });
  return sent;
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

function makeHandlerHarness(tenantId: string, store: RedisResourceSubscriptionStore) {
  let subscribeHandler:
    | ((request: SubscribeRequest, extra: { sessionId?: string }) => Promise<unknown>)
    | undefined;
  let unsubscribeHandler:
    | ((request: UnsubscribeRequest, extra: { sessionId?: string }) => Promise<unknown>)
    | undefined;
  const server = {
    server: {
      registerCapabilities: vi.fn(),
      setRequestHandler: vi.fn((schema, handler) => {
        if (schema === SubscribeRequestSchema) subscribeHandler = handler;
        if (schema === UnsubscribeRequestSchema) unsubscribeHandler = handler;
      }),
    },
  };

  registerResourceSubscriptionHandlers(server as never, { tenantId, store });
  if (!subscribeHandler || !unsubscribeHandler) {
    throw new Error('subscription handlers were not registered');
  }

  return {
    subscribe: subscribeHandler,
    unsubscribe: unsubscribeHandler,
    registerCapabilities: server.server.registerCapabilities,
  };
}

describe('Phase 7 Plan 07-08 Task 2 — resource subscriptions', () => {
  it('resources/subscribe stores the URI under mcp:resource-sub:{tenantId}:{sessionId}', async () => {
    const redis = new MemoryRedisFacade();
    const store = new RedisResourceSubscriptionStore(redis);

    await store.subscribe(TENANT_A, SESSION_SUBSCRIBED, BOOKMARKS_URI);

    const raw = await redis.get(resourceSubscriptionKey(TENANT_A, SESSION_SUBSCRIBED));
    expect(JSON.parse(raw ?? 'null')).toEqual([BOOKMARKS_URI]);
  });

  it('resources/unsubscribe removes only the requested URI', async () => {
    const redis = new MemoryRedisFacade();
    const store = new RedisResourceSubscriptionStore(redis);

    await store.subscribe(TENANT_A, SESSION_SUBSCRIBED, BOOKMARKS_URI);
    await store.subscribe(TENANT_A, SESSION_SUBSCRIBED, FACTS_URI);
    await store.unsubscribe(TENANT_A, SESSION_SUBSCRIBED, BOOKMARKS_URI);

    expect(await store.list(TENANT_A, SESSION_SUBSCRIBED)).toEqual([FACTS_URI]);
  });

  it('resources/subscribe rejects tenant resource URIs owned by another tenant', async () => {
    const redis = new MemoryRedisFacade();
    const store = new RedisResourceSubscriptionStore(redis);
    const handlers = makeHandlerHarness(TENANT_A, store);

    await expect(
      handlers.subscribe(
        { method: 'resources/subscribe', params: { uri: OTHER_TENANT_BOOKMARKS_URI } },
        { sessionId: SESSION_SUBSCRIBED }
      )
    ).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
      data: { code: 'tenant_resource_mismatch' },
    });
    expect(await store.list(TENANT_A, SESSION_SUBSCRIBED)).toEqual([]);
    expect(handlers.registerCapabilities).toHaveBeenCalledWith({
      resources: { listChanged: true, subscribe: true },
    });
  });

  it('resource-updated events deliver only to sessions subscribed to the URI', async () => {
    const redis = new MemoryRedisFacade();
    const store = new RedisResourceSubscriptionStore(redis);
    const registry = new McpSessionRegistry({
      isResourceSubscribed: (tenantId, sessionId, uri) =>
        store.isSubscribed(tenantId, sessionId, uri),
    });
    const subscribed = registerFakeSession(registry, SESSION_SUBSCRIBED);
    const unsubscribed = registerFakeSession(registry, SESSION_UNSUBSCRIBED);

    await store.subscribe(TENANT_A, SESSION_SUBSCRIBED, BOOKMARKS_URI);
    await subscribeToAgenticEvents(redis, registry);
    await publishResourceUpdated(redis, TENANT_A, [BOOKMARKS_URI], 'bookmark-change');
    await waitFor(() => subscribed.length === 1);

    expect(subscribed).toEqual([
      { method: 'notifications/resources/updated', params: { uri: BOOKMARKS_URI } },
    ]);
    expect(unsubscribed).toEqual([]);
  });
});
