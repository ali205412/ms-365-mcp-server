/**
 * ODataErrorHandler — Phase 2 middleware implementing MWARE-07.
 *
 * On 2xx: passes the Response through unchanged (the upstream caller still
 * consumes the body). On non-2xx: parses the body via
 * `graph-errors.parseODataError` and THROWS the correct typed GraphError
 * subclass. Outer middleware (02-02 RetryHandler, 02-07 ETagMiddleware) can
 * inspect `err instanceof Graph*Error` to make retry / recovery decisions.
 *
 * Chain position (02-CONTEXT.md Pattern E): INSIDE RetryHandler so
 * RetryHandler's catch-block sees the typed exception and can decide
 * retry-or-rethrow by class. OUTSIDE TokenRefreshMiddleware (innermost) so
 * 401 refresh runs before ODataError surfaces the error. The locked chain
 * shape is:
 *
 *   [ETag (02-07), RetryHandler (02-02), ODataErrorHandler (this), TokenRefresh (02-01)]
 *     outermost                                                      innermost
 *
 * Body-read safety: fetch Response bodies are single-use streams. We clone
 * the response before reading so the upstream caller (if any) can still
 * re-read the body. The middleware always throws on non-2xx, so the only
 * post-non-2xx consumer is the outer middleware chain — they observe the
 * typed exception, not the Response object.
 *
 * Non-JSON fallback: gateway errors (Cloudflare HTML pages, upstream TLS
 * failures, etc.) may return opaque bodies. We fall back to a synthetic
 * `{ error: { code: 'nonJsonError', message: <text> } }` envelope so the
 * caller always receives a typed GraphError rather than a generic Error.
 *
 * Logging (T-02-03a mitigation): logs code / requestId / clientRequestId
 * at `warn` level via pino. Does NOT log the raw error body (may contain
 * PII per RESEARCH.md). D-01 STRICT redaction chain from Phase 1 applies
 * to the serialized log line.
 */

import { trace } from '@opentelemetry/api';
import logger from '../../logger.js';
import { parseODataError } from '../graph-errors.js';
import type { GraphMiddleware, GraphRequest } from './types.js';

const tracer = trace.getTracer('graph-middleware');

export class ODataErrorHandler implements GraphMiddleware {
  readonly name = 'odata-error';

  async execute(req: GraphRequest, next: () => Promise<Response>): Promise<Response> {
    return tracer.startActiveSpan('graph.middleware.odata-error', async (span) => {
      try {
        const response = await next();
        if (response.ok) {
          span.setAttribute('graph.status', response.status);
          return response;
        }

        // Non-2xx: read the body via clone() so any upstream consumer can
        // still re-read the original stream (single-use per fetch spec).
        const body = await readErrorBody(response);
        const err = parseODataError(body, response.status, response.headers);

        span.setAttribute('graph.status', response.status);
        span.setAttribute('graph.error.code', err.code);
        if (err.requestId) {
          span.setAttribute('graph.error.requestId', err.requestId);
        }

        logger.warn(
          {
            status: response.status,
            code: err.code,
            requestId: err.requestId,
            clientRequestId: err.clientRequestId,
          },
          'graph error'
        );

        throw err;
      } finally {
        span.end();
      }
    });
  }
}

/**
 * Read the response body and return a shape parseODataError can consume.
 *
 * First tries JSON; on any parse failure falls back to reading as text and
 * wrapping it in a synthetic `{ error: { code: 'nonJsonError', message: <text> } }`
 * envelope. The synthetic envelope preserves the status code (parseODataError
 * selects the subclass by status, not by message) and surfaces the opaque
 * text to the caller for diagnostics.
 */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    const text = await response
      .clone()
      .text()
      .catch(() => '');
    return {
      error: {
        code: 'nonJsonError',
        message: text || `Graph returned ${response.status}`,
      },
    };
  }
}
