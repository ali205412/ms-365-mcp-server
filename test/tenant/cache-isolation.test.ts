/**
 * Plan 03-05 Task 2 — cross-tenant cache isolation (TENANT-04, ROADMAP SC#2).
 *
 * Two tenants with DIFFERENT ids but otherwise-identical (clientId, userOid,
 * scope) tuples MUST produce DISTINCT Redis cache keys. A collision here is
 * the Pitfall 2 cross-tenant token leak scenario that D-10 key composition
 * closes.
 *
 * This test drives the MSAL cache plugin (not a real MSAL acquireToken call
 * — that would require Entra network access). The plugin's afterCacheAccess
 * is the path MSAL invokes after a token acquire; asserting it fires a
 * tenant-scoped SET confirms the partitioning works end-to-end.
 *
 * The test uses MemoryRedisFacade to stay pg-mem-grade portable (no
 * testcontainers required).
 */
import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { MemoryRedisFacade } from '../../src/lib/redis-facade.js';
import { TenantPool } from '../../src/lib/tenant/tenant-pool.js';
import { generateTenantDek } from '../../src/lib/crypto/dek.js';
import type { TenantRow } from '../../src/lib/tenant/tenant-row.js';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeTenant(kek: Buffer, overrides: Partial<TenantRow> = {}): TenantRow {
  const { wrappedDek } = generateTenantDek(kek);
  return {
    id: overrides.id ?? crypto.randomUUID(),
    mode: 'delegated',
    client_id: 'shared-client-id',
    client_secret_ref: null,
    tenant_id: 'tenant-guid',
    cloud_type: 'global',
    redirect_uri_allowlist: [],
    cors_origins: [],
    allowed_scopes: [],
    enabled_tools: null,
    slug: null,
    disabled_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
    wrapped_dek: overrides.wrapped_dek === undefined ? wrappedDek : overrides.wrapped_dek,
  };
}

async function writeThroughPlugin(
  pool: TenantPool,
  tenantId: string,
  userOid: string,
  scopes: string[]
): Promise<void> {
  const plugin = pool.buildCachePlugin(tenantId, userOid, scopes);
  const ctx = {
    cacheHasChanged: true,
    tokenCache: {
      serialize: () => '{"AccessToken":{"k":"v"}}',
      deserialize: (_: string) => {
        /* no-op */
      },
    },
  };
  await plugin.afterCacheAccess(ctx as never);
}

describe('plan 03-05 — cross-tenant cache isolation (TENANT-04, SC#2)', () => {
  it('two tenants, same (clientId, userOid, scope) -> two distinct Redis keys', async () => {
    const kek = crypto.randomBytes(32);
    const redis = new MemoryRedisFacade();
    const pool = new TenantPool(redis, kek);

    const tenantA = makeTenant(kek, { id: 'tenant-A' });
    const tenantB = makeTenant(kek, { id: 'tenant-B' });

    await pool.acquire(tenantA);
    await pool.acquire(tenantB);

    // Simulate a concurrent token acquire on both tenants using the IDENTICAL
    // (userOid, scopes) tuple. If the partition were only clientId+userOid+scope,
    // these would collide in Redis — which is the Pitfall 2 scenario.
    await Promise.all([
      writeThroughPlugin(pool, 'tenant-A', 'user-shared', ['Mail.Read']),
      writeThroughPlugin(pool, 'tenant-B', 'user-shared', ['Mail.Read']),
    ]);

    const allKeys = (await redis.keys('mcp:cache:*')).sort();
    // Two keys exactly, differing only in the tenantId segment.
    expect(allKeys).toHaveLength(2);
    expect(allKeys.every((k) => k.includes('shared-client-id:user-shared:'))).toBe(true);
    expect(allKeys.some((k) => k.startsWith('mcp:cache:tenant-A:'))).toBe(true);
    expect(allKeys.some((k) => k.startsWith('mcp:cache:tenant-B:'))).toBe(true);
    // And they are DIFFERENT — the tenantId partition is doing its job.
    expect(allKeys[0]).not.toBe(allKeys[1]);

    await pool.drain();
  });

  it('decrypt in tenant-A does NOT recover tenant-B ciphertext (DEK isolation)', async () => {
    const kek = crypto.randomBytes(32);
    const redis = new MemoryRedisFacade();
    const pool = new TenantPool(redis, kek);

    const tenantA = makeTenant(kek, { id: 'tenant-A' });
    const tenantB = makeTenant(kek, { id: 'tenant-B' });

    await pool.acquire(tenantA);
    await pool.acquire(tenantB);

    // Write each tenant's plaintext
    const pluginA = pool.buildCachePlugin('tenant-A', 'u', ['s']);
    const pluginB = pool.buildCachePlugin('tenant-B', 'u', ['s']);
    const ctxA = {
      cacheHasChanged: true,
      tokenCache: {
        serialize: () => '{"secret":"A-token"}',
        deserialize: (_: string) => {},
      },
    };
    const ctxB = {
      cacheHasChanged: true,
      tokenCache: {
        serialize: () => '{"secret":"B-token"}',
        deserialize: (_: string) => {},
      },
    };
    await pluginA.afterCacheAccess(ctxA as never);
    await pluginB.afterCacheAccess(ctxB as never);

    // Fetch tenant A's blob, swap it into tenant B's key slot.
    // If DEK isolation holds, tenant B's plugin MUST fail to decrypt the swapped
    // blob (because each tenant has a distinct DEK under its own wrapped_dek).
    const keys = await redis.keys('mcp:cache:*');
    const keyA = keys.find((k) => k.startsWith('mcp:cache:tenant-A:'))!;
    const keyB = keys.find((k) => k.startsWith('mcp:cache:tenant-B:'))!;
    const blobA = (await redis.get(keyA))!;
    await redis.set(keyB, blobA, 'EX', 3600);

    // Plugin B tries to read — decrypt must fail and the key must be dropped.
    const readCtx = {
      cacheHasChanged: false,
      tokenCache: {
        serialize: () => '',
        deserialize: vi.fn((_: string) => {}),
      },
    };
    await pluginB.beforeCacheAccess(readCtx as never);
    expect(readCtx.tokenCache.deserialize).not.toHaveBeenCalled();
    // Key was removed after failed decrypt.
    expect(await redis.get(keyB)).toBeNull();

    await pool.drain();
  });
});
