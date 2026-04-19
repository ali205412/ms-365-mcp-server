/**
 * BatchClient + `batch()` helper — Phase 2 Plan 02-05.
 *
 * Coalesces up to 20 Microsoft Graph sub-requests into a single `POST /$batch`
 * envelope per the JSON batching protocol:
 *   https://learn.microsoft.com/graph/json-batching
 *
 * The outbound POST goes through the FULL middleware chain (ETag, Retry,
 * ODataError, TokenRefresh) because this module only calls
 * `client.graphRequest()` — it is NOT itself a `GraphMiddleware`. Same
 * "helper that calls through the chain" placement as 02-04's PageIterator.
 *
 * Per-sub-request error parsing re-uses `parseODataError` from 02-03 directly,
 * so every non-2xx sub-response is surfaced as a typed `GraphError` subclass
 * the caller can branch on by `instanceof` — the batch envelope does NOT
 * throw on sub-failures. One failing sub-request does not reject the whole
 * batch; the caller inspects per-item status + error fields.
 *
 * Validation (all throw at entry, BEFORE the POST is sent):
 *   - requests.length === 0 → reject (caller bug; no-op batch).
 *   - requests.length > 20 → reject (Graph-enforced cap + T-02-05a anti-DoS).
 *   - duplicate sub-request `id` → reject (Graph requires unique ids per batch).
 *   - sub-request `url` is NOT a relative path starting with `/` → reject
 *     (T-02-05b SSRF guard: absolute URLs, protocol-relative `//`, and
 *     non-HTTP schemes like `file://` are all blocked).
 *   - dependsOn references an unknown id → reject.
 *   - dependsOn graph has a cycle (including self-loops) → reject (T-02-05c).
 *
 * Response handling:
 *   - Re-order sub-responses by REQUEST index so callers see the same order
 *     they submitted. Graph may re-order when dependsOn is not present and
 *     the contract mandates preserving caller order for ergonomic indexing.
 *   - Each 2xx sub-response surfaces as `{ id, status, headers?, body }`.
 *   - Each non-2xx sub-response additionally carries `error: GraphError`
 *     populated by `parseODataError(body, status, headers)`.
 *
 * Observability:
 *   - OTel span `graph.batch.submit` around the whole helper, attributes
 *     `graph.batch.count` and `graph.batch.failures`.
 *   - pino logger at `info` for the submission + result count, at `warn`
 *     when any sub-request failed.
 */

import { trace } from '@opentelemetry/api';
import logger from '../../logger.js';
import type GraphClient from '../../graph-client.js';
import { parseODataError, GraphError } from '../graph-errors.js';

const MAX_BATCH_SIZE = 20;
const tracer = trace.getTracer('graph-middleware');

/**
 * Input item for `batch()`. Mirrors the Graph `$batch` sub-request shape:
 *   https://learn.microsoft.com/graph/json-batching#json-batch-syntax
 *
 * `url` MUST be a relative path beginning with `/` (e.g., `/me`,
 * `/users/{id}/messages?$top=5`). The batch request is sent against the
 * `/v1.0/$batch` endpoint, which rewrites sub-request URLs relative to the
 * same service root — passing an absolute URL is both spec-incorrect and a
 * potential SSRF vector (T-02-05b).
 */
export interface BatchRequestItem {
  /** Unique identifier for the sub-request within the batch. */
  id: string;
  /** HTTP method: GET / POST / PATCH / DELETE / PUT. */
  method: string;
  /** Relative URL beginning with `/` (SSRF-guarded). */
  url: string;
  /** Optional headers for the sub-request. */
  headers?: Record<string, string>;
  /** Optional request body (already-shaped JSON). */
  body?: unknown;
  /**
   * Optional list of other sub-request ids that must complete before this
   * one runs. Graph enforces topological ordering; the client-side validator
   * additionally ensures the dependsOn graph is acyclic before sending.
   */
  dependsOn?: string[];
}

/**
 * Per-sub-request result returned by `batch()`. Items are returned in the
 * same order as the input `requests` array, regardless of Graph response
 * order.
 */
export interface BatchResponseItem {
  /** Sub-request identifier, matching the input item. */
  id: string;
  /** HTTP status code returned by Graph for this sub-request. */
  status: number;
  /** Optional sub-response headers (e.g., `Retry-After`, `ETag`). */
  headers?: Record<string, string>;
  /** Parsed sub-response body (JSON). Present on both 2xx and error cases. */
  body?: unknown;
  /**
   * Typed GraphError populated for every non-2xx sub-response, selected by
   * `statusCode` alone (same discipline as 02-03 `parseODataError` —
   * attacker-controllable `code` fields never drive subclass selection).
   */
  error?: GraphError;
}

/**
 * Submit a Graph `$batch` request.
 *
 * @param requests Non-empty array of up to 20 sub-requests.
 * @param client GraphClient the POST /$batch goes through (and thereby the
 *               full middleware chain).
 * @returns Per-item results in REQUEST order. Never throws on sub-failures —
 *          each failure is surfaced as a typed GraphError in `result[i].error`.
 *          Throws only on validation errors at entry OR when the outer POST
 *          itself fails (transport error, GraphError from the chain).
 */
export async function batch(
  requests: BatchRequestItem[],
  client: GraphClient
): Promise<BatchResponseItem[]> {
  validateBatch(requests);

  return tracer.startActiveSpan('graph.batch.submit', async (span) => {
    span.setAttribute('graph.batch.count', requests.length);
    try {
      const envelope = {
        requests: requests.map((r) => buildSubRequest(r)),
      };

      logger.info({ count: requests.length }, 'graph batch submit');

      const mcp = await client.graphRequest('/$batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      });

      const parsed = parseBatchResponseEnvelope(mcp);
      const out = mapResponsesToRequests(requests, parsed);

      const failures = out.filter((r) => r.status >= 400).length;
      span.setAttribute('graph.batch.failures', failures);
      if (failures > 0) {
        logger.warn({ count: requests.length, failures }, 'graph batch completed with failures');
      } else {
        logger.info({ count: requests.length }, 'graph batch completed');
      }

      return out;
    } finally {
      span.end();
    }
  });
}

/**
 * Thin class wrapper — exposes `batch()` as an injectable collaborator. Phase
 * 6 (OPS-06) and future auto-batch coalescer (D-07) can hold a single
 * `BatchClient` instance per tenant/request scope and plug it where a
 * "submit-many" abstraction is needed.
 */
export class BatchClient {
  private readonly client: GraphClient;

  constructor(client: GraphClient) {
    this.client = client;
  }

  async submit(requests: BatchRequestItem[]): Promise<BatchResponseItem[]> {
    return batch(requests, this.client);
  }
}

/**
 * Run all validation guards. Throws on the first failure; the outer caller
 * never sees a partially-validated batch.
 *
 * Order matters: we check cheap input-shape problems (empty, cap) before the
 * per-item loop (SSRF, duplicate id) and only then the full dependsOn graph.
 * The cycle check is the most expensive so it runs last.
 */
function validateBatch(requests: BatchRequestItem[]): void {
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error('batch requires a non-empty requests array (at least 1 sub-request)');
  }
  if (requests.length > MAX_BATCH_SIZE) {
    throw new Error(
      `batch exceeds Graph cap: got ${requests.length} sub-requests, max ${MAX_BATCH_SIZE}`
    );
  }

  const ids = new Set<string>();
  for (const r of requests) {
    if (typeof r.id !== 'string' || r.id.length === 0) {
      throw new Error('each batch sub-request must have a non-empty string id');
    }
    if (ids.has(r.id)) {
      throw new Error(`duplicate sub-request id "${r.id}" — ids must be unique within a batch`);
    }
    ids.add(r.id);

    if (typeof r.url !== 'string' || r.url.length === 0) {
      throw new Error(`sub-request "${r.id}" has no url`);
    }
    if (!isRelativePath(r.url)) {
      throw new Error(
        `sub-request "${r.id}" url must be a relative path starting with "/" ` +
          `(absolute URLs blocked for SSRF safety); got ${JSON.stringify(r.url)}`
      );
    }
  }

  for (const r of requests) {
    if (!r.dependsOn) continue;
    for (const dep of r.dependsOn) {
      if (!ids.has(dep)) {
        throw new Error(
          `sub-request "${r.id}" dependsOn unknown id "${dep}" — referenced id not present in batch`
        );
      }
    }
  }

  const cyclePath = findCycle(requests);
  if (cyclePath !== null) {
    throw new Error(`dependsOn graph has a cycle: ${cyclePath.join(' -> ')}`);
  }
}

/**
 * Relative-URL gate — the only accepted form is a path beginning with a
 * SINGLE `/`. This blocks:
 *   - `http://…` and `https://…` absolute URLs (direct SSRF)
 *   - `//host/path` protocol-relative URLs (scheme-inheriting SSRF)
 *   - `file:///…`, `gopher://…`, `ftp://…`, etc. (scheme abuse)
 *   - `path/without/leading-slash` (would be interpreted relative to the
 *     batch endpoint itself, unlikely to be what the caller intended and
 *     ambiguous enough to reject).
 *
 * Backslashes are also rejected to defuse Windows-path-like inputs that some
 * proxies normalize into the authority component.
 */
function isRelativePath(url: string): boolean {
  if (url.length < 2) return false;
  if (url[0] !== '/') return false;
  if (url[1] === '/') return false; // protocol-relative
  if (url.includes('\\')) return false;
  return true;
}

/**
 * Iterative DFS cycle detector over the dependsOn adjacency. Returns the
 * id-sequence of the first cycle found, or `null` if the graph is acyclic.
 *
 * Algorithm:
 *   - Three color states per node: 0 = unseen, 1 = on current stack,
 *     2 = fully visited.
 *   - DFS each unseen node; when a neighbor is in state 1, walk the parent
 *     chain backwards to produce the cycle path for the error message.
 *
 * Iterative rather than recursive to avoid stack blow-up on pathological
 * input — defense-in-depth even though the 20-node cap already bounds depth.
 */
function findCycle(requests: BatchRequestItem[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const r of requests) {
    adj.set(r.id, r.dependsOn ? [...r.dependsOn] : []);
  }

  const UNSEEN = 0;
  const ON_STACK = 1;
  const DONE = 2;
  const color = new Map<string, number>();
  for (const r of requests) color.set(r.id, UNSEEN);
  const parent = new Map<string, string | undefined>();

  for (const start of adj.keys()) {
    if (color.get(start) !== UNSEEN) continue;
    // Iterative DFS with an explicit stack of (node, iterator-index) frames.
    const stack: Array<{ node: string; idx: number }> = [{ node: start, idx: 0 }];
    color.set(start, ON_STACK);
    parent.set(start, undefined);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const neighbors = adj.get(top.node) ?? [];
      if (top.idx >= neighbors.length) {
        color.set(top.node, DONE);
        stack.pop();
        continue;
      }
      const next = neighbors[top.idx];
      top.idx++;

      const nextColor = color.get(next);
      if (nextColor === undefined) {
        // Dependency on an unknown id — caught by the earlier guard, but
        // defend here too.
        continue;
      }
      if (nextColor === ON_STACK) {
        return buildCyclePath(top.node, next, parent);
      }
      if (nextColor === UNSEEN) {
        color.set(next, ON_STACK);
        parent.set(next, top.node);
        stack.push({ node: next, idx: 0 });
      }
    }
  }
  return null;
}

/**
 * Build the cycle path `next -> ... -> fromNode -> next` by walking the
 * `parent` chain from `fromNode` back to `next`. Used only for error
 * message formatting.
 */
function buildCyclePath(
  fromNode: string,
  next: string,
  parent: Map<string, string | undefined>
): string[] {
  const path: string[] = [];
  let cursor: string | undefined = fromNode;
  while (cursor !== undefined && cursor !== next) {
    path.push(cursor);
    cursor = parent.get(cursor);
  }
  path.push(next);
  path.reverse();
  path.push(next);
  return path;
}

/**
 * Build the JSON-batching sub-request shape, omitting falsy fields per the
 * Graph spec (`headers`, `body`, `dependsOn` must be absent when empty —
 * Graph rejects the request otherwise).
 */
function buildSubRequest(r: BatchRequestItem): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: r.id,
    method: r.method.toUpperCase(),
    url: r.url,
  };
  if (r.headers && Object.keys(r.headers).length > 0) {
    out.headers = r.headers;
  }
  if (r.body !== undefined) {
    out.body = r.body;
  }
  if (r.dependsOn && r.dependsOn.length > 0) {
    out.dependsOn = r.dependsOn;
  }
  return out;
}

/**
 * Extract the `responses` array from the MCP envelope returned by
 * `client.graphRequest('/$batch', ...)`. The graph-client wraps the raw JSON
 * payload in `{ content: [{ type: 'text', text: "<json-string>" }] }`, so we
 * parse the text field to recover the `{ responses: [...] }` payload.
 */
function parseBatchResponseEnvelope(mcp: unknown): RawBatchResponse[] {
  if (!mcp || typeof mcp !== 'object') {
    throw new Error('batch: empty response from /$batch');
  }
  const shape = mcp as { content?: Array<{ text?: unknown }> };
  const text = shape.content?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('batch: /$batch response missing text content');
  }
  const parsed = JSON.parse(text) as { responses?: unknown };
  if (!Array.isArray(parsed.responses)) {
    throw new Error('batch: /$batch response body missing "responses" array');
  }
  return parsed.responses as RawBatchResponse[];
}

interface RawBatchResponse {
  id?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Map raw `responses` from Graph back onto the input `requests` order and
 * populate the typed `error` field for every non-2xx sub-response using
 * `parseODataError`.
 *
 * For any request whose id is missing from the response array (spec
 * violation by Graph; never observed in practice but defensible), we emit a
 * synthetic `{ id, status: 0 }` item with an `error` so callers don't get a
 * silent gap at that index.
 */
function mapResponsesToRequests(
  requests: BatchRequestItem[],
  raw: RawBatchResponse[]
): BatchResponseItem[] {
  const byId = new Map<string, RawBatchResponse>();
  for (const r of raw) {
    if (typeof r.id === 'string') byId.set(r.id, r);
  }

  return requests.map((req) => {
    const found = byId.get(req.id);
    if (!found || typeof found.status !== 'number') {
      // Graph omitted this sub-response (should not happen for a well-formed
      // batch; surface as a synthetic 0-status error so the caller doesn't
      // see a silent gap).
      const err = parseODataError(
        { error: { code: 'missingBatchResponse', message: `No response for id "${req.id}"` } },
        0
      );
      return { id: req.id, status: 0, error: err };
    }
    const item: BatchResponseItem = {
      id: req.id,
      status: found.status,
    };
    if (found.headers) item.headers = found.headers;
    if (found.body !== undefined) item.body = found.body;
    if (found.status >= 400) {
      item.error = parseODataError(found.body, found.status, found.headers);
    }
    return item;
  });
}
