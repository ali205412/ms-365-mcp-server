/**
 * Plan 03-10 Task 2 — audit integration tests (TENANT-06).
 *
 * Asserts that the server's OAuth handlers and Graph error path emit
 * audit_log rows with the correct shape. Uses pg-mem + MemoryRedisFacade
 * and the real createAuthorizeHandler / createTenantTokenHandler factories
 * from src/server.ts.
 *
 * Covered behaviors:
 *   - Test 1: /authorize success → action='oauth.authorize', result='success'
 *   - Test 2: /authorize with invalid redirect_uri → action='oauth.authorize',
 *             result='failure', meta.error='invalid_redirect_uri'
 *   - Test 3: /token success → action='oauth.token.exchange', result='success'
 *   - Test 4: /token with PKCE mismatch → action='oauth.token.exchange',
 *             result='failure', meta.error='invalid_grant'
 *   - Test 5: audit rows carry tenant_id matching the URL segment
 *   - Test 6: SC#2 signal — two tenants concurrently emit distinct audit rows
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { RedisPkceStore } from '../../src/lib/pkce-store/redis-store.js';
import { generateTenantDek } from '../../src/lib/crypto/dek.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');
const KEK = crypto.randomBytes(32);

const TENANT_A_ID = 'aaaaaaaa-1111-4222-8333-444444444444';
const TENANT_B_ID = 'bbbbbbbb-5555-4666-8777-888888888888';

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

async function insertTenantRow(
  pool: Pool,
  id: string,
  clientId: string,
  tenantId: string,
  redirectUris: string[],
  scopes: string[]
): Promise<void> {
  const { wrappedDek } = generateTenantDek(KEK);
  await pool.query(
    `INSERT INTO tenants (
       id, mode, client_id, tenant_id, cloud_type,
       redirect_uri_allowlist, cors_origins, allowed_scopes, wrapped_dek,
       slug, disabled_at
     ) VALUES ($1, 'delegated', $2, $3, 'global', $4, '[]'::jsonb, $5, $6::jsonb, NULL, NULL)`,
    [
      id,
      clientId,
      tenantId,
      JSON.stringify(redirectUris),
      JSON.stringify(scopes),
      JSON.stringify(wrappedDek),
    ]
  );
}

describe('audit integration (plan 03-10, TENANT-06)', () => {
  let server: http.Server | undefined;
  let baseUrl = '';
  let pool: Pool;
  let redis: MemoryRedisFacade;
  let pkceStore: RedisPkceStore;

  beforeEach(async () => {
    pool = await makePool();
    redis = new MemoryRedisFacade();
    pkceStore = new RedisPkceStore(redis);

    await insertTenantRow(
      pool,
      TENANT_A_ID,
      'client-A',
      TENANT_A_ID,
      ['http://localhost:3100/callback-a'],
      ['User.Read']
    );
    await insertTenantRow(
      pool,
      TENANT_B_ID,
      'client-B',
      TENANT_B_ID,
      ['http://localhost:3200/callback-b'],
      ['Mail.Read']
    );

    const mockAcquire = vi.fn(async () => ({
      accessToken: 'access-token',
      expiresOn: new Date(Date.now() + 3600 * 1000),
    }));
    const mockTenantPool = {
      acquire: vi.fn(async () => ({ acquireTokenByCode: mockAcquire })),
      buildCachePlugin: vi.fn(),
      evict: vi.fn(),
      getDekForTenant: vi.fn(() => Buffer.alloc(32, 7)),
    };

    const { createAuthorizeHandler, createTenantTokenHandler } =
      await import('../../src/server.js');
    const { createLoadTenantMiddleware } = await import('../../src/lib/tenant/load-tenant.js');

    const loadTenant = createLoadTenantMiddleware({ pool });

    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use('/t/:tenantId', loadTenant);
    app.get('/t/:tenantId/authorize', createAuthorizeHandler({ pkceStore, pgPool: pool }));
    app.post(
      '/t/:tenantId/token',
      createTenantTokenHandler({
        pkceStore,
        tenantPool: mockTenantPool as unknown as Parameters<
          typeof createTenantTokenHandler
        >[0]['tenantPool'],
        redis,
        pgPool: pool,
      })
    );

    await new Promise<void>((resolve) => {
      server = http.createServer(app).listen(0, () => {
        const { port } = server!.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
    await redis.quit();
  });

  async function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitForAuditRows(
    minRows: number,
    timeoutMs = 1000
  ): Promise<Record<string, unknown>[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY ts ASC');
      if (rows.length >= minRows) return rows;
      await sleep(20);
    }
    const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY ts ASC');
    return rows;
  }

  it('emits oauth.authorize success audit row on /authorize', async () => {
    const challenge = crypto.randomBytes(32).toString('base64url');
    const res = await fetch(
      `${baseUrl}/t/${TENANT_A_ID}/authorize?` +
        new URLSearchParams({
          redirect_uri: 'http://localhost:3100/callback-a',
          code_challenge: challenge,
          state: 'a',
        }),
      { redirect: 'manual' }
    );
    expect(res.status).toBe(302);

    const rows = await waitForAuditRows(1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0]!;
    expect(row.action).toBe('oauth.authorize');
    expect(row.result).toBe('success');
    expect(row.tenant_id).toBe(TENANT_A_ID);
  });

  it('emits oauth.authorize failure audit row on invalid redirect_uri', async () => {
    const challenge = crypto.randomBytes(32).toString('base64url');
    const res = await fetch(
      `${baseUrl}/t/${TENANT_A_ID}/authorize?` +
        new URLSearchParams({
          redirect_uri: 'http://not-in-allowlist.example/callback',
          code_challenge: challenge,
          state: 'a',
        })
    );
    expect(res.status).toBe(400);

    const rows = await waitForAuditRows(1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const failRow = rows.find((r) => r.result === 'failure');
    expect(failRow).toBeDefined();
    expect(failRow!.action).toBe('oauth.authorize');
    const meta =
      typeof failRow!.meta === 'string' ? JSON.parse(failRow!.meta as string) : failRow!.meta;
    expect(meta).toMatchObject({ error: expect.stringMatching(/invalid_redirect_uri/) });
  });

  it('emits oauth.token.exchange success audit row on /token', async () => {
    const clientVerifier = crypto.randomBytes(32).toString('base64url');
    const clientChallenge = crypto.createHash('sha256').update(clientVerifier).digest('base64url');

    const authorizeRes = await fetch(
      `${baseUrl}/t/${TENANT_A_ID}/authorize?` +
        new URLSearchParams({
          redirect_uri: 'http://localhost:3100/callback-a',
          code_challenge: clientChallenge,
          state: 'a',
        }),
      { redirect: 'manual' }
    );
    expect(authorizeRes.status).toBe(302);

    const tokenRes = await fetch(`${baseUrl}/t/${TENANT_A_ID}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: 'http://localhost:3100/callback-a',
        code_verifier: clientVerifier,
      }),
    });
    expect(tokenRes.status).toBe(200);

    const rows = await waitForAuditRows(2);
    const tokenRow = rows.find((r) => r.action === 'oauth.token.exchange');
    expect(tokenRow).toBeDefined();
    expect(tokenRow!.result).toBe('success');
    expect(tokenRow!.tenant_id).toBe(TENANT_A_ID);
  });

  it('emits oauth.token.exchange failure audit row on PKCE mismatch', async () => {
    // No prior authorize → PKCE lookup misses → 400 invalid_grant
    const bogusVerifier = crypto.randomBytes(32).toString('base64url');
    const tokenRes = await fetch(`${baseUrl}/t/${TENANT_A_ID}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: 'the-code',
        redirect_uri: 'http://localhost:3100/callback-a',
        code_verifier: bogusVerifier,
      }),
    });
    expect(tokenRes.status).toBe(400);

    const rows = await waitForAuditRows(1);
    const failRow = rows.find((r) => r.action === 'oauth.token.exchange' && r.result === 'failure');
    expect(failRow).toBeDefined();
    const meta =
      typeof failRow!.meta === 'string' ? JSON.parse(failRow!.meta as string) : failRow!.meta;
    expect(meta).toMatchObject({ error: expect.stringMatching(/invalid_grant/) });
  });

  it('audit tenant_id matches URL tenant segment for each request', async () => {
    const challenge1 = crypto.randomBytes(32).toString('base64url');
    const challenge2 = crypto.randomBytes(32).toString('base64url');

    await fetch(
      `${baseUrl}/t/${TENANT_A_ID}/authorize?` +
        new URLSearchParams({
          redirect_uri: 'http://localhost:3100/callback-a',
          code_challenge: challenge1,
          state: 'a',
        }),
      { redirect: 'manual' }
    );
    await fetch(
      `${baseUrl}/t/${TENANT_B_ID}/authorize?` +
        new URLSearchParams({
          redirect_uri: 'http://localhost:3200/callback-b',
          code_challenge: challenge2,
          state: 'b',
        }),
      { redirect: 'manual' }
    );

    const rows = await waitForAuditRows(2);
    const tenantIds = rows.map((r) => r.tenant_id).sort();
    expect(tenantIds).toEqual([TENANT_A_ID, TENANT_B_ID].sort());
  });

  it('SC#2: two tenants concurrently emit distinct audit_log rows with distinct tenant_id', async () => {
    const challenge1 = crypto.randomBytes(32).toString('base64url');
    const challenge2 = crypto.randomBytes(32).toString('base64url');

    await Promise.all([
      fetch(
        `${baseUrl}/t/${TENANT_A_ID}/authorize?` +
          new URLSearchParams({
            redirect_uri: 'http://localhost:3100/callback-a',
            code_challenge: challenge1,
            state: 'a',
          }),
        { redirect: 'manual' }
      ),
      fetch(
        `${baseUrl}/t/${TENANT_B_ID}/authorize?` +
          new URLSearchParams({
            redirect_uri: 'http://localhost:3200/callback-b',
            code_challenge: challenge2,
            state: 'b',
          }),
        { redirect: 'manual' }
      ),
    ]);

    const rows = await waitForAuditRows(2);
    const distinct = new Set(rows.map((r) => r.tenant_id));
    expect(distinct.size).toBe(2);
    expect(distinct.has(TENANT_A_ID)).toBe(true);
    expect(distinct.has(TENANT_B_ID)).toBe(true);
  });
});
