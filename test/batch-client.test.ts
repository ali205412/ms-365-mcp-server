/**
 * Tests for BatchClient + batch() helper (Plan 02-05).
 *
 * Contract coverage:
 *   1. batch() validates the 20-sub-request cap at entry (T-02-05a anti-DoS).
 *   2. batch() enforces relative-URL-only SSRF guard — absolute URLs (http://,
 *      https://, //, file://) REJECTED at validation time, before any fetch.
 *   3. batch() detects dependsOn cycles (A -> B -> A) and throws before POST.
 *   4. batch() sends a single POST /$batch with the correct envelope shape
 *      (requests array with id/method/url/body/headers/dependsOn preserved).
 *   5. Per-sub-request isolation — one sub-request failing (4xx/5xx) does NOT
 *      reject the batch; successes + typed errors are returned per-item.
 *   6. Per-sub-request error parsing uses parseODataError from 02-03 — the
 *      returned error field is a typed GraphError subclass by statusCode.
 *   7. Empty requests array is rejected (no-op batch is a caller bug).
 *   8. dependsOn referencing an unknown id is rejected.
 *   9. The POST /$batch goes through the full middleware chain — the client's
 *      graphRequest is called exactly once with POST method and JSON body.
 *  10. Sub-request order is preserved in the output regardless of response
 *      order from Graph (Graph may re-order when dependsOn is absent).
 *
 * Logger is mocked so the test suite does not depend on pino bootstrap.
 */
import { describe, it, expect, vi } from 'vitest';
import type GraphClient from '../src/graph-client.js';

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface BatchRequestItem {
  id: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  dependsOn?: string[];
}

interface BatchResponseItem {
  id: string;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Build a mock GraphClient whose graphRequest resolves with a canned $batch
 * response envelope. Captures the arguments so tests can assert the outbound
 * envelope shape.
 */
function mockBatchClient(responses: BatchResponseItem[]): {
  stub: GraphClient;
  calls: Array<{ path: string; options: Record<string, unknown> }>;
} {
  const calls: Array<{ path: string; options: Record<string, unknown> }> = [];
  const stub = {
    graphRequest: vi
      .fn()
      .mockImplementation(async (path: string, options: Record<string, unknown>) => {
        calls.push({ path, options });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ responses }),
            },
          ],
        };
      }),
  } as unknown as GraphClient;
  return { stub, calls };
}

describe('batch() helper — validation', () => {
  it('rejects more than 20 sub-requests (T-02-05a anti-DoS cap)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [];
    for (let i = 1; i <= 21; i++) {
      requests.push({ id: String(i), method: 'GET', url: `/users/${i}` });
    }
    await expect(batch(requests, stub)).rejects.toThrow(/20/);
  });

  it('accepts exactly 20 sub-requests (boundary)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const fakeResponses: BatchResponseItem[] = [];
    const requests: BatchRequestItem[] = [];
    for (let i = 1; i <= 20; i++) {
      requests.push({ id: String(i), method: 'GET', url: `/users/${i}` });
      fakeResponses.push({ id: String(i), status: 200, body: { id: i } });
    }
    const { stub } = mockBatchClient(fakeResponses);
    const out = await batch(requests, stub);
    expect(out).toHaveLength(20);
  });

  it('rejects empty requests array', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    await expect(batch([], stub)).rejects.toThrow(/empty|at least/i);
  });

  it('rejects absolute http URL (SSRF guard)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: 'http://attacker.example.com/exfil' },
    ];
    await expect(batch(requests, stub)).rejects.toThrow(/relative|absolute/i);
  });

  it('rejects absolute https URL (SSRF guard)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: 'https://attacker.example.com/exfil' },
    ];
    await expect(batch(requests, stub)).rejects.toThrow(/relative|absolute/i);
  });

  it('rejects protocol-relative URL (//host/path) SSRF guard', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '//attacker.example.com' },
    ];
    await expect(batch(requests, stub)).rejects.toThrow(/relative|absolute/i);
  });

  it('rejects file:// scheme URL (SSRF guard)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [{ id: '1', method: 'GET', url: 'file:///etc/passwd' }];
    await expect(batch(requests, stub)).rejects.toThrow(/relative|absolute/i);
  });

  it('accepts relative URL starting with /', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([{ id: '1', status: 200, body: { ok: true } }]);
    const requests: BatchRequestItem[] = [{ id: '1', method: 'GET', url: '/me' }];
    const out = await batch(requests, stub);
    expect(out[0].status).toBe(200);
  });

  it('rejects duplicate sub-request ids', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '/me' },
      { id: '1', method: 'GET', url: '/me/messages' },
    ];
    await expect(batch(requests, stub)).rejects.toThrow(/duplicate|unique/i);
  });

  it('rejects dependsOn referencing an unknown id', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '/me', dependsOn: ['99'] },
    ];
    await expect(batch(requests, stub)).rejects.toThrow(/unknown|undefined|dependsOn/i);
  });

  it('rejects self-reference in dependsOn (trivial cycle)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [{ id: '1', method: 'GET', url: '/me', dependsOn: ['1'] }];
    await expect(batch(requests, stub)).rejects.toThrow(/cycle/i);
  });

  it('rejects 2-node cycle in dependsOn (A -> B -> A)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '/me', dependsOn: ['2'] },
      { id: '2', method: 'GET', url: '/me/messages', dependsOn: ['1'] },
    ];
    await expect(batch(requests, stub)).rejects.toThrow(/cycle/i);
  });

  it('rejects 3-node cycle in dependsOn (A -> B -> C -> A)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const requests: BatchRequestItem[] = [
      { id: 'a', method: 'GET', url: '/me', dependsOn: ['c'] },
      { id: 'b', method: 'GET', url: '/me/messages', dependsOn: ['a'] },
      { id: 'c', method: 'GET', url: '/me/events', dependsOn: ['b'] },
    ];
    await expect(batch(requests, stub)).rejects.toThrow(/cycle/i);
  });

  it('accepts valid linear dependsOn chain (A -> B -> C, no cycle)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([
      { id: 'a', status: 200, body: {} },
      { id: 'b', status: 200, body: {} },
      { id: 'c', status: 200, body: {} },
    ]);
    const requests: BatchRequestItem[] = [
      { id: 'a', method: 'GET', url: '/me' },
      { id: 'b', method: 'GET', url: '/me/messages', dependsOn: ['a'] },
      { id: 'c', method: 'GET', url: '/me/events', dependsOn: ['b'] },
    ];
    const out = await batch(requests, stub);
    expect(out).toHaveLength(3);
  });

  it('accepts diamond-shaped DAG (A -> B, A -> C, B+C -> D) with no cycle', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([
      { id: 'a', status: 200, body: {} },
      { id: 'b', status: 200, body: {} },
      { id: 'c', status: 200, body: {} },
      { id: 'd', status: 200, body: {} },
    ]);
    const requests: BatchRequestItem[] = [
      { id: 'a', method: 'GET', url: '/me' },
      { id: 'b', method: 'GET', url: '/me/messages', dependsOn: ['a'] },
      { id: 'c', method: 'GET', url: '/me/events', dependsOn: ['a'] },
      { id: 'd', method: 'GET', url: '/me/drive', dependsOn: ['b', 'c'] },
    ];
    const out = await batch(requests, stub);
    expect(out).toHaveLength(4);
  });
});

describe('batch() helper — envelope + transport', () => {
  it('sends a single POST /$batch with the correct envelope shape', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub, calls } = mockBatchClient([
      { id: '1', status: 200, body: { id: 'me' } },
      { id: '2', status: 200, body: { value: [] } },
    ]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '/me' },
      { id: '2', method: 'GET', url: '/me/messages?$top=5', dependsOn: ['1'] },
    ];
    await batch(requests, stub);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/$batch');
    expect(calls[0].options.method).toBe('POST');
    const body = JSON.parse(calls[0].options.body as string);
    expect(Array.isArray(body.requests)).toBe(true);
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]).toMatchObject({ id: '1', method: 'GET', url: '/me' });
    expect(body.requests[1]).toMatchObject({
      id: '2',
      method: 'GET',
      url: '/me/messages?$top=5',
      dependsOn: ['1'],
    });
  });

  it('goes through the middleware chain (graphRequest called exactly once)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([
      { id: '1', status: 200, body: {} },
      { id: '2', status: 200, body: {} },
    ]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '/me' },
      { id: '2', method: 'GET', url: '/me/messages' },
    ];
    await batch(requests, stub);
    expect((stub.graphRequest as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      1
    );
  });

  it('sets Content-Type: application/json on the outbound POST', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub, calls } = mockBatchClient([{ id: '1', status: 200, body: {} }]);
    await batch([{ id: '1', method: 'GET', url: '/me' }], stub);
    const headers = calls[0].options.headers as Record<string, string>;
    const contentType = headers?.['Content-Type'] || headers?.['content-type'];
    expect(contentType).toBe('application/json');
  });
});

describe('batch() helper — per-sub-request isolation', () => {
  it('returns per-item results in REQUEST order regardless of Graph response order', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    // Graph may return sub-responses in any order; the helper must re-sort by id.
    const { stub } = mockBatchClient([
      { id: '3', status: 200, body: { n: 3 } },
      { id: '1', status: 200, body: { n: 1 } },
      { id: '2', status: 200, body: { n: 2 } },
    ]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '/me' },
      { id: '2', method: 'GET', url: '/users' },
      { id: '3', method: 'GET', url: '/groups' },
    ];
    const out = await batch(requests, stub);
    expect(out[0].id).toBe('1');
    expect(out[1].id).toBe('2');
    expect(out[2].id).toBe('3');
  });

  it('one failing sub-request does NOT reject the batch (per-item isolation)', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([
      { id: '1', status: 200, body: { ok: true } },
      {
        id: '2',
        status: 404,
        body: {
          error: {
            code: 'itemNotFound',
            message: 'Not found',
            innerError: { 'request-id': 'req-2', date: '2026-04-18T12:00:00' },
          },
        },
      },
      { id: '3', status: 201, body: { created: true } },
    ]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '/me' },
      { id: '2', method: 'GET', url: '/users/does-not-exist' },
      { id: '3', method: 'POST', url: '/me/events', body: {} },
    ];
    const out = await batch(requests, stub);
    expect(out).toHaveLength(3);
    expect(out[0].status).toBe(200);
    expect(out[0].error).toBeUndefined();
    expect(out[1].status).toBe(404);
    expect(out[1].error).toBeDefined();
    expect(out[2].status).toBe(201);
    expect(out[2].error).toBeUndefined();
  });

  it('surfaces a typed GraphError (by statusCode) on each failing sub-request', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { GraphThrottleError, GraphServerError, GraphValidationError } =
      await import('../src/lib/graph-errors.js');
    const { stub } = mockBatchClient([
      {
        id: 'throttled',
        status: 429,
        headers: { 'Retry-After': '10' },
        body: {
          error: {
            code: 'TooManyRequests',
            message: 'throttled',
            innerError: { 'request-id': 'rid-throttled' },
          },
        },
      },
      {
        id: 'server',
        status: 500,
        body: {
          error: {
            code: 'generalException',
            message: 'boom',
            innerError: { 'request-id': 'rid-server' },
          },
        },
      },
      {
        id: 'invalid',
        status: 400,
        body: {
          error: {
            code: 'invalidRequest',
            message: 'bad',
            innerError: { 'request-id': 'rid-invalid' },
          },
        },
      },
    ]);
    const requests: BatchRequestItem[] = [
      { id: 'throttled', method: 'GET', url: '/me' },
      { id: 'server', method: 'GET', url: '/users' },
      { id: 'invalid', method: 'POST', url: '/me/events', body: {} },
    ];
    const out = await batch(requests, stub);
    expect(out[0].error).toBeInstanceOf(GraphThrottleError);
    expect(out[0].error?.retryAfterMs).toBe(10_000);
    expect(out[0].error?.requestId).toBe('rid-throttled');
    expect(out[1].error).toBeInstanceOf(GraphServerError);
    expect(out[2].error).toBeInstanceOf(GraphValidationError);
  });

  it('returns body for 2xx and both status + error for non-2xx', async () => {
    const { batch } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([
      { id: '1', status: 200, body: { userId: 'abc' } },
      {
        id: '2',
        status: 403,
        body: {
          error: {
            code: 'Forbidden',
            message: 'denied',
            innerError: { 'request-id': 'r2' },
          },
        },
      },
    ]);
    const requests: BatchRequestItem[] = [
      { id: '1', method: 'GET', url: '/me' },
      { id: '2', method: 'GET', url: '/admin' },
    ];
    const out = await batch(requests, stub);
    expect(out[0].body).toEqual({ userId: 'abc' });
    expect(out[0].status).toBe(200);
    expect(out[1].status).toBe(403);
    expect(out[1].error?.statusCode).toBe(403);
    expect(out[1].error?.requestId).toBe('r2');
  });
});

describe('BatchClient class wrapping batch()', () => {
  it('BatchClient.submit delegates to batch() with the injected graph client', async () => {
    const { BatchClient } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([
      { id: '1', status: 200, body: { ok: true } },
      { id: '2', status: 200, body: { count: 0 } },
    ]);
    const client = new BatchClient(stub);
    const out = await client.submit([
      { id: '1', method: 'GET', url: '/me' },
      { id: '2', method: 'GET', url: '/me/messages' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].status).toBe(200);
    expect(out[1].status).toBe(200);
  });

  it('BatchClient propagates validation errors (not instanceof GraphError)', async () => {
    const { BatchClient } = await import('../src/lib/middleware/batch.js');
    const { stub } = mockBatchClient([]);
    const client = new BatchClient(stub);
    await expect(client.submit([])).rejects.toThrow(/empty|at least/i);
  });
});
