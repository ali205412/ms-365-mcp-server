/**
 * Plan 03-10 Task 2 — PKCE Redis handoff (ROADMAP SC#6).
 *
 * Two RedisPkceStore instances backed by the SAME MemoryRedisFacade —
 * emulating two replicas sharing a Redis cluster. Replica A puts; replica B
 * takes. If replica A were the source of truth (v1 in-memory Map), the B-side
 * takeByChallenge would miss. With Redis as the source of truth, the handoff
 * is transparent.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { RedisPkceStore } from '../../src/lib/pkce-store/redis-store.js';
import type { PkceEntry } from '../../src/lib/pkce-store/pkce-store.js';

const TENANT_ID = 'cafe0000-1111-4222-8333-444455556666';

function mkEntry(challenge: string): PkceEntry {
  return {
    state: 'state-1',
    clientCodeChallenge: challenge,
    clientCodeChallengeMethod: 'S256',
    serverCodeVerifier: 'server-verifier',
    clientId: 'client-A',
    redirectUri: 'http://localhost:3000/callback',
    tenantId: TENANT_ID,
    createdAt: Date.now(),
  };
}

describe('Plan 03-10 — PKCE Redis handoff (SC#6)', () => {
  it('replica B can take a challenge put by replica A through shared Redis', async () => {
    const sharedRedis = new MemoryRedisFacade();
    const replicaA = new RedisPkceStore(sharedRedis);
    const replicaB = new RedisPkceStore(sharedRedis);

    const challenge = crypto.randomBytes(32).toString('base64url');
    const entry = mkEntry(challenge);

    const putOk = await replicaA.put(TENANT_ID, entry);
    expect(putOk).toBe(true);

    // Replica A's "process" goes away (we null the reference — no state
    // lingers in A that would help a take on B).
    // @ts-expect-error — intentional null for the simulation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _forgottenA = (() => null)(); void replicaA;

    // Replica B reads the SAME shared Redis facade.
    const taken = await replicaB.takeByChallenge(TENANT_ID, challenge);
    expect(taken).not.toBeNull();
    expect(taken!.clientCodeChallenge).toBe(challenge);
    expect(taken!.serverCodeVerifier).toBe('server-verifier');
  });

  it('takeByChallenge is atomic — second replica cannot double-take', async () => {
    const sharedRedis = new MemoryRedisFacade();
    const replicaA = new RedisPkceStore(sharedRedis);
    const replicaB = new RedisPkceStore(sharedRedis);

    const challenge = crypto.randomBytes(32).toString('base64url');
    await replicaA.put(TENANT_ID, mkEntry(challenge));

    const first = await replicaB.takeByChallenge(TENANT_ID, challenge);
    const second = await replicaA.takeByChallenge(TENANT_ID, challenge);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('PKCE keys are tenant-scoped — cross-tenant takes miss', async () => {
    const sharedRedis = new MemoryRedisFacade();
    const replica = new RedisPkceStore(sharedRedis);

    const challenge = crypto.randomBytes(32).toString('base64url');
    await replica.put(TENANT_ID, mkEntry(challenge));

    const otherTenant = '11110000-2222-4333-8444-555566667777';
    const got = await replica.takeByChallenge(otherTenant, challenge);
    expect(got).toBeNull();
  });
});
