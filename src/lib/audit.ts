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
import { scheduleAfterCommit } from './postgres.js';

/**
 * Closed set of audit actions the codebase emits.
 *
 * Per-action meta shapes (schema-on-read, D-13):
 *
 *   oauth.authorize                { clientId, scopes?, redirectUri? }
 *   oauth.token.exchange           { clientId, scopes?, error? }
 *   oauth.refresh                  { clientId, scopes?, error? }
 *   graph.error                    { code, message, graphRequestId, httpStatus }
 *   tenant.disable                 { cacheKeysDeleted, pkceKeysDeleted }
 *   kek.rotate                     { rewrapped, skipped, batchId? }
 *   session.put                    { sessionIdSuffix, scopes }
 *   session.delete                 { sessionIdSuffix, reason }
 *
 *   Phase 4 admin.* (ADMIN-01..06):
 *   admin.tenant.create            { tenantId, clientId, mode, cloudType }
 *   admin.tenant.update            { tenantId, fieldsChanged: string[] }
 *   admin.tenant.disable           { tenantId, cacheKeysDeleted, pkceKeysDeleted, apiKeysRevoked }
 *   admin.tenant.delete            { tenantId, apiKeysRevoked }
 *   admin.tenant.rotate-secret     { tenantId, oldWrappedDekHash, newWrappedDekHash }
 *   admin.api-key.mint             { keyId, displaySuffix, tenantId }
 *   admin.api-key.revoke           { keyId, tenantId }
 *   admin.api-key.rotate           { oldKeyId, newKeyId, displaySuffixes: {old, new}, tenantId }
 *   admin.audit.query              { tenantIdFilter, sinceFilter, untilFilter,
 *                                    actionFilter, actorFilter, rowsReturned }
 *
 *   Phase 5 admin.tenant.enabled-tools (plan 05-07, D-21):
 *   admin.tenant.enabled-tools-change       { before_length, after_length,
 *                                              operation: 'add'|'remove'|'set',
 *                                              product?: 'powerbi'|'pwrapps'|
 *                                                'pwrauto'|'exo'|'sp-admin'|
 *                                                'mixed'|null,
 *                                              invalid_count? }
 *   admin.tenant.enabled-tools-parse-error  { raw_selector_summary?,
 *                                              parse_error_category:
 *                                                'zod'|'ast'|'registry',
 *                                              invalid_count? }
 *   CRITICAL (T-05-17, 05-RESEARCH.md:467): NEVER place the raw
 *   enabled_tools string in meta — only categorical length counts +
 *   operation name + product discriminator are safe. Operators grep
 *   audit_log by action + tenantId + optional meta->>'product', not by
 *   selector string content.
 *
 *   Phase 5.1 extension (plan 05.1-08, T-5.1-08-e): meta.product is the
 *   product discriminator for mutations that target a Phase 5.1 product
 *   (Power BI / Power Apps / Power Automate / Exchange Admin / SharePoint
 *   Admin). Null when the mutation targets Graph only; 'mixed' when two
 *   or more products appear in the same PATCH. Set by
 *   `inferProductFromSelectors` in src/lib/admin/enabled-tools.ts.
 *
 *   Phase 4 webhook.* (WEBHK-01..03, plans 04-07 + 04-08 — staged here so
 *   downstream plans extend handlers only, not the union):
 *   webhook.unauthorized               { change_type, resource, received_client_state_suffix }
 *   webhook.duplicate                  { dedup_key_suffix }
 *   webhook.received                   { subscription_id, change_type }
 *   webhook.subscription.renewed       { subscription_id, expires_at }
 *   webhook.subscription.renew_failed  { subscription_id, error_code, graph_request_id }
 *
 * Redaction discipline (D-01): meta JSONB MUST NOT contain plaintext_key,
 * client_secret, wrapped_dek (the raw envelope — wrapped_dek_suffix or a
 * sha256 hash is safe), refresh_token, Authorization header values, or any
 * Graph bearer token. Pino's REDACT_PATHS does not descend into arbitrary
 * JSONB cell values — call-sites are the last line of defence.
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
  | 'admin.tenant.disable'
  | 'admin.tenant.delete'
  | 'admin.tenant.rotate-secret'
  | 'admin.api-key.mint'
  | 'admin.api-key.revoke'
  | 'admin.api-key.rotate'
  | 'admin.audit.query'
  | 'admin.tenant.enabled-tools-change'
  | 'admin.tenant.enabled-tools-parse-error'
  | 'webhook.unauthorized'
  | 'webhook.duplicate'
  | 'webhook.received'
  | 'webhook.subscription.renewed'
  | 'webhook.subscription.renew_failed';

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

export type AuditResourcePublisher = (tenantId: string) => void | Promise<void>;

let auditResourcePublisher: AuditResourcePublisher | undefined;

export function registerAuditResourcePublisher(
  publisher: AuditResourcePublisher | undefined
): void {
  auditResourcePublisher = publisher;
}

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
  if (typeof scheduleAfterCommit === 'function') {
    scheduleAfterCommit(client, () => publishAuditResourceUpdate(row.tenantId));
  }
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
    return;
  }

  try {
    await publishAuditResourceUpdate(row.tenantId);
  } catch (err) {
    logger.warn(
      { tenantId: row.tenantId, err: (err as Error).message },
      'audit resource notification publish failed'
    );
  }
}

async function publishAuditResourceUpdate(tenantId: string): Promise<void> {
  if (!auditResourcePublisher) return;
  await auditResourcePublisher(tenantId);
}
