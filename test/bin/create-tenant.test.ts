/**
 * Plan 03-01 Task 3 — bin/create-tenant.mjs programmatic test.
 *
 * Uses pg-mem as the injected pool so the test never touches a real
 * Postgres. Mirrors the keytar-removal.test.ts pattern (test/keytar-removal
 * Test 12): import main() directly and invoke with argv + a `deps.pool`
 * override.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs import has no types; tests rely on runtime export shape.
import { main as createTenantMain } from '../../bin/create-tenant.mjs';

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
  // Apply just the tenants migration — create-tenant only needs the table.
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

describe('plan 03-01 — bin/create-tenant.mjs', () => {
  let pool: Pool;
  let warnings: string[];
  let deps: { pool: Pool; logger: { warn: (m: string) => void } };

  beforeEach(async () => {
    pool = await makePool();
    warnings = [];
    deps = {
      pool,
      logger: {
        warn: (m: string) => warnings.push(m),
      },
    };
  });

  it('inserts a tenant row with wrapped_dek=NULL and returns its id', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const result = await createTenantMain(
      [
        `--id=${id}`,
        '--client-id=00000000-0000-0000-0000-000000000001',
        '--tenant-id=00000000-0000-0000-0000-000000000002',
        '--mode=delegated',
      ],
      deps
    );
    expect(result).toEqual({ id });

    const r = await pool.query<{ id: string; mode: string; wrapped_dek: unknown }>(
      `SELECT id, mode, wrapped_dek FROM tenants WHERE id = $1`,
      [id]
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.mode).toBe('delegated');
    expect(r.rows[0]!.wrapped_dek).toBeNull();
  });

  it('logs a warning that wrapped_dek=NULL must be completed by 03-04', async () => {
    await createTenantMain(
      [
        '--client-id=c',
        '--tenant-id=t',
        '--mode=delegated',
        '--id=22222222-2222-4222-8222-222222222222',
      ],
      deps
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/03-04/);
    expect(warnings[0]).toMatch(/wrapped_dek=NULL/i);
  });

  it('rejects duplicate --id with tenant_already_exists', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    await createTenantMain(
      [`--id=${id}`, '--client-id=c', '--tenant-id=t', '--mode=delegated'],
      deps
    );
    await expect(
      createTenantMain(
        [`--id=${id}`, '--client-id=c', '--tenant-id=t', '--mode=delegated'],
        deps
      )
    ).rejects.toThrow(/tenant_already_exists/);
  });

  it('rejects invalid --mode', async () => {
    await expect(
      createTenantMain(
        [
          '--id=44444444-4444-4444-8444-444444444444',
          '--client-id=c',
          '--tenant-id=t',
          '--mode=bogus',
        ],
        deps
      )
    ).rejects.toThrow(/invalid --mode/);
  });

  it('rejects missing required flags', async () => {
    await expect(createTenantMain(['--mode=delegated'], deps)).rejects.toThrow(/--client-id/);
    await expect(createTenantMain(['--client-id=c', '--mode=delegated'], deps)).rejects.toThrow(
      /--tenant-id/
    );
    await expect(createTenantMain(['--client-id=c', '--tenant-id=t'], deps)).rejects.toThrow(
      /--mode/
    );
  });

  it('accepts optional --slug and --cloud-type', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    await createTenantMain(
      [
        `--id=${id}`,
        '--client-id=c',
        '--tenant-id=t',
        '--mode=delegated',
        '--slug=example-corp',
        '--cloud-type=china',
      ],
      deps
    );
    const r = await pool.query<{ slug: string; cloud_type: string }>(
      `SELECT slug, cloud_type FROM tenants WHERE id = $1`,
      [id]
    );
    expect(r.rows[0]!.slug).toBe('example-corp');
    expect(r.rows[0]!.cloud_type).toBe('china');
  });
});
