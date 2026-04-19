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
import { GraphError } from './lib/graph-errors.js';
import type { GraphRequest } from './lib/middleware/types.js';

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
    //   - RetryHandler (02-02)                    — this plan
    //   - ODataErrorHandler (02-03)
    //   - TokenRefreshMiddleware (02-01)          — innermost
    // Each subsequent Phase 2 plan adds its middleware to this array in the
    // specified order. Order is load-bearing; see 02-CONTEXT.md and
    // 02-RESEARCH.md "Example 1: Wiring the pipeline in GraphClient".
    this.pipeline = composePipeline(
      [
        // ETagMiddleware — 02-07
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
