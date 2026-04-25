/**
 * Dispatch guard (plan 05-04, TENANT-08, D-20).
 *
 * Pure `Set.has` check run at the top of `executeGraphTool` BEFORE any
 * Graph network call. Returns `null` on pass; returns a structured
 * `CallToolResult`-shaped rejection envelope on miss. NEVER throws — the
 * MCP transport would disconnect if this function raised, so every branch
 * produces a valid response shape.
 *
 * Envelope shape (verbatim from CONTEXT.md D-20):
 *   {
 *     isError: true,
 *     content: [{
 *       type: 'text',
 *       text: JSON.stringify({
 *         error: 'tool_not_enabled_for_tenant',
 *         tool: <alias>,
 *         tenantId: <id | 'unknown'>,
 *         hint: <operator-facing fix path>,
 *         enabled_preset_version: <version | 'unknown'>,
 *       }),
 *     }],
 *   }
 *
 * Fail-closed contract (T-05-09):
 *   - `enabledSet === undefined` → reject (stdio bootstrap missed a seed,
 *     middleware chain broke, etc.).
 *   - `tenantId === undefined` / `presetVersion === undefined` → reject,
 *     substituting the literal string 'unknown' so the envelope shape stays
 *     consistent for downstream log parsers.
 *
 * This module is pure + side-effect-free; structured logging for the reject
 * path happens at the caller (executeGraphTool) so the log carries Winston-
 * style pre-formatted message + rich meta.
 */

export interface DispatchRejectionShape {
  error: 'tool_not_enabled_for_tenant';
  tool: string;
  tenantId: string;
  hint: string;
  enabled_preset_version: string;
}

export interface CallToolResultLike {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
  _meta?: Record<string, unknown>;
}

/**
 * stdio-mode fallback (Pitfall 8 from 05-PATTERNS.md). The MCP
 * StdioServerTransport dispatches tool calls outside the
 * `AsyncLocalStorage` frame established by the bootstrap caller, so the
 * per-request ALS seam is NOT available in stdio. Instead the stdio
 * bootstrap (src/index.ts) calls `setStdioFallback()` once at startup to
 * register the single-tenant triple, and dispatch-guard falls back to it
 * ONLY when ALS has no `enabledToolsSet`.
 *
 * HTTP mode never touches this fallback — the ALS-seeded triple always
 * wins. The fallback is also never persisted to disk / cross-process —
 * it is a pure in-process module-level handle.
 */
interface StdioFallback {
  enabledToolsSet: ReadonlySet<string>;
  enabledToolsExplicit?: boolean;
  tenantId: string;
  presetVersion: string;
}

// Stored on globalThis so the fallback survives `vi.resetModules()` in tests
// (src/__tests__/graph-tools.test.ts) and any other hot-reload scenarios
// that drop module state. The key is namespaced with the package name to
// avoid collisions in shared globals.
const GLOBAL_KEY = Symbol.for('ms-365-mcp-server.dispatch-guard.stdioFallback');

function readFallback(): StdioFallback | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any)[GLOBAL_KEY];
}

function writeFallback(value: StdioFallback | undefined): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any)[GLOBAL_KEY] = value;
}

/**
 * Register (or clear, via undefined) the stdio-mode fallback triple.
 * Idempotent: calling twice replaces the previous registration.
 */
export function setStdioFallback(value: StdioFallback | undefined): void {
  writeFallback(value);
}

/**
 * Test helper — read the current stdio fallback. Not exported publicly;
 * only called from dispatch-guard's own test file.
 */
export function _getStdioFallbackForTest(): StdioFallback | undefined {
  return readFallback();
}

/**
 * Check whether `toolAlias` is permitted for the current tenant. Returns
 * `null` on pass (caller proceeds with the Graph call). Returns a fully
 * shaped rejection envelope on miss — caller returns it verbatim from
 * `executeGraphTool` without throwing.
 */
export function checkDispatch(
  toolAlias: string,
  enabledSet: ReadonlySet<string> | undefined,
  tenantId: string | undefined,
  presetVersion: string | undefined
): CallToolResultLike | null {
  // Pitfall 8: when ALS is empty (stdio mode, or an HTTP seam broken before
  // seedTenantContext), fall back to the module-level stdio triple if one
  // was registered at bootstrap. HTTP mode always populates ALS so this
  // branch is stdio-only in practice.
  const fallback = readFallback();
  const effectiveSet = enabledSet ?? fallback?.enabledToolsSet;
  const resolvedTenant = tenantId ?? fallback?.tenantId ?? 'unknown';
  const resolvedPreset = presetVersion ?? fallback?.presetVersion ?? 'unknown';

  // Fail-closed: no set (neither ALS nor stdio fallback) means no decision
  // was made upstream. Reject.
  if (!effectiveSet) {
    return rejectWithShape(
      toolAlias,
      resolvedTenant,
      resolvedPreset,
      'enabled_tools_set unavailable for this request; ensure loadTenant + requestContext seeding ran'
    );
  }

  if (effectiveSet.has(toolAlias)) {
    return null;
  }

  return rejectWithShape(
    toolAlias,
    resolvedTenant,
    resolvedPreset,
    `Ask admin to enable this tool via PATCH /admin/tenants/${resolvedTenant}/enabled-tools`
  );
}

function rejectWithShape(
  tool: string,
  tenantId: string,
  presetVersion: string,
  hint: string
): CallToolResultLike {
  const payload: DispatchRejectionShape = {
    error: 'tool_not_enabled_for_tenant',
    tool,
    tenantId,
    hint,
    enabled_preset_version: presetVersion,
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: true,
  };
}
