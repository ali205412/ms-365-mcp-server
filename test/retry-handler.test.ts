/**
 * Tests for RetryHandler middleware (Plan 02-02).
 *
 * Closes MWARE-01 (Retry-After + 429) and MWARE-02 (transient 5xx retry) per
 * D-05. RetryHandler sits OUTSIDE ODataErrorHandler (02-03) in the pipeline;
 * it catches GraphError subclasses on retryable statuses (408 / 429 / 500 /
 * 502 / 503 / 504) and re-dispatches. 401 is NOT retried here — that is
 * TokenRefreshMiddleware's responsibility (02-01, innermost).
 *
 * Contract coverage (8 unit tests in this block):
 *   1. Retry-After seconds honored verbatim (clamped to RETRY_AFTER_MAX_MS).
 *   2. Retry-After HTTP-date form parsed correctly.
 *   3. Full jitter within [0, min(cap, base * 2^attempt)] when Retry-After absent.
 *   4. Max attempts exhausted — propagate final response unchanged.
 *   5. 408/500/502/504 each trigger a retry (parameterized).
 *   6. 503 retries with full-jitter backoff.
 *   7. 401 passes through without retry (TokenRefreshMiddleware owns 401).
 *   8. POST idempotency gate: 503 no-retry, 429 retries, 503+Idempotency-Key retries.
 *
 * Fake timers (vi.useFakeTimers) are used so tests never actually sleep the
 * jitter window. vi.setSystemTime locks the clock for HTTP-date assertions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { RetryHandler } from '../src/lib/middleware/retry.js';
import type { GraphRequest } from '../src/lib/middleware/types.js';
import { requestContext } from '../src/request-context.js';
import {
  canonical429Throttle,
  canonical503ServiceUnavailable,
  toResponse,
} from './fixtures/graph-responses.js';

function mkReq(overrides: Partial<GraphRequest> = {}): GraphRequest {
  return {
    url: 'https://graph.microsoft.com/v1.0/me',
    method: 'GET',
    headers: {},
    ...overrides,
  };
}

describe('RetryHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('honors Retry-After seconds verbatim (clamped to max)', async () => {
    const mw = new RetryHandler();
    const resp429 = new Response(JSON.stringify(canonical429Throttle.body), {
      status: 429,
      headers: { 'retry-after': '10', 'content-type': 'application/json' },
    });
    const resp200 = new Response(null, { status: 200 });
    let call = 0;
    const next = vi.fn().mockImplementation(async () => (++call === 1 ? resp429 : resp200));

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const execPromise = requestContext.run({}, () => mw.execute(mkReq(), next));
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await execPromise;

    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(2);
    const delayArg = setTimeoutSpy.mock.calls[0][1] as number;
    expect(delayArg).toBeGreaterThanOrEqual(9_990);
    expect(delayArg).toBeLessThanOrEqual(10_010);
  });

  it('parses Retry-After HTTP-date form', async () => {
    const mw = new RetryHandler();
    const now = new Date('2026-04-18T12:00:00Z');
    vi.setSystemTime(now);
    const futureDate = new Date('2026-04-18T12:00:05Z').toUTCString();
    const resp429 = new Response(JSON.stringify(canonical429Throttle.body), {
      status: 429,
      headers: { 'retry-after': futureDate, 'content-type': 'application/json' },
    });
    const resp200 = new Response(null, { status: 200 });
    let call = 0;
    const next = vi.fn().mockImplementation(async () => (++call === 1 ? resp429 : resp200));

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const execPromise = requestContext.run({}, () => mw.execute(mkReq(), next));
    await vi.advanceTimersByTimeAsync(5_000);
    await execPromise;

    const delayArg = setTimeoutSpy.mock.calls[0][1] as number;
    expect(delayArg).toBeGreaterThanOrEqual(4_900);
    expect(delayArg).toBeLessThanOrEqual(5_100);
  });

  it('uses full jitter within [0, min(cap, base*2^attempt)] when Retry-After absent', async () => {
    const mw = new RetryHandler();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const resp503 = toResponse(canonical503ServiceUnavailable);
    const resp200 = new Response(null, { status: 200 });
    let call = 0;
    const next = vi.fn().mockImplementation(async () => (++call === 1 ? resp503 : resp200));

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const execPromise = requestContext.run({}, () => mw.execute(mkReq(), next));
    await vi.runAllTimersAsync();
    await execPromise;

    // attempt 0: window = min(30000, 500 * 2^0) = 500; Math.floor(0.5 * 500) = 250
    expect(setTimeoutSpy.mock.calls[0][1]).toBe(250);
  });

  it('exhausts max attempts and propagates final response', async () => {
    vi.stubEnv('MS365_MCP_RETRY_MAX_ATTEMPTS', '2');
    const mw = new RetryHandler();
    const next = vi.fn().mockImplementation(async () => toResponse(canonical503ServiceUnavailable));
    const execPromise = requestContext.run({}, () => mw.execute(mkReq(), next));
    await vi.runAllTimersAsync();
    const res = await execPromise;

    expect(res.status).toBe(503);
    // attempts: 0, 1, 2 (max is 2, so total calls = 3 — attempt 0 plus 2 retries)
    expect(next).toHaveBeenCalledTimes(3);
  });

  it.each([408, 500, 502, 504])('retries on retryable status %i', async (status) => {
    const mw = new RetryHandler();
    const resp200 = new Response(null, { status: 200 });
    let call = 0;
    const next = vi.fn().mockImplementation(async () => {
      call++;
      return call === 1
        ? new Response('{}', { status, headers: { 'content-type': 'application/json' } })
        : resp200;
    });
    const execPromise = requestContext.run({}, () => mw.execute(mkReq(), next));
    await vi.runAllTimersAsync();
    const res = await execPromise;

    expect(res.status).toBe(200);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('retries 503 with full-jitter backoff (non-negative delay ≤ cap)', async () => {
    const mw = new RetryHandler();
    const resp503 = toResponse(canonical503ServiceUnavailable);
    const resp200 = new Response(null, { status: 200 });
    let call = 0;
    const next = vi.fn().mockImplementation(async () => (++call === 1 ? resp503 : resp200));

    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const execPromise = requestContext.run({}, () => mw.execute(mkReq(), next));
    await vi.runAllTimersAsync();
    await execPromise;

    expect(setTimeoutSpy).toHaveBeenCalled();
    const delay = setTimeoutSpy.mock.calls[0][1] as number;
    expect(delay).toBeGreaterThanOrEqual(0);
    expect(delay).toBeLessThanOrEqual(30_000);
  });

  it('passes 401 through without retry (TokenRefreshMiddleware owns 401 path)', async () => {
    const mw = new RetryHandler();
    const resp401 = new Response('{}', { status: 401 });
    const next = vi.fn().mockImplementation(async () => resp401);
    const res = await requestContext.run({}, () => mw.execute(mkReq(), next));

    expect(res.status).toBe(401);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry POST 503 (idempotency gate); DOES retry POST 429; retries POST 503 with Idempotency-Key', async () => {
    const mw = new RetryHandler();

    // 8a: POST 503 — no retry (writes without Idempotency-Key only retry on 429).
    const next1 = vi.fn().mockImplementation(async () => toResponse(canonical503ServiceUnavailable));
    const r1 = await requestContext.run({}, () => mw.execute(mkReq({ method: 'POST' }), next1));
    expect(r1.status).toBe(503);
    expect(next1).toHaveBeenCalledTimes(1);

    // 8b: POST 429 — retries (server signal).
    let call2 = 0;
    const next2 = vi.fn().mockImplementation(async () =>
      ++call2 === 1 ? toResponse(canonical429Throttle) : new Response(null, { status: 200 })
    );
    const exec2 = requestContext.run({}, () => mw.execute(mkReq({ method: 'POST' }), next2));
    await vi.runAllTimersAsync();
    const r2 = await exec2;
    expect(r2.status).toBe(200);
    expect(next2).toHaveBeenCalledTimes(2);

    // 8c: POST 503 WITH Idempotency-Key — caller opts into write retries.
    let call3 = 0;
    const next3 = vi.fn().mockImplementation(async () =>
      ++call3 === 1
        ? toResponse(canonical503ServiceUnavailable)
        : new Response(null, { status: 200 })
    );
    const exec3 = requestContext.run({}, () =>
      mw.execute(mkReq({ method: 'POST', headers: { 'Idempotency-Key': 'test-key-123' } }), next3)
    );
    await vi.runAllTimersAsync();
    const r3 = await exec3;
    expect(r3.status).toBe(200);
    expect(next3).toHaveBeenCalledTimes(2);
  });
});
