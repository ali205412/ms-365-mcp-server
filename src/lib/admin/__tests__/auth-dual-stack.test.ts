/**
 * Plan 04-04 Task 2 — dual-stack + api-key middleware + router wiring tests.
 *
 * Covers (per behaviour block):
 *   Test 1: BOTH headers present → api-key wins (entra NOT called)
 *   Test 2: X-Admin-Api-Key valid → req.admin = api-key shape
 *   Test 3: X-Admin-Api-Key revoked → 401 (NOT 403)
 *   Test 4: X-Admin-Api-Key invalid format → 401
 *   Test 5: Bearer valid + member → req.admin = entra shape
 *   Test 6: Bearer valid + non-member → 403 forbidden
 *   Test 7: Bearer malformed → 401 unauthorized
 *   Test 8: neither header → 401 unauthorized
 *   Test 9: /admin/health bypass — auth NOT mounted on health path
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import argon2 from 'argon2';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { decodeJwt } from 'jose';

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
    scheduleAfterCommit: vi.fn(),
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
import { verifyApiKeyHeader, createAdminApiKeyMiddleware } from '../auth/api-key.js';
import { __resetEntraCacheForTesting } from '../auth/entra.js';
import { __resetApiKeyCacheForTesting, API_KEY_PREFIX } from '../api-keys.js';
import { MemoryRedisFacade } from '../../redis-facade.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'migrations');

const ADMIN_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_GROUP_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_TENANT_ID = '33333333-3333-3333-3333-333333333333';
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
  name = 'test-key',
  revoked = false
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
    `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix${
      revoked ? ', revoked_at' : ''
    })
       VALUES ($1, $2, $3, $4, $5${revoked ? ', NOW()' : ''})`,
    [id, tenantId, name, keyHash, displaySuffix]
  );
  return { id, displaySuffix };
}

function craftTestToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ tid: ADMIN_TENANT_ID, ...payload })).toString(
    'base64url'
  );
  return `${header}.${body}.`;
}

const testVerifyToken = vi.fn(async ({ token }: { token: string }) => decodeJwt(token));

function mockMemberOfResponse(groupIds: string[]): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      value: groupIds.map((id) => ({ id, '@odata.type': '#microsoft.graph.group' })),
    }),
  });
}

function makeReqRes(headers: Record<string, string> = {}): {
  req: Request;
  res: Response;
  next: ReturnType<typeof vi.fn>;
  captured: { status: number; body?: unknown; type?: string; ended: boolean };
} {
  const captured: { status: number; body?: unknown; type?: string; ended: boolean } = {
    status: 0,
    ended: false,
  };
  const next = vi.fn();
  const req = {
    headers,
    id: 'test-req-id',
  } as unknown as Request;
  // The mock emulates the parts of Express's Response that the auth layer
  // consumes: status(), type(), json()/send(), and the headersSent flag
  // (dual-stack middleware reads it to detect sub-middleware short-circuits).
  const resImpl: Record<string, unknown> & { headersSent: boolean } = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return resImpl;
    },
    type(t: string) {
      captured.type = t;
      return resImpl;
    },
    json(body: unknown) {
      captured.body = body;
      captured.ended = true;
      resImpl.headersSent = true;
      return resImpl;
    },
    send(body: unknown) {
      captured.body = body;
      captured.ended = true;
      resImpl.headersSent = true;
      return resImpl;
    },
  };
  const res = resImpl as unknown as Response;
  return { req, res, next, captured };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('plan 04-04 Task 2 — verifyApiKeyHeader + createAdminApiKeyMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetApiKeyCacheForTesting();
    __resetEntraCacheForTesting();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('api-key header: valid key → returns ApiKeyAdminIdentity', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    const { id } = await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT);

    const identity = await verifyApiKeyHeader(VALID_PLAINTEXT, {
      pgPool: pool,
      redis: new MemoryRedisFacade(),
    });

    expect(identity).not.toBeNull();
    expect(identity!.actor).toBe(`api-key:${id}`);
    expect(identity!.source).toBe('api-key');
    expect(identity!.tenantScoped).toBe(TENANT_A);
  });

  it('api-key header: revoked key → null (middleware will 401)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT, 'test-key', true);

    const identity = await verifyApiKeyHeader(VALID_PLAINTEXT, {
      pgPool: pool,
      redis: new MemoryRedisFacade(),
    });

    expect(identity).toBeNull();
  });

  it('api-key header: malformed → null', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const identity = await verifyApiKeyHeader('not-a-key', {
      pgPool: pool,
      redis: new MemoryRedisFacade(),
    });
    expect(identity).toBeNull();
  });

  it('createAdminApiKeyMiddleware: no header → next() without req.admin', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const mw = createAdminApiKeyMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
    });

    const { req, res, next, captured } = makeReqRes({});
    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.ended).toBe(false);
    expect((req as Request & { admin?: unknown }).admin).toBeUndefined();
  });

  it('createAdminApiKeyMiddleware: valid header → next() + req.admin populated', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    const { id } = await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT);

    const mw = createAdminApiKeyMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
    });

    const { req, res, next, captured } = makeReqRes({ 'x-admin-api-key': VALID_PLAINTEXT });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.ended).toBe(false);
    const admin = (req as Request & { admin?: AdminIdentity }).admin;
    expect(admin?.source).toBe('api-key');
    expect(admin?.actor).toBe(`api-key:${id}`);
    expect(admin?.tenantScoped).toBe(TENANT_A);
  });

  it('createAdminApiKeyMiddleware: revoked header → 401 problem+json', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT, 'test-key', true);

    const mw = createAdminApiKeyMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
    });

    const { req, res, next, captured } = makeReqRes({ 'x-admin-api-key': VALID_PLAINTEXT });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(401);
    expect(captured.type).toBe('application/problem+json');
    const body = captured.body as { type: string };
    expect(body.type).toContain('/unauthorized');
  });
});

describe('plan 04-04 Task 2 — createAdminAuthMiddleware (dual-stack)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetApiKeyCacheForTesting();
    __resetEntraCacheForTesting();
  });

  afterEach(() => {
    sharedPool = null;
  });

  it('Test 1: BOTH headers → api-key wins, entra not called', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    const { id } = await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT);

    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const entraToken = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyToken: testVerifyToken,
    });

    const { req, res, next, captured } = makeReqRes({
      'x-admin-api-key': VALID_PLAINTEXT,
      authorization: `Bearer ${entraToken}`,
    });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.ended).toBe(false);
    const admin = (req as Request & { admin?: AdminIdentity }).admin;
    expect(admin?.source).toBe('api-key');
    expect(admin?.actor).toBe(`api-key:${id}`);
    expect(fetchImpl).not.toHaveBeenCalled(); // entra NOT called
  });

  it('Test 2: only X-Admin-Api-Key valid → api-key identity', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    const { id } = await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT);

    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
    });

    const { req, res, next } = makeReqRes({ 'x-admin-api-key': VALID_PLAINTEXT });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    const admin = (req as Request & { admin?: AdminIdentity }).admin;
    expect(admin?.actor).toBe(`api-key:${id}`);
    expect(admin?.source).toBe('api-key');
    expect(admin?.tenantScoped).toBe(TENANT_A);
  });

  it('Test 3: only X-Admin-Api-Key revoked → 401 unauthorized (not 403)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT, 'test-key', true);

    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
    });

    const { req, res, next, captured } = makeReqRes({ 'x-admin-api-key': VALID_PLAINTEXT });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(401);
    const body = captured.body as { type: string };
    expect(body.type).toContain('/unauthorized');
  });

  it('Test 4: only X-Admin-Api-Key invalid format → 401', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
    });

    const { req, res, next, captured } = makeReqRes({ 'x-admin-api-key': 'not-a-key' });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(401);
  });

  it('Test 5: only Authorization Bearer valid + member → entra identity', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);

    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyToken: testVerifyToken,
    });

    const { req, res, next, captured } = makeReqRes({ authorization: `Bearer ${token}` });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.ended).toBe(false);
    const admin = (req as Request & { admin?: AdminIdentity }).admin;
    expect(admin?.actor).toBe('alice@contoso.com');
    expect(admin?.source).toBe('entra');
    expect(admin?.tenantScoped).toBeNull();
  });

  it('Test 6: only Bearer valid + non-member → 403 forbidden', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const token = craftTestToken({
      upn: 'eve@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse(['some-other-group']);

    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyToken: testVerifyToken,
    });

    const { req, res, next, captured } = makeReqRes({ authorization: `Bearer ${token}` });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(403);
    const body = captured.body as { type: string };
    expect(body.type).toContain('/forbidden');
  });

  it('Test 7: only Bearer malformed → 401 unauthorized', async () => {
    const pool = await makePool();
    sharedPool = pool;

    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyToken: testVerifyToken,
    });

    const { req, res, next, captured } = makeReqRes({ authorization: 'Bearer not-a-jwt' });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(401);
    const body = captured.body as { type: string };
    expect(body.type).toContain('/unauthorized');
  });

  it('Test 8: neither header → 401 unauthorized (no credential at all)', async () => {
    const pool = await makePool();
    sharedPool = pool;
    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
    });

    const { req, res, next, captured } = makeReqRes({});
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(401);
    const body = captured.body as { type: string };
    expect(body.type).toContain('/unauthorized');
  });

  it('no PII leak: full token and api-key never logged at info/warn', async () => {
    const pool = await makePool();
    sharedPool = pool;
    await seedTenant(pool, TENANT_A);
    await seedApiKey(pool, TENANT_A, VALID_PLAINTEXT);

    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const mw = createAdminAuthMiddleware({
      pgPool: pool,
      redis: new MemoryRedisFacade(),
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      verifyToken: testVerifyToken,
    });

    // Exercise both paths
    const {
      req: req1,
      res: res1,
      next: next1,
    } = makeReqRes({
      'x-admin-api-key': VALID_PLAINTEXT,
    });
    await mw(req1, res1, next1 as unknown as NextFunction);

    const {
      req: req2,
      res: res2,
      next: next2,
    } = makeReqRes({
      authorization: `Bearer ${token}`,
    });
    await mw(req2, res2, next2 as unknown as NextFunction);

    const allCalls = [
      ...loggerMock.info.mock.calls,
      ...loggerMock.warn.mock.calls,
      ...loggerMock.error.mock.calls,
    ];
    const joined = allCalls.map((c) => JSON.stringify(c)).join(' ');
    expect(joined).not.toContain(`Bearer ${token}`);
    expect(joined).not.toContain(VALID_PLAINTEXT);
  });
});

// ── Router mount-order structural tests ─────────────────────────────────────

describe('plan 04-04 Task 2 — router.ts mount order', () => {
  it('router.ts mounts auth BEFORE sub-routes and AFTER /health', async () => {
    const { readFileSync } = await import('node:fs');
    const routerPath = path.resolve(__dirname, '..', 'router.ts');
    const src = readFileSync(routerPath, 'utf8');

    // Match the actual call-site `r.use(createAdminAuthMiddleware(deps))`
    // rather than the JSDoc comment references at the top of the file.
    const healthIdx = src.indexOf("r.get('/health'");
    const authIdx = src.indexOf('r.use(createAdminAuthMiddleware(');
    const apiKeysIdx = src.indexOf("r.use('/api-keys'");
    const corsIdx = src.indexOf('r.use(createAdminCorsMiddleware(');

    expect(healthIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(-1);
    expect(apiKeysIdx).toBeGreaterThan(-1);
    expect(corsIdx).toBeGreaterThan(-1);

    // Required order: cors → health → auth → sub-routes
    expect(corsIdx).toBeLessThan(authIdx);
    expect(healthIdx).toBeLessThan(authIdx);
    expect(authIdx).toBeLessThan(apiKeysIdx);
  });
});
