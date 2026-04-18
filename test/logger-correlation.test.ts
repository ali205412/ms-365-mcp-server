/**
 * Tests for requestId / tenantId correlation threading (OPS-01).
 *
 * Requirement: OPS-01 — every log line within the same request lifespan must
 * carry the same requestId; concurrent requests must keep distinct requestIds.
 *
 * These tests MUST FAIL before the implementation is written (RED phase).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('logger-correlation: requestId threading (OPS-01)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('requestContext carries requestId visible in getRequestId()', async () => {
    const { requestContext, getRequestId } = await import('../src/request-context.js');

    let capturedId: string | undefined;

    await requestContext.run(
      { requestId: 'abc-123', tenantId: null, accessToken: 'tok' },
      async () => {
        capturedId = getRequestId();
      }
    );

    expect(capturedId).toBe('abc-123');
  });

  it('concurrent Promise.all keeps requestIds isolated', async () => {
    const { requestContext, getRequestId } = await import('../src/request-context.js');

    const results: Record<string, string | undefined> = {};

    const req1 = requestContext.run(
      { requestId: 'req-AAA', tenantId: null },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        results['req1'] = getRequestId();
      }
    );

    const req2 = requestContext.run(
      { requestId: 'req-BBB', tenantId: null },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        results['req2'] = getRequestId();
      }
    );

    const req3 = requestContext.run(
      { requestId: 'req-CCC', tenantId: null },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results['req3'] = getRequestId();
      }
    );

    await Promise.all([req1, req2, req3]);

    expect(results['req1']).toBe('req-AAA');
    expect(results['req2']).toBe('req-BBB');
    expect(results['req3']).toBe('req-CCC');
  });

  it('getRequestId returns undefined outside of requestContext.run()', async () => {
    const { getRequestId } = await import('../src/request-context.js');
    expect(getRequestId()).toBeUndefined();
  });

  it('RequestContext interface accepts requestId and tenantId fields', async () => {
    const { requestContext, getRequestTokens } = await import('../src/request-context.js');

    let captured: ReturnType<typeof getRequestTokens>;

    await requestContext.run(
      { requestId: 'test-id', tenantId: null, accessToken: undefined },
      async () => {
        captured = getRequestTokens();
      }
    );

    expect(captured?.requestId).toBe('test-id');
    expect(captured?.tenantId).toBeNull();
    // accessToken can be undefined — interface is now optional
    expect(captured?.accessToken).toBeUndefined();
  });
});
