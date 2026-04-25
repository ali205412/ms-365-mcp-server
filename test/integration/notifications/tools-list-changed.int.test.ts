import { describe, expect, it, vi } from 'vitest';
import { AGENTIC_EVENTS_CHANNEL, publishResourceUpdated, publishToolsListChanged } from '../../../src/lib/mcp-notifications/events.js';
import {
  McpSessionRegistry,
  subscribeToAgenticEvents,
} from '../../../src/lib/mcp-notifications/session-registry.js';
import { ResourceNotificationCoalescer } from '../../../src/lib/mcp-notifications/coalesce.js';
import { MemoryRedisFacade } from '../../../src/lib/redis-facade.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const AUDIT_URI = `mcp://tenant/${TENANT_A}/audit/recent.json`;

interface SentNotification {
  method: string;
  params?: unknown;
}

function makeServer(sent: SentNotification[]) {
  return {
    sendToolListChanged: vi.fn(() => {
      sent.push({ method: 'notifications/tools/list_changed' });
    }),
    sendResourceListChanged: vi.fn(() => {
      sent.push({ method: 'notifications/resources/list_changed' });
    }),
    sendResourceUpdated: vi.fn((params: unknown) => {
      sent.push({ method: 'notifications/resources/updated', params });
    }),
    sendLoggingMessage: vi.fn((params: unknown) => {
      sent.push({ method: 'notifications/message', params });
    }),
  };
}

function registerFakeSession(
  registry: McpSessionRegistry,
  tenantId: string,
  sessionId: string,
  surface: 'discovery' | 'static' = 'discovery'
): SentNotification[] {
  const sent: SentNotification[] = [];
  registry.registerSession({
    tenantId,
    sessionId,
    server: makeServer(sent) as never,
    transport: {} as never,
    surface,
  });
  return sent;
}

describe('Phase 7 Plan 07-08 Task 1 — agentic event session registry', () => {
  it('delivers tools/list_changed only to active discovery sessions for the event tenant', async () => {
    const redis = new MemoryRedisFacade();
    const registry = new McpSessionRegistry();
    const tenantADiscovery = registerFakeSession(registry, TENANT_A, 'a-discovery');
    const tenantAStatic = registerFakeSession(registry, TENANT_A, 'a-static', 'static');
    const tenantBDiscovery = registerFakeSession(registry, TENANT_B, 'b-discovery');

    await subscribeToAgenticEvents(redis, registry);
    await publishToolsListChanged(redis, TENANT_A, 'enabled-tools-change');

    expect(tenantADiscovery).toEqual([{ method: 'notifications/tools/list_changed' }]);
    expect(tenantAStatic).toEqual([]);
    expect(tenantBDiscovery).toEqual([]);
  });

  it('does not deliver tenant A tool-list events to active tenant B discovery sessions', async () => {
    const redis = new MemoryRedisFacade();
    const registry = new McpSessionRegistry();
    const tenantBDiscovery = registerFakeSession(registry, TENANT_B, 'b-discovery');

    await subscribeToAgenticEvents(redis, registry);
    await publishToolsListChanged(redis, TENANT_A, 'enabled-tools-change');

    expect(tenantBDiscovery).toEqual([]);
  });

  it('uses a duplicated Redis subscriber client when duplicate() is available', async () => {
    const registry = new McpSessionRegistry();
    const subscriber = {
      subscribe: vi.fn(async () => 1),
      on: vi.fn(),
    };
    const redis = {
      duplicate: vi.fn(() => subscriber),
    };

    const used = await subscribeToAgenticEvents(redis as never, registry);

    expect(redis.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith(AGENTIC_EVENTS_CHANNEL);
    expect(subscriber.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(used).toBe(subscriber);
  });

  it('coalesces resource-updated burst delivery per tenant, session, and URI for 2 seconds', async () => {
    let now = 1_000;
    const coalescer = new ResourceNotificationCoalescer({
      windowMs: 2_000,
      now: () => now,
    });

    expect(coalescer.shouldDeliver(TENANT_A, 'session-1', AUDIT_URI)).toBe(true);
    now += 1_999;
    expect(coalescer.shouldDeliver(TENANT_A, 'session-1', AUDIT_URI)).toBe(false);
    expect(coalescer.shouldDeliver(TENANT_A, 'session-2', AUDIT_URI)).toBe(true);
    expect(coalescer.shouldDeliver(TENANT_A, 'session-1', `mcp://tenant/${TENANT_A}/bookmarks.json`)).toBe(true);
    expect(coalescer.shouldDeliver(TENANT_B, 'session-1', AUDIT_URI)).toBe(true);

    now += 1;
    expect(coalescer.shouldDeliver(TENANT_A, 'session-1', AUDIT_URI)).toBe(true);
  });

  it('delivers resource-updated event payloads as MCP notification params', async () => {
    const redis = new MemoryRedisFacade();
    const registry = new McpSessionRegistry();
    const tenantADiscovery = registerFakeSession(registry, TENANT_A, 'a-discovery');

    await subscribeToAgenticEvents(redis, registry);
    await publishResourceUpdated(redis, TENANT_A, [AUDIT_URI], 'audit-write');

    expect(tenantADiscovery).toEqual([
      { method: 'notifications/resources/updated', params: { uri: AUDIT_URI } },
    ]);
  });
});
