/**
 * Streamable HTTP transport handler (plan 03-09, TRANS-01).
 *
 * Mounted at /t/:tenantId/mcp (GET + POST). Wraps the v1 stateless Streamable
 * HTTP code path from src/server.ts but per-tenant: every request builds a
 * fresh McpServer scoped to req.tenant + the per-request token in
 * requestContext.
 *
 * Per-request server construction (TRANS-05): the same factory produces an
 * McpServer for stdio + Streamable HTTP + legacy SSE so all three expose the
 * same tool surface. Tool registration is identical across transports — only
 * the transport differs.
 *
 * Stateless contract (v2.0): `sessionIdGenerator: undefined` — no session
 * state retained between requests. Scale-out / multi-replica deployments work
 * without sticky-routing. If a future plan enables stateful mode, the session
 * store must live in Redis per Phase 3 substrate (not in-memory per replica).
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Request, Response, RequestHandler } from 'express';
import type { TenantRow } from '../tenant/tenant-row.js';
import logger from '../../logger.js';

export interface StreamableHttpDeps {
  buildMcpServer: (tenant: TenantRow) => McpServer;
}

/**
 * Factory: returns an Express RequestHandler for POST+GET /t/:tenantId/mcp.
 *
 * Contract:
 *   - Expects `req.tenant` populated by upstream loadTenant middleware. If
 *     missing, responds 500 `loadTenant_middleware_missing` — the mount order
 *     is wrong and no tool call should proceed.
 *   - Constructs a fresh McpServer AND a fresh StreamableHTTPServerTransport
 *     per request. Both are cheap to allocate; keeping them per-request means
 *     no shared state leaks across tenants (TENANT-04 isolation).
 *   - Registers `res.on('close', ...)` cleanup so if the client disconnects
 *     mid-response, the transport + server are torn down immediately rather
 *     than leaking handles.
 */
export function createStreamableHttpHandler(deps: StreamableHttpDeps): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const tenant = (req as Request & { tenant?: TenantRow }).tenant;
    if (!tenant) {
      res.status(500).json({ error: 'loadTenant_middleware_missing' });
      return;
    }

    const server = deps.buildMcpServer(tenant);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless per v2 contract
    });

    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      // req.body is pre-parsed by express.json() upstream; pass it through so
      // the SDK does not re-read the request stream.
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error(
        { err: (err as Error).message, tenantId: tenant.id },
        'Streamable HTTP transport failed'
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };
}
