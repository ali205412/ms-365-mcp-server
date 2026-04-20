/**
 * RFC 7807 `application/problem+json` envelope helper (plan 04-01, D-14).
 *
 * Pure module with NO project-internal imports — safe to load before the
 * logger or OTel bootstrap runs. Follows the zero-dep convention of
 * src/lib/redact.ts (Phase 1 plan 01-02 gold standard) and
 * src/lib/graph-errors.ts (Phase 2 plan 02-03).
 *
 * Shape (per RFC 7807 §3.1 — https://datatracker.ietf.org/doc/html/rfc7807):
 *   {
 *     type:     "https://docs.ms365mcp/errors/<error-code>",  (URI ref)
 *     title:    "Short human summary",
 *     status:   <HTTP status code>,
 *     detail?:  "Developer-facing detail",
 *     instance?: "<requestId or URI>",
 *     ...extensions (spread at top level per §3.2)
 *   }
 *
 * Security invariant (RFC 7807 §3.1, CITED):
 *   `detail` MUST focus on "helping the client correct the problem, rather
 *   than giving debugging information." This helper passes detail through
 *   as-is — CALL-SITES are responsible for sanitizing stack traces, raw SQL
 *   errors, internal paths, and request bodies BEFORE passing them in. T-04-03a
 *   (info-disclosure via detail) is mitigated at call-sites, NOT here; the
 *   helper is deliberately a pure transform so the sanitization boundary is
 *   unambiguous. `problemInternal` uses a static title/no-detail shape so
 *   generic 500 responses cannot leak internals even when call-sites forget.
 *
 * This module does not import the logger — it is a pure transform. Call-sites
 * log (with appropriate redaction) and then call the helper to shape the wire.
 */
import type { Response } from 'express';

/**
 * RFC 7807 problem document. Extension members allowed per §3.2.
 */
export interface ProblemDetails {
  type: string; // URI reference
  title: string; // Short human summary
  status: number; // HTTP status
  detail?: string; // Developer-facing; MUST NOT leak internals (RFC 7807 §3.1)
  instance?: string; // URI / requestId — per-occurrence
  [ext: string]: unknown; // Extension members
}

/**
 * Base URI for our error `type` URIs. Placeholder hostname — the docs site
 * can be published later; clients and operators get a stable, greppable
 * identifier either way.
 */
const TYPE_BASE = 'https://docs.ms365mcp/errors/';

/**
 * Emit a problem+json response.
 *
 * @param res      Express Response
 * @param status   HTTP status code (4xx/5xx)
 * @param code     Short snake_case error code — becomes `<TYPE_BASE><code>`
 * @param opts     title (required), optional detail / instance / extensions
 */
export function problemJson(
  res: Response,
  status: number,
  code: string,
  opts: {
    title: string;
    detail?: string;
    instance?: string;
    extensions?: Record<string, unknown>;
  }
): void {
  const body: ProblemDetails = {
    type: `${TYPE_BASE}${code}`,
    title: opts.title,
    status,
    ...(opts.detail !== undefined ? { detail: opts.detail } : {}),
    ...(opts.instance !== undefined ? { instance: opts.instance } : {}),
    ...(opts.extensions ?? {}),
  };
  res.status(status).type('application/problem+json').json(body);
}

/** 400 Bad Request — client-side input error. */
export const problemBadRequest = (res: Response, detail: string, instance?: string): void =>
  problemJson(res, 400, 'bad_request', { title: 'Bad Request', detail, instance });

/** 401 Unauthorized — missing/invalid credentials. */
export const problemUnauthorized = (res: Response, instance?: string): void =>
  problemJson(res, 401, 'unauthorized', { title: 'Unauthorized', instance });

/** 403 Forbidden — authenticated but not allowed. */
export const problemForbidden = (res: Response, instance?: string): void =>
  problemJson(res, 403, 'forbidden', { title: 'Forbidden', instance });

/** 404 Not Found — resource-scoped message. */
export const problemNotFound = (res: Response, resource: string, instance?: string): void =>
  problemJson(res, 404, 'not_found', {
    title: 'Not Found',
    detail: `${resource} not found`,
    instance,
  });

/** 409 Conflict — state conflict, e.g., duplicate unique key. */
export const problemConflict = (res: Response, detail: string, instance?: string): void =>
  problemJson(res, 409, 'conflict', { title: 'Conflict', detail, instance });

/** 412 Precondition Failed — optimistic-concurrency mismatch (If-Match). */
export const problemPreconditionFailed = (res: Response, instance?: string): void =>
  problemJson(res, 412, 'precondition_failed', { title: 'Precondition Failed', instance });

/**
 * 500 Internal Server Error — static shape; call-sites MUST NOT pass detail
 * (leaks internals). This is the enforcement point for T-04-03a at a helper
 * level: callers that hit this shorthand cannot accidentally leak a stack
 * trace because the signature does not accept one.
 */
export const problemInternal = (res: Response, instance?: string): void =>
  problemJson(res, 500, 'internal_error', { title: 'Internal Server Error', instance });
