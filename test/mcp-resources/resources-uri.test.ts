import { describe, expect, it } from 'vitest';
import {
  assertTenantResourceOwner,
  parseMcpResourceUri,
} from '../../src/lib/mcp-resources/uri.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('Phase 7 Plan 07-11 Task 1 - MCP resource URI parser', () => {
  it('parses catalog navigation guide URIs', () => {
    expect(parseMcpResourceUri('mcp://catalog/navigation-guide.md')).toEqual({
      ok: true,
      kind: 'catalog',
      path: 'navigation-guide.md',
    });
  });

  it('parses catalog workload guide URIs and extracts the workload slug', () => {
    expect(parseMcpResourceUri('mcp://catalog/workloads/mail.md')).toEqual({
      ok: true,
      kind: 'catalog',
      path: 'workloads/mail.md',
      workloadSlug: 'mail',
    });
  });

  it('parses endpoint schema URIs and extracts the endpoint alias', () => {
    expect(parseMcpResourceUri('mcp://endpoint/list-mail-messages.schema.json')).toEqual({
      ok: true,
      kind: 'endpoint',
      alias: 'list-mail-messages',
    });
  });

  it('parses tenant resource URIs and extracts tenant id plus resource view', () => {
    expect(parseMcpResourceUri(`mcp://tenant/${TENANT_A}/bookmarks.json`)).toEqual({
      ok: true,
      kind: 'tenant',
      tenantId: TENANT_A,
      view: 'bookmarks',
      path: 'bookmarks.json',
    });

    expect(parseMcpResourceUri(`mcp://tenant/${TENANT_A}/audit/recent.json`)).toEqual({
      ok: true,
      kind: 'tenant',
      tenantId: TENANT_A,
      view: 'audit/recent',
      path: 'audit/recent.json',
    });
  });

  it('rejects non-mcp schemes and unknown path families with typed invalid results', () => {
    expect(parseMcpResourceUri('https://catalog/navigation-guide.md')).toMatchObject({
      ok: false,
      code: 'invalid_scheme',
    });
    expect(parseMcpResourceUri('mcp://catalog/../navigation-guide.md')).toMatchObject({
      ok: false,
      code: 'invalid_resource_uri',
    });
    expect(parseMcpResourceUri('mcp://endpoint/.schema.json')).toMatchObject({
      ok: false,
      code: 'invalid_resource_uri',
    });
    expect(parseMcpResourceUri(`mcp://tenant/${TENANT_A}/unknown.json`)).toMatchObject({
      ok: false,
      code: 'invalid_resource_uri',
    });
  });

  it('enforces tenant URI ownership with one client-safe mismatch code', () => {
    const parsed = parseMcpResourceUri(`mcp://tenant/${TENANT_A}/bookmarks.json`);

    expect(assertTenantResourceOwner(parsed, TENANT_A)).toEqual(parsed);
    expect(assertTenantResourceOwner(parsed, TENANT_B)).toMatchObject({
      ok: false,
      code: 'tenant_resource_mismatch',
    });
    expect(assertTenantResourceOwner(parsed, undefined)).toMatchObject({
      ok: false,
      code: 'tenant_resource_mismatch',
    });
  });
});
