/**
 * Plan 03-05 Task 3 — bin/disable-tenant.mjs cascade test (SC#4, TENANT-07).
 *
 * Behaviors:
 *   1. Full cascade: tenants.disabled_at set + wrapped_dek null + api_keys
 *      revoked_at set + Redis keys removed + tenantPool.evict called.
 *   2. Unknown tenantId rejects with tenant_not_found without mutating the DB.
 *   3. Pitfall 6 guard: when redis.status === 'reconnecting', the cascade
 *      refuses to run (no DB writes).
 *   4. Required argv guard: missing tenant id rejects with Usage message.
 */
import { describe, it, expect, vi } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { TenantPool } from '../../src/lib/tenant/tenant-pool.js';
import { generateTenantDek } from '../../src/lib/crypto/dek.js';
import type { TenantRow } from '../../src/lib/tenant/tenant-row.js';
// @ts-expect-error — .mjs import has no types; tests rely on runtime export shape.
import { main as disableTenantMain } from '../../bin/disable-tenant.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

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

function withTransactionFactory(pool: Pool) {
  return async function withTransaction<T>(
    fn: (c: { query: Pool['query'] }) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(client);
      await client.query('COMMIT');
      return r;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // best-effort
      }
      throw e;
    } finally {
      client.release();
    }
  };
}

function makeTenantRow(id: string, kek: Buffer, overrides: Partial<TenantRow> = {}): TenantRow {
  const { wrappedDek } = generateTenantDek(kek);
  return {
    id,
    mode: 'delegated',
    client_id: 'cid',
    client_secret_ref: null,
    tenant_id: 'tid',
    cloud_type: 'global',
    redirect_uri_allowlist: [],
    cors_origins: [],
    allowed_scopes: [],
    enabled_tools: null,
    wrapped_dek: wrappedDek,
    slug: null,
    disabled_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('plan 03-05 Task 3 — bin/disable-tenant.mjs cascade (SC#4, TENANT-07)', () => {
  it('disables + cryptoshreds + evicts + revokes api keys', async () => {
    const pool = await makePool();
    const kek = crypto.randomBytes(32);
    const redis = new MemoryRedisFacade();
    const publishSpy = vi.spyOn(redis, 'publish');
    const tenantPool = new TenantPool(redis, kek);

    const id = '11111111-1111-4111-8111-111111111111';
    const row = makeTenantRow(id, kek);
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id, wrapped_dek)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [id, row.mode, row.client_id, row.tenant_id, JSON.stringify(row.wrapped_dek)]
    );
    await pool.query(
      `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix)
         VALUES ('k1', $1, 'default', 'hash-value', 'suf4')`,
      [id]
    );

    // Seed MSAL + PKCE entries in Redis
    await redis.set(`mcp:cache:${id}:cid:user:scope`, '{}', 'EX', 3600);
    await redis.set(`mcp:cache:${id}:cid:appOnly:sc2`, '{}', 'EX', 3600);
    await redis.set(`mcp:pkce:${id}:challenge`, '{}', 'EX', 600);

    // Seed pool entry so evict has something to remove
    await tenantPool.acquire(row);
    expect(tenantPool.has(id)).toBe(true);

    const result = await disableTenantMain([id], {
      postgres: {
        getPool: () => pool,
        withTransaction: withTransactionFactory(pool),
      },
      redis: { getRedis: () => redis },
      tenantPool,
    });

    // Result payload shape
    expect(result.disabled).toBe(id);
    expect(result.cacheKeysDeleted).toBe(2);
    expect(result.pkceKeysDeleted).toBe(1);
    expect(result.apiKeysRevoked).toBe(1);

    // DB assertions
    const tRows = await pool.query(`SELECT wrapped_dek, disabled_at FROM tenants WHERE id = $1`, [
      id,
    ]);
    expect(tRows.rows[0].wrapped_dek).toBeNull();
    expect(tRows.rows[0].disabled_at).not.toBeNull();

    const kRows = await pool.query(`SELECT revoked_at FROM api_keys WHERE tenant_id = $1`, [id]);
    expect(kRows.rows[0].revoked_at).not.toBeNull();

    // Redis cleanup
    expect(await redis.keys(`mcp:cache:${id}:*`)).toEqual([]);
    expect(await redis.keys(`mcp:pkce:${id}:*`)).toEqual([]);

    // Pool eviction
    expect(tenantPool.has(id)).toBe(false);
    expect(publishSpy).toHaveBeenCalledWith('mcp:api-key-revoke', 'k1');

    await tenantPool.drain();
  });

  it('rejects unknown tenant id with tenant_not_found', async () => {
    const pool = await makePool();
    const kek = crypto.randomBytes(32);
    const redis = new MemoryRedisFacade();
    const tenantPool = new TenantPool(redis, kek);

    const bogusId = 'deadbeef-dead-4bee-beef-deadbeefdead';

    await expect(
      disableTenantMain([bogusId], {
        postgres: {
          getPool: () => pool,
          withTransaction: withTransactionFactory(pool),
        },
        redis: { getRedis: () => redis },
        tenantPool,
      })
    ).rejects.toThrow(/tenant_not_found/);

    // No DB rows created
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM tenants`);
    expect(r.rows[0].n).toBe(0);

    await tenantPool.drain();
  });

  it('refuses when redis.status === reconnecting (Pitfall 6 guard)', async () => {
    const pool = await makePool();
    const kek = crypto.randomBytes(32);
    const redis = {
      status: 'reconnecting' as const,
      async get() {
        return null;
      },
      async set() {
        return 'OK';
      },
      async del() {
        return 0;
      },
      async keys() {
        return [];
      },
    };
    const tenantPool = new TenantPool(new MemoryRedisFacade(), kek);

    const id = '22222222-2222-4222-8222-222222222222';
    const row = makeTenantRow(id, kek);
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id, wrapped_dek)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [id, row.mode, row.client_id, row.tenant_id, JSON.stringify(row.wrapped_dek)]
    );

    await expect(
      disableTenantMain([id], {
        postgres: {
          getPool: () => pool,
          withTransaction: withTransactionFactory(pool),
        },
        redis: { getRedis: () => redis },
        tenantPool,
      })
    ).rejects.toThrow(/not ready|retry/i);

    // DB must remain unchanged — disabled_at still NULL.
    const r = await pool.query(`SELECT disabled_at FROM tenants WHERE id = $1`, [id]);
    expect(r.rows[0].disabled_at).toBeNull();

    await tenantPool.drain();
  });

  it('rejects when no tenant id argv is supplied', async () => {
    await expect(
      disableTenantMain([], {
        postgres: {
          getPool: () => ({ query: async () => ({ rows: [] }) }),
          withTransaction: async () => {},
        },
        redis: { getRedis: () => new MemoryRedisFacade() },
        tenantPool: new TenantPool(new MemoryRedisFacade(), crypto.randomBytes(32)),
      })
    ).rejects.toThrow(/Usage|tenant-id/i);
  });
});
