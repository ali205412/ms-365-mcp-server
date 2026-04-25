import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MARKDOWN_MIME_TYPE, STATIC_CATALOG_RESOURCES, WORKLOAD_GUIDE_SLUGS } from './catalog.js';
import { JSON_MIME_TYPE, readMcpResource, type ReadMcpResourceDeps } from './read.js';
import { registerResourceSubscriptionHandlers } from '../mcp-notifications/register-handlers.js';
import type { RedisResourceSubscriptionStore } from '../mcp-notifications/resource-subscriptions.js';
import { completeAlias } from '../mcp-completions/handlers.js';

export interface RegisterMcpResourcesDeps extends ReadMcpResourceDeps {
  resourceSubscriptions?: RedisResourceSubscriptionStore;
}

interface ResourceDefinition {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

const SCOPE_MAP_RESOURCE: ResourceDefinition = Object.freeze({
  uri: 'mcp://catalog/scope-map.json',
  name: 'catalog-scope-map',
  title: 'Microsoft 365 MCP Scope Map',
  description: 'JSON map of Microsoft 365 MCP endpoint aliases to required Graph scopes.',
  mimeType: JSON_MIME_TYPE,
});

const TENANT_RESOURCE_DEFINITIONS: readonly Omit<ResourceDefinition, 'uri'>[] = Object.freeze([
  {
    name: 'tenant-enabled-tools',
    title: 'Tenant Enabled Tools',
    description: 'Read-only JSON view of the caller tenant enabled tool aliases.',
    mimeType: JSON_MIME_TYPE,
  },
  {
    name: 'tenant-scopes',
    title: 'Tenant Granted Scopes',
    description: 'Read-only JSON view of the caller tenant configured Azure AD scopes.',
    mimeType: JSON_MIME_TYPE,
  },
  {
    name: 'tenant-audit-recent',
    title: 'Tenant Recent Audit Rows',
    description: 'Read-only JSON view of the latest 100 audit rows for the caller tenant.',
    mimeType: JSON_MIME_TYPE,
  },
  {
    name: 'tenant-bookmarks',
    title: 'Tenant Tool Bookmarks',
    description: 'Read-only JSON view of the caller tenant saved tool bookmarks.',
    mimeType: JSON_MIME_TYPE,
  },
  {
    name: 'tenant-recipes',
    title: 'Tenant Tool Recipes',
    description: 'Read-only JSON view of the caller tenant saved tool recipes.',
    mimeType: JSON_MIME_TYPE,
  },
  {
    name: 'tenant-facts',
    title: 'Tenant Facts',
    description: 'Read-only JSON view of the caller tenant remembered facts.',
    mimeType: JSON_MIME_TYPE,
  },
]);

const TENANT_RESOURCE_PATHS = [
  'enabled-tools.json',
  'scopes.json',
  'audit/recent.json',
  'bookmarks.json',
  'recipes.json',
  'facts.json',
] as const;

function staticResourceDefinitions(): ResourceDefinition[] {
  return [
    ...STATIC_CATALOG_RESOURCES.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
    SCOPE_MAP_RESOURCE,
  ];
}

function tenantResourceDefinitions(tenantId: string): ResourceDefinition[] {
  return TENANT_RESOURCE_DEFINITIONS.map((definition, index) => ({
    ...definition,
    uri: `mcp://tenant/${tenantId}/${TENANT_RESOURCE_PATHS[index]}`,
  }));
}

function registerStaticResource(
  server: McpServer,
  resource: ResourceDefinition,
  deps: RegisterMcpResourcesDeps
): void {
  server.registerResource(
    resource.name,
    resource.uri,
    {
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    },
    (uri) => readMcpResource(uri.toString(), deps)
  );
}

function registerTemplates(server: McpServer, deps: RegisterMcpResourcesDeps): void {
  server.registerResource(
    'catalog-workload-guide-template',
    new ResourceTemplate('mcp://catalog/workloads/{slug}.md', {
      list: undefined,
      complete: {
        slug: (value) => WORKLOAD_GUIDE_SLUGS.filter((slug) => slug.startsWith(value)),
      },
    }),
    {
      title: 'Catalog Workload Guide Template',
      description: 'Parameterized workload guide resource for Microsoft 365 catalog navigation.',
      mimeType: MARKDOWN_MIME_TYPE,
    },
    (uri) => readMcpResource(uri.toString(), deps)
  );

  server.registerResource(
    'endpoint-schema-template',
    new ResourceTemplate('mcp://endpoint/{alias}.schema.json', {
      list: undefined,
      complete: {
        alias: (value) => completeAlias(value),
      },
    }),
    {
      title: 'Endpoint Schema Template',
      description: 'Parameterized JSON Schema resource for generated Graph and product aliases.',
      mimeType: JSON_MIME_TYPE,
    },
    (uri) => readMcpResource(uri.toString(), deps)
  );
}

export function registerMcpResources(server: McpServer, deps: RegisterMcpResourcesDeps): void {
  const tenantId = deps.tenant?.id;
  if (!tenantId) {
    return;
  }

  if (deps.resourceSubscriptions) {
    registerResourceSubscriptionHandlers(server, {
      tenantId,
      store: deps.resourceSubscriptions,
    });
  }

  for (const resource of staticResourceDefinitions()) {
    registerStaticResource(server, resource, deps);
  }

  for (const resource of tenantResourceDefinitions(tenantId)) {
    registerStaticResource(server, resource, deps);
  }

  registerTemplates(server, deps);
}
