/**
 * Plan 04-08 Task 2 — Subscriptions lifecycle (renew / delete / list / MCP register).
 *
 * Covers (10 tests, per <behavior> lines 337-347 of 04-08-PLAN.md):
 *   Test 1:  renew rotates clientState (new envelope + new plaintext)
 *   Test 2:  renew uses Graph response body's expirationDateTime (Pitfall 4)
 *   Test 3:  renew Graph 404 → local DELETE + webhook.subscription.not_found audit
 *   Test 4:  renew 5xx surfaces error (preserves local row for retry)
 *   Test 5:  delete success — local row removed
 *   Test 6:  delete 404 tolerated — local row removed
 *   Test 7:  delete 5xx re-thrown — local row NOT removed
 *   Test 8:  list filters by tenant_id (cross-tenant isolation)
 *   Test 9:  list empty tenant → []
 *   Test 10: registerSubscriptionTools registers exactly 4 tools
 *
 * Plaintext rotation invariant:
 *   The NEW clientState after a renew must be DIFFERENT from the pre-renew
 *   value. Both must be valid 43-char base64url strings that decrypt
 *   correctly against the tenant DEK.
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
  subscriptionsCreate,
  subscriptionsRenew,
  subscriptionsDelete,
  subscriptionsList,
  registerSubscriptionTools,
} from '../subscriptions.js';
import {
  decryptWithKey,
  encryptWithKey,
  generateDek,
  type Envelope,
} from '../../crypto/envelope.js';
import { GraphAuthError, GraphServerError, GraphError } from '../../graph-errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

const TENANT_A = '12345678-1234-4234-8234-1234567890ab';
const TENANT_B = '87654321-4321-4321-8321-cba098765432';
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

async function seedTenant(pool: Pool, id: string): Promise<void> {
  const placeholderEnvelope = {
    v: 1,
    iv: 'aaaaaaaaaaaaaaaa',
    tag: 'bbbbbbbbbbbbbbbbbbbbbbbb==',
    ct: 'cc==',
  };
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id, cloud_type, wrapped_dek)
       VALUES ($1, 'delegated', 'cid', 'tid', 'global', $2::jsonb)`,
    [id, JSON.stringify(placeholderEnvelope)]
  );
}

async function seedSubscription(
  pool: Pool,
  tenantId: string,
  dek: Buffer,
  graphSubId: string,
  resource = 'users/alice/messages',
  changeType = 'created,updated'
): Promise<{ id: string; clientStatePlain: string; envelope: Envelope }> {
  const clientStatePlain = crypto.randomBytes(32).toString('base64url');
  const envelope = encryptWithKey(Buffer.from(clientStatePlain, 'utf8'), dek);
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO subscriptions
       (id, tenant_id, graph_subscription_id, resource, change_type, notification_url,
        client_state, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW() + INTERVAL '1 day')`,
    [
      id,
      tenantId,
      graphSubId,
      resource,
      changeType,
      `https://mcp.example.com/t/${tenantId}/notifications`,
      JSON.stringify(envelope),
    ]
  );
  return { id, clientStatePlain, envelope };
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
    makeRequest: vi.fn(async (endpoint: string, options: unknown) => handler(endpoint, options)),
  };
}

function makeDeps(
  pool: Pool,
  dek: Buffer,
  graphClient: GraphClientStub,
  publicUrl = 'https://mcp.example.com'
): {
  graphClient: GraphClientStub;
  pgPool: Pool;
  tenantPool: TenantPoolStub;
  publicUrl: string;
  kek: Buffer;
} {
  return {
    graphClient,
    pgPool: pool,
    tenantPool: makeTenantPoolStub(dek),
    publicUrl,
    kek: KEK,
  };
}

/**
 * Helper to read the stored client_state envelope for a given subscription.
 * pg-mem sometimes returns JSONB columns as strings, sometimes as objects
 * — we normalize to the Envelope shape here.
 */
async function loadEnvelope(pool: Pool, graphSubId: string): Promise<Envelope> {
  const { rows } = await pool.query<{ client_state: Envelope | string }>(
    `SELECT client_state FROM subscriptions WHERE graph_subscription_id = $1`,
    [graphSubId]
  );
  if (!rows[0]) throw new Error(`subscription ${graphSubId} not found`);
  const cs = rows[0].client_state;
  return typeof cs === 'string' ? (JSON.parse(cs) as Envelope) : (cs as Envelope);
}

describe('plan 04-08 Task 2 — subscriptions renew / delete / list / registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1 (renew rotates clientState): new envelope with different plaintext', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const seed = await seedSubscription(pool, TENANT_A, dek, 'graph-sub-r1');
    const originalPlain = seed.clientStatePlain;
    const originalEnvelope = seed.envelope;

    const graphClient = makeGraphClientStub(() => ({
      id: 'graph-sub-r1',
      expirationDateTime: '2026-07-01T00:00:00Z',
      notificationUrl: `https://mcp.example.com/t/${TENANT_A}/notifications`,
    }));
    const deps = makeDeps(pool, dek, graphClient);

    const result = await subscriptionsRenew(
      TENANT_A,
      { graphSubscriptionId: 'graph-sub-r1' },
      deps as never
    );
    expect('id' in result).toBe(true);

    const newEnvelope = await loadEnvelope(pool, 'graph-sub-r1');
    expect(newEnvelope.iv).not.toBe(originalEnvelope.iv);
    expect(newEnvelope.tag).not.toBe(originalEnvelope.tag);
    expect(newEnvelope.ct).not.toBe(originalEnvelope.ct);

    const newPlain = decryptWithKey(newEnvelope, dek).toString('utf8');
    expect(newPlain).not.toBe(originalPlain);
    expect(newPlain).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('Test 2 (renew uses Graph response body expiration): Pitfall 4 invariant', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    await seedSubscription(pool, TENANT_A, dek, 'graph-sub-r2');

    const honored = '2026-08-15T12:00:00Z';
    const graphClient = makeGraphClientStub(() => ({
      id: 'graph-sub-r2',
      expirationDateTime: honored,
    }));
    const deps = makeDeps(pool, dek, graphClient);

    await subscriptionsRenew(TENANT_A, { graphSubscriptionId: 'graph-sub-r2' }, deps as never);

    const { rows } = await pool.query<{ expires_at: Date }>(
      `SELECT expires_at FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-r2']
    );
    expect(rows.length).toBe(1);
    const persistedMs = new Date(rows[0]!.expires_at).getTime();
    expect(persistedMs).toBe(new Date(honored).getTime());
  });

  it('Test 3 (renew Graph 404): deletes local row + emits not_found audit', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    const seed = await seedSubscription(pool, TENANT_A, dek, 'graph-sub-r3');

    const graphClient = makeGraphClientStub(() => {
      throw new GraphAuthError({
        code: 'ResourceNotFound',
        message: 'Subscription not found',
        statusCode: 404,
        requestId: 'ms-req-404',
      });
    });
    const deps = makeDeps(pool, dek, graphClient);

    const result = await subscriptionsRenew(
      TENANT_A,
      { graphSubscriptionId: 'graph-sub-r3' },
      deps as never
    );
    expect(result).toEqual({ deleted: true, reason: 'graph_404' });

    const { rows } = await pool.query(
      `SELECT id FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-r3']
    );
    expect(rows.length).toBe(0);

    // Wait briefly for fire-and-forget audit write.
    const deadline = Date.now() + 2000;
    let auditRows: Array<{ meta: unknown; action: string; target: string | null }> = [];
    while (Date.now() < deadline) {
      const { rows: audit } = await pool.query<{
        meta: unknown;
        action: string;
        target: string | null;
      }>(
        `SELECT meta, action, target FROM audit_log WHERE action = 'webhook.subscription.not_found'`
      );
      if (audit.length > 0) {
        auditRows = audit;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(auditRows.length).toBe(1);
    expect(auditRows[0]!.target).toBe('graph-sub-r3');
    const meta =
      typeof auditRows[0]!.meta === 'string'
        ? JSON.parse(auditRows[0]!.meta as string)
        : (auditRows[0]!.meta as Record<string, unknown>);
    expect(meta.subscription_id).toBe(seed.id);
    expect(meta.graph_subscription_id).toBe('graph-sub-r3');
  });

  it('Test 4 (renew 5xx surfaces error): local row preserved', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    await seedSubscription(pool, TENANT_A, dek, 'graph-sub-r4');

    const graphClient = makeGraphClientStub(() => {
      throw new GraphServerError({
        code: 'ServiceUnavailable',
        message: 'Graph 503',
        statusCode: 503,
        requestId: 'ms-req-503',
      });
    });
    const deps = makeDeps(pool, dek, graphClient);

    await expect(
      subscriptionsRenew(TENANT_A, { graphSubscriptionId: 'graph-sub-r4' }, deps as never)
    ).rejects.toThrow(/Graph 503/);

    const { rows } = await pool.query(
      `SELECT id FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-r4']
    );
    expect(rows.length).toBe(1);
  });

  it('Test 5 (delete success): local row removed', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    await seedSubscription(pool, TENANT_A, dek, 'graph-sub-d1');

    const graphClient = makeGraphClientStub(() => ({ message: 'OK!' }));
    const deps = makeDeps(pool, dek, graphClient);

    const res = await subscriptionsDelete(
      TENANT_A,
      { graphSubscriptionId: 'graph-sub-d1' },
      deps as never
    );
    expect(res).toEqual({ deleted: true });

    const { rows } = await pool.query(
      `SELECT id FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-d1']
    );
    expect(rows.length).toBe(0);
  });

  it('Test 6 (delete 404 tolerated): local row still removed', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    await seedSubscription(pool, TENANT_A, dek, 'graph-sub-d2');

    const graphClient = makeGraphClientStub(() => {
      throw new GraphAuthError({
        code: 'ResourceNotFound',
        message: 'Subscription not found',
        statusCode: 404,
      });
    });
    const deps = makeDeps(pool, dek, graphClient);

    const res = await subscriptionsDelete(
      TENANT_A,
      { graphSubscriptionId: 'graph-sub-d2' },
      deps as never
    );
    expect(res).toEqual({ deleted: true });

    const { rows } = await pool.query(
      `SELECT id FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-d2']
    );
    expect(rows.length).toBe(0);
  });

  it('Test 7 (delete 5xx re-thrown): local row preserved for retry', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    await seedSubscription(pool, TENANT_A, dek, 'graph-sub-d3');

    const graphClient = makeGraphClientStub(() => {
      throw new GraphServerError({
        code: 'ServiceUnavailable',
        message: 'Graph 503',
        statusCode: 503,
      });
    });
    const deps = makeDeps(pool, dek, graphClient);

    await expect(
      subscriptionsDelete(TENANT_A, { graphSubscriptionId: 'graph-sub-d3' }, deps as never)
    ).rejects.toThrow(/Graph 503/);

    const { rows } = await pool.query(
      `SELECT id FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-d3']
    );
    expect(rows.length).toBe(1);
  });

  it('Test 8 (list filters by tenant): cross-tenant isolation', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    await seedTenant(pool, TENANT_B);
    const dekA = generateDek();
    const dekB = generateDek();
    for (let i = 0; i < 5; i++) {
      await seedSubscription(pool, TENANT_A, dekA, `graph-sub-a${i}`);
    }
    for (let i = 0; i < 3; i++) {
      await seedSubscription(pool, TENANT_B, dekB, `graph-sub-b${i}`);
    }

    const rowsA = await subscriptionsList(TENANT_A, {} as never, { pgPool: pool });
    expect(rowsA.length).toBe(5);
    for (const r of rowsA) {
      expect(r.tenant_id).toBe(TENANT_A);
      expect(r).not.toHaveProperty('client_state');
    }
    // Cross-check: none of tenant B's graph_subscription_ids appear in A's list.
    const idsA = new Set(rowsA.map((r) => r.graph_subscription_id));
    for (let i = 0; i < 3; i++) {
      expect(idsA.has(`graph-sub-b${i}`)).toBe(false);
    }

    const rowsB = await subscriptionsList(TENANT_B, {} as never, { pgPool: pool });
    expect(rowsB.length).toBe(3);
    for (const r of rowsB) {
      expect(r.tenant_id).toBe(TENANT_B);
    }
  });

  it('Test 9 (list empty): tenant with no subscriptions returns []', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const rows = await subscriptionsList(TENANT_A, {} as never, { pgPool: pool });
    expect(rows).toEqual([]);
  });

  it('Test 10 (registerSubscriptionTools): registers 4 tools with correct hints', async () => {
    const pool = await makePool();
    const serverStub = { tool: vi.fn() };
    const deps = {
      graphClient: { makeRequest: vi.fn() } as never,
      pgPool: pool,
      tenantPool: makeTenantPoolStub(generateDek()) as never,
      publicUrl: 'https://mcp.example.com',
      kek: KEK,
      tenantIdResolver: () => TENANT_A,
    };
    registerSubscriptionTools(serverStub as never, deps as never);
    expect(serverStub.tool).toHaveBeenCalledTimes(4);

    const toolNames = serverStub.tool.mock.calls.map((call: unknown[]) => call[0]);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'subscriptions-create',
        'subscriptions-renew',
        'subscriptions-delete',
        'subscriptions-list',
      ])
    );

    // Find list hints — readOnly:true is the invariant.
    const listCall = serverStub.tool.mock.calls.find(
      (call: unknown[]) => call[0] === 'subscriptions-list'
    );
    expect(listCall).toBeDefined();
    const listHints = (listCall as unknown[])[3] as {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
    };
    expect(listHints.readOnlyHint).toBe(true);

    // Find create hints — destructive:true.
    const createCall = serverStub.tool.mock.calls.find(
      (call: unknown[]) => call[0] === 'subscriptions-create'
    );
    const createHints = (createCall as unknown[])[3] as {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
    };
    expect(createHints.readOnlyHint).toBe(false);
    expect(createHints.destructiveHint).toBe(true);
  });

  it('Test 11 (integration: full create → renew → delete cycle)', async () => {
    // Bonus integration test — exercises create + renew + delete in sequence.
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();

    let graphState: {
      id: string;
      clientState: string;
      expirationDateTime: string;
    } | null = null;

    const graphClient = makeGraphClientStub((endpoint, options) => {
      const opts = options as { method: string; body?: string };
      if (endpoint === '/subscriptions' && opts.method === 'POST') {
        const body = JSON.parse(opts.body!) as {
          clientState: string;
          expirationDateTime: string;
        };
        graphState = {
          id: 'graph-sub-full',
          clientState: body.clientState,
          expirationDateTime: body.expirationDateTime,
        };
        return {
          id: 'graph-sub-full',
          expirationDateTime: body.expirationDateTime,
        };
      }
      if (endpoint === '/subscriptions/graph-sub-full' && opts.method === 'PATCH') {
        const body = JSON.parse(opts.body!) as {
          clientState: string;
          expirationDateTime: string;
        };
        graphState = {
          id: 'graph-sub-full',
          clientState: body.clientState,
          expirationDateTime: body.expirationDateTime,
        };
        return { id: 'graph-sub-full', expirationDateTime: body.expirationDateTime };
      }
      if (endpoint === '/subscriptions/graph-sub-full' && opts.method === 'DELETE') {
        graphState = null;
        return { message: 'OK!' };
      }
      throw new Error(`unexpected call: ${endpoint} ${opts.method}`);
    });

    const deps = makeDeps(pool, dek, graphClient);

    const created = await subscriptionsCreate(
      TENANT_A,
      {
        resource: 'users/alice/messages',
        changeType: 'created',
        desiredExpirationMinutes: 4320,
      },
      deps as never
    );
    expect(created.graph_subscription_id).toBe('graph-sub-full');
    const envelopeAfterCreate = await loadEnvelope(pool, 'graph-sub-full');
    expect(graphState!.clientState).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Make sure encryption round-trips correctly.
    const createdPlain = decryptWithKey(envelopeAfterCreate, dek).toString('utf8');
    expect(createdPlain).toBe(graphState!.clientState);

    const renewed = await subscriptionsRenew(
      TENANT_A,
      { graphSubscriptionId: 'graph-sub-full' },
      deps as never
    );
    expect('id' in renewed).toBe(true);

    const envelopeAfterRenew = await loadEnvelope(pool, 'graph-sub-full');
    expect(envelopeAfterRenew.iv).not.toBe(envelopeAfterCreate.iv);

    const renewedPlain = decryptWithKey(envelopeAfterRenew, dek).toString('utf8');
    expect(renewedPlain).toBe(graphState!.clientState);
    expect(renewedPlain).not.toBe(createdPlain);

    const deleted = await subscriptionsDelete(
      TENANT_A,
      { graphSubscriptionId: 'graph-sub-full' },
      deps as never
    );
    expect(deleted).toEqual({ deleted: true });

    const { rows: after } = await pool.query(
      `SELECT id FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-full']
    );
    expect(after.length).toBe(0);
    expect(graphState).toBeNull();
  });

  it('Test 12 (GraphError bubbles in response): error instance preserved', async () => {
    const pool = await makePool();
    await seedTenant(pool, TENANT_A);
    const dek = generateDek();
    await seedSubscription(pool, TENANT_A, dek, 'graph-sub-r5');

    const graphClient = makeGraphClientStub(() => {
      throw new GraphError({
        code: 'unknownError',
        message: 'Weird failure',
        statusCode: 418,
      });
    });
    const deps = makeDeps(pool, dek, graphClient);

    await expect(
      subscriptionsRenew(TENANT_A, { graphSubscriptionId: 'graph-sub-r5' }, deps as never)
    ).rejects.toThrow(/Weird failure/);
  });
});
