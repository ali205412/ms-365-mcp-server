/**
 * Plan 03-01 Task 2 — src/lib/postgres.ts unit tests.
 *
 * Uses pg-mem as a drop-in pg.Pool so the tests don't need Docker. The
 * singleton is reset between tests via `__setPoolForTesting(null)` — this
 * test-only export exists precisely for this purpose.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import {
  getPool,
  withTransaction,
  shutdown,
  readinessCheck,
  __setPoolForTesting,
} from '../../src/lib/postgres.js';

function makePgMemPool(): Pool {
  const db = newDb();
  db.registerExtension('pgcrypto', () => {});
  const { Pool: PgMemPool } = db.adapters.createPg();
  return new PgMemPool() as Pool;
}

describe('plan 03-01 — src/lib/postgres', () => {
  let envBackup: string | undefined;

  beforeEach(() => {
    envBackup = process.env.MS365_MCP_DATABASE_URL;
    __setPoolForTesting(null);
  });

  afterEach(() => {
    if (envBackup === undefined) {
      delete process.env.MS365_MCP_DATABASE_URL;
    } else {
      process.env.MS365_MCP_DATABASE_URL = envBackup;
    }
    __setPoolForTesting(null);
  });

  it('throws when MS365_MCP_DATABASE_URL AND PGHOST are both unset in HTTP mode', () => {
    delete process.env.MS365_MCP_DATABASE_URL;
    const prevPgHost = process.env.PGHOST;
    delete process.env.PGHOST;
    try {
      expect(() => getPool()).toThrow(/MS365_MCP_DATABASE_URL/);
    } finally {
      if (prevPgHost !== undefined) process.env.PGHOST = prevPgHost;
    }
  });

  it('getPool() returns the same instance on repeated calls (singleton)', () => {
    const injected = makePgMemPool();
    __setPoolForTesting(injected);
    const a = getPool();
    const b = getPool();
    expect(a).toBe(b);
    expect(a).toBe(injected);
  });

  it('withTransaction commits on success and returns the handler result', async () => {
    __setPoolForTesting(makePgMemPool());
    await getPool().query('CREATE TABLE counts (n int)');

    const result = await withTransaction(async (c) => {
      await c.query('INSERT INTO counts VALUES (1)');
      await c.query('INSERT INTO counts VALUES (2)');
      return 'committed';
    });

    expect(result).toBe('committed');
    const rows = await getPool().query<{ n: number }>('SELECT n FROM counts ORDER BY n');
    expect(rows.rows.map((r) => r.n)).toEqual([1, 2]);
  });

  it('withTransaction calls ROLLBACK on throw AND rethrows the original error', async () => {
    __setPoolForTesting(makePgMemPool());
    await getPool().query('CREATE TABLE rollback_probe (n int)');

    // pg-mem 3.x does not implement transactional data atomicity, so we
    // assert the ROLLBACK statement was issued rather than the absence of
    // the row in the table. Real Postgres verifies the data-atomic property
    // during integration tests (testcontainers, Wave 0) — this unit test
    // guards the code path that issues the ROLLBACK.
    const pool = getPool();
    const origConnect = pool.connect.bind(pool);
    const queries: string[] = [];
    (pool as Pool & { connect: typeof pool.connect }).connect = async (
      ...args: Parameters<typeof pool.connect>
    ) => {
      const client = await origConnect(...(args as []));
      const origQuery = client.query.bind(client);
      client.query = ((...qargs: unknown[]) => {
        const arg = qargs[0];
        if (typeof arg === 'string') queries.push(arg.trim().split(/\s+/)[0] ?? '');
        return origQuery(...(qargs as []));
      }) as typeof client.query;
      return client;
    };

    await expect(
      withTransaction(async (c) => {
        await c.query('INSERT INTO rollback_probe VALUES (42)');
        throw new Error('synthetic fn failure');
      })
    ).rejects.toThrow('synthetic fn failure');

    expect(queries).toContain('BEGIN');
    expect(queries).toContain('ROLLBACK');
    expect(queries).not.toContain('COMMIT');
  });

  it('withTransaction releases the client even when fn throws (Pitfall 4 guard)', async () => {
    __setPoolForTesting(makePgMemPool());
    const pool = getPool();

    // Spy on connect() so we can assert the returned client had release()
    // called exactly once after the fn throws. pg-mem's PoolClient.release
    // is a no-op stub; wrapping it lets us verify the contract.
    const origConnect = pool.connect.bind(pool);
    let releaseCalls = 0;
    (pool as Pool & { connect: typeof pool.connect }).connect = async (
      ...args: Parameters<typeof pool.connect>
    ) => {
      const client = await origConnect(...(args as []));
      const origRelease = client.release.bind(client);
      // Parameters vary by pg version; accept unknown[] for signature-compat.
      client.release = ((...rargs: unknown[]) => {
        releaseCalls += 1;
        return origRelease(...(rargs as []));
      }) as typeof client.release;
      return client;
    };

    await expect(
      withTransaction(async () => {
        throw new Error('release-path probe');
      })
    ).rejects.toThrow('release-path probe');

    expect(releaseCalls).toBe(1);
  });

  it('readinessCheck returns true when SELECT 1 succeeds', async () => {
    __setPoolForTesting(makePgMemPool());
    await expect(readinessCheck()).resolves.toBe(true);
  });

  it('readinessCheck returns false when the pool query throws', async () => {
    __setPoolForTesting(makePgMemPool());
    const pool = getPool();
    // Replace query with a rejecting stub — readinessCheck must swallow it.
    pool.query = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused')) as unknown as typeof pool.query;
    await expect(readinessCheck()).resolves.toBe(false);
  });

  it('shutdown() is idempotent — second call is a no-op when pool is null', async () => {
    __setPoolForTesting(makePgMemPool());
    await shutdown();
    // pool is now null — a second call returns without touching anything.
    await expect(shutdown()).resolves.toBeUndefined();
  });

  it('MS365_MCP_DB_POOL_MAX env var is honored when constructing the pool', () => {
    process.env.MS365_MCP_DATABASE_URL = 'postgres://localhost/ignored';
    process.env.MS365_MCP_DB_POOL_MAX = '5';
    try {
      const pool = getPool();
      // pg.Pool exposes `options.max` on the internal config object.
      const max = (pool as unknown as { options: { max: number } }).options.max;
      expect(max).toBe(5);
    } finally {
      delete process.env.MS365_MCP_DB_POOL_MAX;
      __setPoolForTesting(null);
    }
  });
});
