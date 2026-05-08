import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createMcpErrorEnvelope,
  createMcpResultEnvelope,
  outputSchemaFor,
} from '../src/lib/mcp-results/envelope.js';
import {
  McpResultEnvelopeZod,
  McpStructuredContentZod,
  toOutputJsonSchema,
} from '../src/lib/mcp-results/schemas.js';

const forbiddenPayload = {
  ok: true,
  accessToken: 'token',
  nested: {
    refreshToken: 'refresh',
    keep: 'value',
  },
  items: [
    {
      clientSecret: 'secret',
      keep: true,
    },
  ],
  headers: {
    Authorization: 'Bearer abc',
    accept: 'application/json',
  },
};

describe('MCP result envelope helpers', () => {
  it('creates schema-valid success envelopes with non-empty text fallback', () => {
    const result = createMcpResultEnvelope({
      toolName: 'search-tools',
      summary: 'Found 1 matching tool.',
      data: { found: 1, tools: [{ name: 'me-message-list', method: 'GET' }] },
      resources: [{ uri: 'm365://tenant/current/search/results.json', name: 'Search results' }],
      nextActions: ['Call get-tool-schema for me-message-list.'],
      meta: { tenantRef: 'tenant:opaque', correlationId: 'corr-1' },
    });

    expect(result.content[0]?.type).toBe('text');
    expect(result.content[0]?.text.trim().length).toBeGreaterThan(0);
    expect(result.structuredContent).toBeDefined();
    expect(result.structuredContent?.summary).toBe('Found 1 matching tool.');
    expect(McpResultEnvelopeZod.parse(result)).toEqual(result);
    expect(McpStructuredContentZod.parse(result.structuredContent)).toEqual(
      result.structuredContent
    );
  });

  it('falls back to text and warning metadata when structuredContent is invalid', () => {
    const result = createMcpResultEnvelope({
      toolName: 'bad-tool',
      summary: '',
      data: { ok: true },
      nextActions: [],
    });

    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toContain('Structured result unavailable');
    expect(result._meta?.structuredFallback).toBe(true);
    expect(result._meta?.warnings).toContain('structured_content_schema_invalid');
    expect(McpResultEnvelopeZod.parse(result)).toEqual(result);
  });

  it('creates schema-valid error envelopes with text and structured errors', () => {
    const result = createMcpErrorEnvelope({
      toolName: 'execute-tool',
      summary: 'Tool execution failed.',
      code: 'tool_error',
      message: 'Graph rejected the request.',
      nextActions: ['Check get-tool-schema and retry with valid parameters.'],
      meta: { correlationId: 'corr-2' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Tool execution failed.');
    expect(result.structuredContent?.data).toMatchObject({
      error: { code: 'tool_error', message: 'Graph rejected the request.' },
    });
    expect(McpResultEnvelopeZod.parse(result)).toEqual(result);
  });

  it('strips forbidden secret keys recursively from data and metadata', () => {
    const result = createMcpResultEnvelope({
      toolName: 'secret-test',
      summary: 'Secret-free result.',
      data: forbiddenPayload,
      meta: forbiddenPayload,
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('refreshToken');
    expect(serialized).not.toContain('clientSecret');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('Bearer abc');
    expect(result.structuredContent?.data).toMatchObject({
      ok: true,
      nested: { keep: 'value' },
      items: [{ keep: true }],
      headers: { accept: 'application/json' },
    });
    expect(McpResultEnvelopeZod.parse(result)).toEqual(result);
  });

  it('exposes stable JSON output schemas by tool name', () => {
    const schema = outputSchemaFor('search-tools');
    expect(schema).toEqual(toOutputJsonSchema('search-tools'));
    expect(schema).toHaveProperty('type', 'object');
    expect(JSON.stringify(schema)).toContain('structuredContent');
  });

  it('rejects forbidden keys when validating caller-supplied structured content directly', () => {
    expect(() =>
      McpStructuredContentZod.parse({
        summary: 'Bad payload.',
        data: { accessToken: 'token' },
        resources: [],
        nextActions: ['Remove secrets.'],
        warnings: [],
      })
    ).toThrow(z.ZodError);
  });
});
