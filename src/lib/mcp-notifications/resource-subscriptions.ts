import type { RedisClient } from '../redis.js';

const SUBSCRIPTION_TTL_SECONDS = 24 * 60 * 60;

export function resourceSubscriptionKey(tenantId: string, sessionId: string): string {
  return `mcp:resource-sub:${tenantId}:${sessionId}`;
}

export class RedisResourceSubscriptionStore {
  constructor(private readonly redis: Pick<RedisClient, 'get' | 'set' | 'del'>) {}

  async subscribe(tenantId: string, sessionId: string, uri: string): Promise<void> {
    const key = resourceSubscriptionKey(tenantId, sessionId);
    const current = await this.read(key);
    if (!current.includes(uri)) {
      current.push(uri);
    }
    await this.write(key, current);
  }

  async unsubscribe(tenantId: string, sessionId: string, uri: string): Promise<void> {
    const key = resourceSubscriptionKey(tenantId, sessionId);
    const current = await this.read(key);
    await this.write(
      key,
      current.filter((candidate) => candidate !== uri)
    );
  }

  async list(tenantId: string, sessionId: string): Promise<string[]> {
    return this.read(resourceSubscriptionKey(tenantId, sessionId));
  }

  async isSubscribed(tenantId: string, sessionId: string, uri: string): Promise<boolean> {
    const current = await this.list(tenantId, sessionId);
    return current.includes(uri);
  }

  async deleteSession(tenantId: string, sessionId: string): Promise<void> {
    await this.redis.del(resourceSubscriptionKey(tenantId, sessionId));
  }

  private async read(key: string): Promise<string[]> {
    const raw = await this.redis.get(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return [...new Set(parsed.filter((value): value is string => typeof value === 'string'))];
    } catch {
      return [];
    }
  }

  private async write(key: string, uris: string[]): Promise<void> {
    const unique = [...new Set(uris)];
    if (unique.length === 0) {
      await this.redis.del(key);
      return;
    }
    await this.redis.set(key, JSON.stringify(unique), 'EX', SUBSCRIPTION_TTL_SECONDS);
  }
}
