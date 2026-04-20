/**
 * Plan 04-01 Task 1 — problem-json helper unit tests (D-14, RFC 7807).
 *
 * Tests for src/lib/admin/problem-json.ts. Covers:
 *   - Test 1: problemJson emits Content-Type application/problem+json with
 *             shape {type, title, status, detail} when detail provided.
 *   - Test 2: extensions spread into top-level body per RFC 7807 §3.2.
 *   - Test 3: shorthand helpers emit correct codes + statuses.
 *   - Test 4: no detail/instance/extensions → body has only {type, title, status}.
 *   - Test 5: detail pass-through (no sanitization in helper — call-site owns it).
 *
 * T-04-03a mitigation note: this test file documents that problem-json.ts does
 * NOT sanitize detail — that invariant is the contract downstream handlers
 * rely on when they sanitize before passing strings in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  problemJson,
  problemBadRequest,
  problemUnauthorized,
  problemForbidden,
  problemNotFound,
  problemConflict,
  problemPreconditionFailed,
  problemInternal,
} from '../problem-json.js';

/**
 * Fake Express Response with the tiny slice of the API problemJson touches.
 * status/type return `this` for chaining; json captures the body for assertions.
 */
function createMockResponse(): {
  status: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const res = {
    status: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('problemJson — core envelope', () => {
  it('Test 1: emits application/problem+json with full shape', () => {
    const res = createMockResponse();
    problemJson(res as never, 404, 'tenant_not_found', {
      title: 'Not Found',
      detail: 'Tenant x',
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.type).toHaveBeenCalledWith('application/problem+json');
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('https://docs.ms365mcp/errors/tenant_not_found');
    expect(body.title).toBe('Not Found');
    expect(body.status).toBe(404);
    expect(body.detail).toBe('Tenant x');
  });

  it('Test 2: extensions spread into top-level body (RFC 7807 §3.2)', () => {
    const res = createMockResponse();
    problemJson(res as never, 400, 'validation_failed', {
      title: 'Bad Request',
      extensions: { tenantId: 'abc', field: 'client_id' },
    });
    const body = res.json.mock.calls[0][0];
    expect(body.tenantId).toBe('abc');
    expect(body.field).toBe('client_id');
  });

  it('Test 4: minimal body has only {type, title, status}', () => {
    const res = createMockResponse();
    problemJson(res as never, 500, 'internal_error', { title: 'Error' });
    const body = res.json.mock.calls[0][0];
    const keys = Object.keys(body).sort();
    expect(keys).toEqual(['status', 'title', 'type']);
  });

  it('Test 5: detail pass-through — helper does NOT sanitize', () => {
    const res = createMockResponse();
    const raw = 'Error: select * from users failed at /path/to/file.ts:42';
    problemJson(res as never, 500, 'internal_error', {
      title: 'Internal',
      detail: raw,
    });
    const body = res.json.mock.calls[0][0];
    // This documents the contract: problem-json is a pass-through. Call-sites
    // must sanitize BEFORE passing detail in. Changing this would silently
    // break that contract for downstream handlers.
    expect(body.detail).toBe(raw);
  });

  it('includes instance when provided', () => {
    const res = createMockResponse();
    problemJson(res as never, 404, 'not_found', {
      title: 'Not Found',
      instance: 'req-id-abc',
    });
    const body = res.json.mock.calls[0][0];
    expect(body.instance).toBe('req-id-abc');
  });
});

describe('problemJson — shorthand helpers (Test 3)', () => {
  it('problemBadRequest → 400 with /bad_request type', () => {
    const res = createMockResponse();
    problemBadRequest(res as never, 'missing field');
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('https://docs.ms365mcp/errors/bad_request');
    expect(body.status).toBe(400);
    expect(body.detail).toBe('missing field');
  });

  it('problemUnauthorized → 401 with /unauthorized type', () => {
    const res = createMockResponse();
    problemUnauthorized(res as never);
    expect(res.status).toHaveBeenCalledWith(401);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('https://docs.ms365mcp/errors/unauthorized');
    expect(body.status).toBe(401);
  });

  it('problemForbidden → 403 with /forbidden type', () => {
    const res = createMockResponse();
    problemForbidden(res as never);
    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('https://docs.ms365mcp/errors/forbidden');
    expect(body.status).toBe(403);
  });

  it('problemNotFound → 404 with /not_found type, resource-aware detail', () => {
    const res = createMockResponse();
    problemNotFound(res as never, 'tenant', 'req-id');
    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('https://docs.ms365mcp/errors/not_found');
    expect(body.status).toBe(404);
    expect(body.detail).toBe('tenant not found');
    expect(body.instance).toBe('req-id');
  });

  it('problemConflict → 409 with /conflict type', () => {
    const res = createMockResponse();
    problemConflict(res as never, 'duplicate client_id');
    expect(res.status).toHaveBeenCalledWith(409);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('https://docs.ms365mcp/errors/conflict');
    expect(body.status).toBe(409);
    expect(body.detail).toBe('duplicate client_id');
  });

  it('problemPreconditionFailed → 412 with /precondition_failed type', () => {
    const res = createMockResponse();
    problemPreconditionFailed(res as never);
    expect(res.status).toHaveBeenCalledWith(412);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('https://docs.ms365mcp/errors/precondition_failed');
    expect(body.status).toBe(412);
  });

  it('problemInternal → 500 with /internal_error type (static title)', () => {
    const res = createMockResponse();
    problemInternal(res as never);
    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('https://docs.ms365mcp/errors/internal_error');
    expect(body.status).toBe(500);
    // Title must be static; must not leak request-specific detail.
    expect(body.title).toBeDefined();
  });
});
