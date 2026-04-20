/**
 * Plan 04-08 Task 1 — subscriptions-create MCP tool (WEBHK-03, D-17).
 *
 * Covers (10 tests, per <behavior> lines 183-192 of 04-08-PLAN.md):
 *   Test 1:  happy path — DB row + admin-safe response (no client_state)
 *   Test 2:  publicUrl trailing slash normalized
 *   Test 3:  notificationUrl always constructed from publicUrl+tenantId (SSRF)
 *   Test 4:  expirationMinutes clamped to resource max (users/ = 41760)
 *   Test 5:  unknown resource → fallback clamp (4320)
 *   Test 6:  clientState encrypted at rest — plaintext never in DB row
 *   Test 7:  Graph 403 scope error surfaced as tool error; no DB row
 *   Test 8:  malformed input rejected by Zod
 *   Test 9:  response shape NEVER includes client_state
 *   Test 10: pickExpirationMinutes unit clamp table
 *
 * Plaintext clientState invariant (D-01 + D-16):
 *   The 43-char base64url plaintext MUST NEVER appear in DB row meta or
 *   logger mock call history. Only the envelope {v,iv,tag,ct} ciphertext.
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
  pickExpirationMinutes,
  MAX_EXPIRATION_BY_RESOURCE_PREFIX,
  type SubscriptionCreateParams,
} from '../subscriptions.js';
import { decryptWithKey, generateDek, type Envelope } from '../../crypto/envelope.js';
import { GraphAuthError } from '../../graph-errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

const TENANT_A = '12345678-1234-4234-8234-1234567890ab';
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

async function seedTenant(pool: Pool, id = TENANT_A): Promise<void> {
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

/**
 * Create a mocked GraphClient whose makeRequest returns a canonical Graph
 * POST /subscriptions success body by default. Call sites may override the
 * mock per-test to simulate errors.
 */
function makeGraphClientStub(options?: {
  response?: unknown;
  error?: Error;
}): GraphClientStub {
  const defaultResponse = {
    id: 'graph-sub-abc',
    expirationDateTime: '2026-06-01T00:00:00Z',
    notificationUrl: 'https://mcp.example.com/t/' + TENANT_A + '/notifications',
  };
  return {
    makeRequest: vi.fn(async () => {
      if (options?.error) throw options.error;
      return options?.response ?? defaultResponse;
    }),
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

describe('plan 04-08 Task 1 — subscriptions-create MCP tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1 (happy path): inserts DB row + returns admin-safe response', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub();
    const deps = makeDeps(pool, dek, graphClient);

    const params: SubscriptionCreateParams = {
      resource: 'users/alice/messages',
      changeType: 'created,updated',
      desiredExpirationMinutes: 4320,
    };
    const row = await subscriptionsCreate(TENANT_A, params, deps as never);

    expect(row.graph_subscription_id).toBe('graph-sub-abc');
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.resource).toBe('users/alice/messages');
    expect(row.change_type).toBe('created,updated');
    expect(row.notification_url).toBe(`https://mcp.example.com/t/${TENANT_A}/notifications`);
    expect(row).not.toHaveProperty('client_state');

    const { rows } = await pool.query<{ client_state: Envelope }>(
      `SELECT client_state FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-abc']
    );
    expect(rows.length).toBe(1);
    const envelope =
      typeof rows[0]!.client_state === 'string'
        ? (JSON.parse(rows[0]!.client_state as unknown as string) as Envelope)
        : rows[0]!.client_state;
    expect(envelope.v).toBe(1);
    expect(envelope).toHaveProperty('iv');
    expect(envelope).toHaveProperty('tag');
    expect(envelope).toHaveProperty('ct');
  });

  it('Test 2 (publicUrl trailing slash normalized): produces canonical notificationUrl', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub();
    const deps = makeDeps(pool, dek, graphClient, 'https://mcp.example.com/');

    const row = await subscriptionsCreate(
      TENANT_A,
      { resource: 'users/alice/messages', changeType: 'created' },
      deps as never
    );
    expect(row.notification_url).toBe(`https://mcp.example.com/t/${TENANT_A}/notifications`);
  });

  it('Test 3 (SSRF protection): Graph receives notificationUrl from publicUrl+tenantId regardless of caller input', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub();
    const deps = makeDeps(pool, dek, graphClient);

    // Malicious-looking resource — server should NEVER derive notificationUrl from it.
    await subscriptionsCreate(
      TENANT_A,
      {
        resource: 'https://evil.com/webhook',
        changeType: 'created',
      },
      deps as never
    );

    const callArgs = graphClient.makeRequest.mock.calls[0]![1] as {
      method: string;
      body: string;
    };
    const body = JSON.parse(callArgs.body) as { notificationUrl: string };
    expect(body.notificationUrl).toBe(`https://mcp.example.com/t/${TENANT_A}/notifications`);
    expect(body.notificationUrl).not.toContain('evil.com');
  });

  it('Test 4 (expiration clamping): desired 100000 clamped to 41760 for users/ prefix', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub();
    const deps = makeDeps(pool, dek, graphClient);

    const beforeTs = Date.now();
    await subscriptionsCreate(
      TENANT_A,
      {
        resource: 'users/alice/messages',
        changeType: 'created',
        desiredExpirationMinutes: 100000,
      },
      deps as never
    );
    const afterTs = Date.now();

    const callArgs = graphClient.makeRequest.mock.calls[0]![1] as { body: string };
    const body = JSON.parse(callArgs.body) as { expirationDateTime: string };
    const sentExpirationMs = new Date(body.expirationDateTime).getTime();
    const upperBoundMs = afterTs + 41760 * 60_000;
    const lowerBoundMs = beforeTs + 41760 * 60_000 - 2_000;
    expect(sentExpirationMs).toBeLessThanOrEqual(upperBoundMs);
    expect(sentExpirationMs).toBeGreaterThanOrEqual(lowerBoundMs);
  });

  it('Test 5 (unknown resource fallback): non-matching prefix clamped to 4320', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub();
    const deps = makeDeps(pool, dek, graphClient);

    const beforeTs = Date.now();
    await subscriptionsCreate(
      TENANT_A,
      {
        resource: 'exotic/beta/api',
        changeType: 'created',
        desiredExpirationMinutes: 100000,
      },
      deps as never
    );
    const afterTs = Date.now();

    const callArgs = graphClient.makeRequest.mock.calls[0]![1] as { body: string };
    const body = JSON.parse(callArgs.body) as { expirationDateTime: string };
    const sentExpirationMs = new Date(body.expirationDateTime).getTime();
    const upperBoundMs = afterTs + 4320 * 60_000;
    const lowerBoundMs = beforeTs + 4320 * 60_000 - 2_000;
    expect(sentExpirationMs).toBeLessThanOrEqual(upperBoundMs);
    expect(sentExpirationMs).toBeGreaterThanOrEqual(lowerBoundMs);
  });

  it('Test 6 (clientState encryption): plaintext never in DB; decrypts via DEK', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub();
    const deps = makeDeps(pool, dek, graphClient);

    await subscriptionsCreate(
      TENANT_A,
      { resource: 'users/alice/messages', changeType: 'created' },
      deps as never
    );

    // Grab the clientState sent to Graph (must be plaintext base64url).
    const callArgs = graphClient.makeRequest.mock.calls[0]![1] as { body: string };
    const sentBody = JSON.parse(callArgs.body) as { clientState: string };
    const plaintext = sentBody.clientState;
    expect(plaintext).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url = 43 chars

    // DB row envelope — plaintext must NOT appear.
    const { rows } = await pool.query<{ client_state: Envelope | string }>(
      `SELECT client_state FROM subscriptions WHERE graph_subscription_id = $1`,
      ['graph-sub-abc']
    );
    expect(rows.length).toBe(1);
    const envelope =
      typeof rows[0]!.client_state === 'string'
        ? (JSON.parse(rows[0]!.client_state as string) as Envelope)
        : (rows[0]!.client_state as Envelope);
    const envelopeSerialized = JSON.stringify(envelope);
    expect(envelopeSerialized).not.toContain(plaintext);

    // Decrypt the envelope with the same DEK → recover exact plaintext.
    const decrypted = decryptWithKey(envelope, dek).toString('utf8');
    expect(decrypted).toBe(plaintext);

    // Loggers must not have seen the plaintext either (D-01 discipline).
    const allLogArgs = JSON.stringify({
      info: loggerMock.info.mock.calls,
      warn: loggerMock.warn.mock.calls,
      error: loggerMock.error.mock.calls,
    });
    expect(allLogArgs).not.toContain(plaintext);
  });

  it('Test 7 (Graph 403 surfaced; no DB row): error thrown before INSERT', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub({
      error: new GraphAuthError({
        code: 'insufficient_scopes',
        message: 'Insufficient privileges',
        statusCode: 403,
        requestId: 'ms-req-1',
      }),
    });
    const deps = makeDeps(pool, dek, graphClient);

    await expect(
      subscriptionsCreate(
        TENANT_A,
        { resource: 'users/alice/messages', changeType: 'created' },
        deps as never
      )
    ).rejects.toThrow(/Insufficient privileges/i);

    const { rows } = await pool.query('SELECT * FROM subscriptions');
    expect(rows.length).toBe(0);
  });

  it('Test 8 (malformed input rejected): empty resource fails Zod', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub();
    const deps = makeDeps(pool, dek, graphClient);

    await expect(
      subscriptionsCreate(
        TENANT_A,
        { resource: '', changeType: 'created' },
        deps as never
      )
    ).rejects.toThrow();

    expect(graphClient.makeRequest).not.toHaveBeenCalled();
    const { rows } = await pool.query('SELECT * FROM subscriptions');
    expect(rows.length).toBe(0);
  });

  it('Test 9 (response never leaks clientState): keys exclude client_state', async () => {
    const pool = await makePool();
    await seedTenant(pool);
    const dek = generateDek();
    const graphClient = makeGraphClientStub();
    const deps = makeDeps(pool, dek, graphClient);

    const row = await subscriptionsCreate(
      TENANT_A,
      { resource: 'users/alice/messages', changeType: 'created' },
      deps as never
    );
    expect(Object.keys(row).includes('client_state')).toBe(false);
  });

  it('Test 10 (pickExpirationMinutes unit): all resource prefixes clamp correctly', () => {
    // Users / groups: 41760 (29 days)
    expect(pickExpirationMinutes('users/alice/messages', 99999)).toBe(41760);
    expect(pickExpirationMinutes('groups/abc/members', 99999)).toBe(41760);
    // Chats / teams: 4320 (3 days)
    expect(pickExpirationMinutes('chats/foo/messages', 99999)).toBe(4320);
    expect(pickExpirationMinutes('teams/xyz/channels', 99999)).toBe(4320);
    // Presence: 60 (1 hour)
    expect(pickExpirationMinutes('communications/presences/abc', 99999)).toBe(60);
    // Drive: 42300
    expect(pickExpirationMinutes('drive/root/items', 99999)).toBe(42300);
    // Unknown prefix falls back to 4320.
    expect(pickExpirationMinutes('unknown/resource', 99999)).toBe(4320);
    // Desired below max is preserved unchanged.
    expect(pickExpirationMinutes('users/alice/messages', 100)).toBe(100);
    // The exported constants table round-trip.
    expect(MAX_EXPIRATION_BY_RESOURCE_PREFIX['users/']).toBe(41760);
    expect(MAX_EXPIRATION_BY_RESOURCE_PREFIX['chats/']).toBe(4320);
    expect(MAX_EXPIRATION_BY_RESOURCE_PREFIX['communications/presences/']).toBe(60);
  });
});
