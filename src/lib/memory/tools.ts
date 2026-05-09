import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type AuthManager from '../../auth.js';
import type GraphClient from '../../graph-client.js';
import type { RedisClient } from '../redis.js';
import { registerBookmarkTools } from './bookmark-tools.js';
import { registerFactTools } from './fact-tools.js';
import { registerRecipeTools } from './recipe-tools.js';

export interface MemoryToolDeps {
  redis: RedisClient;
  graphClient: GraphClient;
  authManager?: AuthManager;
  readOnly?: boolean;
  orgMode?: boolean;
}

export function registerMemoryTools(server: McpServer, deps: MemoryToolDeps): void {
  registerBookmarkTools(server, { redis: deps.redis });
  registerRecipeTools(server, {
    redis: deps.redis,
    graphClient: deps.graphClient,
    authManager: deps.authManager,
    readOnly: deps.readOnly,
    orgMode: deps.orgMode,
  });
  registerFactTools(server, { redis: deps.redis });
}
