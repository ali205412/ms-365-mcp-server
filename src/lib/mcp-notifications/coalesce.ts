export interface ResourceNotificationCoalescerOptions {
  windowMs?: number;
  now?: () => number;
}

const DEFAULT_WINDOW_MS = 2_000;
const KEY_SEPARATOR = '\\u0000';

export class ResourceNotificationCoalescer {
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly lastDelivered = new Map<string, number>();

  constructor(options: ResourceNotificationCoalescerOptions = {}) {
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  shouldDeliver(tenantId: string, sessionId: string, uri: string, changeType = 'updated'): boolean {
    const key = [tenantId, sessionId, uri, changeType].join(KEY_SEPARATOR);
    const current = this.now();
    const previous = this.lastDelivered.get(key);
    if (previous !== undefined && current - previous < this.windowMs) {
      return false;
    }
    this.lastDelivered.set(key, current);
    return true;
  }

  clearSession(tenantId: string, sessionId: string): void {
    const prefix = [tenantId, sessionId, ''].join(KEY_SEPARATOR);
    for (const key of this.lastDelivered.keys()) {
      if (key.startsWith(prefix)) {
        this.lastDelivered.delete(key);
      }
    }
  }
}

export const defaultResourceNotificationCoalescer = new ResourceNotificationCoalescer();
