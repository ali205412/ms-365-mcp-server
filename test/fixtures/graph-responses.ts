/**
 * Canonical Microsoft Graph response fixtures — used by every Phase 2 middleware
 * test that needs a realistic error / throttle body.
 *
 * Bodies are lifted verbatim from the Microsoft Graph error-responses doc
 * (https://learn.microsoft.com/graph/errors) so tests assert against the
 * real wire format rather than a camelCased clone.
 *
 * IMPORTANT: `innerError` uses HYPHENATED field names (`request-id`,
 * `client-request-id`). This is NOT a typo — it is the format Graph actually
 * emits (see kiota-typescript issue #75 for the real-world inconsistency
 * between Graph docs and SDK camelCase). Phase 2 parsers must read both.
 *
 * File naming: this file lives under `test/fixtures/` with a `.ts` (NOT
 * `.test.ts`) extension so Vitest's default `include: ['**\/*.{test,spec}.{ts,tsx}']`
 * glob ignores it and does not try to execute it as a test suite.
 */

export interface GraphFixture {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * 429 Too Many Requests — throttling response with a 10-second Retry-After.
 * Graph uses this on tenant / user quota exhaustion.
 */
export const canonical429Throttle: GraphFixture = {
  status: 429,
  headers: { 'retry-after': '10' },
  body: {
    error: {
      code: 'TooManyRequests',
      message: 'Rate limit is exceeded. Try again in 10 seconds.',
      innerError: {
        'request-id': 'c68a88d3-7d01-4deb-9a1e-6c2b1d4a5e8b',
        'client-request-id': 'c68a88d3-7d01-4deb-9a1e-6c2b1d4a5e8b',
        date: '2026-04-18T12:00:00',
      },
    },
  },
};

/**
 * 503 Service Unavailable — transient back-end outage.
 */
export const canonical503ServiceUnavailable: GraphFixture = {
  status: 503,
  headers: {},
  body: {
    error: {
      code: 'serviceNotAvailable',
      message: 'Service Unavailable',
      innerError: {
        'request-id': '11111111-2222-3333-4444-555555555555',
        date: '2026-04-18T12:00:00',
      },
    },
  },
};

/**
 * 412 Precondition Failed — ETag mismatch. The resource changed between the
 * caller's read and the conditional write.
 */
export const canonical412PreconditionFailed: GraphFixture = {
  status: 412,
  headers: { etag: '"aaaa-bbbb-cccc"' },
  body: {
    error: {
      code: 'resourceModified',
      message:
        'The ETag value provided does not match the current ETag value for this resource',
      innerError: {
        'request-id': '22222222-3333-4444-5555-666666666666',
        date: '2026-04-18T12:00:00',
      },
    },
  },
};

/**
 * 400 Bad Request — validation failure.
 */
export const canonical400ValidationError: GraphFixture = {
  status: 400,
  headers: {},
  body: {
    error: {
      code: 'invalidRequest',
      message: 'Invalid request',
      innerError: {
        'request-id': '33333333-4444-5555-6666-777777777777',
        'client-request-id': '33333333-4444-5555-6666-777777777777',
        date: '2026-04-18T12:00:00',
      },
    },
  },
};

/**
 * 500 Internal Server Error — generic Graph server exception.
 */
export const canonical500InternalServer: GraphFixture = {
  status: 500,
  headers: {},
  body: {
    error: {
      code: 'generalException',
      message: 'An error has occurred.',
      innerError: {
        'request-id': '44444444-5555-6666-7777-888888888888',
        date: '2026-04-18T12:00:00',
      },
    },
  },
};

/**
 * Construct a real `Response` instance from a fixture.
 *
 * Adds a `content-type: application/json` header when the fixture doesn't
 * specify one, so downstream middleware that calls `response.json()` always
 * sees a parseable body.
 */
export function toResponse(f: GraphFixture): Response {
  const headers = new Headers(f.headers);
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Response(JSON.stringify(f.body), { status: f.status, headers });
}
