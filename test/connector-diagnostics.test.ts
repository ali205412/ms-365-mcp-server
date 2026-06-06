import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import {
  buildConnectorDiagnostics,
  registerConnectorDiagnosticsTool,
} from '../src/lib/mcp-capabilities/diagnostics.js';
import { getSessionCapabilityProfile } from '../src/lib/mcp-capabilities/session-profile.js';
import {
  buildEffectiveCapabilityProfile,
  DEFAULT_SERVER_CAPABILITIES,
} from '../src/lib/mcp-capabilities/profile.js';
import { McpSessionRegistry } from '../src/lib/mcp-notifications/session-registry.js';
import { requestContext } from '../src/request-context.js';

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const inner = (
    server as unknown as {
      _registeredTools: Record<
        string,
        { handler: (args: Record<string, unknown>, extra?: unknown) => Promise<unknown> }
      >;
    }
  )._registeredTools;
  return inner[name]!.handler(args, {});
}

describe('connector diagnostics', () => {
  it('returns text plus structured JSON without secrets', () => {
    const profile = buildEffectiveCapabilityProfile({
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'hosted-connector', version: '1.0.0' },
      advertisedCapabilities: { tools: {} },
      transport: 'streamable-http',
      surface: 'discovery',
      tenantPolicy: { phase8Enabled: true },
      serverCapabilities: DEFAULT_SERVER_CAPABILITIES,
    });

    const diagnostics = buildConnectorDiagnostics({
      server: { name: 'Microsoft365MCP', version: '0.0.0-test' },
      tenant: {
        id: '11111111-1111-1111-1111-111111111111',
        label: 'Aspire secret@example.com',
      },
      surface: 'discovery',
      profile,
      metadataUrls: {
        protectedResource: 'https://example.test/t/tenant/.well-known/oauth-protected-resource',
      },
      expectedDisplayName: 'Microsoft 365 MCP Gateway',
      requestLike: {
        authorization: 'Bearer access_token=abc',
        cookie: 'session=secret',
        refresh_token: 'refresh',
        graphBody: { subject: 'raw Graph body' },
      },
    });

    expect(diagnostics.text).toContain('Server: Microsoft365MCP 0.0.0-test');
    expect(diagnostics.text).toContain('Health: ok');
    expect(diagnostics.text).toContain('Client capabilities:');
    expect(diagnostics.text).toContain('Apps status: fallback');
    expect(diagnostics.text).toContain('Resources status: fallback');
    expect(diagnostics.text).toContain('Structured results status: enabled');
    expect(diagnostics.text).toContain('Metadata URLs: protectedResource:');
    expect(diagnostics.text).toContain('If Apps UI is unavailable');
    expect(diagnostics.text).toContain('Your client does not advertise');
    expect(diagnostics.structured).toEqual(
      expect.objectContaining({
        health: expect.objectContaining({ status: 'ok' }),
        transport: 'streamable-http',
        capabilities: expect.any(Object),
        capabilityStatuses: expect.any(Array),
        disabledFeatures: expect.any(Array),
        metadataUrls: expect.any(Object),
        fallbackInstructions: expect.any(Array),
        expectedDisplayName: 'Microsoft 365 MCP Gateway',
        fallbacks: expect.any(Array),
      })
    );
    expect(diagnostics.structured.tenant.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(JSON.stringify(diagnostics).toLowerCase()).not.toMatch(
      /authorization|refresh_token|access_token|cookie|raw graph body|secret@example\.com/
    );
  });

  it('registers connector-diagnostics as a tool-only compatible discovery tool', async () => {
    const server = new McpServer({ name: 'Microsoft365MCP', version: '0.0.0-test' });
    registerConnectorDiagnosticsTool(server, {
      server: { name: 'Microsoft365MCP', version: '0.0.0-test' },
      tenant: { id: 'tenant-a' },
      surface: 'discovery',
      transport: 'streamable-http',
      expectedDisplayName: 'Microsoft 365 MCP Gateway',
      metadataUrls: { mcp: 'https://example.test/t/tenant-a/mcp' },
    });

    const result = (await callTool(server, 'connector-diagnostics')) as {
      content: Array<{ type: string; text: string }>;
      structuredContent?: Record<string, unknown>;
    };
    const textPayload = result.content[0]!.text;

    expect(textPayload).toContain('Server: Microsoft365MCP 0.0.0-test');
    expect(textPayload).toContain('Health: ok');
    expect(textPayload).toContain('Tenant: tenant-a');
    expect(textPayload).toContain('Transport: streamable-http');
    expect(textPayload).toContain('Client capabilities:');
    expect(textPayload).toContain('Apps status: fallback');
    expect(textPayload).toContain('Resources status: fallback');
    expect(textPayload).toContain('Structured results status: enabled');
    expect(textPayload).toContain('Metadata URLs: mcp: https://example.test/t/tenant-a/mcp');
    expect(textPayload).toContain('Resources:');
    expect(textPayload).toContain('m365://tenant/tenant-a/dashboards/connector-diagnostics.json');
    expect(textPayload).toContain('If Apps UI is unavailable');
    expect(textPayload).toContain('Your client does not advertise');
    expect(result.structuredContent).toEqual(
      expect.objectContaining({
        health: expect.objectContaining({ status: 'ok' }),
        transport: 'streamable-http',
        capabilities: expect.any(Object),
        capabilityStatuses: expect.any(Array),
        disabledFeatures: expect.any(Array),
        metadataUrls: expect.any(Object),
        fallbackInstructions: expect.any(Array),
        expectedDisplayName: 'Microsoft 365 MCP Gateway',
        fallbacks: expect.any(Array),
        resources: expect.arrayContaining([
          expect.objectContaining({
            uri: 'm365://tenant/tenant-a/dashboards/connector-diagnostics.json',
          }),
        ]),
      })
    );
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(
      /authorization|refresh_token|access_token|cookie/
    );
  });

  it('exposes the diagnostics UI resource for Apps-capable clients', async () => {
    const server = new McpServer({ name: 'Microsoft365MCP', version: '0.0.0-test' });
    const profile = buildEffectiveCapabilityProfile({
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'apps-client' },
      advertisedCapabilities: { tools: {}, apps: {}, resources: {}, structuredToolResults: {} },
      transport: 'streamable-http',
      surface: 'discovery',
      tenantPolicy: { phase8Enabled: true },
      serverCapabilities: DEFAULT_SERVER_CAPABILITIES,
    });

    registerConnectorDiagnosticsTool(server, {
      server: { name: 'Microsoft365MCP', version: '0.0.0-test' },
      tenant: { id: 'tenant-a' },
      surface: 'discovery',
      transport: 'streamable-http',
      profile,
    });

    const result = (await callTool(server, 'connector-diagnostics')) as {
      _meta?: Record<string, unknown>;
      structuredContent?: { resources?: Array<{ uri: string }> };
    };

    expect(result._meta?.['ui/resourceUri']).toBe('ui://m365/connector-diagnostics.html');
    expect(result._meta?.ui).toEqual({ resourceUri: 'ui://m365/connector-diagnostics.html' });
    expect(result.structuredContent?.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uri: 'm365://tenant/tenant-a/dashboards/connector-diagnostics.json',
        }),
      ])
    );
  });

  it('uses the live request capability profile ahead of bootstrap registration defaults', async () => {
    const server = new McpServer({ name: 'Microsoft365MCP', version: '0.0.0-test' });
    const bootstrapProfile = buildEffectiveCapabilityProfile({
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'bootstrap' },
      advertisedCapabilities: { tools: {}, apps: {}, resources: {}, structuredToolResults: {} },
      transport: 'streamable-http',
      surface: 'discovery',
      tenantPolicy: { phase8Enabled: true },
      serverCapabilities: DEFAULT_SERVER_CAPABILITIES,
    });
    const liveProfile = buildEffectiveCapabilityProfile({
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'client-without-apps' },
      advertisedCapabilities: { tools: {} },
      transport: 'streamable-http',
      surface: 'discovery',
      tenantPolicy: { phase8Enabled: true },
      serverCapabilities: DEFAULT_SERVER_CAPABILITIES,
    });

    registerConnectorDiagnosticsTool(server, {
      server: { name: 'Microsoft365MCP', version: '0.0.0-test' },
      tenant: { id: 'tenant-a' },
      surface: 'discovery',
      transport: 'streamable-http',
      profile: bootstrapProfile,
    });

    const result = (await requestContext.run({ capabilityProfile: liveProfile }, () =>
      callTool(server, 'connector-diagnostics')
    )) as {
      content: Array<{ type: string; text: string }>;
      structuredContent?: { capabilities?: Record<string, { effective?: boolean }> };
    };

    expect(result.content[0]!.text).toContain('Apps status: fallback');
    expect(result.content[0]!.text).toContain('Resources status: fallback');
    expect(result.structuredContent?.capabilities?.apps?.effective).toBe(false);
    expect(result.structuredContent?.capabilities?.resources?.effective).toBe(false);
  });

  it('stores and resolves immutable Streamable HTTP session profiles', () => {
    const registry = new McpSessionRegistry();
    const profile = buildEffectiveCapabilityProfile({
      protocolVersion: '2025-06-18',
      clientInfo: { name: 'inspector' },
      advertisedCapabilities: { tools: {}, resources: {} },
      transport: 'streamable-http',
      surface: 'discovery',
      tenantPolicy: { phase8Enabled: true },
    });

    registry.registerSession({
      tenantId: 'tenant-a',
      sessionId: 'session-a',
      server: {
        sendToolListChanged: () => undefined,
        sendResourceListChanged: () => undefined,
        sendResourceUpdated: () => undefined,
        sendPromptListChanged: () => undefined,
        sendLoggingMessage: () => undefined,
      },
      transport: {} as never,
      surface: 'discovery',
      capabilityProfile: profile,
    });

    expect(getSessionCapabilityProfile(registry, 'session-a')).toBe(profile);
    expect(Object.isFrozen(getSessionCapabilityProfile(registry, 'session-a'))).toBe(true);
  });
});
