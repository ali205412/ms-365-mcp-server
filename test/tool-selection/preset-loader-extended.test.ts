/**
 * Plan 05.1-07 — preset-loader 6-preset resolution tests.
 *
 * Plan 05-03 exposed `presetFor('essentials-v1')` against a single-preset
 * generated-index.ts. Plan 05.1-07 extends the map with 5 per-product
 * presets; these tests pin the new resolution surface.
 *
 * Invariants:
 *   - `presetFor(version)` resolves each of the 6 known versions to a
 *     ReadonlySet that is Object.isFrozen.
 *   - Unknown versions still resolve to the same frozen EMPTY_PRESET
 *     (fail-closed; T-05-06 + T-5.1-04 mitigation).
 *   - KNOWN_PRESET_VERSIONS lists exactly the 6 expected names.
 *   - DEFAULT_PRESET_VERSION stays 'essentials-v1' — plan 05.1-07 does NOT
 *     change the fresh-tenant default.
 *   - The 5 per-product `*_OPS` re-exports are all defined ReadonlySet
 *     instances, even when the underlying JSON has not yet been compiled
 *     (stub frozen Sets from generated-index.ts preserve fail-closed).
 */
import { describe, it, expect } from 'vitest';
import {
  presetFor,
  DEFAULT_PRESET_VERSION,
  KNOWN_PRESET_VERSIONS,
  ESSENTIALS_V1_OPS,
  POWERBI_ESSENTIALS_OPS,
  PWRAPPS_ESSENTIALS_OPS,
  PWRAUTO_ESSENTIALS_OPS,
  EXO_ESSENTIALS_OPS,
  SP_ADMIN_ESSENTIALS_OPS,
} from '../../src/lib/tool-selection/preset-loader.js';

describe('plan 05.1-07 — preset-loader extended resolution', () => {
  it('DEFAULT_PRESET_VERSION stays essentials-v1 (plan does NOT change fresh-tenant default)', () => {
    expect(DEFAULT_PRESET_VERSION).toBe('essentials-v1');
  });

  it('KNOWN_PRESET_VERSIONS enumerates exactly the 6 preset names', () => {
    expect(KNOWN_PRESET_VERSIONS).toEqual([
      'essentials-v1',
      'powerbi-essentials',
      'pwrapps-essentials',
      'pwrauto-essentials',
      'exo-essentials',
      'sp-admin-essentials',
    ]);
    expect(Object.isFrozen(KNOWN_PRESET_VERSIONS)).toBe(true);
  });

  it.each([
    ['essentials-v1'],
    ['powerbi-essentials'],
    ['pwrapps-essentials'],
    ['pwrauto-essentials'],
    ['exo-essentials'],
    ['sp-admin-essentials'],
  ])('presetFor("%s") returns a frozen ReadonlySet', (version) => {
    const set = presetFor(version);
    expect(set).toBeInstanceOf(Set);
    expect(Object.isFrozen(set)).toBe(true);
  });

  it('presetFor(unknown) returns the same frozen empty Set (fail-closed)', () => {
    const a = presetFor('does-not-exist-v9');
    const b = presetFor('another-unknown');
    expect(Object.isFrozen(a)).toBe(true);
    expect(a.size).toBe(0);
    // Same instance — the EMPTY_PRESET module-level constant, not a fresh
    // Set per call. Identity check prevents accidental churn of per-call
    // empty sets in hot paths.
    expect(a).toBe(b);
  });

  it('unknown preset resolution is NOT the same instance as essentials-v1 (no accidental wide fallback)', () => {
    const unknown = presetFor('does-not-exist');
    const essentials = presetFor('essentials-v1');
    expect(unknown).not.toBe(essentials);
  });

  it('all 5 per-product re-exports are ReadonlySet instances (stub-safe)', () => {
    // Under the plan 05.1-07 initial landing these stubs may be empty
    // Object.freeze(new Set()) placeholders emitted by compile-preset
    // before the next full codegen run. Regardless of whether they are
    // empty or populated, they MUST be Set instances so callers that do
    // Set.has(alias) work uniformly.
    for (const set of [
      POWERBI_ESSENTIALS_OPS,
      PWRAPPS_ESSENTIALS_OPS,
      PWRAUTO_ESSENTIALS_OPS,
      EXO_ESSENTIALS_OPS,
      SP_ADMIN_ESSENTIALS_OPS,
    ]) {
      expect(set).toBeInstanceOf(Set);
      expect(Object.isFrozen(set)).toBe(true);
    }
  });

  it('essentials-v1 re-export is populated (legacy bellwether — NOT empty)', () => {
    // Plan 05-03 shipped 150 real ops. Plan 05.1-07 must preserve this
    // invariant — essentials-v1 is the canonical fresh-tenant default and
    // an empty Set would silently mean "no Graph tools for new tenants".
    expect(ESSENTIALS_V1_OPS.size).toBeGreaterThan(0);
    expect(Object.isFrozen(ESSENTIALS_V1_OPS)).toBe(true);
  });
});
