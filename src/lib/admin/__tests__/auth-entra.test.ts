/**
 * Plan 04-04 Task 1 — verifyEntraAdmin + createAdminEntraMiddleware unit tests.
 *
 * Covers (per behaviour block):
 *   Test 1: valid token + member group → EntraAdminIdentity returned
 *   Test 2: valid token, NOT member → null
 *   Test 3: aud mismatch → null WITHOUT calling fetchImpl (fast-fail)
 *   Test 4: malformed token → null (decodeJwt throws; caught)
 *   Test 5: missing upn/oid → null
 *   Test 6: 5m LRU hit — fetchImpl called 1x
 *   Test 7: 5m LRU miss after TTL — fetchImpl called 2x
 *   Test 8: Graph fetch 401 → null; logger.warn fires
 *   Test 9: Graph fetch 5xx fail-closed → null
 *   Test 10: createAdminEntraMiddleware composition
 *   Test 11: no PII leak (WR-08 invariant)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

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
  verifyEntraAdmin,
  createAdminEntraMiddleware,
  __resetEntraCacheForTesting,
  __setEntraCacheTtlForTesting,
  type EntraConfig,
} from '../auth/entra.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const ADMIN_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const ADMIN_GROUP_ID = '22222222-2222-2222-2222-222222222222';
const AZURE_TENANT_ID = '33333333-3333-3333-3333-333333333333';

const DEFAULT_ENTRA_CONFIG: EntraConfig = {
  appClientId: ADMIN_CLIENT_ID,
  groupId: ADMIN_GROUP_ID,
  graphBase: 'https://graph.microsoft.com/v1.0',
};

/**
 * Craft an unsigned JWT (alg=none) for test purposes — jose.decodeJwt does NOT
 * verify signatures, so this works. Shape: header.body.signature (empty sig).
 */
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
      value: groupIds.map((id) => ({
        id,
        '@odata.type': '#microsoft.graph.group',
      })),
    }),
  });
}

function mockFetchStatus(status: number): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ error: `HTTP ${status}` }),
  });
}

// ── verifyEntraAdmin tests ──────────────────────────────────────────────────

describe('plan 04-04 Task 1 — verifyEntraAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetEntraCacheForTesting();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Test 1: valid token + member group → identity returned', async () => {
    const token = craftTestToken({
      upn: 'alice@contoso.com',
      oid: 'alice-oid',
      tid: AZURE_TENANT_ID,
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);

    const identity = await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(identity).not.toBeNull();
    expect(identity!.actor).toBe('alice@contoso.com');
    expect(identity!.source).toBe('entra');
    expect(identity!.tenantScoped).toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/memberOf');
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('Test 2: valid token, NOT member → null', async () => {
    const token = craftTestToken({
      upn: 'bob@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse(['some-other-group']);

    const identity = await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(identity).toBeNull();
  });

  it('Test 3: aud mismatch → null WITHOUT calling fetchImpl (fast-fail)', async () => {
    const token = craftTestToken({
      upn: 'eve@attacker.com',
      aud: 'attacker-client-id',
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);

    const identity = await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(identity).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Test 4: malformed token → null', async () => {
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);

    const identity = await verifyEntraAdmin('not.a.jwt', {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(identity).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Test 5: missing upn and preferred_username → null', async () => {
    const token = craftTestToken({
      // No upn, no preferred_username
      oid: 'alice-oid',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);

    const identity = await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(identity).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Test 6: 5m LRU cache hit — second call within TTL does not refetch', async () => {
    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);

    const first = await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(first).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const second = await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(second).not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still 1 — cache hit
  });

  it('Test 7: 5m LRU miss after TTL expiry — fetchImpl called again', async () => {
    // LRUCache captures ttl at construction and reads time via performance.now()
    // with 1s debouncing — vi.useFakeTimers cannot reliably expire the default
    // 300_000ms TTL. We swap in a 100ms-TTL cache and use real-time sleeps at
    // 1/3000th scale; deterministic, no clock mocking, argon2/jose-safe.
    __setEntraCacheTtlForTesting(100);
    try {
      const token = craftTestToken({
        upn: 'alice@contoso.com',
        aud: ADMIN_CLIENT_ID,
      });
      const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);

      await verifyEntraAdmin(token, {
        entraConfig: DEFAULT_ENTRA_CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      // Sleep past TTL (100ms + buffer for debounce resolution).
      await new Promise((r) => setTimeout(r, 250));

      await verifyEntraAdmin(token, {
        entraConfig: DEFAULT_ENTRA_CONFIG,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      __setEntraCacheTtlForTesting(null);
    }
  });

  it('Test 8: Graph fetch 401 → null; logger.warn mentions graph_memberOf_failed', async () => {
    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockFetchStatus(401);

    const identity = await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(identity).toBeNull();
    // logger.warn must fire with a graph_memberOf_failed marker
    const warnCalls = loggerMock.warn.mock.calls.map((c) => JSON.stringify(c));
    expect(warnCalls.some((s) => s.includes('graph_memberOf_failed'))).toBe(true);
  });

  it('Test 9: Graph fetch 5xx → null (fail-closed)', async () => {
    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockFetchStatus(503);

    const identity = await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(identity).toBeNull();
    const warnCalls = loggerMock.warn.mock.calls.map((c) => JSON.stringify(c));
    expect(warnCalls.some((s) => s.includes('graph_memberOf_failed'))).toBe(true);
  });

  it('Test 11: no full token or upn PII leaked at info level', async () => {
    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);

    await verifyEntraAdmin(token, {
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    // Aggregate info-level log content
    const infoCalls = loggerMock.info.mock.calls.map((c) => JSON.stringify(c));
    const joined = infoCalls.join(' ');
    expect(joined).not.toContain(token); // full token MUST NOT appear
    expect(joined).not.toContain('alice@contoso.com'); // full UPN must not appear
  });
});

// ── createAdminEntraMiddleware tests ────────────────────────────────────────

describe('plan 04-04 Task 1 — createAdminEntraMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetEntraCacheForTesting();
  });

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
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      type(t: string) {
        captured.type = t;
        return this;
      },
      json(body: unknown) {
        captured.body = body;
        captured.ended = true;
        return this;
      },
      send(body: unknown) {
        captured.body = body;
        captured.ended = true;
        return this;
      },
    } as unknown as Response;
    return { req, res, next, captured };
  }

  it('Test 10a: valid Bearer + member → next() called with req.admin populated', async () => {
    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const mw = createAdminEntraMiddleware({
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const { req, res, next, captured } = makeReqRes({ authorization: `Bearer ${token}` });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.ended).toBe(false);
    const admin = (req as Request & { admin?: { actor: string; source: string } }).admin;
    expect(admin?.actor).toBe('alice@contoso.com');
    expect(admin?.source).toBe('entra');
  });

  it('Test 10b: valid Bearer + NON-member → 403 problem+json forbidden', async () => {
    const token = craftTestToken({
      upn: 'eve@contoso.com',
      aud: ADMIN_CLIENT_ID,
    });
    const fetchImpl = mockMemberOfResponse(['some-other-group']);
    const mw = createAdminEntraMiddleware({
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const { req, res, next, captured } = makeReqRes({ authorization: `Bearer ${token}` });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(403);
    expect(captured.type).toBe('application/problem+json');
    const body = captured.body as { type: string };
    expect(body.type).toContain('/forbidden');
  });

  it('Test 10c: Bearer with malformed token → 401 problem+json unauthorized', async () => {
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const mw = createAdminEntraMiddleware({
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const { req, res, next, captured } = makeReqRes({ authorization: 'Bearer not-a-jwt' });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(401);
    expect(captured.type).toBe('application/problem+json');
    const body = captured.body as { type: string };
    expect(body.type).toContain('/unauthorized');
  });

  it('Test 10d: no Authorization header → next() without req.admin (chain to api-key)', async () => {
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const mw = createAdminEntraMiddleware({
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const { req, res, next, captured } = makeReqRes({});
    await mw(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledTimes(1);
    expect(captured.ended).toBe(false);
    const admin = (req as Request & { admin?: unknown }).admin;
    expect(admin).toBeUndefined();
  });

  it('Test 10e: Bearer token with aud mismatch → 401 unauthorized (not 403)', async () => {
    const token = craftTestToken({
      upn: 'alice@contoso.com',
      aud: 'wrong-client-id',
    });
    const fetchImpl = mockMemberOfResponse([ADMIN_GROUP_ID]);
    const mw = createAdminEntraMiddleware({
      entraConfig: DEFAULT_ENTRA_CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const { req, res, next, captured } = makeReqRes({ authorization: `Bearer ${token}` });
    await mw(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(captured.status).toBe(401);
    const body = captured.body as { type: string };
    expect(body.type).toContain('/unauthorized');
  });
});
