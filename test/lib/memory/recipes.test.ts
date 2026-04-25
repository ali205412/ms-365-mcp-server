/**
 * Phase 7 Plan 07-04 — recipe memory service contract.
 *
 * These tests pin SECUR-08 for recipes: every persistence operation is
 * scoped by the explicit caller tenant id, including same-name rows across
 * tenants.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { __setPoolForTesting } from '../../../src/lib/postgres.js';
import {
  getRecipeByName,
  listRecipes,
  mergeRecipeParams,
  saveRecipe,
} from '../../../src/lib/memory/recipes.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function makePool(): Pool {
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
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

    CREATE TABLE tenant_tool_recipes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,
      alias text NOT NULL,
      params jsonb NOT NULL DEFAULT '{}'::jsonb,
      note text,
      last_run_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, name)
    );

    CREATE INDEX idx_tenant_tool_recipes_tenant
      ON tenant_tool_recipes (tenant_id);
  `);
  await pool.query(`INSERT INTO tenants (id) VALUES ($1), ($2)`, [TENANT_A, TENANT_B]);
}

describe('Phase 7 Plan 07-04 Task 1 — recipe service', () => {
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

  it('saveRecipe inserts and updates on (tenant_id, name)', async () => {
    const first = await saveRecipe(TENANT_A, {
      name: 'morning inbox',
      alias: 'me.mailFolders.messages.ListMessages',
      params: { mailFolderId: 'inbox', top: 10 },
      note: 'initial',
    });
    const updated = await saveRecipe(TENANT_A, {
      name: 'morning inbox',
      alias: 'me.mailFolders.messages.ListMessages',
      params: { mailFolderId: 'inbox', top: 25 },
      note: 'updated',
    });

    expect(updated.id).toBe(first.id);
    expect(updated).toMatchObject({
      name: 'morning inbox',
      alias: 'me.mailFolders.messages.ListMessages',
      params: { mailFolderId: 'inbox', top: 25 },
      note: 'updated',
    });

    const { rows } = await pool.query(
      `SELECT tenant_id, name, alias, params, note FROM tenant_tool_recipes WHERE tenant_id = $1`,
      [TENANT_A]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A,
      name: 'morning inbox',
      alias: 'me.mailFolders.messages.ListMessages',
      params: { mailFolderId: 'inbox', top: 25 },
      note: 'updated',
    });
  });

  it('listRecipes returns only caller tenant rows and supports a text filter', async () => {
    await saveRecipe(TENANT_A, {
      name: 'morning inbox',
      alias: 'me.messages.ListMessages',
      params: { top: 10 },
      note: 'tenant A',
    });
    await saveRecipe(TENANT_B, {
      name: 'morning inbox',
      alias: 'me.messages.ListMessages',
      params: { top: 99 },
      note: 'tenant B',
    });
    await saveRecipe(TENANT_A, {
      name: 'send status',
      alias: 'me.sendMail',
      params: { body: { saveToSentItems: true } },
      note: 'weekly status',
    });

    const allA = await listRecipes(TENANT_A);
    expect(allA.map((recipe) => recipe.name).sort()).toEqual(['morning inbox', 'send status']);
    expect(allA.every((recipe) => !('tenantId' in recipe))).toBe(true);

    const filtered = await listRecipes(TENANT_A, 'status');
    expect(filtered.map((recipe) => recipe.name)).toEqual(['send status']);
  });

  it('getRecipeByName returns null for another tenant recipe with the same name', async () => {
    await saveRecipe(TENANT_B, {
      name: 'shared name',
      alias: 'me.sendMail',
      params: { subject: 'tenant B only' },
    });

    await expect(getRecipeByName(TENANT_A, 'shared name')).resolves.toBeNull();
    await expect(getRecipeByName(TENANT_B, 'shared name')).resolves.toMatchObject({
      name: 'shared name',
      params: { subject: 'tenant B only' },
    });
  });

  it('mergeRecipeParams gives paramOverrides precedence over saved params', () => {
    expect(mergeRecipeParams({ a: 1, b: 2 }, { b: 9 })).toEqual({ a: 1, b: 9 });
  });
});
