import type { PromptArgumentDefinition } from './frontmatter.js';

export interface PromptRenderSuccess {
  readonly ok: true;
  readonly text: string;
}

export interface PromptRenderMissingArgumentError {
  readonly ok: false;
  readonly error: {
    readonly code: 'missing_required_argument';
    readonly message: string;
    readonly argument: string;
  };
}

export type PromptRenderResult = PromptRenderSuccess | PromptRenderMissingArgumentError;

const IDENTIFIER_TOKEN_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

function isNestedPlaceholder(template: string, offset: number): boolean {
  const previousOpen = template.lastIndexOf('{{', offset - 1);
  const previousClose = template.lastIndexOf('}}', offset - 1);
  return previousOpen > previousClose;
}

export function renderPromptTemplate(
  template: string,
  args: Record<string, unknown>,
  argSpec: readonly Pick<PromptArgumentDefinition, 'name' | 'required'>[]
): PromptRenderResult {
  const specByName = new Map(argSpec.map((spec) => [spec.name, spec]));
  const missingRequired = argSpec.find(
    (spec) => spec.required === true && (args[spec.name] === undefined || args[spec.name] === null)
  );

  if (missingRequired) {
    return {
      ok: false,
      error: {
        code: 'missing_required_argument',
        message: `Missing required prompt argument: ${missingRequired.name}`,
        argument: missingRequired.name,
      },
    };
  }

  const text = template.replace(IDENTIFIER_TOKEN_PATTERN, (raw, name: string, offset: number) => {
    if (isNestedPlaceholder(template, offset) || !specByName.has(name)) {
      return raw;
    }

    const value = args[name];
    return value === undefined || value === null ? '' : String(value);
  });

  return { ok: true, text };
}
