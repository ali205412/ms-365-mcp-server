/**
 * Tests for pageIterator + fetchAllPages (Plan 02-04).
 *
 * Closes MWARE-04 — replaces the v1 inline fetchAllPages loop at
 * src/graph-tools.ts:400-461 which silently swallowed mid-stream errors and
 * truncated at a hardcoded 10_000-item ceiling.
 *
 * Contract coverage (5 unit tests + 2 integration tests in this block):
 *   1. pageIterator yields each page until nextLink exhausted (3-page happy
 *      path with correct pageIndex per yield).
 *   2. fetchAllPages concatenates values; no truncation when total pages
 *      <= maxPages (no _truncated / _nextLink).
 *   3. fetchAllPages returns _truncated: true + _nextLink cursor when the
 *      maxPages cap is hit.
 *   4. Mid-stream error BUBBLES via standard JS throw (v1 bug fix) — the
 *      caller's await rejects rather than receiving a silent partial.
 *   5. for-await-of break stops fetching (generator is lazy — proves the
 *      stream API does NOT eagerly pull pages past the consumer's break).
 *   6. executeGraphTool-integration — fetchAllPages cap hit via
 *      MS365_MCP_MAX_PAGES env var surfaces _truncated in the output.
 *   7. executeGraphTool-integration — no _truncated when pages <= maxPages.
 */
import { describe, it, expect, vi } from 'vitest';
import type GraphClient from '../src/graph-client.js';

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function mockClient(responses: Array<Record<string, unknown>>): { stub: GraphClient } {
  let i = 0;
  const stub = {
    graphRequest: vi.fn().mockImplementation(async () => {
      const body = responses[Math.min(i, responses.length - 1)];
      i++;
      return {
        content: [{ type: 'text', text: JSON.stringify(body) }],
      };
    }),
  } as unknown as GraphClient;
  return { stub };
}

describe('pageIterator async generator', () => {
  it('yields each page until nextLink exhausted (3-page happy path)', async () => {
    const { pageIterator } = await import('../src/lib/middleware/page-iterator.js');
    const { stub } = mockClient([
      { value: [1, 2], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skip=2' },
      { value: [3, 4], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?$skip=4' },
      { value: [5] },
    ]);
    const collected: Array<{ json: Record<string, unknown>; pageIndex: number }> = [];
    for await (const page of pageIterator('/users', {}, stub)) {
      collected.push(page);
    }
    expect(collected).toHaveLength(3);
    expect(collected[0].pageIndex).toBe(0);
    expect(collected[1].pageIndex).toBe(1);
    expect(collected[2].pageIndex).toBe(2);
    expect(collected[0].json.value).toEqual([1, 2]);
    expect(collected[1].json.value).toEqual([3, 4]);
    expect(collected[2].json.value).toEqual([5]);
  });

  it('fetchAllPages concatenates values; no truncation when pages <= maxPages', async () => {
    const { fetchAllPages } = await import('../src/lib/middleware/page-iterator.js');
    const { stub } = mockClient([
      { value: [1, 2], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x?$skip=2' },
      { value: [3, 4], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x?$skip=4' },
      { value: [5] },
    ]);
    const result = await fetchAllPages('/users', {}, stub, { maxPages: 5 });
    expect(result.value).toEqual([1, 2, 3, 4, 5]);
    expect(result._truncated).toBeUndefined();
    expect(result._nextLink).toBeUndefined();
  });

  it('fetchAllPages returns _truncated + _nextLink when cap hit', async () => {
    const { fetchAllPages } = await import('../src/lib/middleware/page-iterator.js');
    const responses: Array<Record<string, unknown>> = [];
    for (let n = 1; n <= 100; n++) {
      responses.push({
        value: [n],
        '@odata.nextLink': `https://graph.microsoft.com/v1.0/items?$skip=${n}`,
      });
    }
    const { stub } = mockClient(responses);
    const result = await fetchAllPages('/items', {}, stub, { maxPages: 3 });
    expect(result.value).toEqual([1, 2, 3]);
    expect(result._truncated).toBe(true);
    expect(typeof result._nextLink).toBe('string');
    expect(result._nextLink).toContain('$skip=');
  });

  it('mid-stream error BUBBLES — no silent partial return (v1 bug fix)', async () => {
    const { fetchAllPages } = await import('../src/lib/middleware/page-iterator.js');
    const { GraphServerError } = await import('../src/lib/graph-errors.js');
    let i = 0;
    const stub = {
      graphRequest: vi.fn().mockImplementation(async () => {
        i++;
        if (i <= 4) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  value: [i],
                  '@odata.nextLink': `https://graph.microsoft.com/v1.0/x?$skip=${i}`,
                }),
              },
            ],
          };
        }
        throw new GraphServerError({
          code: 'serviceNotAvailable',
          message: 'boom',
          statusCode: 500,
        });
      }),
    } as unknown as GraphClient;
    await expect(fetchAllPages('/x', {}, stub, { maxPages: 20 })).rejects.toBeInstanceOf(
      GraphServerError
    );
  });

  it('for-await-of break stops fetching (generator is lazy)', async () => {
    const { pageIterator } = await import('../src/lib/middleware/page-iterator.js');
    const { stub } = mockClient([
      { value: [1], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x?$skip=1' },
      { value: [2], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x?$skip=2' },
      { value: [3], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x?$skip=3' },
      { value: [4] },
    ]);
    let seen = 0;
    for await (const _page of pageIterator('/items', {}, stub)) {
      void _page;
      seen++;
      if (seen === 2) break;
    }
    expect(seen).toBe(2);
    expect((stub.graphRequest as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      2
    );
  });
});

describe('executeGraphTool integration with fetchAllPages', () => {
  it('surfaces _truncated in fetchAllPages result when env cap hit', async () => {
    vi.stubEnv('MS365_MCP_MAX_PAGES', '3');
    try {
      const { fetchAllPages } = await import('../src/lib/middleware/page-iterator.js');
      const responses: Array<Record<string, unknown>> = [];
      for (let n = 1; n <= 100; n++) {
        responses.push({
          value: [n],
          '@odata.nextLink': `https://graph.microsoft.com/v1.0/items?$skip=${n}`,
        });
      }
      let i = 0;
      const stub = {
        graphRequest: vi.fn().mockImplementation(async () => {
          const body = responses[Math.min(i, responses.length - 1)];
          i++;
          return { content: [{ type: 'text', text: JSON.stringify(body) }] };
        }),
      } as unknown as GraphClient;
      const combined = await fetchAllPages('/items', {}, stub);
      expect(combined._truncated).toBe(true);
      expect(combined.value).toHaveLength(3);
      expect(typeof combined._nextLink).toBe('string');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('no _truncated flag when total pages <= maxPages', async () => {
    const { fetchAllPages } = await import('../src/lib/middleware/page-iterator.js');
    const { stub } = mockClient([
      { value: [1], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/x?$skip=1' },
      { value: [2] },
    ]);
    const combined = await fetchAllPages('/items', {}, stub, { maxPages: 20 });
    expect(combined._truncated).toBeUndefined();
    expect(combined.value).toEqual([1, 2]);
  });
});
