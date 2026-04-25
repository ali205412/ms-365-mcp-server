/**
 * Phase 7 Plan 07-05 - fact memory service contract.
 *
 * Facts are tenant-owned durable notes. These tests pin the default
 * Postgres full-text recall path and the optional pgvector gate without
 * requiring the vector extension in unit tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataType, newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { __setPoolForTesting } from '../../../src/lib/postgres.js';
import {
  __resetFactPgvectorAvailabilityForTesting,
  forgetFact,
  isPgvectorRecallEnabled,
  recallFacts,
  recordFact,
} from '../../../src/lib/memory/facts.js';

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

    CREATE TABLE tenant_facts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      scope text NOT NULL,
      content text NOT NULL,
      content_tsv text,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      updated_at timestamptz NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`INSERT INTO tenants (id) VALUES ($1), ($2)`, [TENANT_A, TENANT_B]);
}

function makeQuerySpy(rows: unknown[] = []) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return { rows };
    }),
  };
  return { pool: pool as unknown as Pool, queries };
}

describe('Phase 7 Plan 07-05 Task 1 - fact service', () => {
  let pool: Pool;
  const originalPgvectorEnv = process.env.MS365_MCP_PGVECTOR_ENABLED;

  beforeEach(async () => {
    pool = makePool();
    await installSchema(pool);
    __setPoolForTesting(pool);
    __resetFactPgvectorAvailabilityForTesting();
    delete process.env.MS365_MCP_PGVECTOR_ENABLED;
  });

  afterEach(async () => {
    process.env.MS365_MCP_PGVECTOR_ENABLED = originalPgvectorEnv;
    __resetFactPgvectorAvailabilityForTesting();
    __setPoolForTesting(null);
    await pool.end();
  });

  it('recordFact inserts a fact row for the caller tenant', async () => {
    const fact = await recordFact(TENANT_A, {
      scope: 'mailbox',
      content: 'Use concise executive summaries for weekly inbox triage.',
    });

    expect(fact).toMatchObject({
      scope: 'mailbox',
      content: 'Use concise executive summaries for weekly inbox triage.',
    });

    const { rows } = await pool.query(
      `SELECT tenant_id, scope, content FROM tenant_facts WHERE tenant_id = $1`,
      [TENANT_A]
    );
    expect(rows).toEqual([
      {
        tenant_id: TENANT_A,
        scope: 'mailbox',
        content: 'Use concise executive summaries for weekly inbox triage.',
      },
    ]);
  });

  it('recallFacts filters by tenant and scope, then ranks by Postgres full-text when query is present', async () => {
    const { pool: spyPool, queries } = makeQuerySpy([
      {
        id: crypto.randomUUID(),
        scope: 'mailbox',
        content: 'Weekly inbox triage prefers concise executive summaries.',
        created_at: new Date('2026-04-25T10:00:00Z'),
        updated_at: new Date('2026-04-25T10:00:00Z'),
        score: 0.75,
      },
    ]);
    __setPoolForTesting(spyPool);

    const recalled = await recallFacts(TENANT_A, {
      scope: 'mailbox',
      query: 'weekly summaries',
      limit: 3,
    });

    expect(recalled).toHaveLength(1);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('WHERE tenant_id = $1');
    expect(queries[0].sql).toContain('AND scope = $2');
    expect(queries[0].sql).toMatch(
      /ts_rank_cd\(content_tsv,\s*plainto_tsquery\('english', \$3\)\) AS score/
    );
    expect(queries[0].sql).toMatch(
      /ORDER BY ts_rank_cd\(content_tsv,\s*plainto_tsquery\('english', \$3\)\) DESC,\s*updated_at DESC/
    );
    expect(queries[0].params).toEqual([TENANT_A, 'mailbox', 'weekly summaries', 3]);
  });

  it('recallFacts with no query orders by updated_at DESC', async () => {
    const { pool: spyPool, queries } = makeQuerySpy([]);
    __setPoolForTesting(spyPool);

    await recallFacts(TENANT_A, { limit: 500 });

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('WHERE tenant_id = $1');
    expect(queries[0].sql).toMatch(/ORDER BY updated_at DESC,\s*created_at DESC/);
    expect(queries[0].params).toEqual([TENANT_A, 50]);
  });

  it('forgetFact deletes only when the id belongs to that tenant', async () => {
    const factA = await recordFact(TENANT_A, {
      scope: 'preferences',
      content: 'Tenant A prefers short messages.',
    });
    await recordFact(TENANT_B, {
      scope: 'preferences',
      content: 'Tenant B prefers detailed messages.',
    });

    await expect(forgetFact(TENANT_B, factA.id)).resolves.toEqual({ deleted: false });
    await expect(forgetFact(TENANT_A, factA.id)).resolves.toEqual({ deleted: true });

    const { rows } = await pool.query(`SELECT tenant_id, content FROM tenant_facts ORDER BY tenant_id`);
    expect(rows).toEqual([
      {
        tenant_id: TENANT_B,
        content: 'Tenant B prefers detailed messages.',
      },
    ]);
  });

  it('pgvector recall is not selected unless env, query embedding, and schema availability all pass', async () => {
    const vectorRows = [
      {
        id: crypto.randomUUID(),
        scope: 'preferences',
        content: 'Prefer concise summaries.',
        created_at: new Date('2026-04-25T10:00:00Z'),
        updated_at: new Date('2026-04-25T10:00:00Z'),
        score: 0.91,
      },
    ];
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const poolWithGate = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.includes('pg_available_extensions')) {
          return { rows: [{ extension_available: true, column_available: true }] };
        }
        return { rows: vectorRows };
      }),
    } as unknown as Pool;

    __setPoolForTesting(poolWithGate);
    expect(await isPgvectorRecallEnabled([0.1, 0.2])).toBe(false);
    await recallFacts(TENANT_A, {
      query: 'concise summaries',
      queryEmbedding: [0.1, 0.2],
    });
    expect(queries.at(-1)?.sql).not.toContain('<=>');

    process.env.MS365_MCP_PGVECTOR_ENABLED = '1';
    __resetFactPgvectorAvailabilityForTesting();
    await expect(isPgvectorRecallEnabled()).resolves.toBe(false);
    await recallFacts(TENANT_A, { query: 'concise summaries' });
    expect(queries.at(-1)?.sql).not.toContain('<=>');

    __resetFactPgvectorAvailabilityForTesting();
    await expect(isPgvectorRecallEnabled([0.1, 0.2])).resolves.toBe(true);
    await recallFacts(TENANT_A, {
      query: 'concise summaries',
      queryEmbedding: [0.1, 0.2],
    });

    expect(queries.some((query) => query.sql.includes('pg_available_extensions'))).toBe(true);
    expect(queries.at(-1)?.sql).toContain('embedding <=>');
    expect(queries.at(-1)?.params).toContain('[0.1,0.2]');
  });
});
