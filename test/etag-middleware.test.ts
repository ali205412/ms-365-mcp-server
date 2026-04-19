/**
 * Tests for ETagMiddleware (Plan 02-07, MWARE-06).
 *
 * Validates the D-09 "opportunistic auto-attach" semantics:
 *   - Explicit caller-supplied If-Match / If-None-Match headers are forwarded
 *     verbatim (never overridden by the cache).
 *   - Auto-attach path: on PATCH/DELETE to a supported resource
 *     (DriveItem / Event / Message / Contact) where a prior GET surfaced an
 *     ETag, the middleware sets `If-Match: <cached-etag>` before forwarding.
 *   - Opt-out sentinel: explicit `If-Match: 'null'` strips the header AND
 *     skips auto-attach (D-09 escape hatch for advanced callers).
 *   - Scope lock: unsupported resources (e.g. /me/photo) pass through
 *     unchanged — no cache read, no cache write.
 *   - Cache refresh: successful GET on supported resource reads the ETag
 *     header and writes it to the module-level cache.
 *   - Integration with ODataErrorHandler: a 412 response surfaces as
 *     GraphConcurrencyError (the "resource changed" hint belongs to the
 *     GraphConcurrencyError constructor, per 02-03).
 *
 * Because the etagCache is module-level, each test that depends on cache
 * isolation calls `vi.resetModules()` + `await import(...)` to get a fresh
 * module instance. Pattern mirrored from 02-01 middleware-types test that
 * uses runtime import for module-resolution isolation.
 */
import { describe, it, expect, vi } from 'vitest';
import { canonical412PreconditionFailed, toResponse } from './fixtures/graph-responses.js';
import type { GraphRequest } from '../src/lib/middleware/types.js';
import type { GraphConcurrencyError } from '../src/lib/graph-errors.js';
import { requestContext } from '../src/request-context.js';

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function mkReq(overrides: Partial<GraphRequest>): GraphRequest {
  return {
    url: 'https://graph.microsoft.com/v1.0/me',
    method: 'GET',
    headers: {},
    ...overrides,
  };
}

describe('ETagMiddleware', () => {
  it('explicit If-Match header forwarded verbatim (no override from cache)', async () => {
    vi.resetModules();
    const { ETagMiddleware } = await import('../src/lib/middleware/etag.js');
    const mw = new ETagMiddleware();

    // Step A: seed cache via a prior GET that surfaces a different ETag.
    const getNext = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { ETag: 'W/"999"' },
      })
    );
    await requestContext.run({}, () =>
      mw.execute(
        mkReq({ url: 'https://graph.microsoft.com/v1.0/me/events/abc', method: 'GET' }),
        getNext
      )
    );

    // Step B: PATCH with an explicit If-Match — middleware must forward it
    // verbatim, NOT replace it with the cached value.
    const patchReq = mkReq({
      url: 'https://graph.microsoft.com/v1.0/me/events/abc',
      method: 'PATCH',
      headers: { 'If-Match': 'W/"123"' },
    });
    let captured: Record<string, string> = {};
    const patchNext = vi.fn().mockImplementation(async () => {
      captured = { ...patchReq.headers };
      return new Response(null, { status: 204 });
    });
    await requestContext.run({}, () => mw.execute(patchReq, patchNext));

    expect(captured['If-Match']).toBe('W/"123"');
  });

  it('auto-attach: prior GET caches ETag; subsequent PATCH picks it up', async () => {
    vi.resetModules();
    const { ETagMiddleware } = await import('../src/lib/middleware/etag.js');
    const mw = new ETagMiddleware();

    // Step A: GET surfaces an ETag.
    const getNext = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { ETag: 'W/"111"' },
      })
    );
    await requestContext.run({}, () =>
      mw.execute(
        mkReq({ url: 'https://graph.microsoft.com/v1.0/me/events/abc', method: 'GET' }),
        getNext
      )
    );

    // Step B: PATCH without an explicit If-Match — middleware should auto-attach
    // the cached ETag.
    const patchReq = mkReq({
      url: 'https://graph.microsoft.com/v1.0/me/events/abc',
      method: 'PATCH',
      headers: {},
    });
    let captured: Record<string, string> = {};
    const patchNext = vi.fn().mockImplementation(async () => {
      captured = { ...patchReq.headers };
      return new Response(null, { status: 204 });
    });
    await requestContext.run({}, () => mw.execute(patchReq, patchNext));

    expect(captured['If-Match']).toBe('W/"111"');
  });

  it('unsupported resource: pass through; no auto-attach', async () => {
    vi.resetModules();
    const { ETagMiddleware } = await import('../src/lib/middleware/etag.js');
    const mw = new ETagMiddleware();

    // /me/photo/$value is NOT in ETAG_SUPPORTED_PATTERNS — resourceKeyFromUrl
    // returns null; the middleware MUST NOT attempt cache read or write.
    const patchReq = mkReq({
      url: 'https://graph.microsoft.com/v1.0/me/photo/$value',
      method: 'PATCH',
      headers: {},
    });
    let captured: Record<string, string> = {};
    const patchNext = vi.fn().mockImplementation(async () => {
      captured = { ...patchReq.headers };
      return new Response(null, { status: 204 });
    });
    await requestContext.run({}, () => mw.execute(patchReq, patchNext));

    expect(captured['If-Match']).toBeUndefined();
  });

  it('opt-out via If-Match: "null" strips header and skips auto-attach', async () => {
    vi.resetModules();
    const { ETagMiddleware } = await import('../src/lib/middleware/etag.js');
    const mw = new ETagMiddleware();

    // Seed cache via prior GET so auto-attach WOULD fire if the opt-out sentinel
    // were ignored.
    await requestContext.run({}, () =>
      mw.execute(
        mkReq({ url: 'https://graph.microsoft.com/v1.0/me/events/abc', method: 'GET' }),
        vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { ETag: 'W/"222"' } }))
      )
    );

    // PATCH with the opt-out sentinel — middleware must strip the header AND
    // skip the auto-attach path (no cache read, no header replacement).
    const patchReq = mkReq({
      url: 'https://graph.microsoft.com/v1.0/me/events/abc',
      method: 'PATCH',
      headers: { 'If-Match': 'null' },
    });
    let captured: Record<string, string> = {};
    const patchNext = vi.fn().mockImplementation(async () => {
      captured = { ...patchReq.headers };
      return new Response(null, { status: 204 });
    });
    await requestContext.run({}, () => mw.execute(patchReq, patchNext));

    expect(captured['If-Match']).toBeUndefined();
  });
});

describe('ETagMiddleware integration with ODataErrorHandler', () => {
  it('412 from PATCH surfaces as GraphConcurrencyError with re-fetch hint', async () => {
    // Dynamic import for GraphConcurrencyError (VALUE, not just type) so the
    // class identity matches the one ODataErrorHandler's parseODataError uses
    // internally. Earlier tests in this file call vi.resetModules(); that
    // invalidates the module cache, so a statically-imported
    // GraphConcurrencyError from the top of the file would be a DIFFERENT
    // class identity than the one the middleware resolves at runtime — the
    // instanceof check would fail even when the thrown error IS the right
    // type. Resolving the value alongside the pipeline keeps them aligned.
    const { composePipeline } = await import('../src/lib/middleware/pipeline.js');
    const { ETagMiddleware } = await import('../src/lib/middleware/etag.js');
    const { ODataErrorHandler } = await import('../src/lib/middleware/odata-error.js');
    const { GraphConcurrencyError: GraphConcurrencyErrorClass } =
      await import('../src/lib/graph-errors.js');

    const terminal = vi.fn().mockResolvedValue(toResponse(canonical412PreconditionFailed));
    const pipeline = composePipeline([new ETagMiddleware(), new ODataErrorHandler()], terminal);

    let caught: unknown;
    try {
      await requestContext.run({}, () =>
        pipeline({
          url: 'https://graph.microsoft.com/v1.0/me/events/abc',
          method: 'PATCH',
          headers: { 'If-Match': 'W/"stale"' },
        })
      );
      throw new Error('expected pipeline to throw');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(GraphConcurrencyErrorClass);
    expect((caught as GraphConcurrencyError).message).toContain('resource changed');
  });
});

describe('resourceKeyFromUrl', () => {
  it('matches supported DriveItem / Event / Message / Contact paths', async () => {
    vi.resetModules();
    const { resourceKeyFromUrl } = await import('../src/lib/middleware/etag.js');
    expect(resourceKeyFromUrl('https://graph.microsoft.com/v1.0/me/events/abc')).toMatch(
      /\/me\/events\/abc/
    );
    expect(resourceKeyFromUrl('https://graph.microsoft.com/v1.0/me/messages/xyz')).toMatch(
      /\/me\/messages\/xyz/
    );
    expect(resourceKeyFromUrl('https://graph.microsoft.com/v1.0/me/drive/items/f1')).toMatch(
      /\/drive\/items\/f1/
    );
    expect(resourceKeyFromUrl('https://graph.microsoft.com/v1.0/users/u1/contacts/c2')).toMatch(
      /\/users\/u1\/contacts\/c2/
    );
    expect(resourceKeyFromUrl('https://graph.microsoft.com/v1.0/drives/b!abc/items/xyz')).toMatch(
      /\/drives\/b!abc\/items\/xyz/
    );
  });

  it('returns null for unsupported paths', async () => {
    vi.resetModules();
    const { resourceKeyFromUrl } = await import('../src/lib/middleware/etag.js');
    // /me/photo/$value — not ETag-aware per D-09 scope lock.
    expect(resourceKeyFromUrl('https://graph.microsoft.com/v1.0/me/photo/$value')).toBeNull();
    // List endpoint (no item id) — not an individual resource, cannot auto-attach.
    expect(resourceKeyFromUrl('https://graph.microsoft.com/v1.0/me/calendars')).toBeNull();
    // /me/drive is the parent drive, NOT an item.
    expect(resourceKeyFromUrl('https://graph.microsoft.com/v1.0/me/drive')).toBeNull();
  });
});

describe('ETagMiddleware in GraphClient pipeline', () => {
  it('full GraphClient pipeline includes ETagMiddleware as outermost', async () => {
    // Structural regression guard: read the GraphClient source directly and
    // assert the middleware-chain composition matches the locked
    // outermost-to-innermost order [ETag, Retry, ODataError, TokenRefresh]
    // per 02-CONTEXT.md Pattern E. A future refactor that reshuffles the
    // array will fail here rather than silently breaking
    // retry-after-Retry-After semantics or auto-attach header plumbing at
    // runtime.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve('src/graph-client.ts'), 'utf8');

    const pipelineBlockMatch = src.match(/composePipeline\(\s*\[(?<array>[\s\S]*?)\]/);
    expect(pipelineBlockMatch?.groups?.array).toBeDefined();
    const arrayText = pipelineBlockMatch!.groups!.array;

    const etagIdx = arrayText.indexOf('new ETagMiddleware');
    const retryIdx = arrayText.indexOf('new RetryHandler');
    const odataIdx = arrayText.indexOf('new ODataErrorHandler');
    const tokenRefreshIdx = arrayText.indexOf('new TokenRefreshMiddleware');

    expect(etagIdx).toBeGreaterThanOrEqual(0);
    expect(retryIdx).toBeGreaterThanOrEqual(0);
    expect(odataIdx).toBeGreaterThanOrEqual(0);
    expect(tokenRefreshIdx).toBeGreaterThanOrEqual(0);
    expect(etagIdx).toBeLessThan(retryIdx);
    expect(retryIdx).toBeLessThan(odataIdx);
    expect(odataIdx).toBeLessThan(tokenRefreshIdx);
  });
});
