import { describe, expect, it } from 'vitest';
import {
  STATIC_CATALOG_RESOURCES,
  WORKLOAD_GUIDES,
} from '../../src/lib/mcp-resources/catalog.js';

const LOCKED_WORKLOAD_SLUGS = [
  'mail',
  'calendar',
  'teams',
  'files',
  'sharepoint',
  'users',
  'groups',
  'meetings',
  'presence',
  'virtual-events',
] as const;

describe('Phase 7 Plan 07-06 static resource catalog manifest', () => {
  it('WORKLOAD_GUIDES contains exactly the locked workload slug set', () => {
    expect(WORKLOAD_GUIDES.map((guide) => guide.slug)).toEqual(LOCKED_WORKLOAD_SLUGS);
  });

  it('STATIC_CATALOG_RESOURCES contains navigation plus one URI per workload guide', () => {
    const expectedUris = [
      'mcp://catalog/navigation-guide.md',
      ...LOCKED_WORKLOAD_SLUGS.map((slug) => `mcp://catalog/workloads/${slug}.md`),
    ];

    expect(STATIC_CATALOG_RESOURCES.map((resource) => resource.uri)).toEqual(expectedUris);
    expect(STATIC_CATALOG_RESOURCES).toHaveLength(11);
  });

  it('every manifest entry has stable resource metadata', () => {
    for (const resource of STATIC_CATALOG_RESOURCES) {
      expect(resource.name).toMatch(/^catalog-[a-z0-9-]+$/);
      expect(resource.description.length).toBeGreaterThan(24);
      expect(resource.uri).toMatch(/^mcp:\/\/catalog\/.+\.md$/);
      expect(resource.mimeType).toBe('text/markdown');
      expect(resource.resourcePath).toMatch(/^resources\/.+\.md$/);
    }
  });
});
