import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { requestLogProps } from '../src/lib/request-log-props.js';
import { requestContext } from '../src/request-context.js';

describe('requestLogProps', () => {
  it('returns only scalar request and tenant identifiers from the request', () => {
    const req = {
      id: 'req-123',
      tenant: {
        id: 'tenant-abc',
        client_secret_ref: 'secret-ref-must-not-log',
        wrapped_dek: { ciphertext: 'encrypted-key-must-not-log' },
      },
      headers: { authorization: 'Bearer token-must-not-log' },
      body: { client_secret: 'body-secret-must-not-log' },
    } as unknown as Request;

    const props = requestLogProps(req);

    expect(props).toEqual({ requestId: 'req-123', tenantId: 'tenant-abc' });
    expect(Object.keys(props).sort()).toEqual(['requestId', 'tenantId']);
  });

  it('falls back to the async request context tenant id', () => {
    const props = requestContext.run({ tenantId: 'tenant-from-context' }, () =>
      requestLogProps({ id: 'req-456' } as unknown as Request)
    );

    expect(props).toEqual({ requestId: 'req-456', tenantId: 'tenant-from-context' });
  });

  it('uses null for non-string or empty identifiers', () => {
    const props = requestLogProps({ id: 123, tenant: { id: '' } } as unknown as Request);

    expect(props).toEqual({ requestId: null, tenantId: null });
  });
});
