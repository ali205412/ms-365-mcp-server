/**
 * Plan 03-04 Task 2 — bin/rotate-kek.mjs tests (D-12).
 *
 * Uses pg-mem as the injected pool so the test never touches a real
 * Postgres. Mirrors the test/bin/create-tenant.test.ts pattern.
 *
 * Behaviors:
 *   - 3 tenants seeded with old-KEK-wrapped DEKs; main() rewraps all 3.
 *   - After rotate: unwrapTenantDek(row.wrapped_dek, newKek) succeeds per tenant
 *     and returns the original DEK bytes.
 *   - Idempotency: second rotate with same old/new → skipped=N (old KEK fails
 *     to unwrap because the rows now carry new-KEK envelopes).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateTenantDek, unwrapTenantDek } from '../../src/lib/crypto/dek.js';
import { wrapDek } from '../../src/lib/crypto/envelope.js';
// @ts-expect-error — .mjs import has no types; tests rely on runtime export shape.
import { main as rotateKekMain } from '../../bin/rotate-kek.mjs';

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
    .filter((f) => f.startsWith('20260501000000') && f.endsWith('.sql'))
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

interface TenantSeed {
  id: string;
  dek: Buffer;
}

async function seedTenant(pool: Pool, id: string, kek: Buffer): Promise<TenantSeed> {
  const { dek, wrappedDek } = generateTenantDek(kek);
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id, cloud_type, wrapped_dek)
       VALUES ($1, 'delegated', 'c', 't', 'global', $2::jsonb)`,
    [id, JSON.stringify(wrappedDek)]
  );
  return { id, dek };
}

describe('plan 03-04 Task 2 — bin/rotate-kek.mjs', () => {
  let pool: Pool;
  const oldKek = crypto.randomBytes(32);
  const newKek = crypto.randomBytes(32);

  beforeEach(async () => {
    pool = await makePool();
  });

  it('rewraps every tenant DEK from old KEK to new KEK', async () => {
    const seeds = await Promise.all([
      seedTenant(pool, '11111111-1111-4111-8111-111111111111', oldKek),
      seedTenant(pool, '22222222-2222-4222-8222-222222222222', oldKek),
      seedTenant(pool, '33333333-3333-4333-8333-333333333333', oldKek),
    ]);

    const result = await rotateKekMain(
      [`--old=${oldKek.toString('base64')}`, `--new=${newKek.toString('base64')}`],
      { pool }
    );

    expect(result).toEqual({ rewrapped: 3, skipped: 0 });

    // Assert each tenant's wrapped_dek now unwraps cleanly with newKek
    // and yields the original DEK bytes.
    for (const seed of seeds) {
      const r = await pool.query<{ wrapped_dek: unknown }>(
        'SELECT wrapped_dek FROM tenants WHERE id = $1',
        [seed.id]
      );
      const stored = r.rows[0]!.wrapped_dek;
      const env =
        typeof stored === 'string'
          ? JSON.parse(stored)
          : (stored as Parameters<typeof unwrapTenantDek>[0]);
      const recovered = unwrapTenantDek(env, newKek);
      expect(recovered.equals(seed.dek)).toBe(true);
    }
  });

  it('is idempotent: running rotate twice with the same old/new skips all rows on the second run', async () => {
    await seedTenant(pool, '44444444-4444-4444-8444-444444444444', oldKek);
    await seedTenant(pool, '55555555-5555-4555-8555-555555555555', oldKek);

    const first = await rotateKekMain(
      [`--old=${oldKek.toString('base64')}`, `--new=${newKek.toString('base64')}`],
      { pool }
    );
    expect(first).toEqual({ rewrapped: 2, skipped: 0 });

    // Second run: old KEK now fails to unwrap all rows.
    const second = await rotateKekMain(
      [`--old=${oldKek.toString('base64')}`, `--new=${newKek.toString('base64')}`],
      { pool }
    );
    expect(second).toEqual({ rewrapped: 0, skipped: 2 });
  });

  it('skips rows whose wrapped_dek is NULL (03-01 placeholder tenants)', async () => {
    // Insert a tenant without wrapped_dek (mirrors 03-01's create-tenant default).
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id, cloud_type, wrapped_dek)
         VALUES ('66666666-6666-4666-8666-666666666666','delegated','c','t','global',NULL)`
    );

    const result = await rotateKekMain(
      [`--old=${oldKek.toString('base64')}`, `--new=${newKek.toString('base64')}`],
      { pool }
    );
    expect(result).toEqual({ rewrapped: 0, skipped: 0 });
  });

  it('rejects when either --old or --new decodes to the wrong length', async () => {
    const badKey = Buffer.alloc(16, 0).toString('base64');
    const okKey = crypto.randomBytes(32).toString('base64');

    await expect(rotateKekMain([`--old=${badKey}`, `--new=${okKey}`], { pool })).rejects.toThrow(
      /32 bytes/
    );
    await expect(rotateKekMain([`--old=${okKey}`, `--new=${badKey}`], { pool })).rejects.toThrow(
      /32 bytes/
    );
  });

  it('rejects missing flags', async () => {
    await expect(rotateKekMain([], { pool })).rejects.toThrow(/--old/);
  });

  it('uses wrapDek directly to seed envelopes before rotation (sanity)', async () => {
    // Extra sanity: demonstrate the rotate helper works on manually wrapped tenants.
    const dek = crypto.randomBytes(32);
    const wrappedDek = wrapDek(dek, oldKek);
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id, cloud_type, wrapped_dek)
         VALUES ('77777777-7777-4777-8777-777777777777','delegated','c','t','global',$1::jsonb)`,
      [JSON.stringify(wrappedDek)]
    );
    const result = await rotateKekMain(
      [`--old=${oldKek.toString('base64')}`, `--new=${newKek.toString('base64')}`],
      { pool }
    );
    expect(result).toEqual({ rewrapped: 1, skipped: 0 });

    const r = await pool.query<{ wrapped_dek: unknown }>(
      `SELECT wrapped_dek FROM tenants WHERE id = '77777777-7777-4777-8777-777777777777'`
    );
    const stored = r.rows[0]!.wrapped_dek;
    const env =
      typeof stored === 'string'
        ? JSON.parse(stored)
        : (stored as Parameters<typeof unwrapTenantDek>[0]);
    expect(unwrapTenantDek(env, newKek).equals(dek)).toBe(true);
  });
});
