/**
 * Plan 04-09 Task 2 — withDeltaToken 410/resync integration tests (MWARE-08).
 *
 * Covers the one-shot resync contract in D-17:
 *   - Test 1: HTTP 410 Gone → DELETE stored row → call fn(null) ONCE → persist
 *   - Test 2: code='resyncRequired' (non-410 status) → same path
 *   - Test 3: code='syncStateNotFound' → same path
 *   - Test 4: code='syncStateInvalid' → same path
 *   - Test 5: persistent 410 (both calls throw) → error propagates, row stays
 *     deleted (not re-created)
 *   - Test 6: non-resync error (500 generic) → propagates WITHOUT retry; fn
 *     called ONCE; row preserved
 *   - Test 7: resync path emits logger.warn with tenantId + resource AND no
 *     base64url token fragment appears in the log meta
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
import { GraphError } from '../../graph-errors.js';

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

const TENANT_ID = 'cccccccc-2222-4333-8444-555555555555';

async function seedTenant(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id)
       VALUES ($1, 'delegated', 'cid', 'tid')`,
    [TENANT_ID]
  );
}

async function seedDeltaToken(pool: Pool, resource: string, link: string): Promise<void> {
  await pool.query(
    `INSERT INTO delta_tokens (tenant_id, resource, delta_link, updated_at)
       VALUES ($1, $2, $3, NOW())`,
    [TENANT_ID, resource, link]
  );
}

async function readDeltaLink(pool: Pool, resource: string): Promise<string | null> {
  const { rows } = await pool.query<{ delta_link: string }>(
    `SELECT delta_link FROM delta_tokens WHERE tenant_id = $1 AND resource = $2`,
    [TENANT_ID, resource]
  );
  return rows[0]?.delta_link ?? null;
}

function makeGraphError(statusCode: number, code: string): GraphError {
  return new GraphError({
    statusCode,
    code,
    message: `simulated ${code}`,
    requestId: 'rid-test',
    clientRequestId: 'crid-test',
    date: new Date().toISOString(),
  });
}

describe('withDeltaToken — 410 Gone / resync integration (plan 04-09 Task 2, MWARE-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: HTTP 410 Gone → DELETE stored row + one-shot retry with null → persist fresh link', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    await seedDeltaToken(pool, 'users/alice/messages', 'stale-link');

    const callArgs: Array<string | null> = [];
    let call = 0;
    const result = await withDeltaToken<string>(
      pool,
      TENANT_ID,
      'users/alice/messages',
      async (deltaLink) => {
        callArgs.push(deltaLink);
        call++;
        if (call === 1) throw makeGraphError(410, 'itemNotFound');
        return { data: 'resynced', nextDeltaLink: 'fresh-link' };
      }
    );

    expect(result).toBe('resynced');
    // First call saw stored, second saw null (one-shot retry).
    expect(callArgs).toEqual(['stale-link', null]);

    const persisted = await readDeltaLink(pool, 'users/alice/messages');
    expect(persisted).toBe('fresh-link');
  });

  it('Test 2: code=resyncRequired (non-410 status) follows the same one-shot retry path', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    await seedDeltaToken(pool, 'users/alice/messages', 'stale-link');

    let call = 0;
    const result = await withDeltaToken<string>(
      pool,
      TENANT_ID,
      'users/alice/messages',
      async () => {
        call++;
        if (call === 1) throw makeGraphError(400, 'resyncRequired');
        return { data: 'resynced', nextDeltaLink: 'fresh-link' };
      }
    );

    expect(result).toBe('resynced');
    expect(call).toBe(2);
    expect(await readDeltaLink(pool, 'users/alice/messages')).toBe('fresh-link');
  });

  it('Test 3: code=syncStateNotFound triggers resync regardless of statusCode', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    await seedDeltaToken(pool, 'users/alice/messages', 'stale-link');

    let call = 0;
    const result = await withDeltaToken<string>(
      pool,
      TENANT_ID,
      'users/alice/messages',
      async () => {
        call++;
        if (call === 1) throw makeGraphError(500, 'syncStateNotFound');
        return { data: 'resynced', nextDeltaLink: 'fresh-link' };
      }
    );

    expect(result).toBe('resynced');
    expect(call).toBe(2);
  });

  it('Test 4: code=syncStateInvalid triggers resync regardless of statusCode', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    await seedDeltaToken(pool, 'users/alice/messages', 'stale-link');

    let call = 0;
    const result = await withDeltaToken<string>(
      pool,
      TENANT_ID,
      'users/alice/messages',
      async () => {
        call++;
        if (call === 1) throw makeGraphError(400, 'syncStateInvalid');
        return { data: 'resynced', nextDeltaLink: 'fresh-link' };
      }
    );

    expect(result).toBe('resynced');
    expect(call).toBe(2);
  });

  it('Test 5: persistent 410 (both attempts throw) propagates the second error and leaves the row deleted', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    await seedDeltaToken(pool, 'users/alice/messages', 'stale-link');

    const secondError = makeGraphError(410, 'itemNotFound');
    let call = 0;
    await expect(
      withDeltaToken(pool, TENANT_ID, 'users/alice/messages', async () => {
        call++;
        if (call === 1) throw makeGraphError(410, 'itemNotFound');
        throw secondError;
      })
    ).rejects.toBe(secondError);

    expect(call).toBe(2);
    // Row was DELETEd in the resync path; it must NOT have been re-inserted.
    expect(await readDeltaLink(pool, 'users/alice/messages')).toBeNull();
  });

  it('Test 6: non-resync error (500 generic) propagates WITHOUT retry and preserves the stored row', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    await seedDeltaToken(pool, 'users/alice/messages', 'stable-link');

    let call = 0;
    const err = makeGraphError(500, 'generic-error');

    await expect(
      withDeltaToken(pool, TENANT_ID, 'users/alice/messages', async () => {
        call++;
        throw err;
      })
    ).rejects.toBe(err);

    expect(call).toBe(1); // no retry
    expect(await readDeltaLink(pool, 'users/alice/messages')).toBe('stable-link');
  });

  it('Test 7: resync path emits logger.warn with tenantId + resource but no delta-token content', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    // Deliberately use a link that looks like a Graph token so we can
    // assert it does NOT appear in the log meta.
    const sensitiveLink =
      'https://graph.microsoft.com/v1.0/users/alice/messages/delta?$deltatoken=MwdoHn2kVKZaxk8J';
    await seedDeltaToken(pool, 'users/alice/messages', sensitiveLink);

    let call = 0;
    await withDeltaToken<string>(pool, TENANT_ID, 'users/alice/messages', async () => {
      call++;
      if (call === 1) throw makeGraphError(410, 'itemNotFound');
      return { data: 'ok', nextDeltaLink: 'fresh' };
    });

    expect(loggerMock.warn).toHaveBeenCalled();
    const warnCall = loggerMock.warn.mock.calls[0]!;
    const [meta, msg] = warnCall;
    // Meta must carry tenantId + resource
    expect(meta).toMatchObject({
      tenantId: TENANT_ID,
      resource: 'users/alice/messages',
    });
    // Message should mention resync
    expect(String(msg)).toMatch(/delta|resync|stale|full resync/i);
    // Neither the sensitive delta-token fragment nor the whole link must appear
    // anywhere in the emitted arguments. We stringify for a broad guarantee.
    const serialised = JSON.stringify([meta, msg]);
    expect(serialised).not.toContain('MwdoHn2kVKZaxk8J');
    expect(serialised).not.toContain(sensitiveLink);
  });
});
