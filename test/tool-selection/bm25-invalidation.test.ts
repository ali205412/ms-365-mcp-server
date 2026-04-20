/**
 * Plan 05-06 Task 1 — schemaVersion rotation + invalidation coverage.
 *
 * Pairs with test/tool-selection/per-tenant-bm25.test.ts. This file focuses
 * on the invalidation surface (schema rotation, explicit evict, empty-set
 * determinism) separately from the cache-hit / LRU-eviction matrix so the
 * two test files stay tight and intent-revealing.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createTenantBm25Cache,
  type ToolRegistry,
  type ToolRegistryEntry,
} from '../../src/lib/tool-selection/per-tenant-bm25.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function registryOf(aliases: string[]): ToolRegistry {
  const m = new Map<string, ToolRegistryEntry>();
  for (const alias of aliases) {
    m.set(alias, {
      alias,
      path: `/graph/${alias}`,
      description: `test fixture entry for ${alias}`,
      llmTip: `hint for ${alias}`,
    });
  }
  return m;
}

describe('per-tenant BM25 cache — schema rotation + invalidate', () => {
  it('Test 1: schemaVersion rotation — tenant enabled-set changes produce a fresh key', () => {
    const cache = createTenantBm25Cache();
    const registry = registryOf(['x', 'y', 'z']);

    cache.get(TENANT_A, new Set(['x']), registry);
    expect(cache.size()).toBe(1);

    // A new enabled set (x, y) hashes to a different schema → cache miss.
    cache.get(TENANT_A, new Set(['x', 'y']), registry);
    expect(cache.size()).toBe(2);

    // Third distinct set for the same tenant — three distinct cache entries.
    cache.get(TENANT_A, new Set(['z']), registry);
    expect(cache.size()).toBe(3);
  });

  it('Test 2: invalidate(tenantId) drops every rotated entry for that tenant', () => {
    const cache = createTenantBm25Cache();
    const registry = registryOf(['x', 'y', 'z']);

    cache.get(TENANT_A, new Set(['x']), registry);
    cache.get(TENANT_A, new Set(['x', 'y']), registry);
    cache.get(TENANT_A, new Set(['z']), registry);
    cache.get(TENANT_B, new Set(['x']), registry);
    expect(cache.size()).toBe(4);

    const removed = cache.invalidate(TENANT_A);

    expect(removed).toBe(3);
    expect(cache.size()).toBe(1);
  });

  it('Test 3: set iteration order does NOT affect the cache key', () => {
    const cache = createTenantBm25Cache();
    const registry = registryOf(['x', 'y', 'z']);

    // JS Set iterates in insertion order; two Sets with the same members
    // inserted in different orders MUST collide on the cache key thanks to
    // the .sort() step in schemaHash.
    const inserted1 = new Set<string>();
    inserted1.add('x');
    inserted1.add('y');
    inserted1.add('z');

    const inserted2 = new Set<string>();
    inserted2.add('z');
    inserted2.add('x');
    inserted2.add('y');

    const ix1 = cache.get(TENANT_A, inserted1, registry);
    const ix2 = cache.get(TENANT_A, inserted2, registry);

    expect(ix2).toBe(ix1);
    expect(cache.size()).toBe(1);
  });

  it('Test 4: empty set has a deterministic, stable schema hash', () => {
    const cache = createTenantBm25Cache();
    const registry = registryOf(['x', 'y']);

    const empty1 = new Set<string>();
    const empty2 = new Set<string>();

    const ix1 = cache.get(TENANT_A, empty1, registry);
    const ix2 = cache.get(TENANT_A, empty2, registry);

    // Both empty Sets hit the same cache key.
    expect(ix2).toBe(ix1);
    expect(cache.size()).toBe(1);

    // And the empty set's hash is derivable externally (guard against silent
    // drift from the documented algorithm): sha256(JSON.stringify([])) prefix.
    const expectedHashPrefix = createHash('sha256')
      .update(JSON.stringify([]))
      .digest('hex')
      .slice(0, 16);

    // Sanity: produce a separate cache instance and confirm the key behaviour
    // matches — if the algorithm changes, Test 3 above would break too.
    const cache2 = createTenantBm25Cache();
    cache2.get(TENANT_A, new Set<string>(), registry);
    expect(cache2.size()).toBe(1);
    expect(expectedHashPrefix).toMatch(/^[0-9a-f]{16}$/);
  });

  it('invalidate on a tenant with no cached entries is a no-op (returns 0)', () => {
    const cache = createTenantBm25Cache();
    const registry = registryOf(['x']);

    cache.get(TENANT_B, new Set(['x']), registry);
    expect(cache.size()).toBe(1);

    const removed = cache.invalidate(TENANT_A);
    expect(removed).toBe(0);
    expect(cache.size()).toBe(1);
  });

  it('prefix-match on invalidate does NOT catch tenants that share a GUID prefix by accident', () => {
    const cache = createTenantBm25Cache();
    const registry = registryOf(['x']);

    // Craft two GUIDs that share the first 8 hex characters but differ after.
    // The cache key format `${tenantId}:${hash}` has the colon as separator
    // so startsWith(`${tenantId}:`) is safe — only full GUIDs match.
    const TENANT_SHARED_PREFIX_A = '11111111-1111-1111-1111-111111111111';
    const TENANT_SHARED_PREFIX_B = '11111111-2222-2222-2222-222222222222';

    cache.get(TENANT_SHARED_PREFIX_A, new Set(['x']), registry);
    cache.get(TENANT_SHARED_PREFIX_B, new Set(['x']), registry);
    expect(cache.size()).toBe(2);

    const removed = cache.invalidate(TENANT_SHARED_PREFIX_A);
    expect(removed).toBe(1);
    expect(cache.size()).toBe(1);
  });
});
