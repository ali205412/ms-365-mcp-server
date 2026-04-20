import { describe, expect, it } from 'vitest';
import { buildToolsRegistry } from '../src/graph-tools.js';
import { describeToolSchema } from '../src/lib/tool-schema.js';

const registry = buildToolsRegistry(false, true);

function schemaFor(name: string) {
  const entry = registry.get(name);
  if (!entry) throw new Error(`Registry missing ${name}`);
  return describeToolSchema(entry.tool, entry.config?.llmTip);
}

// Post-Phase-5: the legacy v1 aliases (`list-mail-messages`, `send-mail`) no
// longer exist; the full-coverage regen emits Microsoft's operationId-style
// names. Pick representative tools off the live registry instead of
// hard-coding aliases that rot with every upstream spec update.
function firstMatching(
  predicate: (name: string, entry: NonNullable<ReturnType<typeof registry.get>>) => boolean
) {
  for (const [name, entry] of registry) {
    if (predicate(name, entry)) return { name, entry };
  }
  return null;
}

describe('describeToolSchema', () => {
  it('returns name, method, path, and parameters for a common tool', () => {
    const pick = firstMatching(
      (_name, e) => e.tool.method?.toUpperCase?.() === 'GET' && typeof e.tool.path === 'string'
    );
    if (!pick) throw new Error('Registry has no GET tool — full-coverage regen expected');
    const s = schemaFor(pick.name);
    expect(s.name).toBe(pick.name);
    expect(s.method).toBe('GET');
    expect(typeof s.path).toBe('string');
    expect(s.path.length).toBeGreaterThan(0);
    expect(Array.isArray(s.parameters)).toBe(true);
  });

  it('marks path parameters as required', () => {
    // Pick any tool with a Path parameter — every Graph REST resource path
    // carries at least one when a sub-resource is addressed by ID.
    const pick = firstMatching((_name, e) =>
      (e.tool.parameters ?? []).some((p: { type?: string }) => p.type === 'Path')
    );
    if (!pick)
      throw new Error('Registry has no Path-parameterised tool — full-coverage regen expected');
    const s = schemaFor(pick.name);
    const pathParams = s.parameters.filter((p) => p.in === 'Path');
    expect(pathParams.length).toBeGreaterThan(0);
    for (const p of pathParams) expect(p.required).toBe(true);
  });

  it('emits JSON Schema objects (not Zod) for every parameter', () => {
    // Pick any POST tool with a body parameter — mirrors the original
    // `send-mail` case without pinning to a legacy alias.
    const pick = firstMatching(
      (_name, e) =>
        e.tool.method?.toUpperCase?.() === 'POST' &&
        (e.tool.parameters ?? []).some((p: { type?: string }) => p.type === 'Body')
    );
    if (!pick)
      throw new Error('Registry has no POST-with-body tool — full-coverage regen expected');
    const s = schemaFor(pick.name);
    expect(s.parameters.length).toBeGreaterThan(0);
    for (const p of s.parameters) {
      expect(p.schema).toBeDefined();
      expect(typeof p.schema).toBe('object');
      // zod-to-json-schema always produces a typed node at the root for our schemas
      expect(p.schema).toHaveProperty('type');
    }
  });

  it('includes llmTip when the endpoint has one', () => {
    // Walk the registry for any tool with an llmTip — guard against registries without one
    const entry = [...registry.entries()].find(([, v]) => v.config?.llmTip)?.[1];
    if (!entry) return;
    const s = describeToolSchema(entry.tool, entry.config?.llmTip);
    expect(s.llmTip).toBeTruthy();
  });
});
