import { z } from 'zod';
import logger from '../../logger.js';
import { getPool } from '../postgres.js';

const TenantIdZod = z.string().uuid();
export const FactScopeZod = z.string().trim().min(1).max(256);
export const FactContentZod = z.string().trim().min(1).max(8000);
const FactIdZod = z.string().trim().min(1).max(512);
const FactQueryZod = z.string().trim().min(1).max(1000).optional();
const FactLimitZod = z.number().int().optional();
const QueryEmbeddingZod = z.array(z.number().finite()).min(1).optional();

export const FactInputZod = z.object({
  scope: FactScopeZod,
  content: FactContentZod,
});

export interface FactInput {
  scope: string;
  content: string;
}

export interface Fact {
  id: string;
  scope: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  score?: number;
}

export interface RecallFactsInput {
  scope?: string;
  query?: string;
  limit?: number;
  queryEmbedding?: number[];
}

export interface ListFactsForAdminInput {
  scope?: string;
  limit?: number;
  cursor?: string;
}

export interface DeleteFactResult {
  deleted: boolean;
}

export interface AdminFactList {
  facts: Fact[];
  nextCursor: string | null;
}

interface FactRow {
  id: string;
  scope: string;
  content: string;
  created_at: Date | string;
  updated_at: Date | string;
  score?: string | number | null;
}

interface PgvectorAvailabilityRow {
  extension_available?: boolean | string | number | null;
  column_available?: boolean | string | number | null;
}

let pgvectorAvailability: boolean | null = null;

function parseTenantId(tenantId: string): string {
  return TenantIdZod.parse(tenantId);
}

function clampLimit(limit: number | undefined, fallback = 10): number {
  const parsed = FactLimitZod.parse(limit);
  if (parsed === undefined) return fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), 50);
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function toOptionalScore(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const score = Number(value);
  return Number.isFinite(score) ? score : undefined;
}

function rowToFact(row: FactRow): Fact {
  const score = toOptionalScore(row.score);
  return {
    id: row.id,
    scope: row.scope,
    content: row.content,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    ...(score === undefined ? {} : { score }),
  };
}

function boolFromPg(value: boolean | string | number | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['1', 't', 'true', 'yes', 'on'].includes(value.toLowerCase());
  return false;
}

function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}

async function getPgvectorAvailability(): Promise<boolean> {
  if (pgvectorAvailability !== null) return pgvectorAvailability;

  try {
    const result = await getPool().query<PgvectorAvailabilityRow>(
      `SELECT
         EXISTS (
           SELECT 1
           FROM pg_available_extensions
           WHERE name = 'vector'
         ) AS extension_available,
         EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_name = 'tenant_facts'
             AND column_name = 'embedding'
         ) AS column_available`
    );
    const row = result.rows[0] ?? {};
    pgvectorAvailability =
      boolFromPg(row.extension_available) && boolFromPg(row.column_available);
  } catch (err) {
    pgvectorAvailability = false;
    logger.warn(
      { err: (err as Error).message },
      'facts: pgvector availability check failed; using full-text recall'
    );
  }

  return pgvectorAvailability;
}

export function __resetFactPgvectorAvailabilityForTesting(): void {
  pgvectorAvailability = null;
}

export async function isPgvectorRecallEnabled(queryEmbedding?: number[]): Promise<boolean> {
  if (process.env.MS365_MCP_PGVECTOR_ENABLED !== '1') return false;
  if (queryEmbedding === undefined) return false;
  const parsedEmbedding = QueryEmbeddingZod.safeParse(queryEmbedding);
  if (!parsedEmbedding.success) return false;
  return getPgvectorAvailability();
}

export async function recordFact(tenantId: string, input: FactInput): Promise<Fact> {
  const tid = parseTenantId(tenantId);
  const body = FactInputZod.parse(input);
  const result = await getPool().query<FactRow>(
    `INSERT INTO tenant_facts (tenant_id, scope, content)
     VALUES ($1, $2, $3)
     RETURNING id, scope, content, created_at, updated_at`,
    [tid, body.scope, body.content]
  );
  return rowToFact(result.rows[0]);
}

export async function recallFacts(tenantId: string, input: RecallFactsInput = {}): Promise<Fact[]> {
  const tid = parseTenantId(tenantId);
  const parsed = z
    .object({
      scope: FactScopeZod.optional(),
      query: FactQueryZod,
      limit: FactLimitZod,
      queryEmbedding: QueryEmbeddingZod,
    })
    .parse(input);
  const limit = clampLimit(parsed.limit);

  if (
    parsed.query &&
    parsed.queryEmbedding &&
    (await isPgvectorRecallEnabled(parsed.queryEmbedding))
  ) {
    return recallFactsByVector(tid, {
      scope: parsed.scope,
      queryEmbedding: parsed.queryEmbedding,
      limit,
    });
  }

  if (parsed.query) {
    return recallFactsByFullText(tid, {
      scope: parsed.scope,
      query: parsed.query,
      limit,
    });
  }

  return recallFactsByUpdatedAt(tid, {
    scope: parsed.scope,
    limit,
  });
}

async function recallFactsByFullText(
  tenantId: string,
  input: { scope?: string; query: string; limit: number }
): Promise<Fact[]> {
  const params: unknown[] = [tenantId];
  const where = ['tenant_id = $1'];

  if (input.scope) {
    params.push(input.scope);
    where.push(`scope = $${params.length}`);
  }

  params.push(input.query);
  const queryParam = `$${params.length}`;
  params.push(input.limit);
  const limitParam = `$${params.length}`;

  const rankExpr = `ts_rank_cd(content_tsv, plainto_tsquery('english', ${queryParam}))`;
  const result = await getPool().query<FactRow>(
    `SELECT id, scope, content, created_at, updated_at, ${rankExpr} AS score
     FROM tenant_facts
     WHERE ${where.join(' AND ')}
       AND content_tsv @@ plainto_tsquery('english', ${queryParam})
     ORDER BY ${rankExpr} DESC, updated_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return result.rows.map(rowToFact);
}

async function recallFactsByUpdatedAt(
  tenantId: string,
  input: { scope?: string; limit: number }
): Promise<Fact[]> {
  const params: unknown[] = [tenantId];
  const where = ['tenant_id = $1'];

  if (input.scope) {
    params.push(input.scope);
    where.push(`scope = $${params.length}`);
  }

  params.push(input.limit);
  const limitParam = `$${params.length}`;

  const result = await getPool().query<FactRow>(
    `SELECT id, scope, content, created_at, updated_at
     FROM tenant_facts
     WHERE ${where.join(' AND ')}
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return result.rows.map(rowToFact);
}

async function recallFactsByVector(
  tenantId: string,
  input: { scope?: string; queryEmbedding: number[]; limit: number }
): Promise<Fact[]> {
  const params: unknown[] = [tenantId];
  const where = ['tenant_id = $1', 'embedding IS NOT NULL'];

  if (input.scope) {
    params.push(input.scope);
    where.push(`scope = $${params.length}`);
  }

  params.push(vectorLiteral(input.queryEmbedding));
  const vectorParam = `$${params.length}`;
  params.push(input.limit);
  const limitParam = `$${params.length}`;

  const result = await getPool().query<FactRow>(
    `SELECT id, scope, content, created_at, updated_at, 1 - (embedding <=> ${vectorParam}::vector) AS score
     FROM tenant_facts
     WHERE ${where.join(' AND ')}
     ORDER BY embedding <=> ${vectorParam}::vector ASC, updated_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return result.rows.map(rowToFact);
}

export async function forgetFact(tenantId: string, id: string): Promise<DeleteFactResult> {
  const tid = parseTenantId(tenantId);
  const parsedId = FactIdZod.parse(id);
  const result = await getPool().query<{ id: string }>(
    `DELETE FROM tenant_facts
     WHERE tenant_id = $1 AND id::text = $2
     RETURNING id`,
    [tid, parsedId]
  );
  return { deleted: result.rows.length > 0 };
}

export async function listFactsForAdmin(
  tenantId: string,
  input: ListFactsForAdminInput = {}
): Promise<AdminFactList> {
  const tid = parseTenantId(tenantId);
  const parsed = z
    .object({
      scope: FactScopeZod.optional(),
      limit: FactLimitZod,
      cursor: z.string().trim().min(1).optional(),
    })
    .parse(input);
  const limit = clampLimit(parsed.limit);
  const params: unknown[] = [tid];
  const where = ['tenant_id = $1'];

  if (parsed.scope) {
    params.push(parsed.scope);
    where.push(`scope = $${params.length}`);
  }
  if (parsed.cursor) {
    params.push(parsed.cursor);
    where.push(`id::text < $${params.length}`);
  }

  params.push(limit + 1);
  const limitParam = `$${params.length}`;

  const result = await getPool().query<FactRow>(
    `SELECT id, scope, content, created_at, updated_at
     FROM tenant_facts
     WHERE ${where.join(' AND ')}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limitParam}`,
    params
  );
  const rows = result.rows.slice(0, limit);
  const overflow = result.rows[limit];
  return {
    facts: rows.map(rowToFact),
    nextCursor: overflow?.id ?? null,
  };
}
