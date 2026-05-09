/**
 * MCP tool-name sanitizer (SEP-986 / Claude.ai connector).
 *
 * Claude.ai's frontend tool-registration validator enforces
 * `^[a-zA-Z0-9_-]{1,64}$` on tool names. The Microsoft Graph generated
 * catalog uses dotted aliases (`me.messages.ListAttachments`) and many
 * exceed 64 chars. Both shapes are rejected.
 *
 * Transform: dots → underscores; if still > 64 chars, slice to 55 +
 * 8-char sha1 suffix for determinism + collision resistance across the
 * full ~42k-tool catalog.
 *
 * Usage at registration:
 *   server.tool(safeMcpName(tool.alias), description, schema, hints, handler)
 *
 * The handler closure still captures the original `tool.alias`, so
 * dispatch (executeGraphTool) sees the raw alias and routes correctly.
 *
 * Usage at filter sites: when comparing the McpServer's registered tool
 * name against a per-tenant alias allowlist, run alias values through
 * `safeMcpName` first (so the comparison happens in the safe namespace).
 *
 * Pure function. No project-internal imports — safe to load from
 * tool-selection AND src/graph-tools.ts without a circular import risk.
 */
import { createHash } from 'crypto';

const VALID_RE = /^[a-zA-Z0-9_-]+$/;

export function safeMcpName(alias: string): string {
  const flat = alias.replace(/\./g, '_');
  if (flat.length <= 64 && VALID_RE.test(flat)) return flat;
  const cleaned = flat.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (cleaned.length <= 64) return cleaned;
  const hash = createHash('sha1').update(alias).digest('hex').slice(0, 8);
  return cleaned.slice(0, 55) + '_' + hash;
}
