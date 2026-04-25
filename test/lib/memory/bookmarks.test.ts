/**
 * Phase 7 Plan 07-03 — bookmark memory service contract.
 *
 * These tests pin SECUR-08 for bookmark persistence: every operation is
 * scoped by the explicit caller tenant id, including same-alias rows across
 * tenants.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { __setPoolForTesting } from '../../../src/lib/postgres.js';
import {
  deleteBookmark,
  getBookmarkCountsByAlias,
  listBookmarks,
  upsertBookmark,
} from '../../../src/lib/memory/bookmarks.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function makePool(): Pool {
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
  });
  const { Pool: PgMemPool } = db.adapters.createPg();
  return new PgMemPool() as Pool;
}

async function installSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE tenants (
      id uuid PRIMARY KEY
    );

    CREATE TABLE tenant_tool_bookmarks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      alias text NOT NULL,
      label text,
      note text,
      last_used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, alias)
    );

    CREATE INDEX idx_tenant_tool_bookmarks_tenant
      ON tenant_tool_bookmarks (tenant_id);
  `);
  await pool.query(`INSERT INTO tenants (id) VALUES ($1), ($2)`, [TENANT_A, TENANT_B]);
}

describe('Phase 7 Plan 07-03 Task 1 — bookmark service', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = makePool();
    await installSchema(pool);
    __setPoolForTesting(pool);
  });

  afterEach(async () => {
    __setPoolForTesting(null);
    await pool.end();
  });

  it('upsertBookmark inserts and updates on (tenant_id, alias)', async () => {
    const first = await upsertBookmark(TENANT_A, {
      alias: 'me.sendMail',
      label: 'mail sender',
      note: 'initial note',
    });
    const updated = await upsertBookmark(TENANT_A, {
      alias: 'me.sendMail',
      label: 'send mail',
      note: 'updated note',
    });

    expect(updated.id).toBe(first.id);
    expect(updated).toMatchObject({
      alias: 'me.sendMail',
      label: 'send mail',
      note: 'updated note',
    });

    const { rows } = await pool.query(
      `SELECT tenant_id, alias, label, note FROM tenant_tool_bookmarks WHERE tenant_id = $1`,
      [TENANT_A]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A,
      alias: 'me.sendMail',
      label: 'send mail',
      note: 'updated note',
    });
  });

  it('listBookmarks returns only rows where tenant_id = $1', async () => {
    await upsertBookmark(TENANT_A, {
      alias: 'me.sendMail',
      label: 'mail',
      note: 'A note',
    });
    await upsertBookmark(TENANT_B, {
      alias: 'me.sendMail',
      label: 'mail',
      note: 'B note',
    });
    await upsertBookmark(TENANT_A, {
      alias: 'me.ListMessages',
      label: 'inbox',
      note: 'A inbox',
    });

    const allA = await listBookmarks(TENANT_A);
    expect(allA.map((b) => b.alias).sort()).toEqual(['me.ListMessages', 'me.sendMail']);
    expect(allA.every((b) => !('tenantId' in b))).toBe(true);

    const filtered = await listBookmarks(TENANT_A, 'inbox');
    expect(filtered.map((b) => b.alias)).toEqual(['me.ListMessages']);
  });

  it('deleteBookmark deletes only tenant-owned rows by id, alias, or label', async () => {
    const rowA = await upsertBookmark(TENANT_A, {
      alias: 'me.sendMail',
      label: 'send mail',
      note: 'A',
    });
    await upsertBookmark(TENANT_B, {
      alias: 'me.sendMail',
      label: 'send mail',
      note: 'B',
    });

    await expect(deleteBookmark(TENANT_B, rowA.id)).resolves.toEqual({ deleted: false });
    expect(await listBookmarks(TENANT_A)).toHaveLength(1);

    await expect(deleteBookmark(TENANT_A, 'send mail')).resolves.toEqual({ deleted: true });
    expect(await listBookmarks(TENANT_A)).toEqual([]);
    expect(await listBookmarks(TENANT_B)).toHaveLength(1);
  });

  it('getBookmarkCountsByAlias counts only the caller tenant aliases', async () => {
    await upsertBookmark(TENANT_A, { alias: 'me.sendMail', label: 'send mail' });
    await upsertBookmark(TENANT_A, { alias: 'me.ListMessages', label: 'messages' });
    await upsertBookmark(TENANT_B, { alias: 'me.sendMail', label: 'tenant b send mail' });

    const countsA = await getBookmarkCountsByAlias(TENANT_A);
    const countsB = await getBookmarkCountsByAlias(TENANT_B);

    expect([...countsA.entries()].sort()).toEqual([
      ['me.ListMessages', 1],
      ['me.sendMail', 1],
    ]);
    expect([...countsB.entries()]).toEqual([['me.sendMail', 1]]);
  });
});
