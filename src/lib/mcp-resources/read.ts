import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCode, McpError, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { buildToolsRegistry } from '../../graph-tools.js';
import { getRequestTenant } from '../../request-context.js';
import { resolveDiscoveryCatalog } from '../discovery-catalog/catalog.js';
import { listBookmarks } from '../memory/bookmarks.js';
import { recallFacts } from '../memory/facts.js';
import { listRecipes } from '../memory/recipes.js';
import { getPool } from '../postgres.js';
import { describeToolSchema } from '../tool-schema-describer.js';
import {
  MARKDOWN_MIME_TYPE,
  STATIC_CATALOG_RESOURCES,
  type StaticCatalogResource,
} from './catalog.js';
import {
  assertTenantResourceOwner,
  parseMcpResourceUri,
  type InvalidMcpResourceUri,
  type ParsedMcpResourceUri,
  type TenantMcpResourceUri,
} from './uri.js';

export const JSON_MIME_TYPE = 'application/json';

export interface ReadMcpResourceTenant {
  id?: string;
  allowed_scopes?: readonly string[];
  enabled_tools?: string | null;
  enabled_tools_set?: ReadonlySet<string>;
  preset_version?: string;
}

export interface ReadMcpResourceDeps {
  tenant?: ReadMcpResourceTenant;
  readOnly?: boolean;
  orgMode?: boolean;
}

interface EndpointConfigJson {
  toolName: string;
  scopes?: string[];
  workScopes?: string[];
}

interface AuditRecentRow {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  ip: string | null;
  request_id: string;
  result: 'success' | 'failure';
  meta: unknown;
  ts: Date | string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let scopeMapCache: Readonly<Record<string, readonly string[]>> | null = null;

function throwResourceError(error: InvalidMcpResourceUri): never {
  throw new McpError(ErrorCode.InvalidParams, error.message, { code: error.code });
}

function assertParsed(
  parsed: ParsedMcpResourceUri
): asserts parsed is Exclude<ParsedMcpResourceUri, InvalidMcpResourceUri> {
  if (!parsed.ok) {
    throwResourceError(parsed);
  }
}

function textResult(uri: string, mimeType: string, text: string): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType,
        text,
      },
    ],
  };
}

function jsonResult(uri: string, data: unknown): ReadResourceResult {
  return textResult(uri, JSON_MIME_TYPE, JSON.stringify(data, null, 2));
}

function readProjectFile(resourcePath: string): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', resourcePath),
    path.resolve(__dirname, '..', '..', '..', 'src', resourcePath),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf-8');
    }
  }

  throw new McpError(ErrorCode.InvalidParams, `Resource file not found: ${resourcePath}`, {
    code: 'invalid_resource_uri',
  });
}

function readEndpointsJson(): EndpointConfigJson[] {
  return JSON.parse(readProjectFile('endpoints.json')) as EndpointConfigJson[];
}

function buildScopeMap(): Readonly<Record<string, readonly string[]>> {
  if (scopeMapCache) return scopeMapCache;

  const out: Record<string, string[]> = {};
  for (const endpoint of readEndpointsJson()) {
    const scopes = [...new Set([...(endpoint.scopes ?? []), ...(endpoint.workScopes ?? [])])];
    out[endpoint.toolName] = scopes;
  }

  scopeMapCache = Object.freeze(out);
  return scopeMapCache;
}

function staticResourceFor(parsed: ParsedMcpResourceUri): StaticCatalogResource | undefined {
  if (!parsed.ok || parsed.kind !== 'catalog') return undefined;
  return STATIC_CATALOG_RESOURCES.find((resource) => {
    if (parsed.path === 'navigation-guide.md') {
      return resource.uri === 'mcp://catalog/navigation-guide.md';
    }
    return resource.uri === `mcp://catalog/${parsed.path}`;
  });
}

function readCatalogResource(uri: string, parsed: ParsedMcpResourceUri): ReadResourceResult {
  assertParsed(parsed);
  if (parsed.kind !== 'catalog') {
    throw new McpError(ErrorCode.InvalidParams, 'Resource is not a catalog URI.', {
      code: 'invalid_resource_uri',
    });
  }

  if (parsed.path === 'scope-map.json') {
    return jsonResult(uri, buildScopeMap());
  }

  const resource = staticResourceFor(parsed);
  if (!resource) {
    throw new McpError(ErrorCode.InvalidParams, 'Catalog resource not found.', {
      code: 'invalid_resource_uri',
    });
  }

  return textResult(uri, MARKDOWN_MIME_TYPE, readProjectFile(resource.resourcePath));
}

function tenantContextFromDeps(deps: ReadMcpResourceDeps): {
  id?: string;
  enabledToolsSet?: ReadonlySet<string>;
  enabledToolsExplicit?: boolean;
  presetVersion?: string;
} {
  const requestTenant = getRequestTenant();
  return {
    id: requestTenant.id ?? deps.tenant?.id,
    enabledToolsSet: requestTenant.enabledToolsSet ?? deps.tenant?.enabled_tools_set,
    enabledToolsExplicit:
      requestTenant.enabledToolsExplicit ??
      (deps.tenant ? deps.tenant.enabled_tools !== null : undefined),
    presetVersion: requestTenant.presetVersion ?? deps.tenant?.preset_version,
  };
}

function readEndpointSchemaResource(
  uri: string,
  alias: string,
  deps: ReadMcpResourceDeps
): ReadResourceResult {
  const tenant = tenantContextFromDeps(deps);
  if (!tenant.enabledToolsSet || !tenant.presetVersion) {
    throw new McpError(ErrorCode.InvalidParams, 'Tenant context unavailable for schema resource.', {
      code: 'tenant_resource_mismatch',
    });
  }

  const toolsRegistry = buildToolsRegistry(Boolean(deps.readOnly), Boolean(deps.orgMode));
  const catalog = resolveDiscoveryCatalog({
    presetVersion: tenant.presetVersion,
    enabledToolsSet: tenant.enabledToolsSet,
    enabledToolsExplicit: tenant.enabledToolsExplicit,
    registryAliases: toolsRegistry.keys(),
  });

  if (!catalog.discoveryCatalogSet.has(alias)) {
    throw new McpError(ErrorCode.InvalidParams, `Endpoint schema not found: ${alias}`, {
      code: 'invalid_resource_uri',
    });
  }

  const entry = toolsRegistry.get(alias);
  if (!entry) {
    throw new McpError(ErrorCode.InvalidParams, `Endpoint schema not found: ${alias}`, {
      code: 'invalid_resource_uri',
    });
  }

  return jsonResult(uri, describeToolSchema(entry.tool, entry.config?.llmTip));
}

function enabledToolsPayload(deps: ReadMcpResourceDeps): {
  presetVersion?: string;
  enabledTools: string[];
} {
  const tenant = tenantContextFromDeps(deps);
  return {
    presetVersion: tenant.presetVersion,
    enabledTools: [...(tenant.enabledToolsSet ?? [])].sort(),
  };
}

function scopesPayload(deps: ReadMcpResourceDeps): {
  scopes: readonly string[];
} {
  return {
    scopes: deps.tenant?.allowed_scopes ?? [],
  };
}

function toAuditJson(row: AuditRecentRow): Record<string, unknown> {
  const ts = row.ts instanceof Date ? row.ts.toISOString() : new Date(row.ts).toISOString();
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    target: row.target,
    ip: row.ip,
    requestId: row.request_id,
    result: row.result,
    meta: row.meta,
    ts,
  };
}

async function readAuditRecent(tenantId: string): Promise<Record<string, unknown>[]> {
  const result = await getPool().query<AuditRecentRow>(
    `SELECT id, actor, action, target, ip, request_id, result, meta, ts
     FROM audit_log
     WHERE tenant_id = $1
     ORDER BY ts DESC
     LIMIT 100`,
    [tenantId]
  );
  return result.rows.map(toAuditJson);
}

async function readTenantResource(
  uri: string,
  parsed: TenantMcpResourceUri,
  deps: ReadMcpResourceDeps
): Promise<ReadResourceResult> {
  const owned = assertTenantResourceOwner(parsed, getRequestTenant().id ?? deps.tenant?.id);
  assertParsed(owned);
  if (owned.kind !== 'tenant') {
    throw new McpError(ErrorCode.InvalidParams, 'Resource is not a tenant URI.', {
      code: 'invalid_resource_uri',
    });
  }

  switch (owned.view) {
    case 'enabled-tools':
      return jsonResult(uri, enabledToolsPayload(deps));
    case 'scopes':
      return jsonResult(uri, scopesPayload(deps));
    case 'audit/recent':
      return jsonResult(uri, await readAuditRecent(owned.tenantId));
    case 'bookmarks':
      return jsonResult(uri, await listBookmarks(owned.tenantId));
    case 'recipes':
      return jsonResult(uri, await listRecipes(owned.tenantId));
    case 'facts':
      return jsonResult(uri, await recallFacts(owned.tenantId, { limit: 100 }));
  }
}

export async function readMcpResource(
  uri: string,
  deps: ReadMcpResourceDeps
): Promise<ReadResourceResult> {
  const parsed = parseMcpResourceUri(uri);
  assertParsed(parsed);

  switch (parsed.kind) {
    case 'catalog':
      return readCatalogResource(uri, parsed);
    case 'endpoint':
      return readEndpointSchemaResource(uri, parsed.alias, deps);
    case 'tenant':
      return readTenantResource(uri, parsed, deps);
  }
}
