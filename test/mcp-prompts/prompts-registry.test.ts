/**
 * Phase 7 Plan 07-07 — MCP prompt parser and renderer contract.
 */
import { describe, expect, it } from 'vitest';
import { parsePromptMarkdown } from '../../src/lib/mcp-prompts/frontmatter.js';
import { renderPromptTemplate } from '../../src/lib/mcp-prompts/renderer.js';

const VALID_PROMPT = `---
name: inbox-triage
description: Triage unread mail
arguments:
  - name: account
    description: Optional account hint
  - name: since
    description: Required lower bound
    required: true
---
Use {{account}} to triage mail since {{since}}.
`;

describe('Phase 7 Plan 07-07 — prompt frontmatter loader', () => {
  it('rejects prompt names outside the bounded MCP-safe pattern', () => {
    expect(() =>
      parsePromptMarkdown(`---
name: ../../escape
description: Bad prompt
arguments: []
---
Body`)
    ).toThrow(/name/i);

    expect(() =>
      parsePromptMarkdown(`---
name: ${'a'.repeat(65)}
description: Bad prompt
arguments: []
---
Body`)
    ).toThrow(/name/i);
  });

  it('requires name, description, and arguments frontmatter', () => {
    expect(() =>
      parsePromptMarkdown(`---
name: missing-description
arguments: []
---
Body`)
    ).toThrow(/description/i);

    expect(() =>
      parsePromptMarkdown(`---
name: missing-args
description: Missing arguments
---
Body`)
    ).toThrow(/arguments/i);
  });

  it('returns validated prompt metadata and the markdown template body', () => {
    const parsed = parsePromptMarkdown(VALID_PROMPT, 'inbox-triage.md');

    expect(parsed).toEqual({
      sourcePath: 'inbox-triage.md',
      name: 'inbox-triage',
      description: 'Triage unread mail',
      arguments: [
        { name: 'account', description: 'Optional account hint' },
        { name: 'since', description: 'Required lower bound', required: true },
      ],
      template: 'Use {{account}} to triage mail since {{since}}.\n',
    });
  });
});

describe('Phase 7 Plan 07-07 — bounded prompt renderer', () => {
  it('substitutes identifier tokens with provided values', () => {
    const result = renderPromptTemplate(
      'Run {{tool_name}} for {{account}}.',
      { tool_name: 'me.sendMail', account: 'primary' },
      [
        { name: 'tool_name', required: true },
        { name: 'account' },
      ]
    );

    expect(result).toEqual({
      ok: true,
      text: 'Run me.sendMail for primary.',
    });
  });

  it('renders missing optional args as empty strings and returns safe required-arg errors', () => {
    const optional = renderPromptTemplate('Account={{account}}.', {}, [{ name: 'account' }]);
    expect(optional).toEqual({ ok: true, text: 'Account=.' });

    const missingRequired = renderPromptTemplate('Query={{query}}.', {}, [
      { name: 'query', required: true },
    ]);
    expect(missingRequired).toEqual({
      ok: false,
      error: {
        code: 'missing_required_argument',
        message: 'Missing required prompt argument: query',
        argument: 'query',
      },
    });
  });

  it('does not execute arbitrary code or nested expressions', () => {
    const result = renderPromptTemplate(
      'Unsafe {{globalThis.process.exit()}} nested {{outer{{inner}}}} safe {{inner}}.',
      { inner: 'VALUE' },
      [{ name: 'inner' }]
    );

    expect(result).toEqual({
      ok: true,
      text: 'Unsafe {{globalThis.process.exit()}} nested {{outer{{inner}}}} safe VALUE.',
    });
  });
});
