/**
 * Plan 03-07 Task 1 — SessionStore unit tests (SECUR-02).
 *
 * Server-side opaque refresh-token store. Refresh tokens live in Redis under
 * `mcp:session:{tenantId}:{sha256(accessToken)}`, envelope-encrypted with the
 * per-tenant DEK (same shape as msal-cache-plugin from 03-05).
 *
 * Coverage:
 *   1. put + get round-trip preserves full SessionRecord
 *   2. key format is `mcp:session:{tenantId}:{64-hex-sha256}`
 *   3. cross-tenant key distinctness (same access token, two tenants)
 *   4. envelope encryption — raw Redis value matches `{v:1, iv, tag, ct}`
 *      shape; plaintext refresh token is NOT present as substring
 *   5. get on unknown key returns null
 *   6. delete removes the entry
 *   7. TTL: after expiry, get returns null
 *   8. wrong DEK on get → warn log + drop → returns null
 *   9. hashAccessToken returns stable 64-hex-char sha256 digest
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import {
  SessionStore,
  hashAccessToken,
  type SessionRecord,
} from '../../src/lib/session-store.js';
import type { Envelope } from '../../src/lib/crypto/envelope.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Re-import after mock so the store uses the mocked logger.
import logger from '../../src/logger.js';

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    tenantId: overrides.tenantId ?? 'T-A',
    refreshToken: overrides.refreshToken ?? 'rt-SECRET-xyz',
    accountHomeId: overrides.accountHomeId ?? 'home-account-123',
    clientId: overrides.clientId ?? 'client-app-456',
    scopes: overrides.scopes ?? ['User.Read', 'Mail.Read'],
    createdAt: overrides.createdAt ?? Date.now(),
  };
}

describe('plan 03-07 Task 1 — SessionStore (SECUR-02)', () => {
  const dek = crypto.randomBytes(32);

  beforeEach(() => {
    vi.mocked(logger.info).mockClear?.();
    vi.mocked(logger.warn).mockClear?.();
    vi.mocked(logger.error).mockClear?.();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Round-trip ──────────────────────────────────────────────────────────
  it('Test 1: put+get round-trip preserves the full SessionRecord', async () => {
    const redis = new MemoryRedisFacade();
    const store = new SessionStore(redis, dek);
    const record = makeRecord({
      refreshToken: 'rt-SECRET-xyz',
      scopes: ['User.Read', 'Mail.Read'],
    });

    await store.put('T-A', 'access-token-abc', record, 3600);
    const got = await store.get('T-A', 'access-token-abc');

    expect(got).not.toBeNull();
    expect(got?.refreshToken).toBe('rt-SECRET-xyz');
    expect(got?.scopes).toEqual(['User.Read', 'Mail.Read']);
    expect(got?.clientId).toBe('client-app-456');
    expect(got?.accountHomeId).toBe('home-account-123');
    expect(got?.tenantId).toBe('T-A');
  });

  // ── 2. Key format ──────────────────────────────────────────────────────────
  it('Test 2: Redis key matches mcp:session:{tenantId}:{64-hex-sha256}', async () => {
    const redis = new MemoryRedisFacade();
    const store = new SessionStore(redis, dek);

    await store.put('T-A', 'access123', makeRecord());
    const keys = await redis.keys('mcp:session:*');
    expect(keys.length).toBe(1);

    const expectedHash = hashAccessToken('access123');
    expect(keys[0]).toBe(`mcp:session:T-A:${expectedHash}`);
    // sha256 hex is 64 chars
    expect(expectedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── 3. Cross-tenant key distinctness ──────────────────────────────────────
  it('Test 3: same access token across tenants produces two distinct Redis keys', async () => {
    const redis = new MemoryRedisFacade();
    const store = new SessionStore(redis, dek);

    await store.put('T-A', 'same-access', makeRecord({ tenantId: 'T-A' }));
    await store.put('T-B', 'same-access', makeRecord({ tenantId: 'T-B' }));

    const keys = await redis.keys('mcp:session:*');
    expect(keys.length).toBe(2);
    const sorted = keys.slice().sort();
    const hash = hashAccessToken('same-access');
    expect(sorted).toEqual([`mcp:session:T-A:${hash}`, `mcp:session:T-B:${hash}`]);
  });

  // ── 4. Envelope encryption (SC#5 signal) ──────────────────────────────────
  it('Test 4: raw Redis value is envelope-shaped and contains no plaintext refresh token', async () => {
    const redis = new MemoryRedisFacade();
    const store = new SessionStore(redis, dek);
    const record = makeRecord({ refreshToken: 'rt-SECRET-xyz' });

    await store.put('T-A', 'access123', record);
    const keys = await redis.keys('mcp:session:*');
    expect(keys.length).toBe(1);

    const raw = await redis.get(keys[0]);
    expect(raw).toBeTruthy();
    // Plaintext refresh token MUST NOT appear as a substring
    expect(raw!).not.toContain('rt-SECRET-xyz');
    // Field name "refresh_token" or "refreshToken" MUST NOT appear either
    expect(raw!).not.toContain('refresh_token');
    expect(raw!).not.toContain('refreshToken');
    // Scope strings must also be encrypted
    expect(raw!).not.toContain('User.Read');

    // Envelope shape: {v:1, iv, tag, ct}
    const parsed = JSON.parse(raw!) as Envelope;
    expect(parsed.v).toBe(1);
    expect(typeof parsed.iv).toBe('string');
    expect(typeof parsed.tag).toBe('string');
    expect(typeof parsed.ct).toBe('string');
    expect(Object.keys(parsed).sort()).toEqual(['ct', 'iv', 'tag', 'v']);
  });

  // ── 5. Unknown key → null ──────────────────────────────────────────────────
  it('Test 5: get on unknown tenant/accessToken returns null', async () => {
    const redis = new MemoryRedisFacade();
    const store = new SessionStore(redis, dek);

    const got = await store.get('T-A', 'nonexistent-access');
    expect(got).toBeNull();
  });

  // ── 6. Delete ──────────────────────────────────────────────────────────────
  it('Test 6: delete removes the entry and subsequent get returns null', async () => {
    const redis = new MemoryRedisFacade();
    const store = new SessionStore(redis, dek);

    await store.put('T-A', 'access123', makeRecord());
    expect(await store.get('T-A', 'access123')).not.toBeNull();

    await store.delete('T-A', 'access123');
    expect(await store.get('T-A', 'access123')).toBeNull();
    // Underlying Redis key is gone too.
    const keys = await redis.keys('mcp:session:*');
    expect(keys.length).toBe(0);
  });

  // ── 7. TTL expiry ──────────────────────────────────────────────────────────
  it('Test 7: put with ttlSeconds=1 → after 2s get returns null', async () => {
    vi.useFakeTimers();
    const setAt = new Date('2026-04-19T00:00:00.000Z');
    vi.setSystemTime(setAt);

    const redis = new MemoryRedisFacade();
    const store = new SessionStore(redis, dek);
    await store.put('T-A', 'access-short', makeRecord(), 1);

    expect(await store.get('T-A', 'access-short')).not.toBeNull();

    vi.setSystemTime(new Date(setAt.getTime() + 2000));
    expect(await store.get('T-A', 'access-short')).toBeNull();
  });

  // ── 8. Wrong DEK → warn + drop → null ──────────────────────────────────────
  it('Test 8: get with wrong DEK → warn log + delete key + returns null', async () => {
    const redis = new MemoryRedisFacade();
    const dek1 = crypto.randomBytes(32);
    const dek2 = crypto.randomBytes(32);
    const storePut = new SessionStore(redis, dek1);
    const storeGet = new SessionStore(redis, dek2);

    await storePut.put('T-A', 'access-xyz', makeRecord());
    // Key is present in Redis...
    expect((await redis.keys('mcp:session:*')).length).toBe(1);

    const got = await storeGet.get('T-A', 'access-xyz');
    expect(got).toBeNull();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    // After decrypt failure the store drops the key (matches 03-05 plugin pattern)
    expect((await redis.keys('mcp:session:*')).length).toBe(0);
  });

  // ── 9. hashAccessToken determinism + shape ─────────────────────────────────
  it('Test 9: hashAccessToken is stable sha256 hex (64 chars)', () => {
    const h1 = hashAccessToken('access-token-abc');
    const h2 = hashAccessToken('access-token-abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);

    const hOther = hashAccessToken('different-token');
    expect(hOther).not.toBe(h1);

    // Validate against a known canonical sha256 output
    const expected = crypto.createHash('sha256').update('access-token-abc').digest('hex');
    expect(h1).toBe(expected);
  });

  // ── 10. Extra: default TTL picks up from env var when not passed ──────────
  it('Test 10: default TTL respects MS365_MCP_SESSION_TTL_SECONDS env var', async () => {
    vi.useFakeTimers();
    const setAt = new Date('2026-04-19T00:00:00.000Z');
    vi.setSystemTime(setAt);

    const prev = process.env.MS365_MCP_SESSION_TTL_SECONDS;
    process.env.MS365_MCP_SESSION_TTL_SECONDS = '5';
    try {
      const redis = new MemoryRedisFacade();
      const store = new SessionStore(redis, dek);
      await store.put('T-A', 'access-env-ttl', makeRecord());

      // 3 seconds later: still there
      vi.setSystemTime(new Date(setAt.getTime() + 3000));
      expect(await store.get('T-A', 'access-env-ttl')).not.toBeNull();

      // 6 seconds later: expired
      vi.setSystemTime(new Date(setAt.getTime() + 6000));
      expect(await store.get('T-A', 'access-env-ttl')).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.MS365_MCP_SESSION_TTL_SECONDS;
      else process.env.MS365_MCP_SESSION_TTL_SECONDS = prev;
    }
  });
});
