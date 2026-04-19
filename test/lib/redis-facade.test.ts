/**
 * Plan 03-02 Task 1 — MemoryRedisFacade unit tests.
 *
 * The facade is the stdio-mode Redis substitute. Tests cover the exact ioredis
 * API subset Phase 3 plans 03-03 / 03-05 / 03-08 consume:
 *   get / set (with EX + NX) / getdel / del / keys (glob) / ping / quit /
 *   publish / subscribe / on('message') / status transitions.
 *
 * TTL is verified with fake timers — the facade MUST NOT use setTimeout /
 * setInterval to implement expiry (would keep the event loop alive forever in
 * stdio mode). Instead it checks timestamps on every read.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';

describe('plan 03-02 — MemoryRedisFacade', () => {
  let facade: MemoryRedisFacade;

  beforeEach(() => {
    facade = new MemoryRedisFacade();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (facade.status !== 'end') {
      await facade.quit();
    }
  });

  // ── 1. NX semantics ────────────────────────────────────────────────────────
  it('set(k,v,"EX",10,"NX") returns "OK" when absent, null when present', async () => {
    const firstWrite = await facade.set('pkce:abc', 'verifier-123', 'EX', 10, 'NX');
    expect(firstWrite).toBe('OK');
    expect(await facade.get('pkce:abc')).toBe('verifier-123');

    const secondWrite = await facade.set('pkce:abc', 'clobber', 'EX', 10, 'NX');
    expect(secondWrite).toBeNull();
    // Value is NOT overwritten
    expect(await facade.get('pkce:abc')).toBe('verifier-123');
  });

  // ── 2. getdel ──────────────────────────────────────────────────────────────
  it('getdel(k) returns value and removes key atomically', async () => {
    await facade.set('mcp:pkce:state1', 'verifier-xyz');
    const value = await facade.getdel('mcp:pkce:state1');
    expect(value).toBe('verifier-xyz');
    // Key is gone
    expect(await facade.get('mcp:pkce:state1')).toBeNull();
    // Second getdel on the now-gone key returns null
    expect(await facade.getdel('mcp:pkce:state1')).toBeNull();
  });

  // ── 3. TTL expiry via fake timers (no setTimeout/setInterval in impl) ──────
  it('key expires after EX seconds; get returns null post-expiry', async () => {
    vi.useFakeTimers();
    const setAt = new Date('2026-04-19T00:00:00.000Z');
    vi.setSystemTime(setAt);

    await facade.set('mcp:cache:short-lived', 'payload', 'EX', 10);
    expect(await facade.get('mcp:cache:short-lived')).toBe('payload');

    // Advance 9s — still live
    vi.setSystemTime(new Date(setAt.getTime() + 9_000));
    expect(await facade.get('mcp:cache:short-lived')).toBe('payload');

    // Advance past 10s — expired
    vi.setSystemTime(new Date(setAt.getTime() + 11_000));
    expect(await facade.get('mcp:cache:short-lived')).toBeNull();
  });

  // ── 4. keys glob pattern (* wildcard) ─────────────────────────────────────
  it('keys("mcp:cache:*") returns all keys matching glob (only * supported)', async () => {
    await facade.set('mcp:cache:tenant-a:u1', 'x');
    await facade.set('mcp:cache:tenant-a:u2', 'y');
    await facade.set('mcp:cache:tenant-b:u1', 'z');
    await facade.set('mcp:pkce:state-1', 'p');

    const cacheKeys = await facade.keys('mcp:cache:*');
    expect(cacheKeys.sort()).toEqual(
      ['mcp:cache:tenant-a:u1', 'mcp:cache:tenant-a:u2', 'mcp:cache:tenant-b:u1'].sort()
    );

    // Narrower pattern
    const tenantAKeys = await facade.keys('mcp:cache:tenant-a:*');
    expect(tenantAKeys.sort()).toEqual(['mcp:cache:tenant-a:u1', 'mcp:cache:tenant-a:u2'].sort());
  });

  // ── 5. del(...keys) ────────────────────────────────────────────────────────
  it('del("k1","k2") returns count of keys actually deleted', async () => {
    await facade.set('k1', '1');
    await facade.set('k2', '2');

    const removed = await facade.del('k1', 'k2', 'k3-absent');
    expect(removed).toBe(2);
    expect(await facade.get('k1')).toBeNull();
    expect(await facade.get('k2')).toBeNull();
  });

  // ── 6. publish/subscribe ──────────────────────────────────────────────────
  it('publish(channel,msg) delivers to every subscriber of that channel', async () => {
    const received: Array<{ channel: string; msg: string }> = [];
    await facade.subscribe('mcp:tenant-invalidate');
    facade.on('message', (channel, msg) => {
      received.push({ channel, msg });
    });

    const delivered = await facade.publish('mcp:tenant-invalidate', 'tenant-123');
    expect(delivered).toBe(1);
    expect(received).toEqual([{ channel: 'mcp:tenant-invalidate', msg: 'tenant-123' }]);

    // Publishing to unsubscribed channel delivers to no-one
    const noDelivery = await facade.publish('unknown-channel', 'noop');
    expect(noDelivery).toBe(0);
  });

  // ── 7. status transitions ─────────────────────────────────────────────────
  it("status transitions from 'wait' → 'ready' on first command; quit() sets 'end'", async () => {
    expect(facade.status).toBe('wait');
    await facade.get('any-key');
    expect(facade.status).toBe('ready');
    await facade.quit();
    expect(facade.status).toBe('end');
  });

  // ── 8. ping returns PONG when ready, throws when ended ────────────────────
  it("ping() returns 'PONG' when ready; throws when connection is closed", async () => {
    expect(await facade.ping()).toBe('PONG');
    expect(facade.status).toBe('ready');

    await facade.quit();
    expect(facade.status).toBe('end');
    await expect(facade.ping()).rejects.toThrow(/closed/i);
  });
});
