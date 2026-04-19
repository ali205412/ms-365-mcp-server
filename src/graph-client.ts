import logger from './logger.js';
import AuthManager from './auth.js';
import { encode as toonEncode } from '@toon-format/toon';
import type { AppSecrets } from './secrets.js';
import { getCloudEndpoints } from './cloud-config.js';
import { getRequestTokens } from './request-context.js';
import { composePipeline } from './lib/middleware/pipeline.js';
import { TokenRefreshMiddleware } from './lib/middleware/token-refresh.js';
import { ODataErrorHandler } from './lib/middleware/odata-error.js';
import { RetryHandler } from './lib/middleware/retry.js';
import { ETagMiddleware } from './lib/middleware/etag.js';
import { GraphError } from './lib/graph-errors.js';
import type { GraphRequest } from './lib/middleware/types.js';
import type { RedisClient } from './lib/redis.js';
import type { TenantRow } from './lib/tenant/tenant-row.js';
import type { TenantPool } from './lib/tenant/tenant-pool.js';
import { SessionStore } from './lib/session-store.js';

/**
 * Maximum recursion depth for `removeODataProps`. A well-formed Graph response
 * is shallow (typically < 10 levels); 100 is a comfortable safety ceiling that
 * guards against pathological or adversarial payloads stack-overflowing the
 * process. Deeper levels are silently truncated — the caller gets the top-100
 * layers with @odata.* stripped and the rest passed through as-is.
 */
const MAX_REMOVE_ODATA_DEPTH = 100;

/**
 * Recursively strip `@odata.*` properties from a Graph response, preserving
 * `@odata.nextLink` (pagination contract — see test/odata-nextlink.test.ts).
 *
 * Depth-guarded at MAX_REMOVE_ODATA_DEPTH and cycle-guarded via a WeakSet so
 * self-referencing payloads (malicious or buggy upstream responses) cannot
 * stack-overflow the Node runtime (T-01-09a DoS mitigation).
 *
 * Returns a new object; does not mutate `obj`. Primitives pass through
 * unchanged. Arrays are mapped element-wise.
 *
 * Formerly defined as two inline `const` declarations inside
 * `formatJsonResponse` (src/graph-client.ts lines 303-313 and 339-349 in
 * v1) — hoisted to a single module-level implementation by Plan 01-09.
 */
export function removeODataProps<T>(obj: T, depth = 0, seen: WeakSet<object> = new WeakSet()): T {
  if (depth > MAX_REMOVE_ODATA_DEPTH) return obj;
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (seen.has(obj as object)) return obj;
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map((item) => removeODataProps(item, depth + 1, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key.startsWith('@odata.') && key !== '@odata.nextLink') continue;
    result[key] = removeODataProps(value, depth + 1, seen);
  }
  return result as T;
}

/**
 * Returns true if the given HTTP Content-Type header indicates a binary
 * payload that must not be decoded as UTF-8 text. Graph returns binary for
 * endpoints like /me/photo/$value, /chats/.../hostedContents/{id}/$value, and
 * /drives/.../items/{id}/content, among others.
 */
export function isBinaryContentType(contentType: string): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase().split(';')[0].trim();
  if (!lower) return false;
  if (
    lower.startsWith('image/') ||
    lower.startsWith('video/') ||
    lower.startsWith('audio/') ||
    lower.startsWith('font/')
  ) {
    return true;
  }
  if (lower === 'application/octet-stream' || lower === 'application/pdf') {
    return true;
  }
  if (lower.startsWith('application/zip') || lower.startsWith('application/x-zip')) {
    return true;
  }
  // Office document MIME types and other vendor-specific binary formats.
  if (lower.startsWith('application/vnd.') || lower.startsWith('application/x-')) {
    // Be conservative: exclude MIME types that use the structured-syntax suffix
    // to declare a text serialization (e.g. application/vnd.api+json).
    if (lower.endsWith('+json') || lower.endsWith('+xml') || lower.endsWith('+text')) {
      return false;
    }
    return true;
  }
  return false;
}

interface GraphRequestOptions {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
  rawResponse?: boolean;
  includeHeaders?: boolean;
  excludeResponse?: boolean;
  accessToken?: string;
  refreshToken?: string;

  [key: string]: unknown;
}

interface ContentItem {
  type: 'text';
  text: string;

  [key: string]: unknown;
}

interface McpResponse {
  content: ContentItem[];
  _meta?: Record<string, unknown>;
  isError?: boolean;

  [key: string]: unknown;
}

class GraphClient {
  private authManager: AuthManager;
  private secrets: AppSecrets;
  private readonly outputFormat: 'json' | 'toon' = 'json';
  /**
   * Phase 2 middleware pipeline. Middlewares compose outer-to-inner; the
   * terminal handler performs the raw `fetch()` call. Subsequent Phase 2 plans
   * slot their middleware into the array in the specified order (see
   * 02-CONTEXT.md Pattern E "Chain Ordering Invariant"). Order is
   * load-bearing; changes here require a test update.
   */
  private readonly pipeline: (req: GraphRequest) => Promise<Response>;

  constructor(
    authManager: AuthManager,
    secrets: AppSecrets,
    outputFormat: 'json' | 'toon' = 'json'
  ) {
    this.authManager = authManager;
    this.secrets = secrets;
    this.outputFormat = outputFormat;

    // Phase 2 middleware pipeline. Middlewares compose outer-to-inner:
    //   - ETagMiddleware (02-07)                  — outermost
    //   - RetryHandler (02-02)
    //   - ODataErrorHandler (02-03)
    //   - TokenRefreshMiddleware (02-01)          — innermost
    // Order is load-bearing; see 02-CONTEXT.md Pattern E and
    // 02-RESEARCH.md "Example 1: Wiring the pipeline in GraphClient". A
    // structural test in test/etag-middleware.test.ts asserts this order and
    // will fail if a refactor reshuffles the array.
    this.pipeline = composePipeline(
      [
        new ETagMiddleware(),
        new RetryHandler(),
        new ODataErrorHandler(),
        new TokenRefreshMiddleware(this.authManager, this.secrets),
      ],
      (req) =>
        fetch(req.url, {
          method: req.method,
          headers: req.headers,
          body: req.body,
        })
    );
  }

  async makeRequest(endpoint: string, options: GraphRequestOptions = {}): Promise<unknown> {
    const contextTokens = getRequestTokens();
    const accessToken =
      options.accessToken ?? contextTokens?.accessToken ?? (await this.authManager.getToken());

    if (!accessToken) {
      throw new Error('No access token available');
    }

    try {
      // 401-refresh is now owned by TokenRefreshMiddleware (innermost in the
      // pipeline). 4xx / 5xx typed-error parsing is owned by ODataErrorHandler
      // (02-03) — it throws a typed GraphError subclass on any non-2xx
      // response, so the 2xx path below is the only branch we reach here.
      // The pipeline returns the post-refresh / post-error-parse response.
      const response = await this.performRequest(endpoint, accessToken, options);

      const contentTypeHeader = response.headers?.get?.('content-type') || '';
      const isBinaryResponse = isBinaryContentType(contentTypeHeader);

      let result: any;

      if (isBinaryResponse) {
        // Binary payloads (images, video, pdf, octet-stream, etc.) must not be
        // decoded with response.text() — that performs a lossy UTF-8 decode and
        // replaces every high byte with U+FFFD, destroying the file. Read the
        // raw bytes and return them as base64 so callers can reconstruct them.
        const buffer = Buffer.from(await response.arrayBuffer());
        result = {
          message: 'OK!',
          contentType: contentTypeHeader,
          encoding: 'base64',
          contentLength: buffer.byteLength,
          contentBytes: buffer.toString('base64'),
        };
      } else {
        const text = await response.text();

        if (text === '') {
          result = { message: 'OK!' };
        } else {
          try {
            result = JSON.parse(text);
          } catch {
            result = { message: 'OK!', rawResponse: text };
          }
        }
      }

      // If includeHeaders is requested, add response headers to the result
      if (options.includeHeaders) {
        const etag = response.headers.get('ETag') || response.headers.get('etag');

        // Simple approach: just add ETag to the result if it's an object
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          return {
            ...result,
            _etag: etag || 'no-etag-found',
          };
        }
      }

      return result;
    } catch (error) {
      logger.error('Microsoft Graph API request failed:', error);
      throw error;
    }
  }

  /**
   * Builds a GraphRequest from the (endpoint, accessToken, options) tuple and
   * delegates to the Phase 2 middleware pipeline. The pipeline owns
   * 401-refresh (TokenRefreshMiddleware — innermost) and, once subsequent
   * Phase 2 plans land, retry / typed-error-parsing / ETag-plumbing concerns
   * as well. The raw `fetch()` call lives in the terminal handler wired up in
   * the constructor.
   */
  private async performRequest(
    endpoint: string,
    accessToken: string,
    options: GraphRequestOptions
  ): Promise<Response> {
    const cloudEndpoints = getCloudEndpoints(this.secrets.cloudType);
    const url = `${cloudEndpoints.graphApi}/v1.0${endpoint}`;

    logger.info(`[GRAPH CLIENT] Final URL being sent to Microsoft: ${url}`);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const req: GraphRequest = {
      url,
      method: options.method || 'GET',
      headers,
      body: options.body,
    };
    return this.pipeline(req);
  }

  private serializeData(data: unknown, outputFormat: 'json' | 'toon', pretty = false): string {
    if (outputFormat === 'toon') {
      try {
        return toonEncode(data);
      } catch (error) {
        logger.warn(`Failed to encode as TOON, falling back to JSON: ${error}`);
        return JSON.stringify(data, null, pretty ? 2 : undefined);
      }
    }
    return JSON.stringify(data, null, pretty ? 2 : undefined);
  }

  async graphRequest(endpoint: string, options: GraphRequestOptions = {}): Promise<McpResponse> {
    try {
      logger.info(`Calling ${endpoint} with options: ${JSON.stringify(options)}`);

      // Use new OAuth-aware request method
      const result = await this.makeRequest(endpoint, options);

      return this.formatJsonResponse(result, options.rawResponse, options.excludeResponse);
    } catch (error) {
      // Typed GraphError from ODataErrorHandler (02-03) → surface structured
      // fields into _meta.graph so AI callers can paste requestId into a
      // Microsoft support ticket (Phase 2 Success Criteria #5).
      if (error instanceof GraphError) {
        // Plan 03-10 (TENANT-06): emit a graph.error audit row with the
        // Microsoft requestId so operators can correlate to a Microsoft
        // support ticket. Fire-and-forget; writeAuditStandalone falls back
        // to pino shadow log on DB error. Only emitted when a tenantId is
        // present on the request context (HTTP mode per-tenant path);
        // stdio / legacy single-tenant paths skip to avoid orphaning rows.
        void this.emitGraphErrorAudit(endpoint, error);

        let finalMessage = error.message;
        if (error.requiresOrgMode) {
          finalMessage +=
            '. This tool requires organization mode. Please restart with --org-mode flag.';
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: finalMessage,
                code: error.code,
                requestId: error.requestId,
              }),
            },
          ],
          isError: true,
          _meta: {
            graph: {
              code: error.code,
              statusCode: error.statusCode,
              requestId: error.requestId,
              clientRequestId: error.clientRequestId,
              date: error.date,
            },
          },
        };
      }
      // Fallback for non-GraphError (network errors, auth-resolution failures,
      // etc.). These never carry a Microsoft requestId so _meta.graph is omitted.
      logger.error(`Error in Graph API request: ${error}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: (error as Error).message }) }],
        isError: true,
      };
    }
  }

  /**
   * Plan 03-10 (TENANT-06): fire-and-forget Graph error audit writer.
   *
   * Lazy-loads postgres + audit modules so the legacy single-tenant stdio
   * path (no pg available) never pays the import cost. Only emits when a
   * tenantId is present on the request context — Phase 3 HTTP mode sets
   * this via the loadTenant middleware; stdio requests leave it undefined
   * and skip audit.
   */
  private async emitGraphErrorAudit(endpoint: string, error: GraphError): Promise<void> {
    try {
      const ctx = getRequestTokens();
      const tenantId = ctx?.tenantId;
      if (!tenantId) return;

      const postgres = await import('./lib/postgres.js');
      const pgPool = postgres.getPool();
      const { writeAuditStandalone } = await import('./lib/audit.js');

      await writeAuditStandalone(pgPool, {
        tenantId,
        actor: 'system',
        action: 'graph.error',
        target: endpoint,
        ip: null,
        requestId: ctx?.requestId ?? 'no-req-id',
        result: 'failure',
        meta: {
          code: error.code,
          message: error.message,
          graphRequestId: error.requestId,
          httpStatus: error.statusCode,
        },
      });
    } catch {
      // Audit write itself failed (postgres pool not constructed in stdio
      // mode, or pg is unreachable). writeAuditStandalone has its own
      // shadow-log fallback for DB errors; we swallow module-not-available
      // errors here so the Graph error path never fails on missing deps.
    }
  }

  formatJsonResponse(data: unknown, rawResponse = false, excludeResponse = false): McpResponse {
    // If excludeResponse is true, only return success indication
    if (excludeResponse) {
      return {
        content: [{ type: 'text', text: this.serializeData({ success: true }, this.outputFormat) }],
      };
    }

    // Handle the case where data includes headers metadata
    if (data && typeof data === 'object' && '_headers' in data) {
      const responseData = data as {
        data: unknown;
        _headers: Record<string, string>;
        _etag?: string;
      };

      const meta: Record<string, unknown> = {};
      if (responseData._etag) {
        meta.etag = responseData._etag;
      }
      if (responseData._headers) {
        meta.headers = responseData._headers;
      }

      if (rawResponse) {
        return {
          content: [
            { type: 'text', text: this.serializeData(responseData.data, this.outputFormat) },
          ],
          _meta: meta,
        };
      }

      if (responseData.data === null || responseData.data === undefined) {
        return {
          content: [
            { type: 'text', text: this.serializeData({ success: true }, this.outputFormat) },
          ],
          _meta: meta,
        };
      }

      // Strip @odata.* properties (preserves @odata.nextLink) via module-level
      // helper with depth + WeakSet cycle guards (Plan 01-09 / T-01-09a).
      const stripped = removeODataProps(responseData.data);

      return {
        content: [{ type: 'text', text: this.serializeData(stripped, this.outputFormat, true) }],
        _meta: meta,
      };
    }

    // Original handling for backward compatibility
    if (rawResponse) {
      return {
        content: [{ type: 'text', text: this.serializeData(data, this.outputFormat) }],
      };
    }

    if (data === null || data === undefined) {
      return {
        content: [{ type: 'text', text: this.serializeData({ success: true }, this.outputFormat) }],
      };
    }

    // Strip @odata.* properties (preserves @odata.nextLink) via module-level
    // helper with depth + WeakSet cycle guards (Plan 01-09 / T-01-09a).
    const stripped = removeODataProps(data);

    return {
      content: [{ type: 'text', text: this.serializeData(stripped, this.outputFormat, true) }],
    };
  }
}

export default GraphClient;

/**
 * Narrow MSAL interface for acquireTokenByRefreshToken — we only need the
 * subset the 401 refresh path consumes. Keeps the helper testable with
 * lightweight mocks (same pattern as isDelegatedMsalClient in server.ts).
 */
interface MsalWithRefresh {
  acquireTokenByRefreshToken: (req: { refreshToken: string; scopes: string[] }) => Promise<{
    accessToken?: string;
    refreshToken?: string;
    expiresOn?: Date | null;
    account?: { homeAccountId?: string } | null;
  } | null>;
}

function hasAcquireTokenByRefreshToken(c: unknown): c is MsalWithRefresh {
  return (
    typeof c === 'object' &&
    c !== null &&
    'acquireTokenByRefreshToken' in c &&
    typeof (c as { acquireTokenByRefreshToken: unknown }).acquireTokenByRefreshToken === 'function'
  );
}

/**
 * Plan 03-07 SECUR-02: Graph 401 server-side refresh path.
 *
 * Replaces v1's custom-header-driven refresh. Flow:
 *   1. Look up the SessionRecord in Redis keyed by
 *      `mcp:session:{tenantId}:sha256(oldAccessToken)` — if miss, the
 *      caller must re-authenticate via the OAuth round-trip (no header
 *      fallback in v2).
 *   2. Call `tenantPool.acquire(tenant)` + `acquireTokenByRefreshToken`
 *      with the stored refresh token + scopes (no header ride).
 *   3. On success, write a NEW session entry keyed by the fresh access
 *      token and delete the old session — refresh-token rotation is
 *      honored if MSAL returned a new RT.
 *
 * Returned object carries the fresh access token for the Graph retry. The
 * caller (Graph middleware pipeline or tests) is responsible for replaying
 * the original Graph request with `Authorization: Bearer {accessToken}`.
 *
 * This function does NOT read any HTTP header. This is the SECUR-02
 * contract — the T-03-07-01 threat register disposition requires that
 * no custom header read path survives.
 *
 * @throws Error when the session is missing, tenantPool.acquire fails, the
 *   tenant's MSAL client doesn't expose acquireTokenByRefreshToken (bearer
 *   mode — bearer clients never hit the refresh path), or the refresh
 *   acquire returns no accessToken.
 */
export async function refreshSessionAndRetry(args: {
  tenant: TenantRow;
  oldAccessToken: string;
  tenantPool: Pick<TenantPool, 'acquire' | 'getDekForTenant'>;
  redis: RedisClient;
}): Promise<{ accessToken: string; refreshToken?: string; expiresOn?: Date | null }> {
  const { tenant, oldAccessToken, tenantPool, redis } = args;

  // 1. Unwrap DEK + build SessionStore. Throws if the tenant isn't in the
  //    pool — the caller must acquire first.
  const dek = tenantPool.getDekForTenant(tenant.id);
  const sessionStore = new SessionStore(redis, dek);

  const record = await sessionStore.get(tenant.id, oldAccessToken);
  if (!record?.refreshToken) {
    // No server-side session → cannot refresh. Caller must redirect to a
    // fresh OAuth round-trip. 401 propagates to the client.
    throw new Error('no_session_for_access_token');
  }

  // 2. Acquire an MSAL client + call acquireTokenByRefreshToken. Bearer
  //    mode returns null from tenantPool.acquire; we can't refresh bearer
  //    tokens (they're pass-through JWTs — client must re-issue).
  const msal = await tenantPool.acquire(tenant);
  if (!hasAcquireTokenByRefreshToken(msal)) {
    throw new Error('tenant_does_not_support_refresh');
  }

  const fresh = await msal.acquireTokenByRefreshToken({
    refreshToken: record.refreshToken,
    scopes: record.scopes,
  });
  if (!fresh?.accessToken) {
    // Old session is stale — drop it to prevent repeated refresh attempts
    // against a dead refresh token (T-03-07-04 disposition).
    await sessionStore.delete(tenant.id, oldAccessToken);
    throw new Error('refresh_token_exchange_failed');
  }

  // 3. Rotate the session entry: new access-token key holds the (possibly
  //    rotated) refresh token; old key is deleted. When MSAL did NOT rotate
  //    the refresh token, we carry the existing one forward — the session
  //    contents stay valid, only the key changes.
  const newRefreshToken = fresh.refreshToken ?? record.refreshToken;
  await sessionStore.put(tenant.id, fresh.accessToken, {
    ...record,
    refreshToken: newRefreshToken,
    accountHomeId: fresh.account?.homeAccountId ?? record.accountHomeId,
    createdAt: Date.now(),
  });
  await sessionStore.delete(tenant.id, oldAccessToken);

  logger.info(
    { tenantId: tenant.id, rotated: Boolean(fresh.refreshToken) },
    'session refresh: rotated access token via SessionStore'
  );

  return {
    accessToken: fresh.accessToken,
    refreshToken: fresh.refreshToken ?? undefined,
    expiresOn: fresh.expiresOn ?? undefined,
  };
}
