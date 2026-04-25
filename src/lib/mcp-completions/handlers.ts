import { api } from '../../generated/client.js';
import { getFlow, getRequestTenant, type AuthFlow } from '../../request-context.js';
import { resolveDiscoveryCatalog } from '../discovery-catalog/catalog.js';

export interface AccountCompletionAuthManager {
  listAccounts(): Promise<Array<{ username?: string | null }>>;
}

export interface CompleteAccountDeps {
  authManager?: AccountCompletionAuthManager;
  flow?: AuthFlow;
}

export interface CompleteAliasDeps {
  registryAliases?: Iterable<string>;
}

const MAX_COMPLETION_VALUES = 20;

export function completeTenantId(_value: string): string[] {
  const tenant = getRequestTenant();
  return tenant.id ? [tenant.id] : [];
}

export async function completeAccount(
  value: string,
  deps: CompleteAccountDeps = {}
): Promise<string[]> {
  const tenant = getRequestTenant();
  if (!tenant.id || !deps.authManager) return [];

  const flow = deps.flow ?? getFlow();
  if (flow !== 'delegated' && flow !== 'device-code') {
    return [];
  }

  const needle = value.trim().toLowerCase();
  const accounts = await deps.authManager.listAccounts();
  return accounts
    .map((account) => account.username)
    .filter((username): username is string => typeof username === 'string' && username.length > 0)
    .filter((username) => username.toLowerCase().startsWith(needle))
    .slice(0, MAX_COMPLETION_VALUES);
}

export function completeAlias(value: string, deps: CompleteAliasDeps = {}): string[] {
  const tenant = getRequestTenant();
  if (!tenant.id || !tenant.presetVersion || !tenant.enabledToolsSet) {
    return [];
  }

  const registryAliases = deps.registryAliases ?? api.endpoints.map((endpoint) => endpoint.alias);
  const catalog = resolveDiscoveryCatalog({
    presetVersion: tenant.presetVersion,
    enabledToolsSet: tenant.enabledToolsSet,
    registryAliases,
  });

  if (!catalog.isDiscoverySurface) {
    return [];
  }

  const needle = value.trim().toLowerCase();
  return [...catalog.discoveryCatalogSet]
    .filter((alias) => !needle || alias.toLowerCase().includes(needle))
    .sort((a, b) => rankAlias(a, needle) - rankAlias(b, needle) || a.localeCompare(b))
    .slice(0, MAX_COMPLETION_VALUES);
}

function rankAlias(alias: string, needle: string): number {
  if (!needle) return 0;
  const lower = alias.toLowerCase();
  if (lower.startsWith(needle)) return 0;
  if (lower.includes(needle)) return 1;
  return 2;
}
