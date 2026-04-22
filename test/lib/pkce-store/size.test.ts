/**
 * Plan 06-03 Task 2 — PkceStore.size() unit tests.
 *
 * Wires the observable `mcp_oauth_pkce_store_size` gauge required by
 * Phase 6 success criterion 1 (six-gauge set). Redis impl uses SCAN over
 * `mcp:pkce:*` (NOT KEYS — KEYS is banned on prod Redis because it blocks
 * the whole server for O(n) over the full keyspace; SCAN is cursor-based
 * and cooperative).
 *
 * Covered behaviours:
 *   - MemoryPkceStore.size(): 0 when empty, n after n put() calls.
 *   - RedisPkceStore.size(): 0 when empty, counts only mcp:pkce:* keys,
 *     does not count unrelated keys in the same Redis.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryRedisFacade } from '../../../src/lib/redis-facade.js';
import { RedisPkceStore } from '../../../src/lib/pkce-store/redis-store.js';
import { MemoryPkceStore } from '../../../src/lib/pkce-store/memory-store.js';
import type { PkceEntry } from '../../../src/lib/pkce-store/pkce-store.js';

function makeEntry(overrides: Partial<PkceEntry> = {}): PkceEntry {
  return {
    state: 'state-abc',
    clientCodeChallenge: 'challenge-xyz',
    clientCodeChallengeMethod: 'S256',
    serverCodeVerifier: 'server-verifier-123',
    clientId: 'client-id-aaa',
    redirectUri: 'https://app.example.com/callback',
    tenantId: '_',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('plan 06-03 — PkceStore.size()', () => {
  describe('MemoryPkceStore', () => {
    let store: MemoryPkceStore;
    beforeEach(() => {
      store = new MemoryPkceStore();
    });

    it('size() returns 0 when empty', async () => {
      expect(await store.size()).toBe(0);
    });

    it('size() returns n after n put()s with distinct challenges', async () => {
      for (let i = 0; i < 5; i++) {
        await store.put('_', makeEntry({ clientCodeChallenge: `ch-${i}` }));
      }
      expect(await store.size()).toBe(5);
    });

    it('size() counts across tenants (aggregate gauge, no labels)', async () => {
      await store.put('tenant-A', makeEntry({ clientCodeChallenge: 'a-1', tenantId: 'tenant-A' }));
      await store.put('tenant-B', makeEntry({ clientCodeChallenge: 'b-1', tenantId: 'tenant-B' }));
      await store.put('tenant-B', makeEntry({ clientCodeChallenge: 'b-2', tenantId: 'tenant-B' }));
      expect(await store.size()).toBe(3);
    });
  });

  describe('RedisPkceStore', () => {
    let facade: MemoryRedisFacade;
    let store: RedisPkceStore;

    beforeEach(() => {
      facade = new MemoryRedisFacade();
      store = new RedisPkceStore(facade);
    });

    afterEach(async () => {
      if (facade.status !== 'end') {
        await facade.quit();
      }
    });

    it('size() returns 0 when no mcp:pkce:* keys exist', async () => {
      expect(await store.size()).toBe(0);
    });

    it('size() counts mcp:pkce:* keys (SCAN-based)', async () => {
      for (let i = 0; i < 3; i++) {
        await store.put('_', makeEntry({ clientCodeChallenge: `ch-${i}` }));
      }
      expect(await store.size()).toBe(3);
    });

    it('size() does NOT count unrelated keys in the same Redis', async () => {
      // Stash a non-pkce key via the facade's generic set.
      await facade.set('mcp:cache:unrelated', 'x');
      await facade.set('mcp:rl:req:tenant-A', '42');
      await store.put('_', makeEntry({ clientCodeChallenge: 'only-one' }));
      expect(await store.size()).toBe(1);
    });

    it('size() aggregates across tenants (mcp:pkce:{tenant}:{challenge} pattern)', async () => {
      await store.put('tenant-A', makeEntry({ clientCodeChallenge: 'a-1', tenantId: 'tenant-A' }));
      await store.put('tenant-A', makeEntry({ clientCodeChallenge: 'a-2', tenantId: 'tenant-A' }));
      await store.put('tenant-B', makeEntry({ clientCodeChallenge: 'b-1', tenantId: 'tenant-B' }));
      expect(await store.size()).toBe(3);
    });
  });
});
