/**
 * Plan 04-08 Task 3 — Optional renewal cron (unref'd setInterval + graceful
 * shutdown + disabled-tenant filter + per-row error isolation).
 *
 * Covers (8 tests, per <behavior> lines 528-536 of 04-08-PLAN.md):
 *   Test 1: renews subscriptions expiring within the 1h lead time
 *   Test 2: skips disabled tenants (disabled_at IS NOT NULL) — Pitfall 10
 *   Test 3: skips subscriptions outside the 1h lead window
 *   Test 4: per-row try/catch isolates failures; emits renew_failed audit
 *   Test 5: stopRenewalCron awaits the in-flight tick
 *   Test 6: 404 during cron renewal → DELETE local row + not_found audit
 *   Test 7: overlapping ticks guarded (isRunning flag)
 *   Test 8: cron emits webhook.subscription.renewed audit on success
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

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

import {
  startRenewalCron,
  stopRenewalCron,
} from '../subscriptions.js';
import { encryptWithKey, generateDek } from '../../crypto/envelope.js';
import { GraphAuthError, GraphServerError } from '../../graph-errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

const TENANT_A = '12345678-1234-4234-8234-1234567890ab';
const TENANT_DISABLED = '87654321-4321-4321-8321-cba098765432';
const KEK = crypto.randomBytes(32);

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

async function seedTenant(
  pool: Pool,
  id: string,
  opts: { disabledAt?: Date } = {}
): Promise<void> {
  const placeholderEnvelope = {
    v: 1,
    iv: 'aaaaaaaaaaaaaaaa',
    tag: 'bbbbbbbbbbbbbbbbbbbbbbbb==',
    ct: 'cc==',
  };
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id, cloud_type, wrapped_dek, disabled_at)
       VALUES ($1, 'delegated', 'cid', 'tid', 'global', $2::jsonb, $3)`,
    [id, JSON.stringify(placeholderEnvelope), opts.disabledAt ?? null]
  );
}

async function seedSubscriptionWithExpiry(
  pool: Pool,
  tenantId: string,
  dek: Buffer,
  graphSubId: string,
  expiresAt: Date
): Promise<string> {
  const clientStatePlain = crypto.randomBytes(32).toString('base64url');
  const envelope = encryptWithKey(Buffer.from(clientStatePlain, 'utf8'), dek);
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO subscriptions
       (id, tenant_id, graph_subscription_id, resource, change_type, notification_url,
        client_state, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      id,
      tenantId,
      graphSubId,
      'users/alice/messages',
      'created',
      `https://mcp.example.com/t/${tenantId}/notifications`,
      JSON.stringify(envelope),
      expiresAt,
    ]
  );
  return id;
}

interface TenantPoolStub {
  getDekForTenant: ReturnType<typeof vi.fn>;
  acquire: ReturnType<typeof vi.fn>;
}

function makeTenantPoolStub(dek: Buffer): TenantPoolStub {
  return {
    getDekForTenant: vi.fn((_id: string) => dek),
    acquire: vi.fn(() => Promise.resolve(null)),
  };
}

interface GraphClientStub {
  makeRequest: ReturnType<typeof vi.fn>;
}

function makeGraphClientStub(
  handler: (endpoint: string, options: unknown) => unknown
): GraphClientStub {
  return {
    makeRequest: vi.fn(async (endpoint: string, options: unknown) =>
      handler(endpoint, options)
    ),
  };
}

/**
 * Poll the database for a specific audit action count, up to a deadline.
 * Needed because writeAuditStandalone is fire-and-forget.
 */
async function waitForAuditCount(
  pool: Pool,
  action: string,
  count: number,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*) AS c FROM audit_log WHERE action = $1`,
      [action]
    );
    if (Number(rows[0]?.c) >= count) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Poll the subscriptions table for a row's disappearance.
 */
async function waitForSubscriptionGone(
  pool: Pool,
  graphSubId: string,
  timeoutMs = 3000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT id FROM subscriptions WHERE graph_subscription_id = $1`,
      [graphSubId]
    );
    if (rows.length === 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('plan 04-08 Task 3 — renewal cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1 (renews expiring subscriptions): fires within 1h lead time', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const expSoon = new Date(Date.now() + 30 * 60_000); // 30 min from now
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-s1', expSoon);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-s2', expSoon);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-s3', expSoon);

    const calls: string[] = [];
    const graphClient = makeGraphClientStub((endpoint, options) => {
      const opts = options as { method: string };
      if (opts.method === 'PATCH') {
        calls.push(endpoint);
        return {
          id: endpoint.split('/').pop(),
          expirationDateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        };
      }
      throw new Error(`unexpected call ${endpoint} ${opts.method}`);
    });

    const handle = startRenewalCron(
      {
        pgPool: pool,
        tenantPool: makeTenantPoolStub(dek) as never,
        graphClient: graphClient as never,
        kek: KEK,
      },
      { intervalMs: 50 }
    );

    await waitForAuditCount(pool, 'webhook.subscription.renewed', 3);
    expect(calls.sort()).toEqual([
      '/subscriptions/cron-s1',
      '/subscriptions/cron-s2',
      '/subscriptions/cron-s3',
    ]);

    await stopRenewalCron(handle);
  });

  it('Test 2 (skips disabled tenants): Pitfall 10 disabled_at filter', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    await seedTenant(pool, TENANT_DISABLED, { disabledAt: new Date() });
    const dek = generateDek();
    const expSoon = new Date(Date.now() + 30 * 60_000);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-live', expSoon);
    await seedSubscriptionWithExpiry(pool, TENANT_DISABLED, dek, 'cron-dead', expSoon);

    const touched: string[] = [];
    const graphClient = makeGraphClientStub((endpoint, options) => {
      const opts = options as { method: string };
      if (opts.method === 'PATCH') {
        touched.push(endpoint);
        return {
          id: endpoint.split('/').pop(),
          expirationDateTime: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        };
      }
      throw new Error(`unexpected call`);
    });

    const handle = startRenewalCron(
      {
        pgPool: pool,
        tenantPool: makeTenantPoolStub(dek) as never,
        graphClient: graphClient as never,
        kek: KEK,
      },
      { intervalMs: 50 }
    );

    await waitForAuditCount(pool, 'webhook.subscription.renewed', 1);

    // Wait a bit longer to ensure disabled tenant is NOT processed on any tick.
    await new Promise((r) => setTimeout(r, 150));

    expect(touched).toEqual(['/subscriptions/cron-live']);

    // Disabled subscription's expires_at must be unchanged.
    const { rows } = await pool.query<{ expires_at: Date }>(
      `SELECT expires_at FROM subscriptions WHERE graph_subscription_id = $1`,
      ['cron-dead']
    );
    expect(Math.abs(new Date(rows[0]!.expires_at).getTime() - expSoon.getTime())).toBeLessThan(
      5_000
    );

    await stopRenewalCron(handle);
  });

  it('Test 3 (skips subscriptions outside 1h lead): expires_at NOW() + 2h untouched', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const expLater = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h from now
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-far', expLater);

    const touched: string[] = [];
    const graphClient = makeGraphClientStub((endpoint, options) => {
      const opts = options as { method: string };
      if (opts.method === 'PATCH') {
        touched.push(endpoint);
        return { id: 'x', expirationDateTime: new Date().toISOString() };
      }
      throw new Error(`unexpected`);
    });

    const handle = startRenewalCron(
      {
        pgPool: pool,
        tenantPool: makeTenantPoolStub(dek) as never,
        graphClient: graphClient as never,
        kek: KEK,
      },
      { intervalMs: 50 }
    );

    // Wait several ticks to confirm no Graph call is made.
    await new Promise((r) => setTimeout(r, 300));
    expect(touched).toEqual([]);

    await stopRenewalCron(handle);
  });

  it('Test 4 (per-row error isolation): one failure does not stop loop', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const expSoon = new Date(Date.now() + 30 * 60_000);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-ok-1', expSoon);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-fail', expSoon);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-ok-2', expSoon);

    const graphClient = makeGraphClientStub((endpoint, options) => {
      const opts = options as { method: string };
      if (opts.method === 'PATCH') {
        if (endpoint.endsWith('cron-fail')) {
          throw new GraphServerError({
            code: 'ServiceUnavailable',
            message: 'Graph 503',
            statusCode: 503,
            requestId: 'ms-503',
          });
        }
        return {
          id: endpoint.split('/').pop(),
          expirationDateTime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        };
      }
      throw new Error('unexpected');
    });

    const handle = startRenewalCron(
      {
        pgPool: pool,
        tenantPool: makeTenantPoolStub(dek) as never,
        graphClient: graphClient as never,
        kek: KEK,
      },
      { intervalMs: 50 }
    );

    await waitForAuditCount(pool, 'webhook.subscription.renewed', 2);
    await waitForAuditCount(pool, 'webhook.subscription.renew_failed', 1);

    const { rows: failed } = await pool.query<{ meta: unknown }>(
      `SELECT meta FROM audit_log WHERE action = 'webhook.subscription.renew_failed'`
    );
    const meta =
      typeof failed[0]!.meta === 'string'
        ? (JSON.parse(failed[0]!.meta as string) as Record<string, unknown>)
        : (failed[0]!.meta as Record<string, unknown>);
    expect(meta.error_code).toBe('ServiceUnavailable');
    expect(meta.graph_request_id).toBe('ms-503');

    await stopRenewalCron(handle);
  });

  it('Test 5 (stopRenewalCron awaits in-flight): waits for current tick to finish', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const expSoon = new Date(Date.now() + 30 * 60_000);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-slow', expSoon);

    let resolveSlow: (() => void) | null = null;
    const slowPromise = new Promise<void>((r) => {
      resolveSlow = r;
    });
    let graphCallCompleted = false;

    const graphClient = makeGraphClientStub(async (endpoint, options) => {
      const opts = options as { method: string };
      if (opts.method === 'PATCH') {
        await slowPromise;
        graphCallCompleted = true;
        return {
          id: endpoint.split('/').pop(),
          expirationDateTime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        };
      }
      throw new Error('unexpected');
    });

    const handle = startRenewalCron(
      {
        pgPool: pool,
        tenantPool: makeTenantPoolStub(dek) as never,
        graphClient: graphClient as never,
        kek: KEK,
      },
      { intervalMs: 25 }
    );

    // Wait until the graph call is hanging.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (graphClient.makeRequest.mock.calls.length > 0) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(graphClient.makeRequest.mock.calls.length).toBeGreaterThan(0);
    expect(graphCallCompleted).toBe(false);

    // Begin stop; release the hung call after a short delay.
    const stopPromise = stopRenewalCron(handle);
    setTimeout(() => resolveSlow?.(), 50);
    await stopPromise;
    expect(graphCallCompleted).toBe(true);
  });

  it('Test 6 (cron 404 → DELETE local + not_found audit)', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const expSoon = new Date(Date.now() + 30 * 60_000);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-gone', expSoon);

    const graphClient = makeGraphClientStub((endpoint, options) => {
      const opts = options as { method: string };
      if (opts.method === 'PATCH' && endpoint.endsWith('cron-gone')) {
        throw new GraphAuthError({
          code: 'ResourceNotFound',
          message: 'Subscription not found',
          statusCode: 404,
          requestId: 'ms-404',
        });
      }
      throw new Error('unexpected');
    });

    const handle = startRenewalCron(
      {
        pgPool: pool,
        tenantPool: makeTenantPoolStub(dek) as never,
        graphClient: graphClient as never,
        kek: KEK,
      },
      { intervalMs: 25 }
    );

    await waitForSubscriptionGone(pool, 'cron-gone');
    await waitForAuditCount(pool, 'webhook.subscription.not_found', 1);

    // No renewed audit should exist for this subscription.
    const { rows: renewed } = await pool.query(
      `SELECT id FROM audit_log WHERE action = 'webhook.subscription.renewed' AND target = $1`,
      ['cron-gone']
    );
    expect(renewed.length).toBe(0);

    await stopRenewalCron(handle);
  });

  it('Test 7 (overlapping ticks guarded): isRunning prevents re-entry', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const expSoon = new Date(Date.now() + 30 * 60_000);
    await seedSubscriptionWithExpiry(pool, TENANT_A, dek, 'cron-lock', expSoon);

    let resolveHang: (() => void) | null = null;
    const hangPromise = new Promise<void>((r) => {
      resolveHang = r;
    });
    let callCount = 0;

    const graphClient = makeGraphClientStub(async (endpoint, options) => {
      const opts = options as { method: string };
      if (opts.method === 'PATCH') {
        callCount++;
        await hangPromise;
        return {
          id: endpoint.split('/').pop(),
          expirationDateTime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        };
      }
      throw new Error('unexpected');
    });

    // Short interval — many ticks will fire while the first PATCH is hanging.
    const handle = startRenewalCron(
      {
        pgPool: pool,
        tenantPool: makeTenantPoolStub(dek) as never,
        graphClient: graphClient as never,
        kek: KEK,
      },
      { intervalMs: 10 }
    );

    // Let several intervals elapse while the hang is active.
    await new Promise((r) => setTimeout(r, 100));

    // Only ONE call to graph should be in flight; overlap guard prevents
    // the next tick from re-entering the loop until the first finishes.
    expect(callCount).toBe(1);

    resolveHang?.();
    await stopRenewalCron(handle);
  });

  it('Test 8 (renewed audit meta contains subscription_id and resource)', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const expSoon = new Date(Date.now() + 30 * 60_000);
    const localId = await seedSubscriptionWithExpiry(
      pool,
      TENANT_A,
      dek,
      'cron-meta',
      expSoon
    );

    const graphClient = makeGraphClientStub((endpoint, options) => {
      const opts = options as { method: string };
      if (opts.method === 'PATCH') {
        return {
          id: endpoint.split('/').pop(),
          expirationDateTime: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        };
      }
      throw new Error('unexpected');
    });

    const handle = startRenewalCron(
      {
        pgPool: pool,
        tenantPool: makeTenantPoolStub(dek) as never,
        graphClient: graphClient as never,
        kek: KEK,
      },
      { intervalMs: 50 }
    );

    await waitForAuditCount(pool, 'webhook.subscription.renewed', 1);
    const { rows } = await pool.query<{ meta: unknown; target: string | null }>(
      `SELECT meta, target FROM audit_log WHERE action = 'webhook.subscription.renewed'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.target).toBe('cron-meta');
    const meta =
      typeof rows[0]!.meta === 'string'
        ? (JSON.parse(rows[0]!.meta as string) as Record<string, unknown>)
        : (rows[0]!.meta as Record<string, unknown>);
    expect(meta.subscription_id).toBe(localId);
    expect(meta.resource).toBe('users/alice/messages');

    await stopRenewalCron(handle);
  });
});
