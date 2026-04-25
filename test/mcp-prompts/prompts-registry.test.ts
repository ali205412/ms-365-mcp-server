/**
 * Phase 7 Plan 07-07 — MCP prompt parser and renderer contract.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parsePromptMarkdown } from '../../src/lib/mcp-prompts/frontmatter.js';
import { registerMcpPrompts } from '../../src/lib/mcp-prompts/register.js';
import { renderPromptTemplate } from '../../src/lib/mcp-prompts/renderer.js';
import MicrosoftGraphServer from '../../src/server.js';
import {
  DISCOVERY_META_TOOL_NAMES,
  DISCOVERY_PRESET_VERSION,
} from '../../src/lib/tenant-surface/surface.js';

vi.mock('../../src/generated/client.js', () => ({
  api: {
    endpoints: [{ alias: 'me.sendMail', method: 'post', path: '/me/sendMail' }],
  },
}));

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

let tmpDirs: string[] = [];

interface ListPromptsResponse {
  prompts: Array<{
    name: string;
    description?: string;
    arguments?: Array<{ name: string; required?: boolean }>;
  }>;
}

interface GetPromptResponse {
  messages: Array<{ role: string; content: { type: string; text: string } }>;
}

function makeTmpDir(): string {
  const dir = path.join(os.tmpdir(), `plan-07-07-prompts-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function writePrompt(dir: string, fileName = 'inbox-triage.md'): void {
  fs.writeFileSync(path.join(dir, fileName), VALID_PROMPT);
}

async function invokePromptsList(server: McpServer): Promise<ListPromptsResponse> {
  const handler = (
    server.server as unknown as {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => ListPromptsResponse>;
    }
  )._requestHandlers.get('prompts/list');
  if (!handler) {
    throw new Error('prompts/list handler not registered on McpServer');
  }
  return handler(
    { method: 'prompts/list', params: {} },
    { requestId: 'test', sendNotification: vi.fn(), sendRequest: vi.fn() }
  );
}

async function invokePromptGet(
  server: McpServer,
  name: string,
  args: Record<string, string>
): Promise<GetPromptResponse> {
  const handler = (
    server.server as unknown as {
      _requestHandlers: Map<string, (req: unknown, extra: unknown) => Promise<GetPromptResponse>>;
    }
  )._requestHandlers.get('prompts/get');
  if (!handler) {
    throw new Error('prompts/get handler not registered on McpServer');
  }
  return handler(
    { method: 'prompts/get', params: { name, arguments: args } },
    { requestId: 'test', sendNotification: vi.fn(), sendRequest: vi.fn() }
  );
}

function capabilitiesOf(server: McpServer): { prompts?: { listChanged?: boolean } } {
  return (
    server.server as unknown as {
      getCapabilities: () => { prompts?: { listChanged?: boolean } };
    }
  ).getCapabilities();
}

function createServerFactory(
  promptDeps: Parameters<typeof registerMcpPrompts>[1]
): MicrosoftGraphServer {
  return new MicrosoftGraphServer(
    {
      isMultiAccount: vi.fn(async () => false),
      listAccounts: vi.fn(async () => []),
    } as never,
    { http: true, orgMode: true },
    [],
    { promptDeps } as never
  );
}

afterEach(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

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

describe('Phase 7 Plan 07-07 — MCP prompt registration', () => {
  it('registers prompt definitions from a supplied prompt directory or injected loader fixture', async () => {
    const promptDir = makeTmpDir();
    writePrompt(promptDir);

    const dirServer = new McpServer({ name: 'test', version: '0.0.0' });
    expect(registerMcpPrompts(dirServer, { promptDir })).toEqual({ registered: 1 });
    await expect(invokePromptsList(dirServer)).resolves.toMatchObject({
      prompts: [
        {
          name: 'inbox-triage',
          description: 'Triage unread mail',
        },
      ],
    });

    const fixtureServer = new McpServer({ name: 'test', version: '0.0.0' });
    const fixture = parsePromptMarkdown(VALID_PROMPT, 'fixture.md');
    expect(registerMcpPrompts(fixtureServer, { loadPrompts: () => [fixture] })).toEqual({
      registered: 1,
    });
    await expect(invokePromptsList(fixtureServer)).resolves.toMatchObject({
      prompts: [{ name: 'inbox-triage' }],
    });
  });

  it('prompts/get returns a user text message for a valid prompt', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerMcpPrompts(server, {
      loadPrompts: () => [parsePromptMarkdown(VALID_PROMPT, 'fixture.md')],
    });

    await expect(invokePromptGet(server, 'inbox-triage', { since: '2026-04-25' })).resolves.toEqual({
      description: 'Triage unread mail',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Use  to triage mail since 2026-04-25.\n',
          },
        },
      ],
    });
  });

  it('static tenant server has no prompt capability or prompt list handler', () => {
    const graphServer = createServerFactory({
      loadPrompts: () => [parsePromptMarkdown(VALID_PROMPT, 'fixture.md')],
    });
    const mcp = graphServer.createMcpServer({
      preset_version: 'essentials-v1',
      enabled_tools_set: Object.freeze(new Set(['me.sendMail'])),
    } as never);
    const handlers = (
      mcp.server as unknown as {
        _requestHandlers: Map<string, unknown>;
      }
    )._requestHandlers;

    expect(handlers.has('prompts/list')).toBe(false);
    expect(handlers.has('prompts/get')).toBe(false);
    expect(capabilitiesOf(mcp).prompts).toBeUndefined();
  });

  it('discovery tenant prompt capability uses prompts.listChanged false', async () => {
    const graphServer = createServerFactory({
      loadPrompts: () => [parsePromptMarkdown(VALID_PROMPT, 'fixture.md')],
    });
    const mcp = graphServer.createMcpServer({
      preset_version: DISCOVERY_PRESET_VERSION,
      enabled_tools_set: DISCOVERY_META_TOOL_NAMES,
    } as never);

    expect(capabilitiesOf(mcp).prompts).toEqual({ listChanged: false });
    await expect(invokePromptsList(mcp)).resolves.toMatchObject({
      prompts: [{ name: 'inbox-triage' }],
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
