/**
 * Plan 04-09 Task 2 — withDeltaToken happy-path integration tests (MWARE-08).
 *
 * Covers the transactional contract in D-17:
 *   - Test 1: first call (no stored token) → fn(null) → full sweep →
 *             persist nextDeltaLink.
 *   - Test 2: second call (stored token) → fn(storedLink) → incremental →
 *             UPSERT new link.
 *   - Test 3: caller fn throws (non-resync error) → ROLLBACK → old link
 *             unchanged.
 *   - Test 4: nextDeltaLink === null → UPSERT skipped, old row preserved.
 *   - Test 5: per-tenant isolation — tenantA and tenantB rows don't alias.
 *
 * Uses pg-mem (Phase 3 convention). Does not exercise FOR UPDATE semantics —
 * those live in with-delta-token.concurrency.int.test.ts because pg-mem
 * ignores FOR UPDATE (pg-mem/index.js:3108 "ignore 'for update' clause").
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

const TENANT_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const TENANT_B = 'bbbbbbbb-5555-4666-8777-888888888888';

async function seedTenant(pool: Pool, id: string): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id)
       VALUES ($1, 'delegated', 'cid', 'tid')`,
    [id]
  );
}

async function seedDeltaToken(
  pool: Pool,
  tenantId: string,
  resource: string,
  link: string
): Promise<void> {
  await pool.query(
    `INSERT INTO delta_tokens (tenant_id, resource, delta_link, updated_at)
       VALUES ($1, $2, $3, NOW())`,
    [tenantId, resource, link]
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

describe('withDeltaToken — happy-path integration (plan 04-09 Task 2, MWARE-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: first call with no stored token performs a full sweep and persists the new link', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);

    const observedDeltaLink: Array<string | null> = [];
    const msgs = [
      { id: 'msg1', subject: 'hi' },
      { id: 'msg2', subject: 'yo' },
    ];

    const result = await withDeltaToken<typeof msgs>(
      pool,
      TENANT_A,
      'users/alice/messages',
      async (deltaLink) => {
        observedDeltaLink.push(deltaLink);
        return {
          data: msgs,
          nextDeltaLink:
            'https://graph.microsoft.com/v1.0/users/alice/messages/delta?$deltatoken=first-v1',
        };
      }
    );

    expect(result).toEqual(msgs);
    expect(observedDeltaLink).toEqual([null]);

    const persisted = await readDeltaLink(pool, TENANT_A, 'users/alice/messages');
    expect(persisted).toBe(
      'https://graph.microsoft.com/v1.0/users/alice/messages/delta?$deltatoken=first-v1'
    );
  });

  it('Test 2: second call resumes from stored delta link and UPSERTs the new link', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    await seedDeltaToken(
      pool,
      TENANT_A,
      'users/alice/messages',
      'https://graph.microsoft.com/v1.0/users/alice/messages/delta?$deltatoken=first-v1'
    );

    const observedDeltaLink: Array<string | null> = [];
    const msgs = [{ id: 'msg3', subject: 'new thread' }];

    const result = await withDeltaToken<typeof msgs>(
      pool,
      TENANT_A,
      'users/alice/messages',
      async (deltaLink) => {
        observedDeltaLink.push(deltaLink);
        return {
          data: msgs,
          nextDeltaLink:
            'https://graph.microsoft.com/v1.0/users/alice/messages/delta?$deltatoken=incremental-v2',
        };
      }
    );

    expect(result).toEqual(msgs);
    expect(observedDeltaLink).toEqual([
      'https://graph.microsoft.com/v1.0/users/alice/messages/delta?$deltatoken=first-v1',
    ]);

    const persisted = await readDeltaLink(pool, TENANT_A, 'users/alice/messages');
    expect(persisted).toBe(
      'https://graph.microsoft.com/v1.0/users/alice/messages/delta?$deltatoken=incremental-v2'
    );
  });

  it('Test 3: caller fn throws non-resync error → ROLLBACK preserves the stored link', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    await seedDeltaToken(pool, TENANT_A, 'users/alice/messages', 'link-A');

    const thrown = new Error('network unreachable');
    await expect(
      withDeltaToken(pool, TENANT_A, 'users/alice/messages', async () => {
        throw thrown;
      })
    ).rejects.toBe(thrown);

    const persisted = await readDeltaLink(pool, TENANT_A, 'users/alice/messages');
    expect(persisted).toBe('link-A');
  });

  it('Test 4: nextDeltaLink === null skips the UPSERT and preserves the stored link', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    await seedDeltaToken(pool, TENANT_A, 'users/alice/messages', 'link-A');

    const result = await withDeltaToken<unknown[]>(
      pool,
      TENANT_A,
      'users/alice/messages',
      async () => ({ data: [], nextDeltaLink: null })
    );

    expect(result).toEqual([]);

    // Row still has the original link — UPSERT was skipped.
    const persisted = await readDeltaLink(pool, TENANT_A, 'users/alice/messages');
    expect(persisted).toBe('link-A');
  });

  it('Test 4b: nextDeltaLink === null on a fresh resource creates NO row', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);

    const result = await withDeltaToken<unknown[]>(
      pool,
      TENANT_A,
      'users/alice/messages',
      async () => ({ data: [], nextDeltaLink: null })
    );

    expect(result).toEqual([]);

    const persisted = await readDeltaLink(pool, TENANT_A, 'users/alice/messages');
    expect(persisted).toBeNull();
  });

  it('Test 5: per-tenant isolation — tenantA and tenantB hold distinct rows for the same resource', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    await seedTenant(pool, TENANT_B);
    await seedDeltaToken(pool, TENANT_A, 'users/alice/messages', 'link-A');
    await seedDeltaToken(pool, TENANT_B, 'users/alice/messages', 'link-B');

    const observed: Array<string | null> = [];
    await withDeltaToken(pool, TENANT_A, 'users/alice/messages', async (deltaLink) => {
      observed.push(deltaLink);
      return { data: null, nextDeltaLink: 'link-A-updated' };
    });

    expect(observed).toEqual(['link-A']);

    const a = await readDeltaLink(pool, TENANT_A, 'users/alice/messages');
    const b = await readDeltaLink(pool, TENANT_B, 'users/alice/messages');
    expect(a).toBe('link-A-updated');
    expect(b).toBe('link-B'); // untouched
  });
});
