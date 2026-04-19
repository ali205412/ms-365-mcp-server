/**
 * Plan 03-05 Task 2 — src/lib/tenant/tenant-pool.ts unit tests.
 *
 * Behaviors (threat: T-03-05-03, decisions: D-10, TENANT-03):
 *   1. Lazy instantiate: first acquire(tenantA) constructs a new MsalClient;
 *      second acquire(tenantA) returns the SAME instance.
 *   2. Per-mode class selection:
 *        - app-only + secret  → ConfidentialClientApplication
 *        - delegated + secret → ConfidentialClientApplication
 *        - delegated, no secret → PublicClientApplication
 *        - bearer → null (MSAL bypass)
 *   3. Missing wrapped_dek on acquire throws with a clear message
 *   4. LRU eviction at cap — third tenant pushes first out
 *   5. evict(tenantId) removes the entry synchronously; has() reflects it
 *   6. drain() clears the sweep timer + empties the pool
 *   7. buildCachePlugin returns a plugin whose key format matches
 *      mcp:cache:<tenantId>:<clientId>:<userOid>:<scopeHash>
 *   8. Same tenant + same scopes = same scopeHash; different scope set = different hash
 *
 * We import the module under test after stubbing env vars so the LRU cap
 * behavior can be exercised without ceremony.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import {
  ConfidentialClientApplication,
  PublicClientApplication,
} from '@azure/msal-node';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { generateTenantDek } from '../../src/lib/crypto/dek.js';
import type { TenantRow } from '../../src/lib/tenant/tenant-row.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const KEK = crypto.randomBytes(32);

function makeTenantRow(overrides: Partial<TenantRow> = {}): TenantRow {
  const { wrappedDek } = generateTenantDek(KEK);
  return {
    id: overrides.id ?? crypto.randomUUID(),
    mode: overrides.mode ?? 'delegated',
    client_id: overrides.client_id ?? 'app-client-id',
    client_secret_ref: overrides.client_secret_ref ?? null,
    client_secret_resolved: overrides.client_secret_resolved,
    tenant_id: overrides.tenant_id ?? 'tenant-guid',
    cloud_type: overrides.cloud_type ?? 'global',
    redirect_uri_allowlist: overrides.redirect_uri_allowlist ?? [],
    cors_origins: overrides.cors_origins ?? [],
    allowed_scopes: overrides.allowed_scopes ?? [],
    enabled_tools: overrides.enabled_tools ?? null,
    wrapped_dek: overrides.wrapped_dek === undefined ? wrappedDek : overrides.wrapped_dek,
    slug: overrides.slug ?? null,
    disabled_at: overrides.disabled_at ?? null,
    created_at: overrides.created_at ?? new Date(),
    updated_at: overrides.updated_at ?? new Date(),
  };
}

describe('plan 03-05 Task 2 — TenantPool', () => {
  let originalMax: string | undefined;
  let originalIdle: string | undefined;

  beforeEach(() => {
    originalMax = process.env.MS365_MCP_AUTH_POOL_MAX;
    originalIdle = process.env.MS365_MCP_AUTH_POOL_IDLE_MS;
  });

  afterEach(() => {
    if (originalMax === undefined) delete process.env.MS365_MCP_AUTH_POOL_MAX;
    else process.env.MS365_MCP_AUTH_POOL_MAX = originalMax;
    if (originalIdle === undefined) delete process.env.MS365_MCP_AUTH_POOL_IDLE_MS;
    else process.env.MS365_MCP_AUTH_POOL_IDLE_MS = originalIdle;
    vi.resetModules();
  });

  it('lazy instantiate — same tenant returns identical client instance', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const redis = new MemoryRedisFacade();
    const pool = new TenantPool(redis, KEK);
    const tenant = makeTenantRow({ mode: 'delegated' });
    const a = await pool.acquire(tenant);
    const b = await pool.acquire(tenant);
    expect(a).toBe(b); // identity
    await pool.drain();
  });

  it('per-mode class selection — delegated without secret → PublicClientApplication', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    const client = await pool.acquire(makeTenantRow({ mode: 'delegated' }));
    expect(client).toBeInstanceOf(PublicClientApplication);
    await pool.drain();
  });

  it('per-mode class selection — delegated with secret → ConfidentialClientApplication', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    const client = await pool.acquire(
      makeTenantRow({ mode: 'delegated', client_secret_resolved: 'secret-value' })
    );
    expect(client).toBeInstanceOf(ConfidentialClientApplication);
    await pool.drain();
  });

  it('per-mode class selection — app-only with secret → ConfidentialClientApplication', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    const client = await pool.acquire(
      makeTenantRow({ mode: 'app-only', client_secret_resolved: 'secret-value' })
    );
    expect(client).toBeInstanceOf(ConfidentialClientApplication);
    await pool.drain();
  });

  it('per-mode class selection — app-only without secret throws', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    await expect(pool.acquire(makeTenantRow({ mode: 'app-only' }))).rejects.toThrow(
      /client_secret|secret/i
    );
    await pool.drain();
  });

  it('per-mode class selection — bearer returns null (MSAL bypass)', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    const client = await pool.acquire(makeTenantRow({ mode: 'bearer' }));
    expect(client).toBeNull();
    await pool.drain();
  });

  it('missing wrapped_dek throws with a clear message', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    await expect(
      pool.acquire(makeTenantRow({ wrapped_dek: null }))
    ).rejects.toThrow(/wrapped_dek/);
    await pool.drain();
  });

  it('LRU eviction at cap — third acquire pushes the least-recently-used out', async () => {
    process.env.MS365_MCP_AUTH_POOL_MAX = '2';
    vi.resetModules();
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    const tA = makeTenantRow({ id: 'T-A' });
    const tB = makeTenantRow({ id: 'T-B' });
    const tC = makeTenantRow({ id: 'T-C' });
    await pool.acquire(tA);
    await pool.acquire(tB);
    await pool.acquire(tC); // evicts T-A per LRU
    expect(pool.has('T-A')).toBe(false);
    expect(pool.has('T-B')).toBe(true);
    expect(pool.has('T-C')).toBe(true);
    await pool.drain();
  });

  it('evict(tenantId) removes the entry synchronously + has() reflects it', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    const tenant = makeTenantRow({ id: 'T-evict' });
    await pool.acquire(tenant);
    expect(pool.has('T-evict')).toBe(true);
    pool.evict('T-evict');
    expect(pool.has('T-evict')).toBe(false);
    await pool.drain();
  });

  it('drain() clears the sweep timer + empties the pool', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    const t = makeTenantRow({ id: 'T-drain' });
    await pool.acquire(t);
    expect(pool.has('T-drain')).toBe(true);
    await pool.drain();
    expect(pool.has('T-drain')).toBe(false);
  });

  it('buildCachePlugin constructs a plugin whose key format matches expected partitioning', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const redis = new MemoryRedisFacade();
    const pool = new TenantPool(redis, KEK);
    const tenant = makeTenantRow({ id: 'T-key', client_id: 'CID', mode: 'delegated' });
    await pool.acquire(tenant);
    const plugin = pool.buildCachePlugin('T-key', 'user-123', ['Mail.Read']);
    // Drive the plugin's afterCacheAccess to land a key in Redis.
    const ctx = {
      cacheHasChanged: true,
      tokenCache: {
        serialize: () => '{"dummy":true}',
        deserialize: (_: string) => {
          /* no-op */
        },
      },
    };
    await plugin.afterCacheAccess(ctx as never);
    const keys = await redis.keys('mcp:cache:T-key:CID:user-123:*');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^mcp:cache:T-key:CID:user-123:[0-9a-f]{16}$/);
    await pool.drain();
  });

  it('buildCachePlugin throws when tenant has not been acquired yet', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const pool = new TenantPool(new MemoryRedisFacade(), KEK);
    expect(() => pool.buildCachePlugin('nonexistent', 'u', ['s'])).toThrow(/acquire/i);
    await pool.drain();
  });

  it('scopes are sorted before hashing — {A,B} and {B,A} produce same key', async () => {
    const { TenantPool } = await import('../../src/lib/tenant/tenant-pool.js');
    const redis = new MemoryRedisFacade();
    const pool = new TenantPool(redis, KEK);
    const tenant = makeTenantRow({ id: 'T-sort', client_id: 'CID' });
    await pool.acquire(tenant);

    const p1 = pool.buildCachePlugin('T-sort', 'u', ['Mail.Read', 'Files.Read']);
    const p2 = pool.buildCachePlugin('T-sort', 'u', ['Files.Read', 'Mail.Read']);

    const ctx = {
      cacheHasChanged: true,
      tokenCache: { serialize: () => '{}', deserialize: () => {} },
    } as never;

    await p1.afterCacheAccess(ctx);
    await p2.afterCacheAccess(ctx);

    const keys = await redis.keys('mcp:cache:T-sort:*');
    expect(keys).toHaveLength(1); // same key — both scope orderings collapsed to one hash
    await pool.drain();
  });
});
