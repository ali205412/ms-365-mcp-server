/**
 * Typed Graph error hierarchy (Plan 02-03, MWARE-07).
 *
 * Replaces the v1 string-concat `throw new Error(\`Microsoft Graph API
 * error: ...\`)` pattern at src/graph-client.ts:178-194 with a structured
 * hierarchy the AI caller can reason about. Every subclass carries the
 * Microsoft `request-id` (normalized to camelCase) so callers can paste it
 * into a Microsoft support ticket — enabling Phase 2 Success Criteria #5.
 *
 * Subclasses select by HTTP status:
 *   - GraphThrottleError    — 429 (retryable; 02-02 RetryHandler honors retryAfterMs)
 *   - GraphConcurrencyError — 412 (NOT retryable; ETag mismatch; 02-07 surfaces)
 *   - GraphAuthError        — 401 / 403 (NOT retryable; 401 refresh owned by 02-01 innermost)
 *   - GraphValidationError  — 400 / 422 (NOT retryable; caller error)
 *   - GraphServerError      — 5xx (retryable by RetryHandler per D-05)
 *   - GraphError            — unknown status fallback
 *
 * Pure module with NO project-internal imports — safe to load before the
 * logger or OTel bootstrap runs. Follows the zero-dep pattern of
 * src/lib/redact.ts (Phase 1 plan 01-02 gold standard).
 *
 * Parsing tolerance (parseODataError):
 *   - accepts hyphenated innerError keys (`request-id`, `client-request-id`)
 *     per Graph's ongoing wire-format inconsistency (Kiota issue #75);
 *   - accepts camelCase innerError keys (what Graph docs show in some places);
 *   - accepts legacy lowercase `innererror` field name;
 *   - graceful fallback on missing / malformed / non-JSON bodies to
 *     `{ code: 'unknownError', message: \`Graph returned ${statusCode}\` }`;
 *   - Retry-After header extracted in both seconds (integer or fractional
 *     per Sentry issue #7919) and HTTP-date forms.
 *
 * org-mode detection: on 403 with body.error.message containing "scope" or
 * "permission", sets `requiresOrgMode = true` so graph-client.ts can append
 * the "--org-mode" operator hint to the MCP error text. The hint string
 * itself lives in graph-client.ts, NOT in this parser (separation of parsing
 * from presentation).
 */

/**
 * Shape of the constructor parameter bag accepted by GraphError and all
 * subclasses. Mirrors the fields on the resulting instance.
 */
export interface GraphErrorParams {
  code: string;
  message: string;
  statusCode: number;
  requestId?: string;
  clientRequestId?: string;
  date?: string;
  innerDetails?: unknown;
  retryAfterMs?: number;
  requiresOrgMode?: boolean;
}

/**
 * Base class for all typed Graph errors. Subclasses narrow the status-code
 * space so callers can branch on `instanceof` (e.g., RetryHandler in 02-02
 * catches `GraphThrottleError` / `GraphServerError` and ignores the rest).
 */
export class GraphError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly requestId?: string;
  public readonly clientRequestId?: string;
  public readonly date?: string;
  public readonly innerDetails?: unknown;
  public readonly retryAfterMs?: number;
  public readonly requiresOrgMode?: boolean;

  constructor(params: GraphErrorParams) {
    super(params.message);
    this.name = this.constructor.name;
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.requestId = params.requestId;
    this.clientRequestId = params.clientRequestId;
    this.date = params.date;
    this.innerDetails = params.innerDetails;
    this.retryAfterMs = params.retryAfterMs;
    this.requiresOrgMode = params.requiresOrgMode;
  }
}

/** 429 Too Many Requests. Retryable by RetryHandler per D-05. */
export class GraphThrottleError extends GraphError {}

/** 401 / 403. NOT retried — 401 refresh is TokenRefreshMiddleware's job. */
export class GraphAuthError extends GraphError {}

/** 400 / 422. NOT retried — caller error. */
export class GraphValidationError extends GraphError {}

/** 5xx. Retryable by RetryHandler per D-05. */
export class GraphServerError extends GraphError {}

/**
 * 412 Precondition Failed (ETag mismatch). Appends an AI-facing hint to the
 * message so the caller knows to re-fetch the resource before retrying the
 * PATCH / DELETE. Plumbed end-to-end in 02-07 (ETag middleware).
 */
export class GraphConcurrencyError extends GraphError {
  constructor(params: GraphErrorParams) {
    super({
      ...params,
      message: `${params.message} - resource changed; re-fetch before retrying.`,
    });
  }
}

/**
 * Parse the Graph OData error envelope into the correct typed GraphError
 * subclass. See the module docstring for tolerance guarantees.
 *
 * Returns a concrete subclass selected by `statusCode` alone; the `code`
 * field is purely informational and never influences subclass selection
 * (defense against T-02-03f — attacker-controlled `code` cannot spoof a
 * retry class).
 */
export function parseODataError(
  body: unknown,
  statusCode: number,
  headers?: Headers | Record<string, string>
): GraphError {
  const wrapped = extractErrorWrapper(body);
  const innerSource = extractInnerError(wrapped);

  const requestId = readInnerField(innerSource, 'request-id', 'requestId');
  const clientRequestId = readInnerField(innerSource, 'client-request-id', 'clientRequestId');
  const date = innerSource.date as string | undefined;

  const code = (wrapped.code as string | undefined) ?? 'unknownError';
  const rawMessage = wrapped.message as string | undefined;
  const message = rawMessage ?? `Graph returned ${statusCode}`;
  const innerDetails = wrapped.details;

  const retryAfterMs = readRetryAfter(headers);

  // 403 org-mode hint detection — gate on scope/permission keyword in the
  // Microsoft-canned error.message, not on any attacker-controllable field.
  const requiresOrgMode =
    statusCode === 403 && typeof rawMessage === 'string' && /scope|permission/i.test(rawMessage);

  const params: GraphErrorParams = {
    code,
    message,
    statusCode,
    requestId,
    clientRequestId,
    date,
    innerDetails,
    retryAfterMs,
    requiresOrgMode,
  };

  if (statusCode === 429) return new GraphThrottleError(params);
  if (statusCode === 412) return new GraphConcurrencyError(params);
  if (statusCode === 401 || statusCode === 403) return new GraphAuthError(params);
  if (statusCode === 400 || statusCode === 422) return new GraphValidationError(params);
  if (statusCode >= 500) return new GraphServerError(params);
  return new GraphError(params);
}

/**
 * Narrow an opaque body value to `body.error` if it looks like an OData
 * error envelope. Returns an empty object on any non-shape (null, string,
 * primitive, missing `.error`). Safe to call on untrusted input.
 */
function extractErrorWrapper(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') return {};
  const candidate = (body as { error?: unknown }).error;
  if (candidate === null || typeof candidate !== 'object') return {};
  return candidate as Record<string, unknown>;
}

/**
 * Extract the innerError sub-object, accepting both `innerError` (docs form)
 * and the legacy lowercase `innererror` key that Graph has emitted
 * historically (per RESEARCH.md "Don't Hand-Roll" row).
 */
function extractInnerError(wrapper: Record<string, unknown>): Record<string, unknown> {
  const canonical = wrapper.innerError;
  if (canonical !== null && typeof canonical === 'object') {
    return canonical as Record<string, unknown>;
  }
  const legacy = wrapper.innererror;
  if (legacy !== null && typeof legacy === 'object') {
    return legacy as Record<string, unknown>;
  }
  return {};
}

/**
 * Read a field from the innerError object, trying the hyphenated form first
 * (real Graph wire format) then falling back to the camelCase form (docs
 * form). Kiota-bug-#75 compatibility.
 */
function readInnerField(
  inner: Record<string, unknown>,
  hyphenated: string,
  camel: string
): string | undefined {
  const hyphenValue = inner[hyphenated];
  if (typeof hyphenValue === 'string') return hyphenValue;
  const camelValue = inner[camel];
  if (typeof camelValue === 'string') return camelValue;
  return undefined;
}

/**
 * Extract the Retry-After header value and parse it into milliseconds.
 * Accepts a `Headers` instance (modern fetch responses) or a plain object
 * with case-insensitive key matching (for test fixtures / synthetic calls).
 */
function readRetryAfter(headers?: Headers | Record<string, string>): number | undefined {
  if (!headers) return undefined;
  let value: string | null | undefined;
  if (headers instanceof Headers) {
    value = headers.get('retry-after');
  } else {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'retry-after') {
        value = headers[key];
        break;
      }
    }
  }
  if (!value) return undefined;
  const parsed = parseRetryAfter(value);
  return parsed ?? undefined;
}

/**
 * Parse a Retry-After header value in either delay-seconds or HTTP-date form.
 *
 * RFC 7231 §7.1.3: `Retry-After = HTTP-date / delay-seconds`.
 * Delay-seconds MAY be fractional (Sentry #7919 real-world cases); we round
 * to the nearest millisecond rather than truncating with parseInt. Past HTTP
 * dates clamp to 0 (retry immediately) rather than returning a negative delay.
 *
 * Returns `null` on unparseable input so the caller can distinguish "no
 * retry-after" from "retry immediately".
 */
function parseRetryAfter(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;

  // Delay-seconds form (non-negative; fractional tolerated per Sentry #7919).
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
