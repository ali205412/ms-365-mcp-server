import { describe, expect, it, vi } from 'vitest';
import {
  McpSessionRegistry,
  type RegisterSessionInput,
} from '../src/lib/mcp-notifications/session-registry.js';

function makeSession(overrides: Partial<RegisterSessionInput> = {}): RegisterSessionInput {
  return {
    tenantId: 'tenant-a',
    sessionId: 'session-a',
    surface: 'discovery',
    server: {
      sendToolListChanged: vi.fn(),
      sendResourceListChanged: vi.fn(),
      sendResourceUpdated: vi.fn(),
      sendPromptListChanged: vi.fn(),
      sendLoggingMessage: vi.fn(),
    },
    transport: { close: vi.fn() } as never,
    ...overrides,
  };
}

describe('McpSessionRegistry session lifecycle bounds', () => {
  it('stamps createdAt and lastSeenAt and updates lastSeenAt on touch', () => {
    let now = 1_000;
    const registry = new McpSessionRegistry({ now: () => now });

    const registered = registry.registerSession(makeSession());
    expect(registered.createdAt).toBe(1_000);
    expect(registered.lastSeenAt).toBe(1_000);

    now = 2_500;
    const touched = registry.touchSession('session-a');

    expect(touched?.createdAt).toBe(1_000);
    expect(touched?.lastSeenAt).toBe(2_500);
    expect(registry.getSession('session-a')?.lastSeenAt).toBe(2_500);
  });

  it('takes expired sessions without removing active sessions', () => {
    let now = 10_000;
    const registry = new McpSessionRegistry({ sessionTtlMs: 5_000, now: () => now });

    registry.registerSession(makeSession({ sessionId: 'old', lastSeenAt: 1_000 }));
    registry.registerSession(makeSession({ sessionId: 'active', lastSeenAt: 7_500 }));

    const expired = registry.takeExpiredSessions();

    expect(expired.map((session) => session.sessionId)).toEqual(['old']);
    expect(registry.getSession('old')).toBeUndefined();
    expect(registry.getSession('active')).toBeDefined();
  });

  it('takes overflow sessions from oldest lastSeenAt first', () => {
    const registry = new McpSessionRegistry({ maxSessions: 2, now: () => 10_000 });

    registry.registerSession(makeSession({ sessionId: 'newest', lastSeenAt: 9_000 }));
    registry.registerSession(makeSession({ sessionId: 'oldest', lastSeenAt: 1_000 }));
    registry.registerSession(makeSession({ sessionId: 'middle', lastSeenAt: 5_000 }));

    const overflow = registry.takeOverflowSessions();

    expect(overflow.map((session) => session.sessionId)).toEqual(['oldest']);
    expect(
      registry
        .listSessions()
        .map((session) => session.sessionId)
        .sort()
    ).toEqual(['middle', 'newest']);
  });
});
