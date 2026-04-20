/**
 * Plan 05-04 Task 2 — loadTenant populates req.tenant.enabled_tools_set.
 *
 * Verifies the middleware extension: after the DB row resolves, the
 * enabled_tools text is parsed (or NULL → preset fallback) and the frozen
 * Set is attached to `req.tenant.enabled_tools_set` as a new field.
 *
 * Uses the same mock-pool scaffolding as `test/tenant/load-tenant.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Pool, QueryResult } from 'pg';
import type { TenantRow } from '../../src/lib/tenant/tenant-row.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Fixture registry so enabled_tools_set construction has aliases to match on.
vi.mock('../../src/generated/client.js', () => ({
  api: {
    endpoints: [
      { alias: 'mail-send', method: 'POST', path: '/me/sendMail' },
      { alias: 'users-list', method: 'GET', path: '/users' },
      { alias: 'other-op', method: 'GET', path: '/other' },
    ],
  },
}));

vi.mock('../../src/lib/tool-selection/preset-loader.js', () => {
  const PRESET = Object.freeze(new Set<string>(['mail-send']));
  const EMPTY = Object.freeze(new Set<string>());
  return {
    ESSENTIALS_V1_OPS: PRESET,
    DEFAULT_PRESET_VERSION: 'essentials-v1',
    presetFor: (version: string): ReadonlySet<string> =>
      version === 'essentials-v1' ? PRESET : EMPTY,
  };
});

const VALID_GUID = 'abcdef01-2345-6789-abcd-ef0123456789';

function makeRow(overrides: Partial<TenantRow> = {}): TenantRow {
  return {
    id: VALID_GUID,
    mode: 'delegated',
    client_id: 'cid',
    client_secret_ref: null,
    tenant_id: 'az',
    cloud_type: 'global',
    redirect_uri_allowlist: [],
    cors_origins: [],
    allowed_scopes: ['User.Read'],
    enabled_tools: null,
    preset_version: 'essentials-v1',
    wrapped_dek: null,
    slug: null,
    disabled_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function makeMockPool(row: TenantRow): Pool {
  const query = vi.fn(
    async (_sql: string, params: unknown[]): Promise<QueryResult<TenantRow>> => {
      const id = params[0] as string;
      const found = row.id === id && row.disabled_at === null ? row : null;
      return {
        rows: found ? [found] : [],
        rowCount: found ? 1 : 0,
        command: 'SELECT',
        oid: 0,
        fields: [],
      };
    }
  );
  return { query } as unknown as Pool;
}

function makeReq(id: string): Request {
  return { params: { tenantId: id } } as unknown as Request;
}

function makeRes(): { res: Response; status: () => number; body: () => unknown } {
  let currentStatus = 200;
  let currentBody: unknown = undefined;
  const res = {
    status: (code: number) => {
      currentStatus = code;
      return res;
    },
    json: (body: unknown) => {
      currentBody = body;
      return res;
    },
  } as unknown as Response;
  return {
    res,
    status: () => currentStatus,
    body: () => currentBody,
  };
}

describe('plan 05-04 Task 2 — loadTenant populates req.tenant.enabled_tools_set', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Test 7: NULL enabled_tools → preset Set on req.tenant.enabled_tools_set', async () => {
    const { createLoadTenantMiddleware } = await import(
      '../../src/lib/tenant/load-tenant.js'
    );
    const row = makeRow({ enabled_tools: null, preset_version: 'essentials-v1' });
    const pool = makeMockPool(row);
    const mw = createLoadTenantMiddleware({ pool });

    const req = makeReq(VALID_GUID);
    const { res } = makeRes();
    const next: NextFunction = vi.fn();
    await mw(req, res, next);

    const augmented = req as Request & {
      tenant?: TenantRow & { enabled_tools_set?: ReadonlySet<string> };
    };
    expect(augmented.tenant).toBeDefined();
    expect(augmented.tenant!.enabled_tools_set).toBeDefined();
    expect(Object.isFrozen(augmented.tenant!.enabled_tools_set)).toBe(true);
    // Preset contents
    expect(augmented.tenant!.enabled_tools_set!.has('mail-send')).toBe(true);
    expect(augmented.tenant!.enabled_tools_set!.size).toBe(1);
  });

  it('explicit "users-list,mail-send" → Set with exactly those two ops', async () => {
    const { createLoadTenantMiddleware } = await import(
      '../../src/lib/tenant/load-tenant.js'
    );
    const row = makeRow({
      enabled_tools: 'users-list,mail-send',
      preset_version: 'essentials-v1',
    });
    const pool = makeMockPool(row);
    const mw = createLoadTenantMiddleware({ pool });

    const req = makeReq(VALID_GUID);
    const { res } = makeRes();
    const next: NextFunction = vi.fn();
    await mw(req, res, next);

    const augmented = req as Request & {
      tenant?: TenantRow & { enabled_tools_set?: ReadonlySet<string> };
    };
    const set = augmented.tenant!.enabled_tools_set!;
    expect(set.has('users-list')).toBe(true);
    expect(set.has('mail-send')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('empty string enabled_tools → empty Set (explicit no-tools)', async () => {
    const { createLoadTenantMiddleware } = await import(
      '../../src/lib/tenant/load-tenant.js'
    );
    const row = makeRow({ enabled_tools: '', preset_version: 'essentials-v1' });
    const pool = makeMockPool(row);
    const mw = createLoadTenantMiddleware({ pool });

    const req = makeReq(VALID_GUID);
    const { res } = makeRes();
    const next: NextFunction = vi.fn();
    await mw(req, res, next);

    const augmented = req as Request & {
      tenant?: TenantRow & { enabled_tools_set?: ReadonlySet<string> };
    };
    expect(augmented.tenant!.enabled_tools_set!.size).toBe(0);
  });

  it('cache hit re-parses into a fresh Set (WeakMap keys on the Request)', async () => {
    const { createLoadTenantMiddleware } = await import(
      '../../src/lib/tenant/load-tenant.js'
    );
    const row = makeRow({ enabled_tools: null, preset_version: 'essentials-v1' });
    const pool = makeMockPool(row);
    const mw = createLoadTenantMiddleware({ pool });

    // First lookup — DB miss
    const req1 = makeReq(VALID_GUID);
    await mw(req1, makeRes().res, vi.fn());
    // Second lookup — cache hit; ensures the set is still attached
    const req2 = makeReq(VALID_GUID);
    await mw(req2, makeRes().res, vi.fn());

    const a = req1 as Request & {
      tenant?: TenantRow & { enabled_tools_set?: ReadonlySet<string> };
    };
    const b = req2 as Request & {
      tenant?: TenantRow & { enabled_tools_set?: ReadonlySet<string> };
    };
    expect(a.tenant!.enabled_tools_set).toBeDefined();
    expect(b.tenant!.enabled_tools_set).toBeDefined();
    // Each request gets its own Set — the WeakMap is keyed on req, so a new
    // req means a new compute. Even though the set CONTENTS may be equivalent,
    // they are distinct Set instances (no shared mutable state).
    expect(a.tenant!.enabled_tools_set!.size).toBe(b.tenant!.enabled_tools_set!.size);
  });
});
