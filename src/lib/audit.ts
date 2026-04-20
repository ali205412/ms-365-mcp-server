/**
 * Audit log writer (plan 03-10, TENANT-06).
 *
 * Two entry points, per D-13 sync-audit contract:
 *
 *   - writeAudit(client, row): same-transaction INSERT — the caller owns the
 *     pg PoolClient and controls commit/rollback. Use this for actions that
 *     ALSO write to other tenant tables (admin mutations, OAuth completions
 *     that persist a session record) so the audit entry atomically lands or
 *     rolls back with the primary write.
 *
 *   - writeAuditStandalone(pool, row): owns its own connection — falls back
 *     to a pino shadow log on DB error. Use this for actions that have no
 *     other write path (Graph error logging, fire-and-forget side-effect
 *     audits, CLI-driven cascades after the primary COMMIT).
 *
 * Shadow-log invariant: when the DB INSERT fails, the SAME audit_row payload
 * is logged via pino at error level with an `audit_shadow: true` tag.
 * Operators grep their log aggregator for that tag and reconstruct the audit
 * trail offline. The audit trail is NEVER silently dropped.
 *
 * Schema-on-read for `meta` JSONB (D-13): per-action-type shapes are
 * documented inline below; there is no enforcement at the SQL layer. Writers
 * MUST NOT place secrets (tokens, client secrets, refresh tokens) into meta.
 * pino's D-01 redact allowlist does not apply to arbitrary JSONB cell values,
 * so the call-site is the last line of defence.
 *
 * Threat dispositions (03-10 threat_model):
 *   - T-03-10-01 (Repudiation): shadow log closes the DB-outage gap.
 *   - T-03-10-02 (Info disclosure via meta): call-site discipline; no secrets.
 *   - T-03-10-03 (Action injection): action passes via typed AuditAction union.
 *   - T-03-10-08 (UPDATE path): INSERT-only by convention; no UPDATE helpers
 *     exposed from this module.
 */
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import logger from '../logger.js';

/**
 * Closed set of audit actions the codebase emits.
 *
 * Per-action meta shapes (schema-on-read, D-13):
 *
 *   oauth.authorize        { clientId, scopes?, redirectUri? }
 *   oauth.token.exchange   { clientId, scopes?, error? }
 *   oauth.refresh          { clientId, scopes?, error? }
 *   graph.error            { code, message, graphRequestId, httpStatus }
 *   tenant.disable         { cacheKeysDeleted, pkceKeysDeleted }
 *   kek.rotate             { rewrapped, skipped, batchId? }
 *   session.put            { sessionIdSuffix, scopes }
 *   session.delete         { sessionIdSuffix, reason }
 *   admin.tenant.create    { clientId, mode, cloudType }     (Phase 4)
 *   admin.tenant.update    { fields: string[] }              (Phase 4)
 *   admin.api-key.mint     { keyId, displaySuffix, tenantId }                          (Phase 4)
 *   admin.api-key.revoke   { keyId, tenantId }                                         (Phase 4)
 *   admin.api-key.rotate   { oldKeyId, newKeyId, displaySuffixes: {old, new}, tenantId } (Phase 4)
 */
export type AuditAction =
  | 'oauth.authorize'
  | 'oauth.token.exchange'
  | 'oauth.refresh'
  | 'graph.error'
  | 'tenant.disable'
  | 'kek.rotate'
  | 'session.put'
  | 'session.delete'
  | 'admin.tenant.create'
  | 'admin.tenant.update'
  | 'admin.api-key.mint'
  | 'admin.api-key.revoke'
  | 'admin.api-key.rotate';

export interface AuditRow {
  tenantId: string;
  /** 'system' | user OID | admin email | 'cli' | 'unauthenticated' */
  actor: string;
  action: AuditAction | string;
  /** Resource id, tenant id being acted on, target URL, etc. Null when n/a. */
  target: string | null;
  /** Remote IP. Null for CLI / system actions. */
  ip: string | null;
  /** Correlation id — MWARE-07 requestId or a CLI-generated sentinel. */
  requestId: string;
  result: 'success' | 'failure';
  /** Free-form JSONB. MUST NOT contain secrets. */
  meta: Record<string, unknown>;
}

const INSERT_SQL = `
  INSERT INTO audit_log
    (id, tenant_id, actor, action, target, ip, request_id, result, meta)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
`;

function rowToParams(row: AuditRow): unknown[] {
  return [
    randomUUID(),
    row.tenantId,
    row.actor,
    row.action,
    row.target,
    row.ip,
    row.requestId,
    row.result,
    JSON.stringify(row.meta ?? {}),
  ];
}

/**
 * INSERT an audit row on the caller's PoolClient. The caller controls
 * BEGIN/COMMIT/ROLLBACK — if the surrounding transaction rolls back, the
 * audit row rolls back with it. Use this when the audit event MUST land
 * atomically with another tenant-table mutation.
 */
export async function writeAudit(client: PoolClient, row: AuditRow): Promise<void> {
  await client.query(INSERT_SQL, rowToParams(row));
}

/**
 * INSERT an audit row via its own pool connection. On DB error, catches
 * the exception, emits a pino shadow log (`audit_shadow: true`) carrying
 * the full audit_row payload, and resolves normally — NEVER throws. This
 * is the ONLY write path where audit-trail durability depends on pino, not
 * Postgres, for the tail of an outage.
 */
export async function writeAuditStandalone(pool: Pool, row: AuditRow): Promise<void> {
  try {
    await pool.query(INSERT_SQL, rowToParams(row));
  } catch (err) {
    logger.error(
      {
        audit_shadow: true,
        audit_row: row,
        err: (err as Error).message,
      },
      'audit INSERT failed; writing shadow log'
    );
  }
}
