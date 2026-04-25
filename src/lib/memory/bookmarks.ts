import { z } from 'zod';
import { getPool } from '../postgres.js';

const TenantIdZod = z.string().uuid();
export const BookmarkAliasZod = z.string().trim().min(1).max(512);
export const BookmarkLabelZod = z.string().trim().min(1).max(256).optional();
export const BookmarkNoteZod = z.string().trim().min(1).max(2000).optional();
const BookmarkLookupZod = z.string().trim().min(1).max(512);
const BookmarkFilterZod = z.string().trim().min(1).max(512).optional();

export const BookmarkInputZod = z.object({
  alias: BookmarkAliasZod,
  label: BookmarkLabelZod,
  note: BookmarkNoteZod,
});

export interface BookmarkInput {
  alias: string;
  label?: string;
  note?: string;
}

export interface Bookmark {
  id: string;
  alias: string;
  label: string | null;
  note: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface DeleteBookmarkResult {
  deleted: boolean;
}

interface BookmarkRow {
  id: string;
  alias: string;
  label: string | null;
  note: string | null;
  last_used_at: Date | string | null;
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

function rowToBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    alias: row.alias,
    label: row.label,
    note: row.note,
    lastUsedAt: toIsoString(row.last_used_at),
    createdAt: toIsoString(row.created_at) ?? new Date(0).toISOString(),
  };
}

export async function upsertBookmark(tenantId: string, input: BookmarkInput): Promise<Bookmark> {
  const tid = parseTenantId(tenantId);
  const body = BookmarkInputZod.parse(input);
  const result = await getPool().query<BookmarkRow>(
    `INSERT INTO tenant_tool_bookmarks (tenant_id, alias, label, note)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, alias)
     DO UPDATE SET label = EXCLUDED.label, note = EXCLUDED.note
     RETURNING id, alias, label, note, last_used_at, created_at`,
    [tid, body.alias, normalizeOptional(body.label), normalizeOptional(body.note)]
  );
  return rowToBookmark(result.rows[0]);
}

export async function listBookmarks(tenantId: string, filter?: string): Promise<Bookmark[]> {
  const tid = parseTenantId(tenantId);
  const parsedFilter = BookmarkFilterZod.parse(filter);
  const params: unknown[] = [tid];
  let where = `WHERE tenant_id = $1`;
  if (parsedFilter) {
    params.push(`%${parsedFilter.toLowerCase()}%`);
    where += ` AND (
      LOWER(alias) LIKE $2
      OR LOWER(COALESCE(label, '')) LIKE $2
      OR LOWER(COALESCE(note, '')) LIKE $2
    )`;
  }
  const result = await getPool().query<BookmarkRow>(
    `SELECT id, alias, label, note, last_used_at, created_at
     FROM tenant_tool_bookmarks
     ${where}
     ORDER BY created_at DESC, alias ASC`,
    params
  );
  return result.rows.map(rowToBookmark);
}

export async function deleteBookmark(
  tenantId: string,
  labelOrAliasOrId: string
): Promise<DeleteBookmarkResult> {
  const tid = parseTenantId(tenantId);
  const lookup = BookmarkLookupZod.parse(labelOrAliasOrId);
  const result = await getPool().query<{ id: string }>(
    `DELETE FROM tenant_tool_bookmarks
     WHERE tenant_id = $1 AND (id::text = $2 OR alias = $2 OR label = $2)
     RETURNING id`,
    [tid, lookup]
  );
  return { deleted: result.rows.length > 0 };
}

export async function getBookmarkCountsByAlias(tenantId: string): Promise<Map<string, number>> {
  const tid = parseTenantId(tenantId);
  const result = await getPool().query<{ alias: string; count: string | number }>(
    `SELECT alias, COUNT(*)::int AS count
     FROM tenant_tool_bookmarks
     WHERE tenant_id = $1
     GROUP BY alias`,
    [tid]
  );
  return new Map(result.rows.map((row) => [row.alias, Number(row.count)]));
}
