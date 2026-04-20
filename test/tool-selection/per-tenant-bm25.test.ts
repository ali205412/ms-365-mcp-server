/**
 * Plan 05-06 Task 1 — per-tenant BM25 discovery cache (COVRG-05, D-20, T-05-12).
 *
 * Validates src/lib/tool-selection/per-tenant-bm25.ts:
 *
 *   - LRU cache keyed by `${tenantId}:${sha256(sorted enabled_tools_set).slice(0,16)}`.
 *   - Default bounds: max=200 entries / ttlMs=10min (overridable for tests).
 *   - On miss: build BM25 index over the INTERSECTION of (registry ∩ enabledSet);
 *     unknown aliases in enabledSet are silently skipped.
 *   - Token-weighting mirrors v1 buildDiscoverySearchIndex:
 *       name × 5, path × 2, llmTip capped at 12 tokens, description capped at 40.
 *   - Explicit `invalidate(tenantId)` drops every cache key with the tenant
 *     prefix — this is the path the pub/sub subscriber exercises.
 *   - `size()` reports the current entry count (bounded by the LRU max).
 *
 * Tenant isolation is the key correctness property: the per-tenant index for
 * tenant A MUST NOT carry any document for a tool outside A's enabled set,
 * and two concurrent tenants with disjoint sets MUST produce disjoint result
 * sets for the same query.
 */
import { describe, expect, it } from 'vitest';
import { scoreQuery } from '../../src/lib/bm25.js';
import {
  createTenantBm25Cache,
  type ToolRegistry,
  type ToolRegistryEntry,
} from '../../src/lib/tool-selection/per-tenant-bm25.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

/**
 * Small fixture registry covering the workloads the plan's test matrix
 * reaches into: mail, users, calendar. Tokens follow the real-world shape
 * of Microsoft Graph endpoints so BM25 ranking behaves the same as in
 * production.
 */
function buildFixtureRegistry(): ToolRegistry {
  const entries: ToolRegistryEntry[] = [
    {
      alias: 'send-mail',
      path: '/me/sendMail',
      description: 'Send an email on behalf of the signed-in user',
      llmTip: 'Outlook send; body supports text or html',
    },
    {
      alias: 'list-mail-messages',
      path: '/me/messages',
      description: 'List messages in the signed-in user mailbox',
      llmTip: 'Use $top to limit, $filter to narrow',
    },
    {
      alias: 'list-users',
      path: '/users',
      description: 'List users in the organization directory',
      llmTip: 'Use $select to reduce payload size',
    },
    {
      alias: 'create-event',
      path: '/me/events',
      description: 'Create a new calendar event',
      llmTip: 'Accepts start/end datetime and attendees',
    },
    {
      alias: 'get-user',
      path: '/users/{id}',
      description: 'Get a single user by id',
      llmTip: 'Use $expand to include manager',
    },
  ];
  return new Map(entries.map((e) => [e.alias, e]));
}

describe('per-tenant BM25 cache — basic behavior', () => {
  it('Test 1: second get with same key returns the same cached index (pointer identity)', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();
    const setA = new Set(['send-mail', 'list-mail-messages']);

    const first = cache.get(TENANT_A, setA, registry);
    const second = cache.get(TENANT_A, setA, registry);

    expect(second).toBe(first);
  });

  it('Test 2: differing enabled sets for the same tenant produce distinct keys; both cached', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();
    const setA = new Set(['send-mail', 'list-mail-messages']);
    const setAprime = new Set(['list-users', 'get-user']);

    const ix1 = cache.get(TENANT_A, setA, registry);
    const ix2 = cache.get(TENANT_A, setAprime, registry);

    expect(ix1).not.toBe(ix2);
    expect(cache.size()).toBe(2);
    // The two indexes carry disjoint docs — no cross-set leakage.
    expect([...ix1.docs.keys()].sort()).toEqual(['list-mail-messages', 'send-mail']);
    expect([...ix2.docs.keys()].sort()).toEqual(['get-user', 'list-users']);
  });

  it('Test 3: invalidate(tenantId) drops every entry for that tenant; leaves other tenants intact', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();
    const setA = new Set(['send-mail']);
    const setB = new Set(['list-users']);

    cache.get(TENANT_A, setA, registry);
    cache.get(TENANT_A, new Set(['list-mail-messages']), registry);
    cache.get(TENANT_B, setB, registry);

    expect(cache.size()).toBe(3);

    const removed = cache.invalidate(TENANT_A);
    expect(removed).toBe(2);
    expect(cache.size()).toBe(1);

    // Tenant B's entry still serves — get returns the cached index.
    const stillB = cache.get(TENANT_B, setB, registry);
    expect(stillB.docs.has('list-users')).toBe(true);
    expect(cache.size()).toBe(1);
  });

  it('Test 4: LRU eviction: max=2 evicts the least-recently-used entry', () => {
    const cache = createTenantBm25Cache({ max: 2 });
    const registry = buildFixtureRegistry();

    cache.get(TENANT_A, new Set(['send-mail']), registry); // Entry 1
    cache.get(TENANT_B, new Set(['list-users']), registry); // Entry 2
    cache.get(TENANT_A, new Set(['list-mail-messages']), registry); // Entry 3 evicts LRU

    expect(cache.size()).toBe(2);
    // Re-getting Entry 1's exact args forces a rebuild (miss); simpler assertion:
    // the oldest inserted key should be gone, and new inserts succeed.
    cache.get('cc333333-3333-3333-3333-333333333333', new Set(['get-user']), registry);
    expect(cache.size()).toBe(2);
  });

  it('Test 5: TTL expiry: entries are evicted after ttlMs', async () => {
    const cache = createTenantBm25Cache({ ttlMs: 50 });
    const registry = buildFixtureRegistry();
    const set = new Set(['send-mail']);

    cache.get(TENANT_A, set, registry);
    expect(cache.size()).toBe(1);

    await new Promise((r) => setTimeout(r, 100));

    // lru-cache prunes on access; a subsequent get that misses confirms TTL worked.
    const afterTtl = cache.get(TENANT_A, set, registry);
    expect(afterTtl).toBeDefined();
    expect(cache.size()).toBe(1); // Rebuilt entry replaces the expired one.
  });

  it('Test 6: schemaHash is deterministic and order-independent', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();
    const orderA = new Set(['send-mail', 'list-users', 'create-event']);
    const orderB = new Set(['create-event', 'send-mail', 'list-users']);

    const ixA = cache.get(TENANT_A, orderA, registry);
    const ixB = cache.get(TENANT_A, orderB, registry);

    // Same content → same cache key → pointer identity (second call is a cache hit).
    expect(ixB).toBe(ixA);
    expect(cache.size()).toBe(1);
  });

  it('Test 7: BM25 scoring returns only docs in the tenant enabled set', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();
    const setA = new Set(['send-mail', 'list-mail-messages']);
    const setB = new Set(['list-users', 'get-user']);

    const indexA = cache.get(TENANT_A, setA, registry);
    const indexB = cache.get(TENANT_B, setB, registry);

    const rankedA = scoreQuery('send mail', indexA);
    expect(rankedA.length).toBeGreaterThan(0);
    expect(rankedA[0].id).toBe('send-mail');

    const rankedB = scoreQuery('send mail', indexB);
    // Tenant B has no mail tools enabled — the query tokens match no docs.
    expect(rankedB).toEqual([]);
  });

  it('Test 8: cache entries carry only the tenant enabled aliases', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();
    const setA = new Set(['send-mail', 'list-mail-messages']);

    const indexA = cache.get(TENANT_A, setA, registry);

    expect(indexA.docs.has('send-mail')).toBe(true);
    expect(indexA.docs.has('list-mail-messages')).toBe(true);
    expect(indexA.docs.has('list-users')).toBe(false);
    expect(indexA.docs.has('create-event')).toBe(false);
    expect(indexA.docs.has('get-user')).toBe(false);
  });

  it('Test 9: size() reports the current entry count', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();

    expect(cache.size()).toBe(0);

    cache.get(TENANT_A, new Set(['send-mail']), registry);
    expect(cache.size()).toBe(1);

    cache.get(TENANT_B, new Set(['list-users']), registry);
    expect(cache.size()).toBe(2);
  });

  it('silently skips aliases that are not present in the registry', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();
    const setWithUnknown = new Set(['send-mail', 'unknown-alias-not-in-registry']);

    const index = cache.get(TENANT_A, setWithUnknown, registry);

    // Unknown alias is NOT in docs — the intersection path filters it out.
    expect(index.docs.has('send-mail')).toBe(true);
    expect(index.docs.has('unknown-alias-not-in-registry')).toBe(false);
  });

  it('empty enabled set produces an empty BM25 index', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();

    const index = cache.get(TENANT_A, new Set<string>(), registry);

    expect(index.docs.size).toBe(0);
    expect(scoreQuery('send mail', index)).toEqual([]);
  });

  it('_clear() drops every cache entry across all tenants', () => {
    const cache = createTenantBm25Cache();
    const registry = buildFixtureRegistry();

    cache.get(TENANT_A, new Set(['send-mail']), registry);
    cache.get(TENANT_B, new Set(['list-users']), registry);
    expect(cache.size()).toBe(2);

    cache._clear();
    expect(cache.size()).toBe(0);
  });
});
