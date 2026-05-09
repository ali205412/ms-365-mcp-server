import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface RegisterMcpCompletionsResult {
  registered: true;
}

export function registerMcpCompletions(_server: McpServer): RegisterMcpCompletionsResult {
  return { registered: true };
}
