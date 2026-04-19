/**
 * Pure-function unit tests for the typed GraphError hierarchy and the
 * `parseODataError` helper (Plan 02-03, MWARE-07).
 *
 * Asserts both the class-shape contract (`instanceof` for each subclass) and
 * the parsing contract (hyphenated vs camelCase `innerError` keys, Retry-After
 * header extraction in both seconds and HTTP-date forms, org-mode hint
 * detection on 403, graceful fallback on malformed bodies).
 *
 * Fixtures come from `test/fixtures/graph-responses.ts` (established by 02-01).
 * Bodies use HYPHENATED innerError field names — matching the real Graph wire
 * format. The parser normalizes both hyphenated and camelCase to camelCase
 * (Kiota issue #75 pattern).
 */
import { describe, it, expect } from 'vitest';
import {
  GraphError,
  GraphThrottleError,
  GraphConcurrencyError,
  GraphAuthError,
  GraphValidationError,
  GraphServerError,
  parseODataError,
} from '../src/lib/graph-errors.js';
import {
  canonical429Throttle,
  canonical412PreconditionFailed,
  canonical400ValidationError,
  canonical500InternalServer,
} from './fixtures/graph-responses.js';

describe('parseODataError → typed GraphError', () => {
  it('400 returns GraphValidationError with all structured fields', () => {
    const err = parseODataError(canonical400ValidationError.body, 400);
    expect(err).toBeInstanceOf(GraphValidationError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('invalidRequest');
    expect(err.message).toBe('Invalid request');
    expect(err.requestId).toBe('33333333-4444-5555-6666-777777777777');
    expect(err.clientRequestId).toBe('33333333-4444-5555-6666-777777777777');
    expect(err.date).toBe('2026-04-18T12:00:00');
  });

  it('412 returns GraphConcurrencyError with re-fetch hint appended to message', () => {
    const err = parseODataError(canonical412PreconditionFailed.body, 412);
    expect(err).toBeInstanceOf(GraphConcurrencyError);
    expect(err.statusCode).toBe(412);
    expect(err.code).toBe('resourceModified');
    expect(err.message).toContain('resource changed');
  });

  it('429 returns GraphThrottleError and populates retryAfterMs (seconds form)', () => {
    const err = parseODataError(canonical429Throttle.body, 429, { 'retry-after': '10' });
    expect(err).toBeInstanceOf(GraphThrottleError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterMs).toBe(10_000);
  });

  it('429 HTTP-date form populates retryAfterMs within tolerance', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const err = parseODataError(canonical429Throttle.body, 429, { 'retry-after': future });
    expect(err).toBeInstanceOf(GraphThrottleError);
    expect(err.retryAfterMs ?? 0).toBeGreaterThanOrEqual(4_900);
    expect(err.retryAfterMs ?? 0).toBeLessThanOrEqual(5_100);
  });

  it('500 returns GraphServerError', () => {
    const err = parseODataError(canonical500InternalServer.body, 500);
    expect(err).toBeInstanceOf(GraphServerError);
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('generalException');
  });

  it('normalizes hyphenated innerError fields to camelCase', () => {
    const hyphen = {
      error: {
        code: 'x',
        message: 'y',
        innerError: {
          'request-id': 'REQ',
          'client-request-id': 'CLI',
          date: 'DATE',
        },
      },
    };
    const errH = parseODataError(hyphen, 400);
    expect(errH.requestId).toBe('REQ');
    expect(errH.clientRequestId).toBe('CLI');
    expect(errH.date).toBe('DATE');

    const camel = {
      error: {
        code: 'x',
        message: 'y',
        innerError: { requestId: 'R2', clientRequestId: 'C2', date: 'D2' },
      },
    };
    const errC = parseODataError(camel, 400);
    expect(errC.requestId).toBe('R2');
    expect(errC.clientRequestId).toBe('C2');
    expect(errC.date).toBe('D2');

    const legacy = {
      error: {
        code: 'x',
        message: 'y',
        innererror: { 'request-id': 'R3' },
      },
    };
    const errL = parseODataError(legacy, 400);
    expect(errL.requestId).toBe('R3');
  });

  it('unknown status returns base GraphError (not a subclass)', () => {
    const err = parseODataError(
      { error: { code: 'teapot', message: 'I am a teapot' } },
      418
    );
    expect(err.constructor).toBe(GraphError);
    expect(err.code).toBe('teapot');
    expect(err.statusCode).toBe(418);
  });

  it('detects org-mode hint on 403 via scope/permission keyword', () => {
    const body = {
      error: {
        code: 'Forbidden',
        message:
          'Access to users in this tenant requires admin consent for the scope Mail.ReadWrite',
      },
    };
    const err = parseODataError(body, 403);
    expect(err).toBeInstanceOf(GraphAuthError);
    expect((err as GraphAuthError).requiresOrgMode).toBe(true);
    // The "--org-mode" composition happens in graph-client.ts, not the parser.
    expect(err.message).not.toContain('--org-mode');
  });

  it('401 returns GraphAuthError without requiresOrgMode flag', () => {
    const err = parseODataError(
      { error: { code: 'InvalidAuthenticationToken', message: 'Access token expired' } },
      401
    );
    expect(err).toBeInstanceOf(GraphAuthError);
    expect((err as GraphAuthError).requiresOrgMode).toBe(false);
  });

  it('falls back gracefully on empty-object body', () => {
    const err = parseODataError({}, 500);
    expect(err).toBeInstanceOf(GraphServerError);
    expect(err.code).toBe('unknownError');
    expect(err.message).toBe('Graph returned 500');
  });

  it('falls back gracefully on null body', () => {
    const err = parseODataError(null, 502);
    expect(err).toBeInstanceOf(GraphServerError);
    expect(err.code).toBe('unknownError');
    expect(err.message).toBe('Graph returned 502');
  });

  it('falls back gracefully on string (non-JSON) body', () => {
    const err = parseODataError('not json at all', 503);
    expect(err).toBeInstanceOf(GraphServerError);
    expect(err.code).toBe('unknownError');
    expect(err.message).toBe('Graph returned 503');
  });

  it('accepts Headers instance for retry-after extraction', () => {
    const hdrs = new Headers({ 'retry-after': '7' });
    const err = parseODataError(canonical429Throttle.body, 429, hdrs);
    expect(err).toBeInstanceOf(GraphThrottleError);
    expect(err.retryAfterMs).toBe(7_000);
  });

  it('handles case-insensitive Retry-After header key in plain object', () => {
    const err = parseODataError(canonical429Throttle.body, 429, { 'Retry-After': '3' });
    expect(err.retryAfterMs).toBe(3_000);
  });

  it('retryAfterMs is undefined when no retry-after header present', () => {
    const err = parseODataError(canonical429Throttle.body, 429);
    expect(err).toBeInstanceOf(GraphThrottleError);
    expect(err.retryAfterMs).toBeUndefined();
  });

  it('422 returns GraphValidationError (validation class covers 400 and 422)', () => {
    const err = parseODataError(
      { error: { code: 'UnprocessableEntity', message: 'Invalid content' } },
      422
    );
    expect(err).toBeInstanceOf(GraphValidationError);
  });

  it('surfaces innerDetails from body.error.details when present', () => {
    const body = {
      error: {
        code: 'invalidRequest',
        message: 'Invalid request',
        details: [{ code: 'missingField', message: "Required field 'id' missing" }],
      },
    };
    const err = parseODataError(body, 400);
    expect(err.innerDetails).toEqual([
      { code: 'missingField', message: "Required field 'id' missing" },
    ]);
  });

  it('preserves Error inheritance contract (instanceof Error + stack trace)', () => {
    const err = parseODataError(canonical400ValidationError.body, 400);
    expect(err).toBeInstanceOf(Error);
    expect(err.stack).toBeDefined();
    expect(err.name).toBe('GraphValidationError');
  });
});
