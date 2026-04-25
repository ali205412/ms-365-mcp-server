import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import logger from '../../logger.js';
import type AuthManager from '../../auth.js';
import type GraphClient from '../../graph-client.js';
import { executeToolAlias } from '../../graph-tools.js';
import { getRequestTenant } from '../../request-context.js';
import type { RedisClient } from '../redis.js';
import { publishResourceUpdated } from '../mcp-notifications/events.js';
import { emitMcpLogEvent } from '../mcp-logging/register.js';
import {
  RecipeAliasZod,
  RecipeNameZod,
  RecipeNoteZod,
  RecipeParamsZod,
  getRecipeByName,
  listRecipes,
  markRecipeRun,
  mergeRecipeParams,
  saveRecipe,
} from './recipes.js';

const RECIPE_CHANGE_REASON = 'recipe-change';

const SaveRecipeInputZod = z.object({
  name: RecipeNameZod.describe('Caller-friendly recipe name unique within this tenant.'),
  alias: RecipeAliasZod.describe('Exact Graph/product alias discovered by search-tools.'),
  params: RecipeParamsZod.describe('Known-good parameters to replay when this recipe runs.'),
  note: RecipeNoteZod.describe('Optional note describing when this recipe is useful.'),
});

const ListRecipesInputZod = z.object({
  filter: z.string().trim().min(1).max(512).optional().describe('Optional text filter.'),
});

const RunRecipeInputZod = z.object({
  name: RecipeNameZod.describe('Recipe name to run for this tenant.'),
  paramOverrides: RecipeParamsZod.optional().describe(
    'Optional parameters that override the saved recipe params for this run.'
  ),
});

export interface RecipeToolDeps {
  redis: RedisClient;
  graphClient: GraphClient;
  authManager?: AuthManager;
  readOnly?: boolean;
  orgMode?: boolean;
}

function jsonResult(value: unknown, isError = false): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function requireTenant():
  | {
      id: string;
    }
  | undefined {
  const tenant = getRequestTenant();
  if (!tenant.id) return undefined;
  return { id: tenant.id };
}

async function publishRecipeChange(redis: RedisClient, tenantId: string): Promise<void> {
  try {
    await publishResourceUpdated(
      redis,
      tenantId,
      [`mcp://tenant/${tenantId}/recipes.json`],
      RECIPE_CHANGE_REASON
    );
  } catch (err) {
    logger.warn(
      { tenantId, err: (err as Error).message },
      'recipe-tools: publish recipe change failed; Redis notification skipped'
    );
  }
}

export function registerRecipeTools(server: McpServer, deps: RecipeToolDeps): void {
  server.tool(
    'save-recipe',
    'Save a reusable Microsoft Graph tool alias and parameter shape for this tenant.',
    {
      name: SaveRecipeInputZod.shape.name,
      alias: SaveRecipeInputZod.shape.alias,
      params: SaveRecipeInputZod.shape.params,
      note: SaveRecipeInputZod.shape.note,
    },
    {
      title: 'save-recipe',
      readOnlyHint: false,
      openWorldHint: false,
    },
    async (args) => {
      const tenant = requireTenant();
      if (!tenant) return jsonResult({ error: 'tenant_required' }, true);

      const parsed = SaveRecipeInputZod.safeParse(args);
      if (!parsed.success) {
        return jsonResult(
          {
            error: 'invalid_recipe',
            details: parsed.error.issues.map((issue) => issue.message),
          },
          true
        );
      }

      const recipe = await saveRecipe(tenant.id, parsed.data);
      await emitMcpLogEvent({
        tenantId: tenant.id,
        event: 'recipe.saved',
        level: 'info',
        data: {
          name: parsed.data.name,
          alias: parsed.data.alias,
        },
      });
      await publishRecipeChange(deps.redis, tenant.id);
      return jsonResult(recipe);
    }
  );

  server.tool(
    'list-recipes',
    'List saved workflow recipes for this tenant.',
    {
      filter: ListRecipesInputZod.shape.filter,
    },
    {
      title: 'list-recipes',
      readOnlyHint: true,
      openWorldHint: false,
    },
    async (args) => {
      const tenant = requireTenant();
      if (!tenant) return jsonResult({ error: 'tenant_required' }, true);

      const parsed = ListRecipesInputZod.safeParse(args);
      if (!parsed.success) {
        return jsonResult(
          {
            error: 'invalid_recipe_filter',
            details: parsed.error.issues.map((issue) => issue.message),
          },
          true
        );
      }

      const recipes = await listRecipes(tenant.id, parsed.data.filter);
      return jsonResult({ recipes });
    }
  );

  server.tool(
    'run-recipe',
    'Run a saved recipe through the same guarded dispatch path as execute-tool.',
    {
      name: RunRecipeInputZod.shape.name,
      paramOverrides: RunRecipeInputZod.shape.paramOverrides,
    },
    {
      title: 'run-recipe',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    async (args) => {
      const tenant = requireTenant();
      if (!tenant) return jsonResult({ error: 'tenant_required' }, true);

      const parsed = RunRecipeInputZod.safeParse(args);
      if (!parsed.success) {
        return jsonResult(
          {
            error: 'invalid_recipe_run',
            details: parsed.error.issues.map((issue) => issue.message),
          },
          true
        );
      }

      const recipe = await getRecipeByName(tenant.id, parsed.data.name);
      if (!recipe) {
        return jsonResult({ error: 'recipe_not_found' }, true);
      }

      const merged = mergeRecipeParams(recipe.params, parsed.data.paramOverrides ?? {});
      const result = await executeToolAlias({
        toolName: recipe.alias,
        parameters: merged,
        graphClient: deps.graphClient,
        authManager: deps.authManager,
        readOnly: deps.readOnly ?? false,
        orgMode: deps.orgMode ?? false,
      });

      if (!result.isError) {
        await markRecipeRun(tenant.id, recipe.name);
        await publishRecipeChange(deps.redis, tenant.id);
      }

      return result;
    }
  );
}
