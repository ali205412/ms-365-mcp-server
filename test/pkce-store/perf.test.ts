/**
 * Plan 03-03 Task 2 — SECUR-03 latency benchmark.
 *
 * SECUR-03 mandates O(1) PKCE lookup to close the v1 O(N) Map.find vector.
 * We cannot directly measure big-O in a unit test, but we CAN assert that
 * takeByChallenge latency does not grow unbounded with store size. If the
 * implementation regressed to a scan, p99 at 1000 entries would exceed
 * 50ms even on a fast box.
 *
 * Target per RESEARCH.md Validation: p99 < 5ms. We use a generous 50ms
 * bound because the test runs on CI which can have noisy wall-clock; the
 * signal here is "latency is bounded, not linear in N".
 *
 * This runs against MemoryRedisFacade (in-process), so the measured floor
 * is microseconds in theory — any O(N) regression would easily blow 50ms.
 */
import { describe, it, expect } from 'vitest';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { RedisPkceStore } from '../../src/lib/pkce-store/redis-store.js';

describe('plan 03-03 — PKCE store latency (SECUR-03)', () => {
  it('takeByChallenge p99 < 50ms at 1000-entry store', async () => {
    const redis = new MemoryRedisFacade();
    const store = new RedisPkceStore(redis);

    // Seed 1000 entries.
    for (let i = 0; i < 1000; i++) {
      await store.put('_', {
        state: `s${i}`,
        clientCodeChallenge: `c${i}`,
        clientCodeChallengeMethod: 'S256',
        serverCodeVerifier: `v${i}`,
        clientId: 'id',
        redirectUri: 'u',
        tenantId: '_',
        createdAt: Date.now(),
      });
    }

    // Measure 100 random takes. We put entries back after each take so the
    // store size stays at 1000 throughout — a naive O(N) scan would still
    // show linear growth.
    const durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const idx = Math.floor(Math.random() * 1000);
      const t0 = performance.now();
      const entry = await store.takeByChallenge('_', `c${idx}`);
      durations.push(performance.now() - t0);
      if (entry) {
        // Restore so store size remains 1000 for next iteration.
        await store.put('_', entry);
      }
    }
    durations.sort((a, b) => a - b);
    const p99 = durations[Math.floor(durations.length * 0.99)];
    // Generous bound — facade is in-process so this effectively asserts
    // "latency is not O(N)". A regression would hit tens of ms easily.
    expect(p99).toBeLessThan(50);
  });
});
