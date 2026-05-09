/**
 * TenantPool — per-tenant MSAL client pool (plan 03-05, D-10, TENANT-03).
 *
 * Hybrid LRU + idle eviction:
 *   - max=200 (MS365_MCP_AUTH_POOL_MAX) — bounded memory.
 *   - idle TTL=30min (MS365_MCP_AUTH_POOL_IDLE_MS) — stale entries evicted.
 *   - background sweep every 60s (defense-in-depth for boundary entries).
 *
 * Cache key composition (TENANT-04 isolation — Pitfall 2 mitigation):
 *   mcp:cache:{tenantId}:{clientId}:{userOid|appOnly}:{scopeHash}
 *
 * MSAL class selection (RESEARCH.md Pattern 5):
 *   - app-only              -> ConfidentialClientApplication (REQUIRES client_secret_resolved)
 *   - delegated + secret    -> ConfidentialClientApplication
 *   - delegated, no secret  -> PublicClientApplication
 *   - bearer                -> bypass MSAL entirely (token comes from request header)
 *
 * Pitfall 2 mitigation: every MSAL acquire must construct a FRESH
 * ICachePlugin per (tenantId, userOid, scopeHash) tuple — never reuse a
 * plugin across users or scope sets. `buildCachePlugin` is the single
 * correct path; it validates the tenant has been acquired so callers can't
 * accidentally construct a plugin for a tenant whose DEK isn't in memory.
 *
 * Sweep timer is unref'd so it does NOT keep the event loop alive —
 * mirrors the unref pattern used in src/lib/shutdown.ts:84-88.
 */
import { ConfidentialClientApplication, PublicClientApplication } from '@azure/msal-node';
import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import type { RedisClient } from '../redis.js';
import { unwrapTenantDek } from '../crypto/dek.js';
import { unwrapWithDek } from '../crypto/envelope.js';
import { getCloudEndpoints } from '../../cloud-config.js';
import { createRedisCachePlugin, type CachePluginConfig } from '../msal-cache-plugin.js';
import logger from '../../logger.js';
import type { TenantRow } from './tenant-row.js';

export type MsalClient = ConfidentialClientApplication | PublicClientApplication;

interface PoolEntry {
  /** null when tenant.mode === 'bearer' — MSAL is bypassed entirely. */
  client: MsalClient | null;
  dek: Buffer;
  mode: TenantRow['mode'];
  clientId: string;
  authority: string;
  lastAccessedAt: number;
}

const DEFAULT_MAX = 200;
const DEFAULT_IDLE_MS = 1_800_000; // 30 min
const SWEEP_INTERVAL_MS = 60_000;

// Minimal shape of the Node Timer returned by global timer APIs. The full
// Timer type requires @types/node globals which aren't exposed in the ESLint
// flat config's `globals` entry — this structural type lets the pool compile
// AND pass lint without losing the unref + clearInterval contract.
type TimerHandle = { unref(): void };

export class TenantPool {
  private pool: LRUCache<string, PoolEntry>;
  private sweepTimer: TimerHandle | null = null;

  constructor(
    private readonly redis: RedisClient,
    private readonly kek: Buffer
  ) {
    const max = Number.parseInt(process.env.MS365_MCP_AUTH_POOL_MAX ?? String(DEFAULT_MAX), 10);
    const ttl = Number.parseInt(
      process.env.MS365_MCP_AUTH_POOL_IDLE_MS ?? String(DEFAULT_IDLE_MS),
      10
    );
    this.pool = new LRUCache<string, PoolEntry>({
      max: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX,
      ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_IDLE_MS,
      updateAgeOnGet: true,
      updateAgeOnHas: false,
      dispose: (_entry, key, reason) => {
        logger.info({ tenantId: key, reason }, 'TenantPool eviction');
      },
    });
    this.sweepTimer = setInterval(() => this.pool.purgeStale(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  /**
   * Lazy-instantiate an MSAL client for this tenant. Identity-stable:
   * repeated acquires for the same tenantId return the SAME client instance
   * until eviction.
   *
   * @throws Error when tenant.disabled_at is set (WR-02 — direct callers
   *   that bypass loadTenant must not get a working MSAL client for a
   *   disabled tenant; the disable-cascade convention says wrapped_dek is
   *   nulled when disabled_at is set, but database constraints don't
   *   enforce the pairing — this guard is the runtime invariant.)
   * @throws Error when tenant.wrapped_dek is null (disabled or unprovisioned)
   * @throws Error when tenant.mode is 'app-only' without client_secret_resolved
   */
  async acquire(tenant: TenantRow): Promise<MsalClient | null> {
    // WR-02 fix: explicit disabled_at gate. loadTenant filters disabled rows
    // at SELECT time, but tests, CLIs, and future admin flows can construct
    // a TenantRow without that path. Refuse here too rather than relying on
    // the convention that disabled tenants always have wrapped_dek = NULL.
    if (tenant.disabled_at) {
      throw new Error(
        `Tenant ${tenant.id} is disabled (disabled_at=${tenant.disabled_at.toISOString()})`
      );
    }

    const existing = this.pool.get(tenant.id);
    if (existing) return existing.client;

    if (!tenant.wrapped_dek) {
      throw new Error(`Tenant ${tenant.id} has no wrapped_dek (disabled or unprovisioned)`);
    }
    const dek = unwrapTenantDek(tenant.wrapped_dek, this.kek);
    const cloudEndpoints = getCloudEndpoints(tenant.cloud_type);
    const authority = `${cloudEndpoints.authority}/${tenant.tenant_id || 'common'}`;

    // Resolve client_secret_ref → client_secret_resolved (lazy, in-memory).
    // tenant-row.ts documents this as "Done lazily at tenant-pool.acquire()
    // time so plain SELECTs never materialize a plaintext secret." but the
    // resolver was never wired. This block parses the ref:
    //   - JSON envelope `{v,iv,tag,ct}` → AES-GCM-decrypt with the tenant DEK
    //   - anything else (plain string / future `env:` / `kv:` schemes) is
    //     left for callers / future plans to handle (logged at debug only).
    if (tenant.client_secret_ref && !tenant.client_secret_resolved) {
      const ref = tenant.client_secret_ref.trim();
      if (ref.startsWith('{')) {
        try {
          const envelope = JSON.parse(ref);
          tenant.client_secret_resolved = unwrapWithDek(envelope, dek).toString('utf8');
        } catch (err) {
          throw new Error(
            `Tenant ${tenant.id}: failed to unwrap client_secret_ref envelope: ${(err as Error).message}`
          );
        }
      }
    }

    const client = this.buildMsalClient(tenant, authority);
    this.pool.set(tenant.id, {
      client,
      dek,
      mode: tenant.mode,
      clientId: tenant.client_id,
      authority,
      lastAccessedAt: Date.now(),
    });
    return client;
  }

  /**
   * Build a per-request MSAL cache plugin for a specific (userOid, scopes)
   * tuple. MUST be called on EVERY acquireToken call — never cached across
   * requests (Pitfall 2 mitigation).
   *
   * @throws Error when the tenant has not been acquired yet
   */
  buildCachePlugin(
    tenantId: string,
    userOid: string,
    scopes: string[]
  ): ReturnType<typeof createRedisCachePlugin> {
    const entry = this.pool.get(tenantId);
    if (!entry) {
      throw new Error(`TenantPool: no entry for tenant ${tenantId} (call acquire first)`);
    }
    const scopeHash = hashScopes(scopes);
    const config: CachePluginConfig = {
      redis: this.redis,
      tenantId,
      clientId: entry.clientId,
      userOid,
      scopeHash,
      dek: entry.dek,
    };
    return createRedisCachePlugin(config);
  }

  /**
   * Remove a tenant's entry synchronously. Called by the disable cascade
   * (bin/disable-tenant.mjs) and by 03-08's pub/sub invalidation subscriber.
   */
  evict(tenantId: string): void {
    this.pool.delete(tenantId);
  }

  /**
   * Test/introspection helper — returns true if the tenant has a live pool
   * entry. Not intended for hot-path code; production callers use acquire().
   */
  has(tenantId: string): boolean {
    return this.pool.has(tenantId);
  }

  /**
   * Return the per-tenant DEK for callers that need to build their own
   * per-subsystem encryptor (plan 03-07 SessionStore is the first consumer:
   * the /token handler wraps refresh tokens with this DEK after MSAL acquire;
   * the Graph 401 handler uses the same DEK to unwrap the stored session).
   *
   * @throws Error when the tenant is not currently in the pool. Callers MUST
   *   call `acquire(tenant)` first so the wrapped_dek is unwrapped into the
   *   cached PoolEntry.
   */
  getDekForTenant(tenantId: string): Buffer {
    const entry = this.pool.get(tenantId);
    if (!entry) {
      throw new Error(`TenantPool: no entry for tenant ${tenantId}; call acquire first`);
    }
    return entry.dek;
  }

  /**
   * Graceful-shutdown hook. Clears the sweep timer and empties the pool.
   * Registered in src/index.ts phase3ShutdownOrchestrator BEFORE
   * redis.shutdown so the final Redis writes can drain.
   */
  async drain(): Promise<void> {
    if (this.sweepTimer) {
      // Cast through unknown because TimerHandle is a structural subset;
      // clearInterval's overload wants the full Timer object.
      clearInterval(this.sweepTimer as unknown as Parameters<typeof clearInterval>[0]);
      this.sweepTimer = null;
    }
    this.pool.clear();
  }

  private buildMsalClient(tenant: TenantRow, authority: string): MsalClient | null {
    if (tenant.mode === 'bearer') {
      // Bypass MSAL entirely — bearer tokens come from the Authorization
      // header (03-06 bearer middleware). No cache plugin for this mode.
      return null;
    }
    if (tenant.mode === 'app-only') {
      if (!tenant.client_secret_resolved) {
        throw new Error(`Tenant ${tenant.id} is app-only but has no resolved client_secret`);
      }
      return new ConfidentialClientApplication({
        auth: {
          clientId: tenant.client_id,
          authority,
          clientSecret: tenant.client_secret_resolved,
        },
      });
    }
    // delegated
    if (tenant.client_secret_resolved) {
      return new ConfidentialClientApplication({
        auth: {
          clientId: tenant.client_id,
          authority,
          clientSecret: tenant.client_secret_resolved,
        },
      });
    }
    return new PublicClientApplication({
      auth: { clientId: tenant.client_id, authority },
    });
  }
}

/**
 * Deterministic scope-set fingerprint. Sort first so `{A,B}` and `{B,A}`
 * hash identically — otherwise a tool that happens to pass scopes in a
 * different order would miss the cache even though the granted permissions
 * are the same.
 *
 * 16 hex chars (64 bits) is sufficient — collision would only affect the
 * same tenant+client+user, and MSAL handles missing-cache-entry gracefully
 * via a fresh network acquire.
 */
function hashScopes(scopes: string[]): string {
  return createHash('sha256').update(scopes.slice().sort().join(',')).digest('hex').slice(0, 16);
}

// ── Module-level singleton accessors (plan 03-05) ─────────────────────────
// Matches src/lib/postgres.ts + src/lib/redis.ts pattern: one pool per
// process, lazily constructed, idempotent shutdown. Consumers in src/index.ts
// wire via getTenantPool() + shutdown(); tests swap in a fresh instance via
// __setTenantPoolForTesting().

let singleton: TenantPool | null = null;

/**
 * Returns the singleton TenantPool. The caller MUST have constructed it
 * at least once via initTenantPool(redis, kek) — this accessor does NOT
 * lazy-construct because the KEK is not available at module-load time.
 */
export function getTenantPool(): TenantPool | null {
  return singleton;
}

/**
 * Construct the singleton TenantPool. Idempotent: a second call with the
 * same redis/kek returns the existing instance unchanged.
 */
export function initTenantPool(redis: RedisClient, kek: Buffer): TenantPool {
  if (singleton) return singleton;
  singleton = new TenantPool(redis, kek);
  return singleton;
}

/**
 * Graceful-shutdown hook. Idempotent — safe to call even when no pool was
 * constructed (stdio mode or HTTP mode that crashed pre-bootstrap).
 * Registered in src/index.ts phase3ShutdownOrchestrator BEFORE
 * redisClient.shutdown so final Redis writes can drain.
 */
export async function shutdown(): Promise<void> {
  if (!singleton) return;
  const p = singleton;
  singleton = null;
  await p.drain();
}

/**
 * Test-only: replace the cached singleton. Production callers MUST use
 * initTenantPool() / getTenantPool() — this export exists solely so vitest
 * tests can reset between runs without needing module reloads.
 */
export function __setTenantPoolForTesting(p: TenantPool | null): void {
  singleton = p;
}
