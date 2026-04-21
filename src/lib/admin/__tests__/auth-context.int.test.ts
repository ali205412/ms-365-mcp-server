/**
 * Plan 04-04 Task 2 — req.admin end-to-end integration tests.
 *
 * Drives a real Express app: mount createAdminAuthMiddleware + a test-only
 * /whoami handler that echoes req.admin. Verifies:
 *   - Valid X-Admin-Api-Key → /whoami returns the api-key identity
 *   - Valid Entra Bearer → /whoami returns the entra identity
 *   - Neither → 401 problem+json (response shape honours RFC 7807)
 *   - /admin/health bypass — reachable without any header
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import argon2 from 'argon2';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

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

let sharedPool: Pool | null = null;
vi.mock('../../postgres.js', async () => {
  return {
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
      if (!sharedPool) throw new Error('sharedPool not set in test');
      const client = await sharedPool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // best-effort
        }
        throw err;
      } finally {
        client.release();
      }
    },
    getPool: () => sharedPool,
  };
});

import { createAdminAuthMiddleware, type AdminIdentity } from '../auth/dual-stack.js';
import { __resetEntraCacheForTesting } from '../auth/entra.js';
import { __resetApiKeyCacheForTesting, API_KEY_PREFIX } from '../api-keys.js';
import { MemoryRedisFacade } from '../../redis-facade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

const ADMIN_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_GROUP_ID = '22222222-2222-2222-2222-222222222222';
const TENANT_A = '12345678-1234-4234-8234-1234567890ab';

const VALID_PLAINTEXT = `${API_KEY_PREFIX}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

const DEFAULT_ENTRA_CONFIG = {
  appClientId: ADMIN_CLIENT_ID,
  groupId: ADMIN_GROUP_ID,
  graphBase: 'https://graph.microsoft.com/v1.0',
};

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
  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id)
       VALUES ($1, 'delegated', 'cid', 'tid')`,
    [id]
  );
}

async function seedApiKey(
  pool: Pool,
  tenantId: string,
  plaintext: string,
  name = 'test-key'
): Promise<{ id: string; displaySuffix: string }> {
  const keyHash = await argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
  });
  const displaySuffix = plaintext.slice(-8);
  const id = `api-key-${Math.random().toString(36).slice(2, 10)}`;
  await pool.query(
    `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix)
       VALUES ($1, $2, $3, $4, $5)`,
    [id, tenantId, name, keyHash, displaySuffix]
  );
  return { id, displaySuffix };
}

function craftTestToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

function mockMemberOfResponse(groupIds: string[]): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      value: groupIds.map((id) => ({ id, '@odata.type': '#microsoft.graph.group' })),
    }),
  });
}

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

async function startTestServer(pool: Pool, fetchImpl: typeof fetch): Promise<TestServer> {
  const app = express();
  app.use(express.json() as unknown as express.RequestHandler);

  // /health BEFORE auth — auth bypass.
  app.get('/admin/health', (_req, res) => {
    res.type('text/plain').status(200).send('admin-router-alive');
  });

  const authMw = createAdminAuthMiddleware({
    pgPool: pool,
    redis: new MemoryRedisFacade(),
    entraConfig: DEFAULT_ENTRA_CONFIG,
    fetchImpl,
  });
  app.use('/admin', authMw);

  app.get('/admin/whoami', (req: Request, res: Response) => {
    const admin = (req as Request & { admin?: AdminIdentity }).admin ?? null;
    res.status(200).json({ admin });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

describe('plan 04-04 Task 2 — req.admin end-to-end via Express', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetApiKeyCacheForTesting();
    __resetEntraCacheForTesting();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('Test 1: req.admin flows to handler via valid X-Admin-Api-Key', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    const { id } = await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT);

    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const srv = await startTestServer(pool, fetchImpl as unknown as typeof fetch);
    try {
      const res = await fetch(`${srv.url}/admin/whoami`, {
        headers: { 'x-admin-api-key': VALID_PLAINTEXT },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { admin: AdminIdentity };
      expect(body.admin.actor).toBe(`api-key:${id}`);
      expect(body.admin.source).toBe('api-key');
      expect(body.admin.tenantScoped).toBe(TENANT_A);
    } finally {
      await srv.close();
    }
  });

  it('Test 2: req.admin flows via valid Entra Bearer', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const srv = await startTestServer(pool, fetchImpl as unknown as typeof fetch);
    try {
      const res = await fetch(`${srv.url}/admin/whoami`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { admin: AdminIdentity };
      expect(body.admin.actor).toBe('alice@contoso.com');
      expect(body.admin.source).toBe('entra');
      expect(body.admin.tenantScoped).toBeNull();
    } finally {
      await srv.close();
    }
  });

  it('Test 3: neither header → 401 problem+json unauthorized', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const srv = await startTestServer(pool, fetchImpl as unknown as typeof fetch);
    try {
      const res = await fetch(`${srv.url}/admin/whoami`);
      expect(res.status).toBe(401);
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toContain('application/problem+json');
      const body = (await res.json()) as { type: string; title: string };
      expect(body.type).toContain('/unauthorized');
    } finally {
      await srv.close();
    }
  });

  it('Test 4: /admin/health bypasses auth (no header required)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const srv = await startTestServer(pool, fetchImpl as unknown as typeof fetch);
    try {
      const res = await fetch(`${srv.url}/admin/health`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe('admin-router-alive');
    } finally {
      await srv.close();
    }
  });
});
