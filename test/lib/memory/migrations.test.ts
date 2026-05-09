/**
 * Plan 07-01 Task 1 — tenant memory migration contract.
 *
 * Static checks prove the migration stays additive and tenant-scoped.
 * pg-mem is used only for the subset it supports: applying the tenants
 * migration plus memory table DDL after stripping tsvector/pgvector-only
 * statements that real Postgres handles in production.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb, type IMemoryDb } from 'pg-mem';
import type { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'migrations');
const MIGRATE_BIN = path.resolve(__dirname, '..', '..', '..', 'bin', 'migrate.mjs');
const TENANTS_MIGRATION = '20260501000000_tenants.sql';
const MEMORY_MIGRATION = '20261001000000_tenant_memory.sql';
const FORBIDDEN_EXISTING_TENANT_MUTATIONS = [
  'UPDATE tenants',
  'ALTER TABLE tenants',
  "DEFAULT 'discovery-v1'",
] as const;

interface MigrationPair {
  up: string;
  down: string;
}

function readMigration(file: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
}

function splitMigration(sql: string): MigrationPair {
  const parts = sql.split(/^--\s*Down Migration\s*$/m);
  return {
    up: (parts[0] ?? '').replace(/^--\s*Up Migration\s*$/m, ''),
    down: parts[1] ?? '',
  };
}

function stripPgcryptoExtensionStmts(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/\bextension\b.*\bpgcrypto\b/i.test(line))
    .join('\n');
}

function stripPgMemUnsupportedMemorySql(sql: string): string {
  return sql
    .replace(/\n\s*content_tsv\s+tsvector\s+GENERATED\s+ALWAYS\s+AS[\s\S]*?\s+STORED,?/i, '')
    .replace(
      /\nCREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_tenant_facts_content_tsv\s+ON\s+tenant_facts\s+USING\s+gin\s+\(content_tsv\);/i,
      ''
    )
    .replace(/\nDO\s+\$\$[\s\S]*?\$\$;/i, '');
}

function makePool(): { db: IMemoryDb; pool: Pool } {
  const db = newDb();
  db.registerExtension('pgcrypto', () => {
    // no-op — tests never depend on generating UUID defaults.
  });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => '00000000-0000-4000-8000-000000000001',
  });
  const { Pool } = db.adapters.createPg();
  return { db, pool: new Pool() as Pool };
}

async function listTables(pool: Pool, names: string[]): Promise<string[]> {
  const r = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`
  );
  const allow = new Set(names);
  return r.rows.map((row) => row.table_name).filter((tableName) => allow.has(tableName));
}

function tableBlock(sql: string, tableName: string): string {
  const match = sql.match(
    new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${tableName}\\s*\\([\\s\\S]*?\\n\\);`,
      'i'
    )
  );
  return match?.[0] ?? '';
}

describe('plan 07-01 — tenant memory migration', () => {
  let pool: Pool;

  beforeEach(() => {
    ({ pool } = makePool());
  });

  it('creates tenant_tool_bookmarks, tenant_tool_recipes, and tenant_facts tables', async () => {
    const tenants = splitMigration(readMigration(TENANTS_MIGRATION));
    const memory = splitMigration(readMigration(MEMORY_MIGRATION));

    await pool.query(stripPgcryptoExtensionStmts(tenants.up));
    await pool.query(stripPgMemUnsupportedMemorySql(memory.up));

    const tables = await listTables(pool, [
      'tenant_tool_bookmarks',
      'tenant_tool_recipes',
      'tenant_facts',
    ]);
    expect(tables).toEqual(['tenant_facts', 'tenant_tool_bookmarks', 'tenant_tool_recipes']);
  });

  it('every memory table has a tenant_id uuid FK cascade to tenants(id)', () => {
    const sql = readMigration(MEMORY_MIGRATION);
    for (const tableName of ['tenant_tool_bookmarks', 'tenant_tool_recipes', 'tenant_facts']) {
      expect(tableBlock(sql, tableName)).toMatch(
        /tenant_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+tenants\(id\)\s+ON\s+DELETE\s+CASCADE/i
      );
    }
  });

  it('bookmarks and recipes have tenant-scoped uniqueness constraints', () => {
    const sql = readMigration(MEMORY_MIGRATION);
    expect(tableBlock(sql, 'tenant_tool_bookmarks')).toMatch(/UNIQUE\s+\(tenant_id,\s*alias\)/i);
    expect(tableBlock(sql, 'tenant_tool_recipes')).toMatch(/UNIQUE\s+\(tenant_id,\s*name\)/i);
  });

  it('tenant_facts has generated full-text recall column and GIN index', () => {
    const sql = readMigration(MEMORY_MIGRATION);
    expect(tableBlock(sql, 'tenant_facts')).toMatch(
      /content_tsv\s+tsvector\s+GENERATED\s+ALWAYS\s+AS\s+\(to_tsvector\('english',\s*content\)\)\s+STORED/i
    );
    expect(sql).toMatch(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_tenant_facts_content_tsv\s+ON\s+tenant_facts\s+USING\s+gin\s+\(content_tsv\)/i
    );
  });

  it('does not mutate existing tenant rows or change tenant defaults', () => {
    const sql = readMigration(MEMORY_MIGRATION);
    expect(FORBIDDEN_EXISTING_TENANT_MUTATIONS).toEqual([
      'UPDATE tenants',
      'ALTER TABLE tenants',
      "DEFAULT 'discovery-v1'",
    ]);
    expect(sql).not.toMatch(/\bUPDATE\s+tenants\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\s+tenants\b/i);
    expect(sql).not.toContain("DEFAULT 'discovery-v1'");
  });

  it('applies pgvector SQL from the migration CLI behind env, table, and extension gates', () => {
    const source = readFileSync(MIGRATE_BIN, 'utf8');
    expect(source).toContain('MS365_MCP_PGVECTOR_ENABLED');
    expect(source).toContain('pg_available_extensions');
    expect(source).toContain("to_regclass('public.tenant_facts')");
    expect(source).toMatch(/\bCREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+vector\b/i);
    expect(source).toMatch(
      /\bALTER\s+TABLE\s+tenant_facts\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+embedding\s+vector\(1536\)/i
    );
    expect(source).toMatch(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_tenant_facts_embedding\b/i);
  });

  it('sets the pgvector migration session gate from MS365_MCP_PGVECTOR_ENABLED', () => {
    const source = readFileSync(MIGRATE_BIN, 'utf8');
    expect(source).toContain('MS365_MCP_PGVECTOR_ENABLED');
    expect(source).toContain("set_config('ms365_mcp.pgvector_enabled'");
    expect(source).toContain('dbClient');
  });
});
