import { z } from 'zod';
import { getPool } from '../postgres.js';

const TenantIdZod = z.string().uuid();
export const RecipeNameZod = z.string().trim().min(1).max(256);
export const RecipeAliasZod = z.string().trim().min(1).max(512);
export const RecipeParamsZod = z.record(z.unknown());
export const RecipeNoteZod = z.string().trim().min(1).max(2000).optional();
const RecipeLookupZod = z.string().trim().min(1).max(512);
const RecipeFilterZod = z.string().trim().min(1).max(512).optional();

export const RecipeInputZod = z.object({
  name: RecipeNameZod,
  alias: RecipeAliasZod,
  params: RecipeParamsZod,
  note: RecipeNoteZod,
});

export interface RecipeInput {
  name: string;
  alias: string;
  params: Record<string, unknown>;
  note?: string;
}

export interface Recipe {
  id: string;
  name: string;
  alias: string;
  params: Record<string, unknown>;
  note: string | null;
  lastRunAt: string | null;
  createdAt: string;
}

export interface DeleteRecipeResult {
  deleted: boolean;
}

interface RecipeRow {
  id: string;
  tenant_id?: string;
  name: string;
  alias: string;
  params: unknown;
  note: string | null;
  last_run_at: Date | string | null;
  created_at: Date | string;
}

function parseTenantId(tenantId: string): string {
  return TenantIdZod.parse(tenantId);
}

function normalizeOptional(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function toIsoString(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function parseParams(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const parsed = JSON.parse(value) as unknown;
    return RecipeParamsZod.parse(parsed);
  }
  return RecipeParamsZod.parse(value);
}

function rowToRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    name: row.name,
    alias: row.alias,
    params: parseParams(row.params),
    note: row.note,
    lastRunAt: toIsoString(row.last_run_at),
    createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  };
}

export async function saveRecipe(tenantId: string, input: RecipeInput): Promise<Recipe> {
  const tid = parseTenantId(tenantId);
  const body = RecipeInputZod.parse(input);
  const result = await getPool().query<RecipeRow>(
    `INSERT INTO tenant_tool_recipes (tenant_id, name, alias, params, note)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (tenant_id, name)
     DO UPDATE SET alias = EXCLUDED.alias, params = EXCLUDED.params, note = EXCLUDED.note
     RETURNING id, tenant_id, name, alias, params, note, last_run_at, created_at`,
    [tid, body.name, body.alias, JSON.stringify(body.params), normalizeOptional(body.note)]
  );
  return rowToRecipe(result.rows[0]);
}

export async function listRecipes(tenantId: string, filter?: string): Promise<Recipe[]> {
  const tid = parseTenantId(tenantId);
  const parsedFilter = RecipeFilterZod.parse(filter);
  const params: unknown[] = [tid];
  let where = `WHERE tenant_id = $1`;
  if (parsedFilter) {
    params.push(`%${parsedFilter.toLowerCase()}%`);
    where += ` AND (
      LOWER(name) LIKE $2
      OR LOWER(alias) LIKE $2
      OR LOWER(COALESCE(note, '')) LIKE $2
    )`;
  }
  const result = await getPool().query<RecipeRow>(
    `SELECT id, name, alias, params, note, last_run_at, created_at
     FROM tenant_tool_recipes
     ${where}
     ORDER BY created_at DESC, name ASC`,
    params
  );
  return result.rows.map(rowToRecipe);
}

export async function getRecipeByName(tenantId: string, name: string): Promise<Recipe | null> {
  const tid = parseTenantId(tenantId);
  const parsedName = RecipeNameZod.parse(name);
  const result = await getPool().query<RecipeRow>(
    `SELECT id, name, alias, params, note, last_run_at, created_at
     FROM tenant_tool_recipes
     WHERE tenant_id = $1 AND name = $2
     LIMIT 1`,
    [tid, parsedName]
  );
  return result.rows[0] ? rowToRecipe(result.rows[0]) : null;
}

export async function markRecipeRun(tenantId: string, name: string): Promise<Recipe | null> {
  const tid = parseTenantId(tenantId);
  const parsedName = RecipeNameZod.parse(name);
  const result = await getPool().query<RecipeRow>(
    `UPDATE tenant_tool_recipes
     SET last_run_at = NOW()
     WHERE tenant_id = $1 AND name = $2
     RETURNING id, name, alias, params, note, last_run_at, created_at`,
    [tid, parsedName]
  );
  return result.rows[0] ? rowToRecipe(result.rows[0]) : null;
}

export async function deleteRecipe(
  tenantId: string,
  nameOrId: string
): Promise<DeleteRecipeResult> {
  const tid = parseTenantId(tenantId);
  const lookup = RecipeLookupZod.parse(nameOrId);
  const result = await getPool().query<{ id: string }>(
    `DELETE FROM tenant_tool_recipes
     WHERE tenant_id = $1 AND (id::text = $2 OR name = $2)
     RETURNING id`,
    [tid, lookup]
  );
  return { deleted: result.rows.length > 0 };
}

export function mergeRecipeParams(
  savedParams: Record<string, unknown>,
  paramOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...savedParams, ...paramOverrides };
}
