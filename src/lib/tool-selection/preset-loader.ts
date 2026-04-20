/**
 * Preset loader (plan 05-03, D-19).
 *
 * Re-exports the compile-time-generated preset set plus a version-indexed
 * resolver. Runtime callers MUST go through this file rather than importing
 * generated-index.ts directly — the resolver layer stays stable so future
 * plans can add essentials-v2 (or swap out the compile strategy) without
 * touching consumers.
 *
 * Threat ref T-05-06 (elevation via typo-expanded preset): presetFor returns
 * an empty frozen Set when the requested version is unknown. That is the
 * fail-closed default — an unknown preset_version means the tenant gets ZERO
 * tools rather than accidentally falling back to a wider surface.
 */
import { ESSENTIALS_V1_OPS, PRESET_VERSIONS } from '../../presets/generated-index.js';

export { ESSENTIALS_V1_OPS };

/**
 * Canonical default preset_version for fresh tenants. Migration
 * 20260702000000_preset_version.sql pins the DB default to the same
 * literal so a newly-inserted tenant row always resolves to this preset.
 */
export const DEFAULT_PRESET_VERSION = 'essentials-v1';

/**
 * Resolve a preset name to its frozen op set. Returns an empty frozen Set
 * on unknown input (fail-closed). Callers treating this as "Set.has()" will
 * see zero hits rather than an unexpected wide fallback.
 */
export function presetFor(version: string): ReadonlySet<string> {
  const found = PRESET_VERSIONS.get(version);
  return found ?? EMPTY_PRESET;
}

// Module-level frozen empty set so presetFor never allocates per-call and
// downstream equality / identity checks (e.g. `=== EMPTY_PRESET`) are cheap.
const EMPTY_PRESET: ReadonlySet<string> = Object.freeze(new Set<string>());
