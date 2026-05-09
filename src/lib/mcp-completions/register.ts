import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface RegisterMcpCompletionsResult {
  registered: true;
}

type CompletionCapableMcpServer = {
  setCompletionRequestHandler?: () => void;
};

export function registerMcpCompletions(server: McpServer): RegisterMcpCompletionsResult {
  (server as unknown as CompletionCapableMcpServer).setCompletionRequestHandler?.();
  return { registered: true };
}
