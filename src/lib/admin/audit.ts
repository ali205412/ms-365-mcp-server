/**
 * Admin /audit query endpoint (plan 04-05, ADMIN-06, D-13/D-14).
 *
 * Endpoint:
 *   GET /admin/audit — cursor-paginated query over audit_log with RBAC filters.
 *
 * Query parameters:
 *   - tenant_id   (optional GUID) — filter by tenant
 *   - since       (optional ISO-8601) — lower bound (inclusive) on ts
 *   - until       (optional ISO-8601) — upper bound (exclusive) on ts
 *   - action      (optional string)   — exact action match (e.g., admin.tenant.create)
 *   - actor       (optional string)   — exact actor match
 *   - cursor      (optional opaque)   — HMAC-signed (ts, id) tuple from a prior
 *                                       response; page forward from that point
 *   - limit       (optional 1..200, default 50) — page size
 *
 * Response shape (stable contract — mirrors /admin/tenants + /admin/api-keys):
 *   {
 *     data:        Array<AuditWireRow>,
 *     next_cursor: string | null,
 *     has_more:    boolean
 *   }
 *
 * RBAC (D-13, T-04-05c analog):
 *   - Entra admin (tenantScoped === null): global — may omit tenant_id to
 *     list cross-tenant rows, or pass tenant_id to filter.
 *   - API-key admin (tenantScoped !== null): the SQL WHERE clause forces
 *     tenant_id = admin.tenantScoped regardless of query parameters. Defense
 *     in depth — this is enforced at the SQL-param level, NOT as a post-SELECT
 *     result filter. An explicit cross-tenant query parameter returns 403
 *     (loud signal to the caller that their request was denied) rather than
 *     silently rewriting the filter.
 *
 * Cursor (D-14):
 *   - encodeCursor/decodeCursor (HMAC-SHA256, process-lifetime secret) wraps
 *     the (ts_ms, id) tuple. SQL WHERE clause uses tuple comparison for stable
 *     pagination ordering: rows in the page strictly precede the cursor.
 *   - ORDER BY ts DESC, id DESC — newest first.
 *   - LIMIT n+1 idiom determines has_more without a separate COUNT query.
 *
 * Security invariants (threat_model references embedded):
 *   - T-04-05c: tenant-scoped admin cross-tenant enumeration blocked at SQL
 *     layer, not in JavaScript. Even a tampered cursor (wrong process-secret)
 *     would be rejected by decodeCursor before reaching the query.
 *   - T-04-02:  cursor tamper detection via HMAC → decoded null → 400.
 *   - T-04-03a: problem+json envelopes used everywhere; no stack traces.
 *   - request_id is a field in the wire row to support MWARE-07 client-side
 *     correlation and Microsoft-support cross-lookup with ODataError.requestId.
 *   - meta is passed through as-is. Call-sites that wrote meta already applied
 *     D-01 redaction; this endpoint is read-only and MUST NOT mutate meta.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { problemBadRequest, problemForbidden, problemInternal } from './problem-json.js';
import { encodeCursor, decodeCursor } from './cursor.js';
import logger from '../../logger.js';
import type { AdminRouterDeps } from './router.js';

// ── Types ───────────────────────────────────────────────────────────────────

/**
 * Wire row returned by GET /admin/audit. snake_case per D-14. All fields
 * except `id`/`tenant_id`/`actor`/`action`/`request_id`/`result`/`ts` may
 * be null when the writer did not populate them; meta defaults to {} at the
 * schema level.
 */
export interface AuditWireRow {
  id: string;
  tenant_id: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  request_id: string;
  result: 'success' | 'failure';
  meta: Record<string, unknown>;
  ts: string; // ISO-8601
}

/**
 * Admin identity attached by the dual-stack middleware (plan 04-04). Local
 * shape mirrors AdminIdentity union members — see tenants.ts / api-keys.ts
 * for the same convention (avoids a cycle with dual-stack.ts).
 */
interface AdminContext {
  actor: string;
  source: 'entra' | 'api-key';
  tenantScoped: string | null;
}

type RequestWithAdmin = Request & { admin?: AdminContext; id?: string };

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * RFC 4122 GUID regex — matches tenants.ts + load-tenant.ts. Shields the SQL
 * query from callers passing non-GUID tenant_id filters (those would surface
 * as a Postgres cast error, which we pre-empt with a clean 400).
 */
const TENANT_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Column projection. Explicit list matches tenants.ts convention — no
 * SELECT * so schema additions in future migrations do not silently leak
 * new columns into the wire shape.
 */
const AUDIT_SELECT_COLUMNS = `
  id, tenant_id, actor, action, target, ip, request_id, result, meta, ts
`;

// ── Zod validator (snake_case wire) ─────────────────────────────────────────

/**
 * Query-string shape for GET /admin/audit. Every parameter is optional so the
 * endpoint serves as a catch-all list by default.
 *
 * - `limit` uses coerce.number() + clamp to 1..200. Callers passing a
 *   non-numeric string get a Zod rejection (400 bad_request).
 * - `since`/`until` are ISO-8601 datetimes. Zod's .datetime() accepts both
 *   millisecond and non-ms forms; we pass through the raw string to the
 *   query param so Postgres performs the final timestamptz cast.
 */
const ListAuditZod = z.object({
  tenant_id: z.string().regex(TENANT_GUID, 'invalid tenant_id (must be GUID)').optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  action: z.string().min(1).max(128).optional(),
  actor: z.string().min(1).max(512).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a pg row (or pg-mem row with string-typed JSONB/timestamptz) into the
 * wire shape. `meta` arrives as either a parsed object (real pg) or a JSON
 * string (pg-mem), so we normalise both paths.
 */
export function auditRowToWire(row: {
  id: string;
  tenant_id: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  request_id: string;
  result: string;
  meta: unknown;
  ts: Date | string;
}): AuditWireRow {
  let meta: Record<string, unknown> = {};
  if (row.meta !== null && row.meta !== undefined) {
    if (typeof row.meta === 'string' && row.meta.length > 0) {
      try {
        const parsed = JSON.parse(row.meta);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          meta = parsed as Record<string, unknown>;
        }
      } catch {
        meta = {};
      }
    } else if (typeof row.meta === 'object' && !Array.isArray(row.meta)) {
      meta = row.meta as Record<string, unknown>;
    }
  }

  const toIso = (d: Date | string): string => {
    if (d instanceof Date) return d.toISOString();
    return String(d);
  };

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    actor: row.actor,
    action: row.action,
    target: row.target,
    ip: row.ip,
    request_id: row.request_id,
    result: (row.result === 'failure' ? 'failure' : 'success') as 'success' | 'failure',
    meta,
    ts: toIso(row.ts),
  };
}

// ── Router factory ──────────────────────────────────────────────────────────

/**
 * Build the /admin/audit sub-router. Captures deps in a closure so callers
 * hand a single Express router to `createAdminRouter` via
 * `r.use('/audit', createAuditRoutes(deps))`.
 *
 * Mounts only GET / — audit records are append-only via the writer module
 * (src/lib/audit.ts); there is no admin CRUD path.
 */
export function createAuditRoutes(deps: AdminRouterDeps): Router {
  const r = Router();

  r.get('/', async (req: RequestWithAdmin, res: Response) => {
    const admin = req.admin;
    if (!admin) {
      // Defense in depth. The dual-stack middleware in router.ts populates
      // req.admin on every /admin/* request before sub-routes see it; if we
      // ever get here it means an upstream misconfiguration.
      problemInternal(res, req.id);
      return;
    }

    const parsed = ListAuditZod.safeParse(req.query);
    if (!parsed.success) {
      problemBadRequest(res, parsed.error.issues.map((e) => e.message).join('; '), req.id);
      return;
    }
    const {
      tenant_id: queryTenantId,
      since,
      until,
      action,
      actor,
      cursor: rawCursor,
      limit,
    } = parsed.data;

    // RBAC (D-13, T-04-05c analog):
    //   - Tenant-scoped admin: SQL-param filter forces tenant_id = admin.tenantScoped.
    //     Explicit cross-tenant query → 403 (loud signal, not silent rewrite).
    //   - Global admin: tenant_id query, if present, applied as-is; absent = all rows.
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

    // Decode cursor — malformed/tampered returns null → 400.
    let cursorTs: Date | null = null;
    let cursorId: string | null = null;
    if (rawCursor !== undefined) {
      const decoded = decodeCursor(rawCursor, deps.cursorSecret);
      if (!decoded) {
        problemBadRequest(res, 'invalid_cursor', req.id);
        return;
      }
      cursorTs = new Date(decoded.ts);
      cursorId = decoded.id;
    }

    // Build the SELECT. All filters are parameterised (no string concat),
    // matching tenants.ts :: pagination-by-tuple pattern.
    //
    // Param index map (1-indexed):
    //   $1 effectiveTenantFilter  (uuid | null)
    //   $2 since                  (timestamptz | null)
    //   $3 until                  (timestamptz | null)
    //   $4 action                 (text | null)
    //   $5 actor                  (text | null)
    //   $6 cursorTs               (timestamptz | null)
    //   $7 cursorId               (text | null)
    //   $8 limit + 1              (int — has_more probe)
    try {
      const { rows } = await deps.pgPool.query(
        `SELECT ${AUDIT_SELECT_COLUMNS} FROM audit_log
          WHERE ($1::uuid IS NULL OR tenant_id = $1::uuid)
            AND ($2::timestamptz IS NULL OR ts >= $2::timestamptz)
            AND ($3::timestamptz IS NULL OR ts < $3::timestamptz)
            AND ($4::text IS NULL OR action = $4::text)
            AND ($5::text IS NULL OR actor = $5::text)
            AND (
              $6::timestamptz IS NULL
              OR (ts < $6::timestamptz)
              OR (ts = $6::timestamptz AND id < $7::text)
            )
          ORDER BY ts DESC, id DESC
          LIMIT $8`,
        [
          effectiveTenantFilter,
          since ?? null,
          until ?? null,
          action ?? null,
          actor ?? null,
          cursorTs,
          cursorId,
          limit + 1,
        ]
      );

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      let nextCursor: string | null = null;
      if (hasMore && page.length > 0) {
        const last = page[page.length - 1]!;
        const ts = last.ts instanceof Date ? last.ts : new Date(last.ts);
        nextCursor = encodeCursor({ ts: ts.getTime(), id: last.id }, deps.cursorSecret);
      }

      res.status(200).json({
        data: page.map(auditRowToWire),
        next_cursor: nextCursor,
        has_more: hasMore,
      });
    } catch (err) {
      logger.error(
        { err: (err as Error).message, actor: admin.actor },
        'admin-audit: list query failed'
      );
      problemInternal(res, req.id);
    }
  });

  return r;
}
