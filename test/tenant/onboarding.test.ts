/**
 * Plan 03-01 Task 3 — tenant onboarding smoke (Wave 1 stub).
 *
 * Wave 1 coverage: assert that the fixture helper INSERTs a row and that
 * SELECT returns it. End-to-end onboarding — tool call on /t/{id}/mcp —
 * is deferred to Wave 5 where `loadTenant` lands in 03-08 and the tenant
 * pool in 03-05. This stub guards the fixtures.ts contract so sibling
 * plans can rely on it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTenantFixture,
  cleanupTenantFixture,
  makeTenantId,
} from '../setup/fixtures.js';

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

describe('plan 03-01 — tenant onboarding (Wave 1)', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = await makePool();
  });

  it('fixtures INSERT a row and SELECT reflects it', async () => {
    const id = makeTenantId();
    const row = await createTenantFixture(pool, { id, mode: 'app-only' });
    expect(row.id).toBe(id);
    expect(row.mode).toBe('app-only');
    expect(row.wrapped_dek).toBeNull();

    const r = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1`, [id]);
    expect(r.rows).toHaveLength(1);
  });

  it('cleanup removes the tenant row', async () => {
    const id = makeTenantId();
    await createTenantFixture(pool, { id });
    await cleanupTenantFixture(pool, id);

    const r = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1`, [id]);
    expect(r.rows).toHaveLength(0);
  });

  it('supports multiple concurrent fixtures without collision', async () => {
    const ids = [makeTenantId(), makeTenantId(), makeTenantId()];
    await Promise.all(ids.map((id) => createTenantFixture(pool, { id })));
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM tenants ORDER BY id`
    );
    const found = new Set(r.rows.map((row) => row.id));
    for (const id of ids) {
      expect(found.has(id)).toBe(true);
    }
  });
});
