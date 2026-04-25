/**
 * Tests for buildWwwAuthenticate (RFC 9728 / MCP 2025-06-18).
 *
 * Verifies the header value emitted on 401 responses correctly points
 * MCP clients at the OAuth Protected Resource Metadata document.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';
import { buildWwwAuthenticate, resolvePublicBase } from '../../src/lib/www-authenticate.js';

function makeReq(
  opts: {
    protocol?: string;
    host?: string;
  } = {}
): Request {
  const headers: Record<string, string> = {};
  if (opts.host) headers.host = opts.host;
  return {
    protocol: opts.protocol ?? 'https',
    headers,
    get(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

describe('buildWwwAuthenticate', () => {
  const ORIGINAL_PUBLIC_URL = process.env.MS365_MCP_PUBLIC_URL;
  const ORIGINAL_BASE_URL = process.env.MS365_MCP_BASE_URL;

  beforeEach(() => {
    delete process.env.MS365_MCP_PUBLIC_URL;
    delete process.env.MS365_MCP_BASE_URL;
  });

  afterEach(() => {
    if (ORIGINAL_PUBLIC_URL !== undefined) process.env.MS365_MCP_PUBLIC_URL = ORIGINAL_PUBLIC_URL;
    else delete process.env.MS365_MCP_PUBLIC_URL;
    if (ORIGINAL_BASE_URL !== undefined) process.env.MS365_MCP_BASE_URL = ORIGINAL_BASE_URL;
    else delete process.env.MS365_MCP_BASE_URL;
  });

  it('uses MS365_MCP_PUBLIC_URL when set, with tenantId in URL', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'https://mcp.example.com';
    const header = buildWwwAuthenticate({
      req: makeReq(),
      tenantId: 'c9514cd6-4b67-42cb-80f1-821cf82d3303',
    });

    expect(header).toContain(
      'resource_metadata="https://mcp.example.com/t/c9514cd6-4b67-42cb-80f1-821cf82d3303/.well-known/oauth-protected-resource"'
    );
    expect(header).toContain(
      'realm="https://mcp.example.com/t/c9514cd6-4b67-42cb-80f1-821cf82d3303"'
    );
    expect(header.startsWith('Bearer ')).toBe(true);
  });

  it('uses MS365_MCP_PUBLIC_URL with no tenantId → root resource-metadata URL', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'https://mcp.example.com';
    const header = buildWwwAuthenticate({ req: makeReq() });

    expect(header).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
    );
    expect(header).toContain('realm="https://mcp.example.com"');
  });

  it('strips trailing slash on PUBLIC_URL before composing', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'https://mcp.example.com/';
    const header = buildWwwAuthenticate({ req: makeReq(), tenantId: 't1' });
    // No double slashes between host and /t/
    expect(header).toContain('https://mcp.example.com/t/t1/');
    expect(header).not.toMatch(/example\.com\/\/t\//);
  });

  it('falls back to deprecated MS365_MCP_BASE_URL when PUBLIC_URL is unset', () => {
    process.env.MS365_MCP_BASE_URL = 'https://legacy.example.com';
    const header = buildWwwAuthenticate({ req: makeReq() });
    expect(header).toContain('https://legacy.example.com/.well-known/oauth-protected-resource');
  });

  it('falls back to req.protocol + Host header when neither env is set', () => {
    const header = buildWwwAuthenticate({
      req: makeReq({ protocol: 'https', host: 'fallback.example.com' }),
      tenantId: 'tenant-x',
    });
    expect(header).toContain(
      'resource_metadata="https://fallback.example.com/t/tenant-x/.well-known/oauth-protected-resource"'
    );
  });

  it('includes error and error_description in header per RFC 6750 §3', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'https://mcp.example.com';
    const header = buildWwwAuthenticate({
      req: makeReq(),
      tenantId: 'tid',
      error: 'invalid_token',
      errorDescription: 'JWT tid does not match URL tenantId',
    });
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain('error_description="JWT tid does not match URL tenantId"');
  });

  it('preserves param order: realm first, error/desc middle, resource_metadata last', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'https://mcp.example.com';
    const header = buildWwwAuthenticate({
      req: makeReq(),
      tenantId: 'tid',
      error: 'invalid_token',
      errorDescription: 'desc',
    });
    const realmIdx = header.indexOf('realm=');
    const errorIdx = header.indexOf('error=');
    const descIdx = header.indexOf('error_description=');
    const metaIdx = header.indexOf('resource_metadata=');
    expect(realmIdx).toBeLessThan(errorIdx);
    expect(errorIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(metaIdx);
  });

  it('encodes tenantId path segment safely (no path traversal)', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'https://mcp.example.com';
    const header = buildWwwAuthenticate({ req: makeReq(), tenantId: '../../../etc/passwd' });
    expect(header).not.toContain('../');
    expect(header).toContain('%2F');
  });

  it('escapes backslash and double-quote in error description (defensive)', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'https://mcp.example.com';
    const header = buildWwwAuthenticate({
      req: makeReq(),
      error: 'x',
      errorDescription: 'has "quote" and \\backslash',
    });
    expect(header).toContain('error_description="has \\"quote\\" and \\\\backslash"');
  });

  it('falls back to req-derived base when PUBLIC_URL env is malformed', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'not-a-url';
    const header = buildWwwAuthenticate({
      req: makeReq({ protocol: 'https', host: 'fallback.example.com' }),
    });
    expect(header).toContain('https://fallback.example.com/.well-known/oauth-protected-resource');
  });
});

describe('resolvePublicBase', () => {
  const ORIGINAL_PUBLIC_URL = process.env.MS365_MCP_PUBLIC_URL;
  const ORIGINAL_BASE_URL = process.env.MS365_MCP_BASE_URL;

  beforeEach(() => {
    delete process.env.MS365_MCP_PUBLIC_URL;
    delete process.env.MS365_MCP_BASE_URL;
  });

  afterEach(() => {
    if (ORIGINAL_PUBLIC_URL !== undefined) process.env.MS365_MCP_PUBLIC_URL = ORIGINAL_PUBLIC_URL;
    else delete process.env.MS365_MCP_PUBLIC_URL;
    if (ORIGINAL_BASE_URL !== undefined) process.env.MS365_MCP_BASE_URL = ORIGINAL_BASE_URL;
    else delete process.env.MS365_MCP_BASE_URL;
  });

  it('returns env URL with trailing slash stripped', () => {
    process.env.MS365_MCP_PUBLIC_URL = 'https://example.com/';
    expect(resolvePublicBase(makeReq())).toBe('https://example.com');
  });

  it('returns req protocol+host when env unset', () => {
    expect(resolvePublicBase(makeReq({ protocol: 'http', host: 'localhost:3000' }))).toBe(
      'http://localhost:3000'
    );
  });

  it('defaults host to "localhost" when Host header absent', () => {
    expect(resolvePublicBase(makeReq({ protocol: 'http' }))).toBe('http://localhost');
  });
});
