/**
 * Plan 03-03 Task 2 — Cross-replica PKCE handoff test.
 *
 * ROADMAP SC#6: "a second replica picks up PKCE state from Redis". In the v2.0
 * single-VM harness there is only one process, so we simulate the multi-replica
 * case with two RedisPkceStore instances sharing one MemoryRedisFacade. The
 * facade models Redis as a single shared state — if the PkceStore implementation
 * leaks any in-process memory (e.g., a hidden Map), replica B's take would fail
 * because B's Map is empty. Redis-as-source-of-truth is the invariant under test.
 *
 * Covers:
 *   - Replica A writes via storeA.put()
 *   - Replica B reads via storeB.takeByChallenge() (success)
 *   - Replica B re-reads (miss — atomic delete through Redis, not a per-instance
 *     cache)
 */
import { describe, it, expect } from 'vitest';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { RedisPkceStore } from '../../src/lib/pkce-store/redis-store.js';
import type { PkceEntry } from '../../src/lib/pkce-store/pkce-store.js';

describe('plan 03-03 — PKCE store cross-replica handoff (SC#6)', () => {
  it('replica A put, replica B take — one shared Redis', async () => {
    const redis = new MemoryRedisFacade();
    const storeA = new RedisPkceStore(redis);
    const storeB = new RedisPkceStore(redis);

    const entry: PkceEntry = {
      state: 's',
      clientCodeChallenge: 'c',
      clientCodeChallengeMethod: 'S256',
      serverCodeVerifier: 'v',
      clientId: 'id',
      redirectUri: 'https://app/cb',
      tenantId: '_',
      createdAt: Date.now(),
    };

    // Replica A registers the challenge
    expect(await storeA.put('_', entry)).toBe(true);

    // Replica B consumes it — Redis is the source of truth, not per-instance state
    const taken = await storeB.takeByChallenge('_', 'c');
    expect(taken).not.toBeNull();
    expect(taken?.state).toBe('s');
    expect(taken?.serverCodeVerifier).toBe('v');

    // Second take from B — key is gone from shared Redis
    const second = await storeB.takeByChallenge('_', 'c');
    expect(second).toBeNull();

    // A also sees it gone (same Redis)
    const fromA = await storeA.takeByChallenge('_', 'c');
    expect(fromA).toBeNull();
  });
});
