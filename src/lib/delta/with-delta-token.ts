/**
 * Delta-token persistence wrapper (plan 04-09, MWARE-08).
 *
 * Transactional envelope around the `delta_tokens` table:
 *   BEGIN
 *     INSERT empty lock row if absent
 *     SELECT delta_link FROM delta_tokens
 *       WHERE (tenant_id, resource) FOR UPDATE
 *     call fn(stored || null)
 *     if nextDeltaLink: UPSERT
 *   COMMIT
 *
 * The insert-before-select matters: `FOR UPDATE` locks no row when the token
 * does not exist yet. A transient empty row gives first-use callers something
 * concrete to serialize on, then gets deleted again if the caller produces no
 * delta link.
 *
 * Sync-reset handling (410 Gone / resyncRequired / syncStateNotFound /
 * syncStateInvalid — see Assumption A4 in 04-RESEARCH.md):
 *   - catch narrow error codes
 *   - DELETE the stored row inside the same transaction
 *   - call fn(null) ONCE for a fresh full sweep
 *   - UPSERT the new delta link
 *   - if the retry also throws, COMMIT the DELETE (so the stale row is
 *     gone) and propagate — caller decides whether to retry later.
 *
 * Logging: emits pino.warn({ tenantId, resource, errorCode }) on resync. The
 * opaque delta-link content is NEVER logged — per Graph docs "don't inspect
 * the token contents" (04-RESEARCH.md Pattern 6) and per D-01 redact list.
 *
 * Called by any delta-supporting MCP tool (mail.list-messages-delta,
 * calendar.list-events-delta, groups.list-members-delta, etc). The caller
 * constructs the Graph URL, passes the stored link into Graph's
 * `$deltatoken` query param on resume (or omits it on null), and returns the
 * final `@odata.deltaLink` from the last page via PageIterator (Phase 2
 * plan 02-04).
 */
import type { Pool, PoolClient } from 'pg';
import { GraphError } from '../graph-errors.js';
import logger from '../../logger.js';

export interface DeltaResult<T> {
  data: T;
  nextDeltaLink: string | null;
}

/**
 * Graph error codes that signal "the stored delta token is no longer valid —
 * start over from scratch". These codes appear on 410 Gone, and sometimes on
 * 400 / 500 (per real-world observations in 04-RESEARCH.md Assumption A4).
 */
export const SYNC_RESET_CODES: ReadonlySet<string> = new Set([
  'syncStateNotFound',
  'syncStateInvalid',
  'resyncRequired',
]);

/**
 * Predicate: does this error indicate a sync-reset (stored delta link is
 * stale and must be discarded)? Returns true on HTTP 410 Gone OR on any of
 * the SYNC_RESET_CODES regardless of statusCode.
 */
export function isSyncReset(err: unknown): boolean {
  if (err instanceof GraphError) {
    if (err.statusCode === 410) return true;
    if (typeof err.code === 'string' && SYNC_RESET_CODES.has(err.code)) return true;
  }
  return false;
}

export async function withDeltaToken<T>(
  pool: Pool,
  tenantId: string,
  resource: string,
  fn: (deltaLink: string | null) => Promise<DeltaResult<T>>
): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const insertedLockRow = await client.query(
      `INSERT INTO delta_tokens (tenant_id, resource, delta_link, updated_at)
         VALUES ($1, $2, '', NOW())
       ON CONFLICT (tenant_id, resource) DO NOTHING
       RETURNING true AS inserted`,
      [tenantId, resource]
    );
    const insertedEmptyLockRow = insertedLockRow.rows.length > 0;

    // Row-level lock. New callers for this (tenant, resource) wait here until
    // the prior transaction COMMITs, so overlapping first-use callers cannot
    // both run a full sweep with deltaLink=null.
    const { rows } = await client.query<{ delta_link: string }>(
      `SELECT delta_link FROM delta_tokens
         WHERE tenant_id = $1 AND resource = $2
         FOR UPDATE`,
      [tenantId, resource]
    );
    const selectedLink = rows[0]?.delta_link ?? null;
    const createdLockRow = insertedEmptyLockRow && selectedLink === '';
    const storedLink: string | null = createdLockRow ? null : selectedLink;

    let result: DeltaResult<T>;
    try {
      result = await fn(storedLink);
    } catch (err) {
      if (!isSyncReset(err)) {
        // Not a sync-reset — preserve the old delta link so the caller can
        // retry later from the same point.
        throw err;
      }

      logger.warn(
        {
          tenantId,
          resource,
          errorCode: err instanceof GraphError ? (err.code ?? 'http_410') : 'http_410',
        },
        'delta: sync reset (410 / resyncRequired) — full resync'
      );

      // DELETE the stale row in this transaction.
      await client.query(`DELETE FROM delta_tokens WHERE tenant_id = $1 AND resource = $2`, [
        tenantId,
        resource,
      ]);

      // One-shot retry with null delta link. If the retry also throws, we
      // COMMIT the DELETE (the stale row is gone for good) and propagate.
      try {
        result = await fn(null);
      } catch (retryErr) {
        try {
          await client.query('COMMIT');
        } catch {
          // best-effort — the outer catch will still ROLLBACK if COMMIT
          // threw, but pg docs guarantee COMMIT is a no-op after a failed
          // statement only if we already ROLLBACKed; we haven't, so this
          // path is unreachable in practice.
        }
        throw retryErr;
      }
    }

    // UPSERT the next link (skip when null — rare caller-error case in which
    // we preserve the existing row rather than blow it away with no data).
    if (result.nextDeltaLink) {
      await client.query(
        `INSERT INTO delta_tokens (tenant_id, resource, delta_link, updated_at)
           VALUES ($1, $2, $3, NOW())
         ON CONFLICT (tenant_id, resource)
         DO UPDATE SET delta_link = EXCLUDED.delta_link, updated_at = NOW()`,
        [tenantId, resource, result.nextDeltaLink]
      );
    } else if (createdLockRow) {
      await client.query(`DELETE FROM delta_tokens WHERE tenant_id = $1 AND resource = $2`, [
        tenantId,
        resource,
      ]);
    }

    await client.query('COMMIT');
    return result.data;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // best-effort rollback — original error already in flight
    }
    throw err;
  } finally {
    client.release();
  }
}
