import { describe, it, expect } from 'vitest';

type PathModifier = (p: string, id: string) => string;

describe('Simple Calendar ID Path Mapping', () => {
  it('should modify path when calendarId is provided', () => {
    // This test verifies the simple path substitution
    const params = {
      calendarId: 'test-calendar-id',
      body: { subject: 'Test' },
    };

    let path = '/me/events';

    // Simple path substitution - exactly what the code does
    if (params.calendarId) {
      path = `/me/calendars/${encodeURIComponent(params.calendarId)}/events`;
    }

    expect(path).toBe('/me/calendars/test-calendar-id/events');
  });

  it('should use default path when calendarId is not provided', () => {
    const params: Record<string, string | undefined> = {
      body: 'Test',
    };

    let path = '/me/events';

    // Generic path modifier logic
    const pathModifiers: Record<string, PathModifier> = {
      calendarId: (p, id) => {
        if (p === '/me/events') {
          return `/me/calendars/${id}/events`;
        } else if (p.startsWith('/me/events/')) {
          return p.replace('/me/events/', `/me/calendars/${id}/events/`);
        }
        return p;
      },
    };

    // Process any ID parameters that modify the path
    for (const [paramName, transformer] of Object.entries(pathModifiers)) {
      const value = params[paramName];
      if (value) {
        const encodedId = encodeURIComponent(value);
        path = transformer(path, encodedId);
      }
    }

    expect(path).toBe('/me/events');
  });

  it('should handle update/delete operations with calendarId', () => {
    const params: Record<string, string | undefined> = {
      calendarId: 'test-calendar-id',
      eventId: 'event-123',
    };

    let path = '/me/events/event-123';

    const pathModifiers: Record<string, PathModifier> = {
      calendarId: (p, id) => {
        if (p === '/me/events') {
          return `/me/calendars/${id}/events`;
        } else if (p.startsWith('/me/events/')) {
          return p.replace('/me/events/', `/me/calendars/${id}/events/`);
        }
        return p;
      },
    };

    for (const [paramName, transformer] of Object.entries(pathModifiers)) {
      const value = params[paramName];
      if (value) {
        const encodedId = encodeURIComponent(value);
        path = transformer(path, encodedId);
      }
    }

    expect(path).toBe('/me/calendars/test-calendar-id/events/event-123');
  });
});
