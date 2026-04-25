import { WORKLOAD_GUIDE_SLUGS, type WorkloadGuideSlug } from './catalog.js';

export type TenantResourceView =
  | 'enabled-tools'
  | 'scopes'
  | 'audit/recent'
  | 'bookmarks'
  | 'recipes'
  | 'facts';

export type ResourceUriErrorCode =
  | 'invalid_scheme'
  | 'invalid_resource_uri'
  | 'tenant_resource_mismatch';

export interface InvalidMcpResourceUri {
  ok: false;
  code: ResourceUriErrorCode;
  message: string;
}

export interface CatalogMcpResourceUri {
  ok: true;
  kind: 'catalog';
  path: 'navigation-guide.md' | 'scope-map.json' | `workloads/${WorkloadGuideSlug}.md`;
  workloadSlug?: WorkloadGuideSlug;
}

export interface EndpointMcpResourceUri {
  ok: true;
  kind: 'endpoint';
  alias: string;
}

export interface TenantMcpResourceUri {
  ok: true;
  kind: 'tenant';
  tenantId: string;
  view: TenantResourceView;
  path:
    | 'enabled-tools.json'
    | 'scopes.json'
    | 'audit/recent.json'
    | 'bookmarks.json'
    | 'recipes.json'
    | 'facts.json';
}

export type ValidMcpResourceUri =
  | CatalogMcpResourceUri
  | EndpointMcpResourceUri
  | TenantMcpResourceUri;

export type ParsedMcpResourceUri = ValidMcpResourceUri | InvalidMcpResourceUri;

const WORKLOAD_GUIDE_SET: ReadonlySet<string> = Object.freeze(new Set(WORKLOAD_GUIDE_SLUGS));

const TENANT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TENANT_VIEW_BY_PATH: ReadonlyMap<string, TenantResourceView> = Object.freeze(
  new Map<string, TenantResourceView>([
    ['enabled-tools.json', 'enabled-tools'],
    ['scopes.json', 'scopes'],
    ['audit/recent.json', 'audit/recent'],
    ['bookmarks.json', 'bookmarks'],
    ['recipes.json', 'recipes'],
    ['facts.json', 'facts'],
  ])
);

function invalid(code: ResourceUriErrorCode, message: string): InvalidMcpResourceUri {
  return { ok: false, code, message };
}

function decodePathname(url: URL): string | null {
  try {
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

function hasNoUrlDecorators(url: URL): boolean {
  return (
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.port === ''
  );
}

function parseCatalogResource(pathname: string): ParsedMcpResourceUri {
  if (pathname === 'navigation-guide.md' || pathname === 'scope-map.json') {
    return { ok: true, kind: 'catalog', path: pathname };
  }

  const match = /^workloads\/([a-z0-9-]+)\.md$/.exec(pathname);
  if (!match) {
    return invalid('invalid_resource_uri', 'Unsupported catalog resource path.');
  }

  const slug = match[1];
  if (!WORKLOAD_GUIDE_SET.has(slug)) {
    return invalid('invalid_resource_uri', 'Unsupported workload guide slug.');
  }

  return {
    ok: true,
    kind: 'catalog',
    path: `workloads/${slug}.md` as `workloads/${WorkloadGuideSlug}.md`,
    workloadSlug: slug as WorkloadGuideSlug,
  };
}

function parseEndpointResource(pathname: string): ParsedMcpResourceUri {
  const suffix = '.schema.json';
  if (!pathname.endsWith(suffix)) {
    return invalid('invalid_resource_uri', 'Endpoint resource must end with .schema.json.');
  }

  const alias = pathname.slice(0, -suffix.length);
  if (alias.length === 0 || alias.includes('/')) {
    return invalid('invalid_resource_uri', 'Endpoint schema alias is invalid.');
  }

  return { ok: true, kind: 'endpoint', alias };
}

function parseTenantResource(pathname: string): ParsedMcpResourceUri {
  const segments = pathname.split('/');
  const tenantId = segments.shift();
  if (!tenantId || !TENANT_ID_RE.test(tenantId)) {
    return invalid('invalid_resource_uri', 'Tenant resource URI must include a UUID tenant id.');
  }

  const resourcePath = segments.join('/');
  const view = TENANT_VIEW_BY_PATH.get(resourcePath);
  if (!view) {
    return invalid('invalid_resource_uri', 'Unsupported tenant resource path.');
  }

  return {
    ok: true,
    kind: 'tenant',
    tenantId,
    view,
    path: resourcePath as TenantMcpResourceUri['path'],
  };
}

export function parseMcpResourceUri(raw: string): ParsedMcpResourceUri {
  if (/\/\.{1,2}(?:\/|$)/.test(raw)) {
    return invalid('invalid_resource_uri', 'Resource URI path must not include dot segments.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid('invalid_resource_uri', 'Resource URI is not a valid URL.');
  }

  if (url.protocol !== 'mcp:') {
    return invalid('invalid_scheme', 'Resource URI must use the mcp: scheme.');
  }

  if (!hasNoUrlDecorators(url)) {
    return invalid('invalid_resource_uri', 'Resource URI must not include auth, query, or hash.');
  }

  const pathname = decodePathname(url);
  if (!pathname || pathname.includes('..') || pathname.includes('//')) {
    return invalid('invalid_resource_uri', 'Resource URI path is invalid.');
  }

  switch (url.hostname) {
    case 'catalog':
      return parseCatalogResource(pathname);
    case 'endpoint':
      return parseEndpointResource(pathname);
    case 'tenant':
      return parseTenantResource(pathname);
    default:
      return invalid('invalid_resource_uri', 'Unsupported MCP resource host.');
  }
}

export function assertTenantResourceOwner(
  parsed: ParsedMcpResourceUri,
  callerTenantId: string | undefined
): ParsedMcpResourceUri {
  if (!parsed.ok || parsed.kind !== 'tenant') {
    return parsed;
  }

  if (!callerTenantId || parsed.tenantId !== callerTenantId) {
    return invalid('tenant_resource_mismatch', 'Tenant resource does not belong to caller.');
  }

  return parsed;
}
