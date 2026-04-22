/**
 * RetryHandler — Phase 2 middleware implementing MWARE-01 (Retry-After + 429)
 * and MWARE-02 (transient 5xx retry) per D-05.
 *
 * Backoff: AWS full-jitter `delay = floor(random() * min(cap, base * 2^attempt))`
 * with `base = 500ms`, `cap = 30_000ms`. When the server supplies a
 * `Retry-After` header (seconds or HTTP-date), we honor it verbatim — clamped
 * to `RETRY_AFTER_MAX_MS = 120_000ms` (2 min) so a malicious / misconfigured
 * upstream cannot park us for arbitrary time (T-02-02b).
 *
 * Retryable statuses (fixed per D-05): 408 / 429 / 500 / 502 / 503 / 504.
 * 401 is explicitly NOT retryable here — TokenRefreshMiddleware (innermost,
 * 02-01) owns 401 refresh. GraphAuthError propagates through RetryHandler
 * unchanged.
 *
 * Max attempts: `MS365_MCP_RETRY_MAX_ATTEMPTS` env var (default 3). After
 * exhaustion the final response / error propagates unchanged.
 *
 * Idempotency gate (T-02-02c mitigation):
 *   - GET / HEAD / OPTIONS: always retry on retryable statuses.
 *   - POST / PATCH / PUT / DELETE: retry on 429 only (explicit server
 *     throttle signal) OR when the caller supplies an `Idempotency-Key`
 *     header. Other 5xx on writes return immediately to avoid duplicate
 *     side effects.
 *
 * Chain position: OUTSIDE ODataErrorHandler (02-03). ODataErrorHandler throws
 * GraphError on non-2xx; RetryHandler's catch-block inspects the typed
 * exception (statusCode + retryAfterMs) and decides retry-or-rethrow. When
 * called directly in a unit test without ODataErrorHandler in the chain,
 * RetryHandler also handles raw Response returns — the response.status
 * inspection path is covered.
 *
 * Short-circuit: when `req._skipRetry === true` the middleware passes through
 * straight to `next()` without wrapping. UploadSession chunk PUTs set this
 * flag per D-08 — their resume protocol relies on observing raw transport
 * errors and would break under double-retry.
 *
 * Observability:
 *   - `retryCount` + `lastStatus` written to `RequestContext` on every exit
 *     path so Phase 6 OPS-06 (`mcp_graph_throttled_total`) can surface them.
 *   - OTel span `graph.middleware.retry` with attributes
 *     `graph.retry.count` + `graph.retry.last_status` (D-03).
 *   - pino logger: `logger.info({ attempt, delay, status, method }, 'retrying ...')`
 *     — status + attempt only, URL omitted (T-02-02d).
 */

import { trace, type Span } from '@opentelemetry/api';
import logger from '../../logger.js';
import { mcpGraphThrottledTotal } from '../otel-metrics.js';
import { requestContext } from '../../request-context.js';
import { GraphError } from '../graph-errors.js';
import type { GraphMiddleware, GraphRequest } from './types.js';

const BASE_MS = 500;
const CAP_MS = 30_000;
const RETRY_AFTER_MAX_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

const tracer = trace.getTracer('graph-middleware');

export class RetryHandler implements GraphMiddleware {
  readonly name = 'retry';

  async execute(req: GraphRequest, next: () => Promise<Response>): Promise<Response> {
    // _skipRetry short-circuit — UploadSession chunk PUTs (02-06) bypass the
    // retry loop entirely. Their own resume-from-nextExpectedRanges protocol
    // owns recovery.
    if (req._skipRetry) return next();

    const maxAttempts = parseMaxAttempts();

    return tracer.startActiveSpan('graph.middleware.retry', async (span) => {
      let attempt = 0;

      for (;;) {
        try {
          const response = await next();

          // Non-retryable status (2xx or not-in-RETRYABLE_STATUSES, e.g. 401):
          // propagate immediately.
          if (!RETRYABLE_STATUSES.has(response.status)) {
            finalizeSpan(span, attempt, response.status);
            updateContext(attempt, response.status);
            return response;
          }

          // Attempts exhausted — return the final response unchanged. Max
          // attempts is the NUMBER OF RETRIES allowed (default 3), so we
          // have already made the (attempt === maxAttempts) call; stop.
          if (attempt >= maxAttempts) {
            logger.warn(
              { attempts: attempt + 1, status: response.status, method: req.method },
              'retry exhausted'
            );
            finalizeSpan(span, attempt, response.status);
            updateContext(attempt, response.status);
            return response;
          }

          // Idempotency gate — writes without Idempotency-Key only retry on
          // 429 (explicit server signal). Reads always retry.
          if (!shouldRetryMethodByStatus(req.method, response.status, req.headers)) {
            finalizeSpan(span, attempt, response.status);
            updateContext(attempt, response.status);
            return response;
          }

          const delay = computeDelayFromResponse(attempt, response);
          logger.info(
            { attempt, delay, status: response.status, method: req.method },
            'retrying (response path)'
          );
          await sleep(delay);
          attempt++;
          continue;
        } catch (err) {
          // GraphError path — ODataErrorHandler is in-chain and has thrown.
          if (!(err instanceof GraphError)) {
            // Non-GraphError (network failure, aborted fetch, etc.) —
            // RetryHandler does not own transport-level errors. Propagate.
            finalizeSpan(span, attempt, 0);
            updateContext(attempt, 0);
            throw err;
          }

          if (!RETRYABLE_STATUSES.has(err.statusCode)) {
            finalizeSpan(span, attempt, err.statusCode);
            updateContext(attempt, err.statusCode);
            throw err;
          }

          if (attempt >= maxAttempts) {
            logger.warn(
              { attempts: attempt + 1, status: err.statusCode, method: req.method },
              'retry exhausted (typed)'
            );
            finalizeSpan(span, attempt, err.statusCode);
            updateContext(attempt, err.statusCode);
            throw err;
          }

          if (!shouldRetryMethodByStatus(req.method, err.statusCode, req.headers)) {
            finalizeSpan(span, attempt, err.statusCode);
            updateContext(attempt, err.statusCode);
            throw err;
          }

          const delay = computeDelayFromError(attempt, err);
          logger.info(
            { attempt, delay, status: err.statusCode, method: req.method },
            'retrying (typed path)'
          );
          await sleep(delay);
          attempt++;
          continue;
        }
      }
    });
  }
}

/** Parse `MS365_MCP_RETRY_MAX_ATTEMPTS`; non-integer / negative → fallback. */
function parseMaxAttempts(): number {
  const raw = process.env.MS365_MCP_RETRY_MAX_ATTEMPTS;
  if (!raw) return DEFAULT_MAX_ATTEMPTS;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX_ATTEMPTS;
}

/** Terminate the OTel span with retry.count + retry.last_status attributes. */
function finalizeSpan(span: Span, attempt: number, lastStatus: number): void {
  span.setAttribute('graph.retry.count', attempt);
  span.setAttribute('graph.retry.last_status', lastStatus);
  span.end();
}

/** Write retryCount + lastStatus onto the ALS-stored RequestContext. */
function updateContext(retryCount: number, lastStatus: number): void {
  const ctx = requestContext.getStore();
  if (ctx) {
    ctx.retryCount = retryCount;
    ctx.lastStatus = lastStatus;
  }
  emitThrottleMetric(lastStatus);
}

/**
 * Plan 06-02 Task 3 — increment mcp_graph_throttled_total when a terminal
 * Graph observation carries status 429. Called once per RetryHandler exit
 * path (via updateContext), so retries of the same logical call are
 * counted exactly once at the terminal observation.
 *
 * Safe when requestContext is undefined (stdio mode): tenant label falls
 * back to 'unknown'.
 */
function emitThrottleMetric(status: number): void {
  if (status !== 429) return;
  const tenantId = requestContext.getStore()?.tenantId ?? 'unknown';
  mcpGraphThrottledTotal.add(1, { tenant: tenantId });
}

/**
 * Idempotency gate — decide whether a retry is safe given the HTTP method
 * and the status code that triggered the decision.
 *
 * Reads (GET / HEAD / OPTIONS) are idempotent by definition; always retry
 * on retryable statuses.
 *
 * Writes (POST / PATCH / PUT / DELETE) retry only when:
 *   - the server explicitly signalled a throttle via 429, or
 *   - the caller supplied an `Idempotency-Key` header, opting into retry.
 *
 * The header lookup is case-insensitive per HTTP/1.1 semantics.
 */
function shouldRetryMethodByStatus(
  method: string,
  statusCode: number,
  headers: Record<string, string>
): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  if (statusCode === 429) return true;
  if (hasIdempotencyKey(headers)) return true;
  return false;
}

/** Case-insensitive lookup for the `Idempotency-Key` header. */
function hasIdempotencyKey(headers: Record<string, string>): boolean {
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === 'idempotency-key') return true;
  }
  return false;
}

/**
 * Compute retry delay from a raw Response — prefers Retry-After header;
 * falls back to full-jitter.
 */
function computeDelayFromResponse(attempt: number, response: Response): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const parsed = parseRetryAfter(retryAfter);
    if (parsed !== null) return Math.min(parsed, RETRY_AFTER_MAX_MS);
  }
  return fullJitterDelay(attempt);
}

/**
 * Compute retry delay from a thrown GraphError — ODataErrorHandler has
 * already populated `retryAfterMs` from the wire header when present.
 */
function computeDelayFromError(attempt: number, err: GraphError): number {
  if (err.retryAfterMs !== undefined) {
    return Math.min(err.retryAfterMs, RETRY_AFTER_MAX_MS);
  }
  return fullJitterDelay(attempt);
}

/**
 * AWS full-jitter delay formula (D-05 locked):
 *   window = min(cap, base * 2 ^ attempt)
 *   delay  = floor(random() * window)
 *
 * Full jitter dominates decorrelated / equal jitter for storm prevention per
 * the canonical AWS Architecture Blog analysis; see 02-RESEARCH.md §
 * "State of the Art — Exponential Backoff".
 */
function fullJitterDelay(attempt: number): number {
  const window = Math.min(CAP_MS, BASE_MS * 2 ** attempt);
  return Math.floor(Math.random() * window);
}

/**
 * Parse `Retry-After` header value (RFC 7231 §7.1.3) — delay-seconds or
 * HTTP-date form. Tolerates fractional seconds (Sentry #7919) via
 * `Number()` + `Math.round(n * 1000)` rather than `parseInt` which would
 * truncate. Past HTTP-dates clamp to 0 (retry immediately). Returns `null`
 * on unparseable input so the caller can fall through to full-jitter.
 *
 * Exported for direct test coverage of the parsing edge cases; also called
 * internally by `computeDelayFromResponse`.
 */
export function parseRetryAfter(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  // Delay-seconds form; fractional tolerated.
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.round(asNumber * 1000);
  }

  // HTTP-date form.
  const asDate = new Date(trimmed).getTime();
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

/** Promise-wrapped setTimeout — the sole sleep primitive used by the loop. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
