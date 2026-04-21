/**
 * Admin API keys CRUD + argon2id verify + 60s LRU cache + Redis pub/sub
 * invalidation (plan 04-03, D-15, ADMIN-02).
 *
 * Endpoints:
 *   POST   /admin/api-keys              — mint (plaintext once)
 *   GET    /admin/api-keys              — list (NO plaintext, NO key_hash)
 *   GET    /admin/api-keys/:id          — get single (same whitelist)
 *   POST   /admin/api-keys/:id/revoke   — mark revoked + publish invalidation
 *   POST   /admin/api-keys/:id/rotate   — mint new + revoke old atomically
 *
 * Plus the `verifyApiKeyPlaintext` helper consumed by the dual-stack auth
 * middleware (plan 04-04). The helper runs `argon2.verify` with a 60-second
 * in-process LRU cache keyed by sha256(plaintext) — so the plaintext itself
 * is never retained in memory. A companion `subscribeToApiKeyRevoke` hook
 * installs a Redis pub/sub subscriber on channel `mcp:api-key-revoke`; on
 * receipt the cached keyId is evicted, providing faster-than-TTL revocation
 * propagation across replicas (single-replica v2.0 uses TTL as the fallback).
 *
 * D-15 lock points:
 *   - `msk_live_` prefix with 32-byte entropy body (base64url, 43 chars)
 *   - argon2id with memoryCost 64*1024, timeCost 3, parallelism 1
 *   - plaintext_key returned ONCE at mint and NEVER again (GET excludes it)
 *   - revocation freshness: ≤60s via TTL; <100ms via pub/sub when subscribed
 *
 * Security invariants:
 *   - plaintext_key NEVER logged (every info/warn log carries only keyId +
 *     displaySuffix + tenantId). D-01 redactor also covers *.plaintext_key,
 *     *.key_hash, req.headers.x-admin-api-key as belt-and-suspenders.
 *   - GET handlers NEVER SELECT key_hash. The whitelist SELECT makes this
 *     structurally impossible (no SELECT * path exists).
 *   - RBAC: tenantScoped admins cannot act on other tenants — enforced at
 *     the top of every handler BEFORE any DB lookup.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import type { Pool } from 'pg';
import { withTransaction } from '../postgres.js';
import { writeAudit } from '../audit.js';
import {
  problemBadRequest,
  problemNotFound,
  problemForbidden,
  problemConflict,
  problemInternal,
} from './problem-json.js';
import logger from '../../logger.js';
import type { RedisClient } from '../redis.js';

// ── Public constants (exported for test assertions & 04-04 dual-stack) ─────

/** Bearer prefix — GitGuardian / TruffleHog match on `msk_live_` out of the box. */
export const API_KEY_PREFIX = 'msk_live_';

/** 32 bytes of entropy → 43 base64url chars (unpadded). 256-bit key per D-15. */
export const API_KEY_BODY_LENGTH_CHARS = 43;

/** Last 8 chars of plaintext retained for admin-UI recognition. */
export const API_KEY_DISPLAY_SUFFIX_CHARS = 8;

/** 60-second LRU TTL per D-15 revocation freshness. */
export const API_KEY_CACHE_TTL_MS = 60_000;

/** Pub/sub channel for faster-than-TTL invalidation. */
export const API_KEY_REVOKE_CHANNEL = 'mcp:api-key-revoke';

// ── argon2id parameters (D-15 verbatim) ─────────────────────────────────────

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // 64 MiB
  timeCost: 3, // iterations
  parallelism: 1,
} as const;

/** Regex for fast-fail before DB lookup + argon2.verify. */
const KEY_REGEX = new RegExp(`^${API_KEY_PREFIX}[A-Za-z0-9_-]{${API_KEY_BODY_LENGTH_CHARS}}$`);

// ── Module-level cache state ────────────────────────────────────────────────

/**
 * 60s LRU. Key: sha256(plaintext) hex — so the plaintext itself never sits
 * in memory. Value: ApiKeyIdentity with revokedAt=null at cache write time.
 *
 * `let` rather than `const` so tests can substitute a cache with a shorter
 * TTL via __setApiKeyCacheForTesting — LRUCache captures ttl at construction
 * and does not support changing it at runtime.
 */
let cache: LRUCache<string, ApiKeyIdentity> = new LRUCache<string, ApiKeyIdentity>({
  max: 10_000,
  ttl: API_KEY_CACHE_TTL_MS,
  updateAgeOnGet: false,
});

/**
 * In-flight promise map — when two callers verify the SAME plaintext
 * concurrently, only one argon2.verify call is made. Critical for protecting
 * the event loop under auth flood (Pitfall 6 in RESEARCH.md:780-787).
 */
const inflight = new Map<string, Promise<ApiKeyIdentity | null>>();

// ── Types ───────────────────────────────────────────────────────────────────

export interface ApiKeyIdentity {
  keyId: string;
  tenantId: string;
  displaySuffix: string;
  name: string;
  revokedAt: Date | null;
}

/**
 * Admin context attached to req by the dual-stack auth middleware (plan
 * 04-04). Shape defined here so the api-keys handlers can read it before
 * 04-04 lands — the middleware will populate these exact fields.
 */
interface AdminContext {
  actor: string;
  source: 'entra' | 'api-key';
  /** null = global admin; string = tenant-scoped admin */
  tenantScoped: string | null;
}

// Express 5's IRouterMatcher infers P from the path literal. Using
// `Request<any, any, any, any>` sidesteps the overload mismatch for custom
// handler signatures; admin.* and req.id are declaration-merged globally in
// src/lib/admin/auth/dual-stack.ts, so RequestWithAdmin stays a thin alias.
type RequestWithAdmin = Request<any, any, any, any>;

/** Dependency bag. Pool + Redis are the only runtime needs. */
interface ApiKeyRouteDeps {
  pgPool: Pool;
  redis: RedisClient;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a fresh API key plaintext + its display suffix.
 *
 * 32 bytes (256 bits) from crypto.randomBytes → base64url with no padding →
 * exactly 43 chars. Prepend `msk_live_` for secret-scanner friendliness.
 */
function generateApiKey(): { plaintext: string; displaySuffix: string } {
  const body = randomBytes(32).toString('base64url');
  const plaintext = `${API_KEY_PREFIX}${body}`;
  const displaySuffix = plaintext.slice(-API_KEY_DISPLAY_SUFFIX_CHARS);
  return { plaintext, displaySuffix };
}

/** Argon2id hash with the D-15 parameter bundle. */
async function hashApiKey(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/** Read the admin context or null if not wired. */
function getAdmin(req: RequestWithAdmin): AdminContext | null {
  return req.admin ?? null;
}

/**
 * RBAC helper: returns true if the admin is allowed to act on the given
 * tenant. null tenantScoped = global admin = always allowed.
 */
function canActOnTenant(admin: AdminContext, tenantId: string | null): boolean {
  if (admin.tenantScoped === null) return true;
  return tenantId !== null && admin.tenantScoped === tenantId;
}

/** Project a DB row to the whitelist shape returned by GET handlers. */
interface ApiKeyPublicRow {
  id: string;
  tenant_id: string;
  name: string;
  display_suffix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function serializeApiKeyRow(row: {
  id: string;
  tenant_id: string;
  name: string;
  display_suffix: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}): ApiKeyPublicRow {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    display_suffix: row.display_suffix,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    last_used_at:
      row.last_used_at instanceof Date
        ? row.last_used_at.toISOString()
        : row.last_used_at === null
          ? null
          : String(row.last_used_at),
    revoked_at:
      row.revoked_at instanceof Date
        ? row.revoked_at.toISOString()
        : row.revoked_at === null
          ? null
          : String(row.revoked_at),
  };
}

// ── verifyApiKeyPlaintext (consumed by 04-04 dual-stack) ────────────────────

/**
 * Verify a plaintext API key and return its identity, or null if invalid.
 *
 * Flow:
 *   1. Regex fast-fail (no DB or argon2.verify on malformed input).
 *   2. LRU cache lookup by sha256(plaintext) — plaintext never sits in cache.
 *   3. In-flight dedup — two concurrent calls for same plaintext share one
 *      argon2.verify (Pitfall 6 mitigation).
 *   4. DB prefilter by display_suffix (LAST 8 chars). Suffix collisions are
 *      rare (8 base64url chars = 2^48 space); cap LIMIT at 16 for worst case.
 *   5. argon2.verify against each candidate — timing-safe per node-argon2
 *      library contract (RFC 9106 §9.4).
 *   6. On success, cache the identity ONLY if revokedAt is null.
 *
 * Never throws — all DB errors log at warn and return null so the caller
 * (04-04 middleware) can translate to 401 uniformly.
 */
export async function verifyApiKeyPlaintext(
  plaintext: string,
  deps: { pgPool: Pool; redis: RedisClient }
): Promise<ApiKeyIdentity | null> {
  // 1. fast-fail on malformed input
  if (!KEY_REGEX.test(plaintext)) return null;

  const cacheKey = createHash('sha256').update(plaintext).digest('hex');

  // 2. cache hit
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // 3. in-flight dedup
  const inflightPromise = inflight.get(cacheKey);
  if (inflightPromise) return inflightPromise;

  // 4-6. DB prefilter + argon2.verify
  const promise = (async (): Promise<ApiKeyIdentity | null> => {
    try {
      const suffix = plaintext.slice(-API_KEY_DISPLAY_SUFFIX_CHARS);
      const { rows } = await deps.pgPool.query<{
        id: string;
        tenant_id: string;
        name: string;
        key_hash: string;
        display_suffix: string;
        revoked_at: Date | null;
      }>(
        `SELECT id, tenant_id, name, key_hash, display_suffix, revoked_at
           FROM api_keys
          WHERE display_suffix = $1
          LIMIT 16`,
        [suffix]
      );

      for (const row of rows) {
        let ok = false;
        try {
          ok = await argon2.verify(row.key_hash, plaintext);
        } catch (err) {
          // argon2.verify throws on malformed stored hashes (impossible in
          // normal operation). Log + treat as non-match to avoid 500s.
          logger.warn(
            { keyId: row.id, err: (err as Error).message },
            'api-keys: argon2.verify threw; treating as non-match'
          );
          continue;
        }
        if (!ok) continue;

        const identity: ApiKeyIdentity = {
          keyId: row.id,
          tenantId: row.tenant_id,
          displaySuffix: row.display_suffix,
          name: row.name,
          revokedAt: row.revoked_at,
        };
        // Only cache active keys. Revoked rows are still returned so the
        // caller can inspect revokedAt, but they are not cached (next call
        // hits DB and sees the updated state).
        if (row.revoked_at === null) {
          cache.set(cacheKey, identity);
        }
        return identity;
      }

      return null;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'api-keys: DB lookup failed during verify; returning null'
      );
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Walk the cache and drop every entry with the given keyId. Used by both
 * the revoke handler (local eviction) and the pub/sub subscriber (cross-
 * replica eviction). O(cache.size) worst case; cache is capped at 10k so
 * this is trivial.
 */
function evictApiKeyFromCacheByKeyId(keyId: string): void {
  for (const [k, v] of cache.entries()) {
    if (v.keyId === keyId) cache.delete(k);
  }
}

/**
 * Test-only: direct access to evictApiKeyFromCacheByKeyId so tests can
 * simulate the post-pub/sub state without needing a full Redis round-trip.
 */
export function __evictApiKeyFromCacheByKeyId(keyId: string): void {
  evictApiKeyFromCacheByKeyId(keyId);
}

/**
 * Test-only: clear the module-level cache + in-flight map. Required between
 * tests because the module is imported ONCE and Vitest reuses the instance.
 */
export function __resetApiKeyCacheForTesting(): void {
  cache.clear();
  inflight.clear();
}

/**
 * Test-only: replace the module-level cache with one using a custom TTL.
 * LRUCache captures ttl at construction, so swapping the reference is the
 * only way to test TTL expiry behaviour deterministically. Pass null to
 * reset to production defaults.
 */
export function __setApiKeyCacheTtlForTesting(ttlMs: number | null): void {
  cache.clear();
  inflight.clear();
  cache = new LRUCache<string, ApiKeyIdentity>({
    max: 10_000,
    ttl: ttlMs ?? API_KEY_CACHE_TTL_MS,
    updateAgeOnGet: false,
  });
}

// ── Pub/sub subscription (faster-than-TTL invalidation) ─────────────────────

/**
 * Subscribe to `mcp:api-key-revoke`; on each message evict the keyId from
 * the local LRU. Idempotent — subscribing twice reuses the same subscription
 * on ioredis; on MemoryRedisFacade the duplicate is a no-op because
 * message listeners are tracked by reference.
 *
 * Caller (04-01 router bootstrap via Task 3) wraps this in .catch(logger.error)
 * so a temporary Redis outage does not abort router mount — the 60s TTL is
 * the fallback.
 */
export async function subscribeToApiKeyRevoke(redis: RedisClient): Promise<void> {
  await redis.subscribe(API_KEY_REVOKE_CHANNEL);
  redis.on('message', (channel: string, message: string) => {
    if (channel !== API_KEY_REVOKE_CHANNEL) return;
    if (typeof message !== 'string' || message.length === 0) {
      logger.warn(
        { channel, messageLength: message?.length ?? 0 },
        'api-keys: received empty revoke message; ignoring'
      );
      return;
    }
    try {
      evictApiKeyFromCacheByKeyId(message);
      logger.info({ keyId: message }, 'api-keys: evicted from cache via pub/sub');
    } catch (err) {
      logger.error(
        { keyId: message, err: (err as Error).message },
        'api-keys: cache eviction failed (continuing)'
      );
    }
  });
}

// ── Zod schemas ─────────────────────────────────────────────────────────────

const mintBodySchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(128),
});

const rotateBodySchema = z.object({
  name: z.string().min(1).max(128).optional(),
});

// ── Router factory ──────────────────────────────────────────────────────────

/**
 * Build the /admin/api-keys sub-router. Mounted from createAdminRouter via
 * `r.use('/api-keys', createApiKeyRoutes(deps))` (wired in Task 3).
 */
export function createApiKeyRoutes(deps: ApiKeyRouteDeps): Router {
  const r = Router();

  // POST /  — mint
  r.post('/', async (req: RequestWithAdmin, res: Response) => {
    const admin = getAdmin(req);
    if (!admin) {
      // Missing admin context = misconfigured middleware chain. Defensive.
      problemInternal(res, req.id);
      return;
    }

    const parsed = mintBodySchema.safeParse(req.body);
    if (!parsed.success) {
      problemBadRequest(res, parsed.error.issues.map((e) => e.message).join('; '), req.id);
      return;
    }
    const { tenant_id: tenantId, name } = parsed.data;

    if (!canActOnTenant(admin, tenantId)) {
      problemForbidden(res, req.id);
      return;
    }

    // Verify tenant exists and is not disabled
    try {
      const { rows: tenantRows } = await deps.pgPool.query(
        `SELECT id FROM tenants WHERE id = $1 AND disabled_at IS NULL`,
        [tenantId]
      );
      if (tenantRows.length === 0) {
        problemConflict(res, 'tenant_not_found_or_disabled', req.id);
        return;
      }
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'api-keys: tenant lookup failed during mint');
      problemInternal(res, req.id);
      return;
    }

    const { plaintext, displaySuffix } = generateApiKey();
    let keyHash: string;
    try {
      keyHash = await hashApiKey(plaintext);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'api-keys: argon2.hash failed during mint');
      problemInternal(res, req.id);
      return;
    }

    const keyId = randomUUID();

    try {
      const createdAt = await withTransaction(async (client) => {
        const insert = await client.query<{ created_at: Date }>(
          `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING created_at`,
          [keyId, tenantId, name, keyHash, displaySuffix]
        );
        await writeAudit(client, {
          tenantId,
          actor: admin.actor,
          action: 'admin.api-key.mint',
          target: keyId,
          ip: req.ip ?? null,
          requestId: req.id ?? 'unknown',
          result: 'success',
          meta: { keyId, displaySuffix, tenantId },
        });
        return insert.rows[0]!.created_at;
      });

      logger.info({ keyId, displaySuffix, tenantId, actor: admin.actor }, 'api-keys: minted');

      res.status(201).json({
        id: keyId,
        tenant_id: tenantId,
        name,
        plaintext_key: plaintext,
        display_suffix: displaySuffix,
        created_at: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
      });
    } catch (err) {
      logger.error(
        { err: (err as Error).message, keyId, tenantId },
        'api-keys: mint transaction failed'
      );
      problemInternal(res, req.id);
    }
  });

  // GET /  — list
  r.get('/', async (req: RequestWithAdmin, res: Response) => {
    const admin = getAdmin(req);
    if (!admin) {
      problemInternal(res, req.id);
      return;
    }

    const queryTenantId = typeof req.query.tenant_id === 'string' ? req.query.tenant_id : undefined;

    // RBAC: if tenantScoped, the effective filter is forced.
    let effectiveTenantFilter: string | null = null;
    if (admin.tenantScoped !== null) {
      if (queryTenantId !== undefined && queryTenantId !== admin.tenantScoped) {
        problemForbidden(res, req.id);
        return;
      }
      effectiveTenantFilter = admin.tenantScoped;
    } else if (queryTenantId !== undefined) {
      effectiveTenantFilter = queryTenantId;
    }

    const limitRaw =
      typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : 50;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200 ? limitRaw : 50;

    try {
      const params: unknown[] = [];
      let where = '';
      if (effectiveTenantFilter !== null) {
        params.push(effectiveTenantFilter);
        where = `WHERE tenant_id = $${params.length}`;
      }
      params.push(limit);
      const { rows } = await deps.pgPool.query(
        `SELECT id, tenant_id, name, display_suffix, created_at, last_used_at, revoked_at
           FROM api_keys
           ${where}
           ORDER BY created_at DESC, id DESC
           LIMIT $${params.length}`,
        params
      );
      res.status(200).json({
        data: rows.map(serializeApiKeyRow),
        next_cursor: null,
        has_more: false,
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'api-keys: list query failed');
      problemInternal(res, req.id);
    }
  });

  // GET /:id
  r.get('/:id', async (req: RequestWithAdmin, res: Response) => {
    const admin = getAdmin(req);
    if (!admin) {
      problemInternal(res, req.id);
      return;
    }
    try {
      const { rows } = await deps.pgPool.query(
        `SELECT id, tenant_id, name, display_suffix, created_at, last_used_at, revoked_at
           FROM api_keys
          WHERE id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) {
        problemNotFound(res, 'api_key', req.id);
        return;
      }
      const row = rows[0];
      if (!canActOnTenant(admin, row.tenant_id)) {
        problemForbidden(res, req.id);
        return;
      }
      res.status(200).json(serializeApiKeyRow(row));
    } catch (err) {
      logger.error(
        { err: (err as Error).message, id: req.params.id },
        'api-keys: get by id failed'
      );
      problemInternal(res, req.id);
    }
  });

  // POST /:id/revoke
  r.post('/:id/revoke', async (req: RequestWithAdmin, res: Response) => {
    const admin = getAdmin(req);
    if (!admin) {
      problemInternal(res, req.id);
      return;
    }
    const id = req.params.id;

    try {
      const result = await withTransaction(async (client) => {
        const sel = await client.query<{
          id: string;
          tenant_id: string;
          revoked_at: Date | null;
        }>(`SELECT id, tenant_id, revoked_at FROM api_keys WHERE id = $1 FOR UPDATE`, [id]);
        if (sel.rows.length === 0) {
          return { kind: 'not_found' as const };
        }
        const row = sel.rows[0];
        if (!canActOnTenant(admin, row.tenant_id)) {
          return { kind: 'forbidden' as const };
        }
        if (row.revoked_at !== null) {
          return { kind: 'already_revoked' as const };
        }
        const upd = await client.query<{ revoked_at: Date }>(
          `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 RETURNING revoked_at`,
          [id]
        );
        await writeAudit(client, {
          tenantId: row.tenant_id,
          actor: admin.actor,
          action: 'admin.api-key.revoke',
          target: id,
          ip: req.ip ?? null,
          requestId: req.id ?? 'unknown',
          result: 'success',
          meta: { keyId: id, tenantId: row.tenant_id },
        });
        return {
          kind: 'ok' as const,
          tenantId: row.tenant_id,
          revokedAt: upd.rows[0]!.revoked_at,
        };
      });

      if (result.kind === 'not_found') {
        problemNotFound(res, 'api_key', req.id);
        return;
      }
      if (result.kind === 'forbidden') {
        problemForbidden(res, req.id);
        return;
      }
      if (result.kind === 'already_revoked') {
        problemConflict(res, 'already_revoked', req.id);
        return;
      }

      // Post-commit: publish invalidation + local evict.
      try {
        await deps.redis.publish(API_KEY_REVOKE_CHANNEL, id);
      } catch (err) {
        // Non-fatal: TTL is the fallback.
        logger.warn(
          { keyId: id, err: (err as Error).message },
          'api-keys: redis publish on revoke failed; TTL will catch up'
        );
      }
      evictApiKeyFromCacheByKeyId(id);

      logger.info(
        { keyId: id, tenantId: result.tenantId, actor: admin.actor },
        'api-keys: revoked'
      );

      res.status(200).json({
        id,
        revoked_at:
          result.revokedAt instanceof Date
            ? result.revokedAt.toISOString()
            : String(result.revokedAt),
      });
    } catch (err) {
      logger.error({ err: (err as Error).message, id }, 'api-keys: revoke transaction failed');
      problemInternal(res, req.id);
    }
  });

  // POST /:id/rotate
  r.post('/:id/rotate', async (req: RequestWithAdmin, res: Response) => {
    const admin = getAdmin(req);
    if (!admin) {
      problemInternal(res, req.id);
      return;
    }
    const id = req.params.id;

    const parsed = rotateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      problemBadRequest(res, parsed.error.issues.map((e) => e.message).join('; '), req.id);
      return;
    }

    try {
      const result = await withTransaction(async (client) => {
        const sel = await client.query<{
          id: string;
          tenant_id: string;
          name: string;
          display_suffix: string;
          revoked_at: Date | null;
        }>(
          `SELECT id, tenant_id, name, display_suffix, revoked_at
             FROM api_keys WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (sel.rows.length === 0) {
          return { kind: 'not_found' as const };
        }
        const oldRow = sel.rows[0];
        if (!canActOnTenant(admin, oldRow.tenant_id)) {
          return { kind: 'forbidden' as const };
        }
        if (oldRow.revoked_at !== null) {
          return { kind: 'cannot_rotate_revoked_key' as const };
        }

        // Revoke old
        const revUpd = await client.query<{ revoked_at: Date }>(
          `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 RETURNING revoked_at`,
          [id]
        );

        // Mint new
        const newPlaintextBundle = generateApiKey();
        const newHash = await hashApiKey(newPlaintextBundle.plaintext);
        const newId = randomUUID();
        const newName = parsed.data.name ?? oldRow.name;
        const ins = await client.query<{ created_at: Date }>(
          `INSERT INTO api_keys (id, tenant_id, name, key_hash, display_suffix)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING created_at`,
          [newId, oldRow.tenant_id, newName, newHash, newPlaintextBundle.displaySuffix]
        );

        await writeAudit(client, {
          tenantId: oldRow.tenant_id,
          actor: admin.actor,
          action: 'admin.api-key.rotate',
          target: id,
          ip: req.ip ?? null,
          requestId: req.id ?? 'unknown',
          result: 'success',
          meta: {
            oldKeyId: id,
            newKeyId: newId,
            displaySuffixes: {
              old: oldRow.display_suffix,
              new: newPlaintextBundle.displaySuffix,
            },
            tenantId: oldRow.tenant_id,
          },
        });

        return {
          kind: 'ok' as const,
          tenantId: oldRow.tenant_id,
          oldDisplaySuffix: oldRow.display_suffix,
          oldRevokedAt: revUpd.rows[0]!.revoked_at,
          newId,
          newPlaintext: newPlaintextBundle.plaintext,
          newDisplaySuffix: newPlaintextBundle.displaySuffix,
          newCreatedAt: ins.rows[0]!.created_at,
        };
      });

      if (result.kind === 'not_found') {
        problemNotFound(res, 'api_key', req.id);
        return;
      }
      if (result.kind === 'forbidden') {
        problemForbidden(res, req.id);
        return;
      }
      if (result.kind === 'cannot_rotate_revoked_key') {
        problemConflict(res, 'cannot_rotate_revoked_key', req.id);
        return;
      }

      // Post-commit: publish invalidation + local evict (old key only).
      try {
        await deps.redis.publish(API_KEY_REVOKE_CHANNEL, id);
      } catch (err) {
        logger.warn(
          { keyId: id, err: (err as Error).message },
          'api-keys: redis publish on rotate failed; TTL will catch up'
        );
      }
      evictApiKeyFromCacheByKeyId(id);

      logger.info(
        {
          oldKeyId: id,
          newKeyId: result.newId,
          oldDisplaySuffix: result.oldDisplaySuffix,
          newDisplaySuffix: result.newDisplaySuffix,
          tenantId: result.tenantId,
          actor: admin.actor,
        },
        'api-keys: rotated'
      );

      res.status(200).json({
        old: {
          id,
          display_suffix: result.oldDisplaySuffix,
          revoked_at:
            result.oldRevokedAt instanceof Date
              ? result.oldRevokedAt.toISOString()
              : String(result.oldRevokedAt),
        },
        new: {
          id: result.newId,
          plaintext_key: result.newPlaintext,
          display_suffix: result.newDisplaySuffix,
          created_at:
            result.newCreatedAt instanceof Date
              ? result.newCreatedAt.toISOString()
              : String(result.newCreatedAt),
        },
      });
    } catch (err) {
      logger.error({ err: (err as Error).message, id }, 'api-keys: rotate transaction failed');
      problemInternal(res, req.id);
    }
  });

  return r;
}

/**
 * Optional TTL sweeper. LRUCache handles TTL on .get/.set already, but
 * exposing a periodic sweeper lets operators force memory reclamation if
 * tight memory budgets matter. No-op in tests.
 *
 * Returns a handle with a stop() method so graceful-shutdown can cancel.
 * The setInterval is unref'd so it never keeps the event loop alive on
 * its own.
 */
export function startApiKeyCacheTtl(intervalMs = 30_000): { stop(): void } {
  const handle = setInterval(() => {
    // Touch the cache so LRUCache's internal TTL sweep runs.
    cache.purgeStale();
  }, intervalMs);
  // setInterval in Node returns a Timeout; typings for unref vary.
  if (typeof (handle as unknown as { unref?: () => void }).unref === 'function') {
    (handle as unknown as { unref: () => void }).unref();
  }
  return {
    stop() {
      clearInterval(handle);
    },
  };
}
