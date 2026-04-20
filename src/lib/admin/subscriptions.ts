/**
 * Microsoft Graph subscription lifecycle (plan 04-08, WEBHK-03, D-17).
 *
 * Four per-tenant MCP tools plus an optional in-process renewal cron:
 *
 *   - subscriptions-create: POST /subscriptions (Graph) after validating that
 *     notificationUrl === ${publicUrl}/t/${tenantId}/notifications.
 *     Generates a server-side clientState via crypto.randomBytes(32), encrypts
 *     it with the tenant DEK, INSERTs into subscriptions, and returns an
 *     admin-safe row shape (client_state stripped — T-04-20 mitigation).
 *
 *   - subscriptions-renew: PATCH /subscriptions/{id}. Rotates clientState on
 *     every call so a leaked value is invalidated within one renewal cycle
 *     (T-04-19a mitigation). Uses Graph's response body for the new expires_at
 *     (Pitfall 4 — Graph is authoritative on the honored expiration).
 *
 *   - subscriptions-delete: DELETE /subscriptions/{id}. Tolerates Graph 404
 *     (already deleted on Graph's side) and DELETEs the local subscriptions
 *     row unconditionally on success.
 *
 *   - subscriptions-list: SELECT * FROM subscriptions WHERE tenant_id = $1.
 *     Returns admin-safe rows (no client_state field).
 *
 *   - startRenewalCron: optional, gated on MS365_MCP_SUBSCRIPTION_CRON env
 *     var. Single-replica only — emits a startup WARN the first time the
 *     loop runs. Queries subscriptions JOIN tenants WHERE expires_at <
 *     NOW() + 1 hour AND tenants.disabled_at IS NULL (Pitfall 10 —
 *     disabled-tenant filter). unref'd setInterval so the timer does not
 *     keep the event loop alive after graceful-shutdown triggers.
 *
 * Redaction (D-01 + D-17):
 *   - clientState plaintext NEVER appears in responses (subscriptionRowToWire
 *     whitelists non-secret columns).
 *   - clientState plaintext NEVER logged — the logger-mock grep test in
 *     subscriptions-create.int.test.ts Test 6 is the invariant's proof.
 *   - clientState stored as AES-GCM envelope (encryptWithKey) with tenant DEK;
 *     cryptoshredded when the tenant is disabled (wrapped_dek set to NULL).
 *
 * Threat refs (from 04-08-PLAN <threat_model>):
 *   - T-04-19 (SSRF via caller-controlled notificationUrl): the Zod schema has
 *     NO notificationUrl field — we construct it from the trusted publicUrl
 *     and the tenantId only.
 *   - T-04-20 (clientState plaintext leaked): envelope at rest +
 *     subscriptionRowToWire whitelist.
 *   - T-04-19a (stolen clientState reused forever): every renew rotates.
 *   - T-04-19d (cron memory leak): unref'd timer + per-row try/catch +
 *     isRunning overlap guard + LIMIT 1000 per tick.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { encryptWithKey, type Envelope } from '../crypto/envelope.js';
import { writeAuditStandalone } from '../audit.js';
import { GraphError } from '../graph-errors.js';
import logger from '../../logger.js';
import type { TenantPool } from '../tenant/tenant-pool.js';
import type { default as GraphClient } from '../../graph-client.js';

// ─── Expiration clamps per resource prefix ─────────────────────────────────

/**
 * Per-resource expiration ceiling in minutes (per D-17 table sourced from
 * https://learn.microsoft.com/en-us/graph/api/resources/subscription —
 * Subscription lifetime table, 2026-04-07).
 *
 * Unknown resources fall back to FALLBACK_EXPIRATION_MINUTES (conservative
 * 3-day ceiling that matches chats/teams and avoids over-committing to a
 * long lifetime on a beta / non-documented API surface).
 */
export const MAX_EXPIRATION_BY_RESOURCE_PREFIX: Record<string, number> = {
  'users/': 41760, // 29 days
  'groups/': 41760,
  'chats/': 4320, // 3 days
  'teams/': 4320,
  'communications/presences/': 60, // 1 hour
  'security/alerts': 43200, // 30 days
  'drive/': 42300,
  '/me/events': 10080, // 7 days
  '/me/messages': 10080,
};

const FALLBACK_EXPIRATION_MINUTES = 4320; // 3 days

/**
 * Clamp a caller-supplied desired expiration (minutes from now) to the
 * per-resource Graph-documented maximum. Resource prefixes are matched
 * longest-first intuitively, but since the dictionary keys are disjoint
 * (no 'users/' prefix is also a 'users/alice/' prefix), simple startsWith
 * ordering is correct.
 */
export function pickExpirationMinutes(resource: string, desired: number): number {
  for (const [prefix, max] of Object.entries(MAX_EXPIRATION_BY_RESOURCE_PREFIX)) {
    if (resource.startsWith(prefix)) return Math.min(desired, max);
  }
  return Math.min(desired, FALLBACK_EXPIRATION_MINUTES);
}

// ─── Parameter schemas ─────────────────────────────────────────────────────

/**
 * Zod schema for subscriptions-create params. Intentionally does NOT accept
 * a `notificationUrl` field — the server constructs it from the trusted
 * publicUrl + tenantId pair. Caller-supplied URLs would open an SSRF vector
 * (T-04-19) where an attacker uses the Graph delivery pipeline to probe
 * internal services.
 */
const CreateParamsZod = z.object({
  resource: z.string().min(1).max(2048),
  changeType: z.string().min(1),
  desiredExpirationMinutes: z.number().int().min(1).max(525_600).optional(),
});

export type SubscriptionCreateParams = z.infer<typeof CreateParamsZod>;

const RenewParamsZod = z.object({
  graphSubscriptionId: z.string().min(1),
});
export type SubscriptionRenewParams = z.infer<typeof RenewParamsZod>;

const DeleteParamsZod = z.object({
  graphSubscriptionId: z.string().min(1),
});
export type SubscriptionDeleteParams = z.infer<typeof DeleteParamsZod>;

// ─── Wire-level row shape returned to admins ───────────────────────────────

export interface SubscriptionRow {
  id: string;
  tenant_id: string;
  graph_subscription_id: string;
  resource: string;
  change_type: string;
  notification_url: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

interface RawSubscriptionDbRow {
  id: string;
  tenant_id: string;
  graph_subscription_id: string;
  resource: string;
  change_type: string;
  notification_url: string;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Whitelist serializer — converts the raw DB row shape to the admin-facing
 * SubscriptionRow. client_state is DELIBERATELY never included; using a
 * whitelist (rather than a blacklist / spread-with-delete pattern) ensures
 * that future schema additions don't accidentally leak.
 */
function subscriptionRowToWire(row: RawSubscriptionDbRow): SubscriptionRow {
  const toIso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    graph_subscription_id: row.graph_subscription_id,
    resource: row.resource,
    change_type: row.change_type,
    notification_url: row.notification_url,
    expires_at: toIso(row.expires_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

/**
 * Minimal shape of the Graph POST /subscriptions success response used by
 * subscriptionsCreate. Graph returns much more (application-id, creatorId,
 * lifecycleNotificationUrl, etc.) that we intentionally ignore — the local
 * row captures only the fields the webhook handler needs.
 */
interface GraphSubscriptionResponse {
  id: string;
  expirationDateTime: string;
  notificationUrl?: string;
}

// ─── Dependency bundles ────────────────────────────────────────────────────

/**
 * Dependencies needed by the three mutating handlers (create / renew /
 * delete). publicUrl is only consumed by subscriptionsCreate — renew/delete
 * do not need it but accept it for interface uniformity.
 */
export interface SubscriptionsDeps {
  graphClient: GraphClient;
  pgPool: Pool;
  tenantPool: TenantPool;
  publicUrl: string;
  kek: Buffer;
}

export interface SubscriptionsListDeps {
  pgPool: Pool;
}

// ─── subscriptions-create ──────────────────────────────────────────────────

/**
 * Construct a per-tenant notificationUrl from the trusted publicUrl and the
 * tenantId path segment. Strips any trailing slash from publicUrl so
 * 'https://mcp.example.com/' and 'https://mcp.example.com' both resolve to
 * the same canonical URL shape.
 */
function buildNotificationUrl(publicUrl: string, tenantId: string): string {
  return `${publicUrl.replace(/\/$/, '')}/t/${tenantId}/notifications`;
}

/**
 * Create a Microsoft Graph change-notification subscription.
 *
 * Flow:
 *   1. Validate params via Zod (rejects empty resource, etc.).
 *   2. Construct notificationUrl from trusted publicUrl+tenantId.
 *   3. Generate fresh 32-byte clientState (server-side — never caller-supplied).
 *   4. Encrypt clientState with the tenant DEK.
 *   5. Clamp expiration to per-resource max (pickExpirationMinutes).
 *   6. POST /subscriptions via graphClient.makeRequest (inherits Phase 2
 *      retry + ETag + OData error middleware).
 *   7. INSERT local row with encrypted envelope.
 *   8. SELECT the persisted row + serialize via subscriptionRowToWire so
 *      timestamps come back as canonical ISO 8601 and client_state is stripped.
 */
export async function subscriptionsCreate(
  tenantId: string,
  params: SubscriptionCreateParams,
  deps: SubscriptionsDeps
): Promise<SubscriptionRow> {
  const validated = CreateParamsZod.parse(params);

  const notificationUrl = buildNotificationUrl(deps.publicUrl, tenantId);

  const clientStatePlain = randomBytes(32).toString('base64url');

  const dek = deps.tenantPool.getDekForTenant(tenantId);
  if (!dek) {
    throw new Error(`subscriptions-create: tenant DEK unavailable for ${tenantId}`);
  }
  const clientStateEnvelope: Envelope = encryptWithKey(
    Buffer.from(clientStatePlain, 'utf8'),
    dek
  );

  const minutes = pickExpirationMinutes(
    validated.resource,
    validated.desiredExpirationMinutes ?? FALLBACK_EXPIRATION_MINUTES
  );
  const expirationDateTime = new Date(Date.now() + minutes * 60_000).toISOString();

  const graphResponse = (await deps.graphClient.makeRequest('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      changeType: validated.changeType,
      notificationUrl,
      resource: validated.resource,
      expirationDateTime,
      clientState: clientStatePlain,
    }),
  })) as GraphSubscriptionResponse;

  if (!graphResponse?.id) {
    throw new Error('subscriptions-create: Graph response missing subscription id');
  }

  const localId = randomUUID();
  await deps.pgPool.query(
    `INSERT INTO subscriptions (id, tenant_id, graph_subscription_id, resource,
       change_type, notification_url, client_state, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      localId,
      tenantId,
      graphResponse.id,
      validated.resource,
      validated.changeType,
      notificationUrl,
      JSON.stringify(clientStateEnvelope),
      new Date(graphResponse.expirationDateTime ?? expirationDateTime),
    ]
  );

  const { rows } = await deps.pgPool.query<RawSubscriptionDbRow>(
    `SELECT id, tenant_id, graph_subscription_id, resource, change_type,
       notification_url, expires_at, created_at, updated_at
     FROM subscriptions WHERE id = $1`,
    [localId]
  );
  if (!rows[0]) {
    throw new Error('subscriptions-create: inserted row not found on readback');
  }
  return subscriptionRowToWire(rows[0]);
}

// ─── subscriptions-renew ───────────────────────────────────────────────────

/**
 * Renew an existing Graph subscription.
 *
 * Per D-17: clientState is rotated on EVERY renew to invalidate any leaked
 * value within one renewal cycle (T-04-19a).
 *
 * Per Pitfall 4 (RESEARCH.md:757-767):
 *   - Graph's PATCH response body's expirationDateTime is the honored value;
 *     we use it for the UPDATE rather than our requested value.
 *   - A 404 response means the subscription is dead on Graph's side; we
 *     DELETE the local row and emit webhook.subscription.not_found so the
 *     operator can investigate (zombie-subscription prevention).
 *
 * Returns either the refreshed SubscriptionRow on success OR a signal object
 * { deleted: true, reason: 'graph_404' } when the local row was DELETEd
 * because Graph no longer recognizes the subscription.
 */
export async function subscriptionsRenew(
  tenantId: string,
  params: SubscriptionRenewParams,
  deps: SubscriptionsDeps
): Promise<SubscriptionRow | { deleted: true; reason: 'graph_404' }> {
  const validated = RenewParamsZod.parse(params);

  const { rows } = await deps.pgPool.query<{
    id: string;
    resource: string;
    change_type: string;
  }>(
    `SELECT id, resource, change_type FROM subscriptions
       WHERE tenant_id = $1 AND graph_subscription_id = $2`,
    [tenantId, validated.graphSubscriptionId]
  );
  if (rows.length === 0) {
    throw new Error(
      `subscriptions-renew: no local row for ${validated.graphSubscriptionId}`
    );
  }
  const existing = rows[0]!;

  const newClientStatePlain = randomBytes(32).toString('base64url');
  const dek = deps.tenantPool.getDekForTenant(tenantId);
  if (!dek) {
    throw new Error(`subscriptions-renew: tenant DEK unavailable for ${tenantId}`);
  }
  const newEnvelope = encryptWithKey(Buffer.from(newClientStatePlain, 'utf8'), dek);

  const minutes = pickExpirationMinutes(existing.resource, FALLBACK_EXPIRATION_MINUTES);
  const requestedExpiration = new Date(Date.now() + minutes * 60_000).toISOString();

  try {
    const graphResponse = (await deps.graphClient.makeRequest(
      `/subscriptions/${validated.graphSubscriptionId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          expirationDateTime: requestedExpiration,
          clientState: newClientStatePlain,
        }),
      }
    )) as GraphSubscriptionResponse;

    const honoredExpiration = graphResponse?.expirationDateTime ?? requestedExpiration;
    await deps.pgPool.query(
      `UPDATE subscriptions
         SET client_state = $1::jsonb, expires_at = $2, updated_at = NOW()
         WHERE tenant_id = $3 AND graph_subscription_id = $4`,
      [
        JSON.stringify(newEnvelope),
        new Date(honoredExpiration),
        tenantId,
        validated.graphSubscriptionId,
      ]
    );

    const { rows: updated } = await deps.pgPool.query<RawSubscriptionDbRow>(
      `SELECT id, tenant_id, graph_subscription_id, resource, change_type,
         notification_url, expires_at, created_at, updated_at
       FROM subscriptions WHERE tenant_id = $1 AND graph_subscription_id = $2`,
      [tenantId, validated.graphSubscriptionId]
    );
    if (!updated[0]) {
      throw new Error('subscriptions-renew: updated row not found on readback');
    }
    return subscriptionRowToWire(updated[0]);
  } catch (err) {
    if (err instanceof GraphError && err.statusCode === 404) {
      await deps.pgPool.query(
        `DELETE FROM subscriptions WHERE tenant_id = $1 AND graph_subscription_id = $2`,
        [tenantId, validated.graphSubscriptionId]
      );
      void writeAuditStandalone(deps.pgPool, {
        tenantId,
        actor: 'system',
        action: 'webhook.subscription.not_found',
        target: validated.graphSubscriptionId,
        ip: null,
        requestId: err.requestId ?? 'no-req-id',
        result: 'failure',
        meta: {
          subscription_id: existing.id,
          graph_subscription_id: validated.graphSubscriptionId,
        },
      });
      return { deleted: true, reason: 'graph_404' };
    }
    throw err;
  }
}

// ─── subscriptions-delete ──────────────────────────────────────────────────

/**
 * Delete a subscription on both Graph and locally. Graph 404 is tolerated
 * idempotently — the caller reached the "subscription is gone" terminal
 * state either way. Graph 5xx and other failures re-throw so the local row
 * is preserved for retry.
 */
export async function subscriptionsDelete(
  tenantId: string,
  params: SubscriptionDeleteParams,
  deps: SubscriptionsDeps
): Promise<{ deleted: true }> {
  const validated = DeleteParamsZod.parse(params);

  try {
    await deps.graphClient.makeRequest(
      `/subscriptions/${validated.graphSubscriptionId}`,
      { method: 'DELETE' }
    );
  } catch (err) {
    if (err instanceof GraphError && err.statusCode === 404) {
      logger.info(
        { graphSubscriptionId: validated.graphSubscriptionId, tenantId },
        'subscriptions-delete: graph 404 (already gone)'
      );
    } else {
      throw err;
    }
  }
  await deps.pgPool.query(
    `DELETE FROM subscriptions WHERE tenant_id = $1 AND graph_subscription_id = $2`,
    [tenantId, validated.graphSubscriptionId]
  );
  return { deleted: true };
}

// ─── subscriptions-list ────────────────────────────────────────────────────

/**
 * List all subscriptions for a tenant. SQL-level WHERE tenant_id = $1
 * enforces cross-tenant isolation (row-level tenancy per D-11); callers
 * cannot see another tenant's subscriptions even by spoofing the tool params.
 */
export async function subscriptionsList(
  tenantId: string,
  _params: Record<string, never>,
  deps: SubscriptionsListDeps
): Promise<SubscriptionRow[]> {
  const { rows } = await deps.pgPool.query<RawSubscriptionDbRow>(
    `SELECT id, tenant_id, graph_subscription_id, resource, change_type,
       notification_url, expires_at, created_at, updated_at
     FROM subscriptions WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return rows.map(subscriptionRowToWire);
}

// ─── MCP tool registration ─────────────────────────────────────────────────

/**
 * Dependencies needed to register the four MCP tools on an McpServer
 * instance. tenantIdResolver is the only tenant-context hook — it returns
 * the current tenantId for the active request, enabling the SAME tool
 * registration to work across stdio (single tenant) and HTTP (per-request
 * tenant from the request-context AsyncLocalStorage).
 */
export interface RegisterSubscriptionToolsDeps extends SubscriptionsDeps {
  /**
   * Returns the tenantId for the current tool invocation. In HTTP mode this
   * reads from request-context (populated by loadTenant); in stdio mode
   * (single-tenant) the caller can hard-code it.
   */
  tenantIdResolver: () => string;
}

function textContent(payload: unknown): {
  content: [{ type: 'text'; text: string }];
} {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function errorContent(err: unknown): {
  content: [{ type: 'text'; text: string }];
  isError: true;
} {
  const message = err instanceof Error ? err.message : String(err);
  const payload: Record<string, unknown> = { error: message };
  if (err instanceof GraphError) {
    payload.code = err.code;
    payload.statusCode = err.statusCode;
    if (err.requestId) payload.requestId = err.requestId;
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: true,
  };
}

/**
 * Register the four subscription lifecycle MCP tools on the supplied server.
 * Caller is responsible for ensuring deps.publicUrl is non-empty — without
 * it, the SSRF-protection invariant is meaningless because the notificationUrl
 * would resolve to '/t/{tenantId}/notifications' without a scheme+host.
 */
export function registerSubscriptionTools(
  server: McpServer,
  deps: RegisterSubscriptionToolsDeps
): void {
  server.tool(
    'subscriptions-create',
    'Create a Microsoft Graph change-notification subscription for this tenant. ' +
      'The notificationUrl is constructed server-side from the trusted publicUrl ' +
      'and tenant id (SSRF protection). clientState is generated fresh and ' +
      'encrypted at rest with the tenant DEK. The response does NOT include ' +
      'client_state.',
    CreateParamsZod.shape,
    {
      title: 'subscriptions-create',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    async (params) => {
      try {
        const tenantId = deps.tenantIdResolver();
        const row = await subscriptionsCreate(tenantId, params, deps);
        return textContent(row);
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.tool(
    'subscriptions-renew',
    'Renew (extend expiration of) a Microsoft Graph subscription. Rotates ' +
      'clientState on every call. If Graph reports 404 (subscription is dead), ' +
      'the local row is DELETEd and an audit event is emitted.',
    RenewParamsZod.shape,
    {
      title: 'subscriptions-renew',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    async (params) => {
      try {
        const tenantId = deps.tenantIdResolver();
        const result = await subscriptionsRenew(tenantId, params, deps);
        return textContent(result);
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.tool(
    'subscriptions-delete',
    'Delete a Microsoft Graph subscription. Tolerates Graph 404 ' +
      '(already-deleted idempotent); any other error preserves the local row ' +
      'for retry.',
    DeleteParamsZod.shape,
    {
      title: 'subscriptions-delete',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    async (params) => {
      try {
        const tenantId = deps.tenantIdResolver();
        const result = await subscriptionsDelete(tenantId, params, deps);
        return textContent(result);
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.tool(
    'subscriptions-list',
    'List all Microsoft Graph subscriptions for this tenant. Response rows ' +
      'NEVER include client_state (T-04-20 mitigation).',
    {} as never,
    {
      title: 'subscriptions-list',
      readOnlyHint: true,
      openWorldHint: true,
    },
    async () => {
      try {
        const tenantId = deps.tenantIdResolver();
        const rows = await subscriptionsList(
          tenantId,
          {} as Record<string, never>,
          { pgPool: deps.pgPool }
        );
        return textContent(rows);
      } catch (err) {
        return errorContent(err);
      }
    }
  );
}

// ─── Renewal cron (optional) ───────────────────────────────────────────────

const DEFAULT_CRON_INTERVAL_MS = 60_000;

/** Structural subset of the Node Timer API the cron uses. Matches the same
 * pattern used in src/lib/tenant/tenant-pool.ts:57 so both places avoid
 * needing @types/node globals at module-load time.
 */
type TimerHandle = { unref(): void };

export interface RenewalCronDeps {
  pgPool: Pool;
  tenantPool: TenantPool;
  graphClient: GraphClient;
  kek: Buffer;
}

export interface RenewalCronHandle {
  stop(): Promise<void>;
}

interface RenewLoopRow {
  id: string;
  tenant_id: string;
  graph_subscription_id: string;
  resource: string;
  expires_at: Date | string;
}

/**
 * Start the in-process renewal cron. Single-replica only — operators running
 * multiple replicas MUST gate this on an external leader election or defer to
 * Phase 6's distributed lock.
 *
 * Gating contract: the CALLER checks MS365_MCP_SUBSCRIPTION_CRON before
 * invoking this function. This module does not read environment variables
 * directly so it stays test-friendly.
 *
 * Timer is unref'd so it does not keep the event loop alive during graceful
 * shutdown. stopRenewalCron awaits any in-flight tick so shutdown does not
 * abort a renewal mid-row (leaving the DB in an inconsistent state).
 */
export function startRenewalCron(
  deps: RenewalCronDeps,
  opts?: { intervalMs?: number }
): RenewalCronHandle {
  const intervalMs = opts?.intervalMs ?? DEFAULT_CRON_INTERVAL_MS;
  let isRunning = false;
  let stopped = false;
  let currentRun: Promise<void> | null = null;

  async function renewLoop(): Promise<void> {
    if (isRunning || stopped) return;
    isRunning = true;
    try {
      const { rows } = await deps.pgPool.query<RenewLoopRow>(
        `SELECT s.id, s.tenant_id, s.graph_subscription_id, s.resource, s.expires_at
           FROM subscriptions s
           JOIN tenants t ON t.id = s.tenant_id
          WHERE s.expires_at < NOW() + interval '1 hour'
            AND t.disabled_at IS NULL
          ORDER BY s.expires_at ASC
          LIMIT 1000`
      );
      for (const row of rows) {
        if (stopped) break;
        try {
          const result = await subscriptionsRenew(
            row.tenant_id,
            { graphSubscriptionId: row.graph_subscription_id },
            {
              graphClient: deps.graphClient,
              pgPool: deps.pgPool,
              tenantPool: deps.tenantPool,
              publicUrl: '', // unused on renew path
              kek: deps.kek,
            }
          );
          // Renew may signal { deleted: true } when Graph returned 404 —
          // subscriptionsRenew already wrote webhook.subscription.not_found
          // in that case, so we skip the renewed audit row to avoid noise.
          const wasDeleted =
            typeof result === 'object' &&
            result !== null &&
            'deleted' in result &&
            result.deleted === true;
          if (!wasDeleted) {
            void writeAuditStandalone(deps.pgPool, {
              tenantId: row.tenant_id,
              actor: 'system',
              action: 'webhook.subscription.renewed',
              target: row.graph_subscription_id,
              ip: null,
              requestId: 'cron',
              result: 'success',
              meta: {
                subscription_id: row.id,
                resource: row.resource,
              },
            });
          }
        } catch (err) {
          logger.error(
            {
              subscriptionId: row.id,
              graphSubscriptionId: row.graph_subscription_id,
              err: (err as Error).message,
            },
            'subscription renewal failed'
          );
          void writeAuditStandalone(deps.pgPool, {
            tenantId: row.tenant_id,
            actor: 'system',
            action: 'webhook.subscription.renew_failed',
            target: row.graph_subscription_id,
            ip: null,
            requestId: 'cron',
            result: 'failure',
            meta: {
              subscription_id: row.id,
              error_code: err instanceof GraphError ? err.code : 'unknown',
              graph_request_id:
                err instanceof GraphError ? (err.requestId ?? null) : null,
            },
          });
        }
      }
    } finally {
      isRunning = false;
    }
  }

  const timer = setInterval(() => {
    currentRun = renewLoop().catch((err) => {
      logger.error(
        { err: (err as Error).message },
        'renewLoop outer failure'
      );
    });
  }, intervalMs);
  (timer as unknown as TimerHandle).unref();

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer as unknown as Parameters<typeof clearInterval>[0]);
      if (currentRun) {
        try {
          await currentRun;
        } catch {
          // Loop errors were already logged; shutdown must not propagate.
        }
      }
    },
  };
}

/**
 * Graceful-shutdown helper: thin wrapper over `handle.stop()` so callers can
 * `await stopRenewalCron(cronHandle)` symmetrically with startRenewalCron.
 * Idempotent — safe to call even after the underlying loop already exited.
 */
export async function stopRenewalCron(handle: RenewalCronHandle): Promise<void> {
  await handle.stop();
}
