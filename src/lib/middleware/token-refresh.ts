/**
 * TokenRefreshMiddleware — innermost participant in the Graph pipeline
 * (Plan 02-01).
 *
 * Preserves v1 401-refresh semantics extracted from src/graph-client.ts
 * (Phase 1 lines 143-150 + 222-248). On a 401 response, attempts a single
 * refresh of the access token via `refreshAccessToken` (the underlying
 * OAuth 2.0 refresh-token grant helper from src/lib/microsoft-auth.ts) and
 * retries the request ONCE with the new bearer. Any further 401 from the
 * retry is propagated as-is — callers (02-03 ODataErrorHandler) surface it
 * as a typed GraphAuthError.
 *
 * Ordering: TokenRefresh sits INNERMOST in the chain. The outer middlewares
 * (ETag 02-07, Retry 02-02, ODataError 02-03) see the POST-refresh response,
 * not the raw 401. This is deliberate — refresh is a transport concern
 * orthogonal to retry logic and belongs before the fetch() call returns.
 *
 * Security (T-02-01c): the middleware logs via the pino logger and NEVER
 * via console.*. D-01 STRICT redaction (Phase 1 plan 01-02) redacts
 * `req.headers.authorization` + `*.access_token` + `*.refresh_token` before
 * any transport writes them, so even if a log message ever captured a raw
 * request object the bearer would never reach disk.
 */

import { trace } from '@opentelemetry/api';
import logger from '../../logger.js';
import { refreshAccessToken } from '../microsoft-auth.js';
import { requestContext } from '../../request-context.js';
import type AuthManager from '../../auth.js';
import type { AppSecrets } from '../../secrets.js';
import type { GraphMiddleware, GraphRequest } from './types.js';

const tracer = trace.getTracer('graph-middleware');

export class TokenRefreshMiddleware implements GraphMiddleware {
  readonly name = 'token-refresh';

  constructor(
    private readonly authManager: AuthManager,
    private readonly secrets: AppSecrets
  ) {}

  async execute(req: GraphRequest, next: () => Promise<Response>): Promise<Response> {
    return tracer.startActiveSpan('graph.middleware.token-refresh', async (span) => {
      try {
        let response = await next();
        if (response.status !== 401) return response;

        const ctx = requestContext.getStore();
        const refreshToken = ctx?.refreshToken;
        if (!refreshToken) return response; // No refresh available — propagate 401

        const tenantId = this.secrets.tenantId || 'common';
        const clientId = this.secrets.clientId;
        const clientSecret = this.secrets.clientSecret;

        if (clientSecret) {
          logger.info('TokenRefresh: refreshing with confidential client');
        } else {
          logger.info('TokenRefresh: refreshing with public client');
        }

        const tokens = await refreshAccessToken(
          refreshToken,
          clientId,
          clientSecret,
          tenantId,
          this.secrets.cloudType
        );

        // Swap bearer in-place; retry once.
        req.headers.Authorization = `Bearer ${tokens.access_token}`;
        response = await next();
        return response;
      } finally {
        span.end();
      }
    });
  }
}
