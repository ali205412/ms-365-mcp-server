import { DISCOVERY_META_TOOL_NAMES, isDiscoverySurface } from '../tenant-surface/surface.js';

const EMPTY_SET: ReadonlySet<string> = Object.freeze(new Set<string>());

export interface DiscoveryCatalogResolution {
  visibleToolsSet: ReadonlySet<string>;
  discoveryCatalogSet: ReadonlySet<string>;
  isDiscoverySurface: boolean;
}

export interface DiscoveryCatalogInput {
  presetVersion?: string;
  enabledToolsSet?: ReadonlySet<string>;
  enabledToolsExplicit?: boolean;
  registryAliases: Iterable<string>;
}

export function resolveDiscoveryCatalog(input: DiscoveryCatalogInput): DiscoveryCatalogResolution {
  if (isDiscoverySurface(input.presetVersion)) {
    const explicitAllowlist = input.enabledToolsExplicit ? input.enabledToolsSet : undefined;
    const discoveryCatalogSet = new Set<string>();
    for (const alias of input.registryAliases) {
      if (
        !DISCOVERY_META_TOOL_NAMES.has(alias) &&
        (!explicitAllowlist || explicitAllowlist.has(alias))
      ) {
        discoveryCatalogSet.add(alias);
      }
    }
    return {
      visibleToolsSet: DISCOVERY_META_TOOL_NAMES,
      discoveryCatalogSet: Object.freeze(discoveryCatalogSet),
      isDiscoverySurface: true,
    };
  }

  const enabledToolsSet = input.enabledToolsSet ?? EMPTY_SET;
  return {
    visibleToolsSet: enabledToolsSet,
    discoveryCatalogSet: enabledToolsSet,
    isDiscoverySurface: false,
  };
}
