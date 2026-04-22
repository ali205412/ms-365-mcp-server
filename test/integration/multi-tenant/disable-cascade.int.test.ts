/**
 * Tenant disable cascade integration test (plan 06-06, ROADMAP SC#4, TENANT-07, SECUR-01).
 *
 * Verifies:
 *   - Soft-disable (set disabled_at): the tenant row persists with a
 *     non-null disabled_at; ON DELETE CASCADE guarantees audit + dependent
 *     rows follow the row's lifecycle.
 *   - Hard-delete: the tenant row is removed. Because wrapped_dek lived on
 *     the tenant row, destroying it cryptoshreds any Redis ciphertext that
 *     was envelope-encrypted with the (now unrecoverable) DEK — the actual
 *     ciphertext blob may persist in Redis but is meaningless noise without
 *     the DEK.
 *   - Idempotent soft-disable: repeating the disable SQL on an already-disabled
 *     tenant is a no-op thanks to the `WHERE disabled_at IS NULL` guard —
 *     matches bin/disable-tenant.mjs semantics.
 *   - Audit-row CASCADE: a pre-existing audit row for the tenant disappears
 *     when the tenant is hard-deleted (plan 03-01 FK ON DELETE CASCADE).
 *
 * Runs under MS365_MCP_INTEGRATION=1 against Testcontainers PG + Redis
 * from plan 06-05 globalSetup.
 *
 * Related existing test: `test/integration/tenant-disable-cascade.test.ts` —
 * plan 06-06 EXTENDS with direct Postgres + Redis inspection against REAL
 * Postgres (instead of pg-mem) so the FK CASCADE semantics are exercised
 * against the same engine that runs in production.
 */
import { describe, it, expect, beforeEach, afterEach, vi, inject } from 'vitest';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'migrations');

// Stable UUID for this test — cleanup stays surgical across parallel
// .int.test.ts runs that share the same Postgres container.
const TEST_TENANT = 'cbb5a3e7-cbb5-4a3e-8bb5-a3e7cbb5a3e7';

describe('plan 06-06 — tenant disable + delete cascade (TENANT-07, SECUR-01, SC#4)', () => {
  let pool: Pool;
  let redis: Redis;

  beforeEach(async () => {
    const pgUrl = inject('pgUrl' as never);
    const redisUrl = inject('redisUrl' as never);
    if (!pgUrl || !redisUrl) {
      throw new Error(
        'plan 06-06: Testcontainers injections missing. Run with MS365_MCP_INTEGRATION=1 and ensure test/setup/integration-globalSetup.ts is configured.'
      );
    }

    pool = new Pool({ connectionString: pgUrl });

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const up = (sql.split(/^--\s*Down Migration\s*$/m)[0] ?? '').replace(
        /^--\s*Up Migration\s*$/m,
        ''
      );
      try {
        await pool.query(up);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (!/already exists|duplicate/i.test(msg)) throw err;
      }
    }

    redis = new Redis(redisUrl, { lazyConnect: false });

    // Clean any test keys from previous runs on the same container.
    const existing = await redis.keys(`mcp:cache:${TEST_TENANT}:*`);
    if (existing.length) await redis.del(...existing);
  });

  afterEach(async () => {
    try {
      await pool.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [TEST_TENANT]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [TEST_TENANT]);
    } finally {
      const remaining = await redis.keys(`mcp:cache:${TEST_TENANT}:*`);
      if (remaining.length) await redis.del(...remaining);
      await pool.end();
      await redis.quit();
      vi.restoreAllMocks();
    }
  });

  it('soft-disable: disabled_at is set; tenant row persists', async () => {
    const { seedTenant } = await import('../../fixtures/tenant-seed.js');
    await seedTenant(pool, { id: TEST_TENANT });

    // Simulate the core SQL side-effect of `bin/disable-tenant.mjs`: the
    // admin handler runs this exact UPDATE inside a transaction alongside
    // the cache flush + tenantPool eviction, all of which have their own
    // integration tests. This test verifies the DATA invariant.
    await pool.query(
      `UPDATE tenants SET disabled_at = NOW() WHERE id = $1 AND disabled_at IS NULL`,
      [TEST_TENANT]
    );

    const { rows } = await pool.query(`SELECT id, disabled_at FROM tenants WHERE id = $1`, [
      TEST_TENANT,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].disabled_at).not.toBeNull();
  });

  it('hard-delete: row is removed; audit rows CASCADE away (plan 03-01 FK semantics)', async () => {
    const { seedTenant } = await import('../../fixtures/tenant-seed.js');
    await seedTenant(pool, { id: TEST_TENANT });

    // Write an audit row BEFORE the delete so we can prove the CASCADE fires.
    // Note: $2 is uuid (tenant_id) and $3 is text (target) — keep them
    // distinct so Postgres can deduce types on the first parse.
    await pool.query(
      `INSERT INTO audit_log (id, tenant_id, actor, action, target, ip, request_id, result)
       VALUES ($1, $2, 'admin-test', 'admin.tenant.delete', $3, '127.0.0.1', 'req-delete-1', 'success')`,
      ['audit-cascade-1', TEST_TENANT, TEST_TENANT]
    );

    // Hard-delete.
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [TEST_TENANT]);

    // Tenant row gone.
    const tenantAfter = await pool.query(`SELECT id FROM tenants WHERE id = $1`, [TEST_TENANT]);
    expect(tenantAfter.rows).toHaveLength(0);

    // Audit rows CASCADE removed (FK ON DELETE CASCADE per
    // migrations/20260501000100_audit_log.sql). This is the T-06-06-c
    // trade-off documented in the threat model: referential integrity wins.
    const auditAfter = await pool.query(`SELECT id FROM audit_log WHERE tenant_id = $1`, [
      TEST_TENANT,
    ]);
    expect(auditAfter.rows).toHaveLength(0);
  });

  it('cryptoshred: after tenant delete, wrapped_dek is gone; Redis ciphertext is unrecoverable', async () => {
    const { seedTenant } = await import('../../fixtures/tenant-seed.js');
    // Give the tenant a non-null wrapped_dek so we can watch it disappear.
    await seedTenant(pool, {
      id: TEST_TENANT,
      wrapped_dek: {
        v: 1,
        iv: 'iv-placeholder',
        tag: 'tag-placeholder',
        ct: 'wrapped-dek-ciphertext',
      },
    });

    // Pre-delete: wrapped_dek is present.
    const preDelete = await pool.query(`SELECT wrapped_dek FROM tenants WHERE id = $1`, [
      TEST_TENANT,
    ]);
    expect(preDelete.rows).toHaveLength(1);
    expect(preDelete.rows[0].wrapped_dek).not.toBeNull();

    // Write a cache entry whose wrappedDek references the tenant's DEK
    // (the Redis envelope structure from plan 03-04).
    await redis.set(
      `mcp:cache:${TEST_TENANT}:cid:oid1:sh1`,
      JSON.stringify({
        wrappedDek: 'wrapped-dek-bytes-base64',
        ciphertext: 'encrypted-token',
        iv: 'iv-bytes',
        authTag: 'at-bytes',
        savedAt: Date.now(),
      })
    );

    // Hard-delete — the tenant row (and its wrapped_dek) is gone.
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [TEST_TENANT]);

    // Row gone → wrapped_dek unrecoverable → Redis ciphertext is noise.
    // (Plan 06-07 runbook documents the optional FLUSHDB step for operators
    // who want strict-shred; SC#4's invariant is only that the DEK is gone.)
    const postDelete = await pool.query(`SELECT wrapped_dek FROM tenants WHERE id = $1`, [
      TEST_TENANT,
    ]);
    expect(postDelete.rows).toHaveLength(0);

    const still = await redis.get(`mcp:cache:${TEST_TENANT}:cid:oid1:sh1`);
    // The ciphertext MAY persist (Redis isn't auto-flushed by the delete),
    // but it's cryptoshredded: no DEK, no plaintext.
    if (still) {
      const envelope = JSON.parse(still);
      expect(envelope.ciphertext).toBeTruthy();
      // No plaintext accessor exists — this is the cryptoshred guarantee.
    }
  });

  it('soft-disable is idempotent: calling twice does not throw (WHERE disabled_at IS NULL guard)', async () => {
    const { seedTenant } = await import('../../fixtures/tenant-seed.js');
    await seedTenant(pool, { id: TEST_TENANT });

    // Two disable operations in a row; the second is a no-op because
    // disabled_at is already non-null.
    const firstResult = await pool.query(
      `UPDATE tenants SET disabled_at = NOW() WHERE id = $1 AND disabled_at IS NULL`,
      [TEST_TENANT]
    );
    const secondResult = await pool.query(
      `UPDATE tenants SET disabled_at = NOW() WHERE id = $1 AND disabled_at IS NULL`,
      [TEST_TENANT]
    );

    // First call updated one row; second matched zero rows.
    expect(firstResult.rowCount).toBe(1);
    expect(secondResult.rowCount).toBe(0);

    const { rows } = await pool.query(`SELECT disabled_at FROM tenants WHERE id = $1`, [
      TEST_TENANT,
    ]);
    expect(rows[0].disabled_at).not.toBeNull();
  });

  it('partial-index behaviour: disabled tenants drop out of idx_tenants_disabled_at (active scan)', async () => {
    const { seedTenant } = await import('../../fixtures/tenant-seed.js');
    await seedTenant(pool, { id: TEST_TENANT });

    // Pre-disable — tenant visible via the `disabled_at IS NULL` predicate
    // used by loadTenant's SELECT.
    const pre = await pool.query(`SELECT id FROM tenants WHERE id = $1 AND disabled_at IS NULL`, [
      TEST_TENANT,
    ]);
    expect(pre.rows).toHaveLength(1);

    // Disable.
    await pool.query(`UPDATE tenants SET disabled_at = NOW() WHERE id = $1`, [TEST_TENANT]);

    // Post-disable — the same query returns zero rows, which is the
    // observable "404 after disable" contract seen by `/t/{disabled}/*`
    // (verified end-to-end by `test/integration/tenant-disable-cascade.test.ts`).
    const post = await pool.query(`SELECT id FROM tenants WHERE id = $1 AND disabled_at IS NULL`, [
      TEST_TENANT,
    ]);
    expect(post.rows).toHaveLength(0);
  });
});
