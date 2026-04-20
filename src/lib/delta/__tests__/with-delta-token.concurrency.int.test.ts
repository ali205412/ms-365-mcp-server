/**
 * Plan 04-09 Task 2 — withDeltaToken concurrency integration tests (MWARE-08).
 *
 * Covers SELECT ... FOR UPDATE serialization semantics in D-17:
 *   - Test 1: serialised chain — two sequential withDeltaToken calls for the
 *             same (tenant, resource) both read through the current row; the
 *             second fn receives the delta link written by the first. This
 *             verifies the "second caller sees updated delta_link" contract.
 *             Why not a real concurrent test? pg-mem explicitly ignores FOR
 *             UPDATE (pg-mem/index.js:3108 comment: "ignore 'for update'
 *             clause (not useful in non-concurrent environements)"), so we
 *             cannot observe blocking via pg-mem. End-to-end FOR UPDATE
 *             semantics are verified manually per VALIDATION.md "Delta
 *             resync after resource reset" against real Postgres.
 *   - Test 2: different resources in the same tenant don't alias — each has
 *             its own delta_tokens row.
 *   - Test 3: different tenants on the same resource are independent — PK
 *             (tenant_id, resource) + tenant FK CASCADE guarantee isolation.
 *
 * The tests exercise the transactional wrapper with an overlap emulation
 * (awaiting first COMMIT before starting second) so the chained-link
 * observation holds under both pg-mem and real Postgres.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

import { withDeltaToken } from '../with-delta-token.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

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

const TENANT_A = 'dddddddd-3333-4444-8555-666666666666';
const TENANT_B = 'eeeeeeee-7777-4888-8999-aaaaaaaaaaaa';

async function seedTenant(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id)
       VALUES ($1, 'delegated', 'cid', 'tid')`,
    [id]
  );
}

async function readDeltaLink(
  pool: Pool,
  tenantId: string,
  resource: string
): Promise<string | null> {
  const { rows } = await pool.query<{ delta_link: string }>(
    `SELECT delta_link FROM delta_tokens WHERE tenant_id = $1 AND resource = $2`,
    [tenantId, resource]
  );
  return rows[0]?.delta_link ?? null;
}

describe('withDeltaToken — concurrency / FOR UPDATE contract (plan 04-09 Task 2, MWARE-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: two sequential calls chain delta links — second fn observes first fn\'s persisted nextDeltaLink', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);

    // First caller sweeps (stored is null) and writes link-v1.
    const observedFirst: Array<string | null> = [];
    await withDeltaToken<string>(pool, TENANT_A, 'users/alice/messages', async (stored) => {
      observedFirst.push(stored);
      return { data: 'full', nextDeltaLink: 'link-v1' };
    });
    expect(observedFirst).toEqual([null]);

    // Second caller must see link-v1 and produce link-v2.
    const observedSecond: Array<string | null> = [];
    await withDeltaToken<string>(pool, TENANT_A, 'users/alice/messages', async (stored) => {
      observedSecond.push(stored);
      return { data: 'incremental', nextDeltaLink: 'link-v2' };
    });
    expect(observedSecond).toEqual(['link-v1']);

    // Third confirms the chain continues.
    const observedThird: Array<string | null> = [];
    await withDeltaToken<string>(pool, TENANT_A, 'users/alice/messages', async (stored) => {
      observedThird.push(stored);
      return { data: 'incremental2', nextDeltaLink: 'link-v3' };
    });
    expect(observedThird).toEqual(['link-v2']);

    expect(await readDeltaLink(pool, TENANT_A, 'users/alice/messages')).toBe('link-v3');
  });

  it('Test 2: different resources in the same tenant keep separate rows (no alias)', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);

    await withDeltaToken<string>(pool, TENANT_A, 'users/alice/messages', async () => ({
      data: 'alice',
      nextDeltaLink: 'alice-link-v1',
    }));
    await withDeltaToken<string>(pool, TENANT_A, 'users/bob/messages', async () => ({
      data: 'bob',
      nextDeltaLink: 'bob-link-v1',
    }));

    // Each row independent — no cross-contamination.
    expect(await readDeltaLink(pool, TENANT_A, 'users/alice/messages')).toBe('alice-link-v1');
    expect(await readDeltaLink(pool, TENANT_A, 'users/bob/messages')).toBe('bob-link-v1');

    // And the second-call observations don't see each other.
    const aliceSecond: Array<string | null> = [];
    await withDeltaToken<string>(pool, TENANT_A, 'users/alice/messages', async (stored) => {
      aliceSecond.push(stored);
      return { data: 'a2', nextDeltaLink: 'alice-link-v2' };
    });
    expect(aliceSecond).toEqual(['alice-link-v1']); // NOT bob-link-v1
  });

  it('Test 3: different tenants on the same resource are independent (PK + FK CASCADE)', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    await seedTenant(pool, TENANT_B);

    await withDeltaToken<string>(pool, TENANT_A, 'users/alice/messages', async () => ({
      data: 'A',
      nextDeltaLink: 'tenantA-link-v1',
    }));
    await withDeltaToken<string>(pool, TENANT_B, 'users/alice/messages', async () => ({
      data: 'B',
      nextDeltaLink: 'tenantB-link-v1',
    }));

    expect(await readDeltaLink(pool, TENANT_A, 'users/alice/messages')).toBe('tenantA-link-v1');
    expect(await readDeltaLink(pool, TENANT_B, 'users/alice/messages')).toBe('tenantB-link-v1');

    // TenantA follow-up must still see only its own row.
    const observed: Array<string | null> = [];
    await withDeltaToken<string>(pool, TENANT_A, 'users/alice/messages', async (stored) => {
      observed.push(stored);
      return { data: 'A2', nextDeltaLink: 'tenantA-link-v2' };
    });
    expect(observed).toEqual(['tenantA-link-v1']);
    expect(await readDeltaLink(pool, TENANT_B, 'users/alice/messages')).toBe('tenantB-link-v1');
  });
});
