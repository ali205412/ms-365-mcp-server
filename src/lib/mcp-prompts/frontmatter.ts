import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

export const PROMPT_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const PROMPT_ARGUMENT_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const PromptArgumentSchema = z
  .object({
    name: z.string().regex(PROMPT_ARGUMENT_NAME_PATTERN),
    description: z.string().optional(),
    required: z.boolean().optional(),
  })
  .strict();

const PromptFrontmatterSchema = z
  .object({
    name: z.string().regex(PROMPT_NAME_PATTERN),
    description: z.string().min(1),
    arguments: z.array(PromptArgumentSchema),
  })
  .strict()
  .superRefine((frontmatter, ctx) => {
    const seen = new Set<string>();
    frontmatter.arguments.forEach((argument, index) => {
      if (seen.has(argument.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['arguments', index, 'name'],
          message: `Duplicate prompt argument name: ${argument.name}`,
        });
      }
      seen.add(argument.name);
    });
  });

export type PromptArgumentDefinition = z.infer<typeof PromptArgumentSchema>;

export interface PromptTemplateDefinition {
  readonly sourcePath: string;
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly PromptArgumentDefinition[];
  readonly template: string;
}

function splitPromptMarkdown(markdown: string, sourcePath: string): [string, string] {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) {
    throw new Error(`Prompt markdown in ${sourcePath} must start with YAML frontmatter`);
  }
  return [match[1], match[2]];
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`)
    .join('; ');
}

export function parsePromptMarkdown(
  markdown: string,
  sourcePath = '<inline>'
): PromptTemplateDefinition {
  const [frontmatterYaml, template] = splitPromptMarkdown(markdown, sourcePath);
  const parsedYaml = yaml.load(frontmatterYaml);
  const parsedFrontmatter = PromptFrontmatterSchema.safeParse(parsedYaml);

  if (!parsedFrontmatter.success) {
    throw new Error(
      `Invalid prompt frontmatter in ${sourcePath}: ${formatZodError(parsedFrontmatter.error)}`
    );
  }

  return {
    sourcePath,
    name: parsedFrontmatter.data.name,
    description: parsedFrontmatter.data.description,
    arguments: parsedFrontmatter.data.arguments,
    template,
  };
}

export function loadPromptFile(filePath: string): PromptTemplateDefinition {
  return parsePromptMarkdown(fs.readFileSync(filePath, 'utf-8'), filePath);
}

export function loadPromptDirectory(promptDir: string): PromptTemplateDefinition[] {
  if (!fs.existsSync(promptDir)) {
    return [];
  }

  const stat = fs.statSync(promptDir);
  if (!stat.isDirectory()) {
    throw new Error(`Prompt path is not a directory: ${promptDir}`);
  }

  return fs
    .readdirSync(promptDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((fileName) => loadPromptFile(path.join(promptDir, fileName)));
}
