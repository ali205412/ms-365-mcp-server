/**
 * Plan 04-03 Task 1 — verifyApiKeyPlaintext argon2id + LRU cache tests.
 *
 * Covers (per behaviour block):
 *   - Test 1: valid plaintext → ApiKeyIdentity returned
 *   - Test 2: wrong plaintext (well-formed but no hash match) → null
 *   - Test 3: malformed prefix → null WITHOUT invoking argon2.verify
 *   - Test 4: LRU cache hit — second call does NOT invoke argon2.verify
 *   - Test 5: LRU cache TTL — 59s cached, 61s re-verified (fake timers)
 *   - Test 6: timing-safe verify — argon2 library is used
 *   - Test 7: revoked-key cache staleness window documented
 *   - Test 8: concurrent verifies for same plaintext dedupe via in-flight promise
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

let sharedPool: Pool | null = null;
vi.mock('../../postgres.js', async () => {
  return {
    scheduleAfterCommit: vi.fn(),
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
      if (!sharedPool) throw new Error('sharedPool not set in test');
      const client = await sharedPool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // best-effort
        }
        throw err;
      } finally {
        client.release();
      }
    },
    getPool: () => sharedPool,
  };
});

import {
  verifyApiKeyPlaintext,
  __resetApiKeyCacheForTesting,
  __evictApiKeyFromCacheByKeyId,
  __setApiKeyCacheTtlForTesting,
  API_KEY_PREFIX,
} from '../api-keys.js';
import { MemoryRedisFacade } from '../../redis-facade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

function stripPgcryptoExtensionStmts(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/\bextension\b.*\bpgcrypto\b/i.test(line))
    .join('\n');
}

async function makePool(): Promise<Pool> {
  const db = newDb();
  db.registerExtension('pgcrypto', () => {});
  const { Pool: PgMemPool } = db.adapters.createPg();
  const pool = new PgMemPool() as Pool;
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const up = stripPgcryptoExtensionStmts(
      (sql.split(/^--\s*Down Migration\s*$/m)[0] ?? '').replace(/^--\s*Up Migration\s*$/m, '')
    );
    await pool.query(up);
  }
  return pool;
}

const TENANT_A = '12345678-1234-4234-8234-1234567890ab';

async function seedTenant(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id)
       VALUES ($1, 'delegated', 'cid', 'tid')`,
    [id]
  );
}

/**
 * Seed an api_keys row with a real argon2id hash of the given plaintext.
 * Returns {id, plaintext}.
 */
async function seedApiKey(
  pool: Pool,
  tenantId: string,
  plaintext: string,
  name = 'test-key'
): Promise<{ id: string; displaySuffix: string }> {
  const keyHash = await argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
  });
  const displaySuffix = plaintext.slice(-8);
  const id = `api-key-${Math.random().toString(36).slice(2, 10)}`;
  await pool.query(
    `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix)
       VALUES ($1, $2, $3, $4, $5)`,
    [id, tenantId, name, keyHash, displaySuffix]
  );
  return { id, displaySuffix };
}

function makeDeps(pool: Pool, redis: MemoryRedisFacade) {
  return { pgPool: pool, redis };
}

// Valid plaintext fixtures (format: msk_live_<43 base64url>).
const VALID_PLAINTEXT_1 = `${API_KEY_PREFIX}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
const VALID_PLAINTEXT_2 = `${API_KEY_PREFIX}BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB`;

describe('plan 04-03 Task 1 — verifyApiKeyPlaintext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetApiKeyCacheForTesting();
  });

  afterEach(() => {
    sharedPool = null;
    vi.useRealTimers();
  });

  it('Test 1: valid plaintext → ApiKeyIdentity returned', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    const { id, displaySuffix } = await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT_1, 'my-bot');

    const identity = await verifyApiKeyPlaintext(
      VALID_PLAINTEXT_1,
      makeDeps(pool, new MemoryRedisFacade())
    );

    expect(identity).not.toBeNull();
    expect(identity!.keyId).toBe(id);
    expect(identity!.tenantId).toBe(TENANT_A);
    expect(identity!.displaySuffix).toBe(displaySuffix);
    expect(identity!.name).toBe('my-bot');
    expect(identity!.revokedAt).toBeNull();
  });

  it('Test 2: wrong plaintext (well-formed) → null; cache NOT populated', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT_1);

    // Bogus plaintext (same format, completely different body)
    const bogus = `${API_KEY_PREFIX}CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC`;
    const result = await verifyApiKeyPlaintext(bogus, makeDeps(pool, new MemoryRedisFacade()));
    expect(result).toBeNull();

    // Call again — still null (no false positive from cache)
    const result2 = await verifyApiKeyPlaintext(bogus, makeDeps(pool, new MemoryRedisFacade()));
    expect(result2).toBeNull();
  });

  it('Test 3: malformed prefix → null WITHOUT invoking argon2.verify', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT_1);

    const spy = vi.spyOn(argon2, 'verify');
    try {
      const result = await verifyApiKeyPlaintext(
        'bearer abcdefghijklmnopqrstuvwxyz',
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(result).toBeNull();
      expect(spy).not.toHaveBeenCalled();

      // Also: empty string, too short, too long, wrong prefix
      expect(await verifyApiKeyPlaintext('', makeDeps(pool, new MemoryRedisFacade()))).toBeNull();
      expect(
        await verifyApiKeyPlaintext('msk_live_short', makeDeps(pool, new MemoryRedisFacade()))
      ).toBeNull();
      expect(
        await verifyApiKeyPlaintext(
          'msk_test_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          makeDeps(pool, new MemoryRedisFacade())
        )
      ).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('Test 4: LRU cache hit — second call does NOT invoke argon2.verify', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT_1);

    const spy = vi.spyOn(argon2, 'verify');
    try {
      const first = await verifyApiKeyPlaintext(
        VALID_PLAINTEXT_1,
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(first).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);

      const second = await verifyApiKeyPlaintext(
        VALID_PLAINTEXT_1,
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(second).not.toBeNull();
      expect(second!.keyId).toBe(first!.keyId);
      // No additional call — served from cache
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('Test 5: LRU cache TTL — cached within window; re-verified after expiry', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT_1);

    // Substitute a cache with a short TTL so real-time sleeps produce the
    // 59s/61s semantics at 1000x speed. Mocking LRUCache's internal clock
    // (performance.now or Date.now) is unreliable because the library
    // debounces now() reads across tests and holds the ref captured at
    // construction. Swapping the cache reference is the only clean path.
    __setApiKeyCacheTtlForTesting(100); // 100ms TTL

    const spy = vi.spyOn(argon2, 'verify');
    try {
      // Initial verify — 1 call
      const first = await verifyApiKeyPlaintext(
        VALID_PLAINTEXT_1,
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(first).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);

      // Within TTL window (< 100ms) — still cached
      await new Promise((r) => setTimeout(r, 40));
      const cached = await verifyApiKeyPlaintext(
        VALID_PLAINTEXT_1,
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(cached).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);

      // Past TTL (cumulative > 100ms) — cache expired; verify re-runs
      await new Promise((r) => setTimeout(r, 120));
      const expired = await verifyApiKeyPlaintext(
        VALID_PLAINTEXT_1,
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(expired).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
      __setApiKeyCacheTtlForTesting(null); // restore default
    }
  });

  it('Test 6: argon2.verify IS invoked on cache miss (timing-safe contract via lib)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT_1);

    const spy = vi.spyOn(argon2, 'verify');
    try {
      await verifyApiKeyPlaintext(VALID_PLAINTEXT_1, makeDeps(pool, new MemoryRedisFacade()));
      expect(spy).toHaveBeenCalled();
      // The library call signature is (hash, plaintext)
      const [hashArg, plaintextArg] = spy.mock.calls[0]!;
      expect(typeof hashArg).toBe('string');
      expect(plaintextArg).toBe(VALID_PLAINTEXT_1);
    } finally {
      spy.mockRestore();
    }
  });

  it('Test 7: revoked key — TTL staleness window documented; evict clears cache', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    const { id } = await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT_1);

    const spy = vi.spyOn(argon2, 'verify');
    try {
      // First verify — cache populated with revokedAt=null
      const first = await verifyApiKeyPlaintext(
        VALID_PLAINTEXT_1,
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(first!.revokedAt).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);

      // Revoke in DB
      await pool.query(`UPDATE api_keys SET revoked_at = NOW() WHERE id = $1`, [id]);

      // Within TTL — cache STILL returns null revokedAt (staleness window).
      // Caller (04-04 middleware) MUST recheck DB or rely on pub/sub invalidation.
      const stale = await verifyApiKeyPlaintext(
        VALID_PLAINTEXT_1,
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(stale!.revokedAt).toBeNull();
      expect(spy).toHaveBeenCalledTimes(1);

      // Simulate pub/sub eviction
      __evictApiKeyFromCacheByKeyId(id);

      // After eviction, next verify hits DB and sees revoked_at
      const fresh = await verifyApiKeyPlaintext(
        VALID_PLAINTEXT_1,
        makeDeps(pool, new MemoryRedisFacade())
      );
      expect(fresh).not.toBeNull();
      expect(fresh!.revokedAt).not.toBeNull();
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('Test 8: concurrent verifies for same plaintext dedup via in-flight promise', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT_1);

    const spy = vi.spyOn(argon2, 'verify');
    try {
      // Fire both concurrently. The second call should see the in-flight promise
      // and reuse it instead of spawning its own argon2.verify.
      const [a, b] = await Promise.all([
        verifyApiKeyPlaintext(VALID_PLAINTEXT_1, makeDeps(pool, new MemoryRedisFacade())),
        verifyApiKeyPlaintext(VALID_PLAINTEXT_1, makeDeps(pool, new MemoryRedisFacade())),
      ]);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.keyId).toBe(b!.keyId);

      // Exactly one argon2.verify call despite two callers (in-flight dedup).
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
