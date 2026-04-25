import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  loadPromptDirectory,
  type PromptArgumentDefinition,
  type PromptTemplateDefinition,
} from './frontmatter.js';
import { renderPromptTemplate } from './renderer.js';
import {
  completeAccount,
  completeAlias,
  completeTenantId,
  type AccountCompletionAuthManager,
} from '../mcp-completions/handlers.js';

const DEFAULT_PROMPT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'prompts'
);

export interface RegisterMcpPromptsDeps {
  readonly promptDir?: string;
  readonly loadPrompts?: () => readonly PromptTemplateDefinition[];
  readonly authManager?: AccountCompletionAuthManager;
}

export interface RegisterMcpPromptsResult {
  readonly registered: number;
}

function loadPromptDefinitions(deps: RegisterMcpPromptsDeps): PromptTemplateDefinition[] {
  const definitions = deps.loadPrompts
    ? [...deps.loadPrompts()]
    : loadPromptDirectory(deps.promptDir ?? DEFAULT_PROMPT_DIR);
  return definitions.sort((a, b) => a.name.localeCompare(b.name));
}

function assertUniquePromptNames(prompts: readonly PromptTemplateDefinition[]): void {
  const seen = new Set<string>();
  for (const prompt of prompts) {
    if (seen.has(prompt.name)) {
      throw new Error(`Duplicate MCP prompt name: ${prompt.name}`);
    }
    seen.add(prompt.name);
  }
}

function promptArgsSchema(
  args: readonly PromptArgumentDefinition[],
  deps: RegisterMcpPromptsDeps
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const arg of args) {
    let schema: z.ZodTypeAny = z
      .string()
      .describe(arg.description ?? `Prompt argument ${arg.name}`);
    const complete =
      arg.name === 'tenantId'
        ? completeTenantId
        : arg.name === 'account'
          ? (value: string) => completeAccount(value, { authManager: deps.authManager })
          : arg.name === 'alias'
            ? completeAlias
            : undefined;
    if (arg.required !== true) {
      schema = schema.optional();
    }
    if (complete) {
      schema = completable(schema, complete);
    }
    shape[arg.name] = schema;
  }
  return shape;
}

function validationErrorResult(
  prompt: PromptTemplateDefinition,
  error: Exclude<ReturnType<typeof renderPromptTemplate>, { ok: true }>['error']
): GetPromptResult {
  return {
    description: prompt.description,
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: JSON.stringify({ error }, null, 2),
        },
      },
    ],
  };
}

export function registerMcpPrompts(
  server: McpServer,
  deps: RegisterMcpPromptsDeps = {}
): RegisterMcpPromptsResult {
  const prompts = loadPromptDefinitions(deps);
  if (prompts.length === 0) {
    return { registered: 0 };
  }

  assertUniquePromptNames(prompts);

  for (const prompt of prompts) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.name,
        description: prompt.description,
        argsSchema: promptArgsSchema(prompt.arguments, deps),
      },
      (args): GetPromptResult => {
        const rendered = renderPromptTemplate(
          prompt.template,
          args as Record<string, unknown>,
          prompt.arguments
        );
        if (!rendered.ok) {
          return validationErrorResult(prompt, rendered.error);
        }

        return {
          description: prompt.description,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: rendered.text,
              },
            },
          ],
        };
      }
    );
  }

  server.server.registerCapabilities({
    prompts: { listChanged: false },
  });

  return { registered: prompts.length };
}
