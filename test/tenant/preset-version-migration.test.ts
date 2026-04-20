/**
 * Plan 05-03 Task 2 — preset_version migration + TenantRow plumbing tests.
 *
 * Asserts that migration 20260702000000_preset_version.sql:
 *   1. Adds tenants.preset_version as NOT NULL text DEFAULT 'essentials-v1'.
 *   2. Backfills existing rows (pre-migration rows get 'essentials-v1').
 *   3. Lets INSERTs omit preset_version (default kicks in).
 *   4. Is clean-rollback-safe (down migration drops the column).
 *
 * Uses pg-mem (same pattern as test/tenant/postgres-schema.test.ts) so the
 * tests run without a real Postgres + no docker.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb, type IMemoryDb } from 'pg-mem';
import type { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

interface MigrationPair {
  file: string;
  up: string;
  down: string;
}

function stripPgcryptoExtensionStmts(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/\bextension\b.*\bpgcrypto\b/i.test(line))
    .join('\n');
}

function listMigrations(): MigrationPair[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const parts = sql.split(/^--\s*Down Migration\s*$/m);
      const up = (parts[0] ?? '').replace(/^--\s*Up Migration\s*$/m, '');
      const down = parts[1] ?? '';
      return {
        file,
        up: stripPgcryptoExtensionStmts(up),
        down: stripPgcryptoExtensionStmts(down),
      };
    });
}

function makePool(): { db: IMemoryDb; pool: Pool } {
  const db = newDb();
  db.registerExtension('pgcrypto', () => {
    // no-op — we never depend on gen_random_uuid at the app layer
  });
  const { Pool } = db.adapters.createPg();
  return { db, pool: new Pool() as Pool };
}

describe('plan 05-03 task 2 — tenants.preset_version migration', () => {
  let pool: Pool;
  let migrations: MigrationPair[];

  beforeEach(() => {
    ({ pool } = makePool());
    migrations = listMigrations();
  });

  it('preset_version migration is discovered in lex order after the Phase 4 subscriptions migration', () => {
    const files = migrations.map((m) => m.file);
    const subIdx = files.indexOf('20260601000000_subscriptions.sql');
    const presetIdx = files.indexOf('20260702000000_preset_version.sql');
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(presetIdx).toBeGreaterThanOrEqual(0);
    expect(presetIdx).toBeGreaterThan(subIdx);
  });

  it('applying all migrations including preset_version leaves tenants.preset_version as NOT NULL with default essentials-v1', async () => {
    for (const m of migrations) {
      await pool.query(m.up);
    }

    const { rows } = await pool.query<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
      data_type: string;
    }>(
      `SELECT column_name, is_nullable, column_default, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tenants'
         AND column_name = 'preset_version'`
    );

    expect(rows.length).toBe(1);
    const col = rows[0]!;
    expect(col.data_type).toBe('text');
    expect(col.is_nullable).toBe('NO');
    // Postgres formats the default as 'essentials-v1'::text; pg-mem may
    // simply echo 'essentials-v1'. Match either by substring.
    expect((col.column_default ?? '')).toContain('essentials-v1');
  });

  it('backfills pre-existing rows (inserted before migration) to preset_version = essentials-v1', async () => {
    // Apply every migration EXCEPT the preset_version one; seed a row; then
    // apply the last migration and confirm backfill.
    const beforePreset = migrations.filter(
      (m) => m.file !== '20260702000000_preset_version.sql'
    );
    for (const m of beforePreset) {
      await pool.query(m.up);
    }
    const tenantId = '12345678-1234-4234-8234-1234567890ab';
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id)
       VALUES ($1, 'delegated', 'app-c', 'az-t')`,
      [tenantId]
    );

    // Pre-condition: row exists, has NO preset_version column.
    const pre = await pool.query<{ count: string }>(
      `SELECT count(*) FROM tenants WHERE id = $1`,
      [tenantId]
    );
    expect(Number(pre.rows[0]!.count)).toBe(1);

    // Apply preset migration (the backfill UPDATE runs alongside ADD COLUMN).
    const preset = migrations.find((m) => m.file === '20260702000000_preset_version.sql');
    expect(preset).toBeDefined();
    await pool.query(preset!.up);

    const post = await pool.query<{ preset_version: string }>(
      `SELECT preset_version FROM tenants WHERE id = $1`,
      [tenantId]
    );
    expect(post.rows[0]!.preset_version).toBe('essentials-v1');
  });

  it('new INSERT without preset_version field reads back as essentials-v1 (default applied)', async () => {
    for (const m of migrations) {
      await pool.query(m.up);
    }

    const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id)
       VALUES ($1, 'delegated', 'client-1', 'azure-tenant-1')`,
      [tenantId]
    );

    const { rows } = await pool.query<{ preset_version: string }>(
      `SELECT preset_version FROM tenants WHERE id = $1`,
      [tenantId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.preset_version).toBe('essentials-v1');
  });

  it('explicit preset_version on INSERT is honored (not overwritten by default)', async () => {
    for (const m of migrations) {
      await pool.query(m.up);
    }

    const tenantId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id, preset_version)
       VALUES ($1, 'delegated', 'client-2', 'azure-tenant-2', 'essentials-v2')`,
      [tenantId]
    );

    const { rows } = await pool.query<{ preset_version: string }>(
      `SELECT preset_version FROM tenants WHERE id = $1`,
      [tenantId]
    );
    expect(rows[0]!.preset_version).toBe('essentials-v2');
  });

  it('down migration drops the preset_version column cleanly', async () => {
    for (const m of migrations) {
      await pool.query(m.up);
    }

    const preset = migrations.find((m) => m.file === '20260702000000_preset_version.sql');
    expect(preset).toBeDefined();
    await pool.query(preset!.down);

    const { rows } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tenants'
         AND column_name = 'preset_version'`
    );
    expect(rows).toEqual([]);
  });
});
