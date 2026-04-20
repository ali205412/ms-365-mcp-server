/**
 * Plan 05-03 Task 1 — essentials-v1.json preset invariants.
 *
 * These tests pin the shape and content contracts on the human-editable
 * preset source. They are orthogonal to the compile step (which validates
 * the ops against the generated registry) — here we only assert the JSON
 * stands on its own as a diff-friendly artifact.
 *
 * D-19 composition (MUST total exactly 150):
 *   Mail 30, Calendar 25, Files/OneDrive 20, Teams 20, Users 15,
 *   Groups 10, SharePoint Sites 10, Planner 8, ToDo 8, Subscriptions 4.
 *
 * D-18 invariant: beta ops (prefixed __beta__) are NEVER part of the
 * default preset. Beta opt-in is a per-tenant admin PATCH concern.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const presetPath = path.resolve(__dirname, '../../src/presets/essentials-v1.json');
const preset = JSON.parse(readFileSync(presetPath, 'utf-8')) as {
  version: string;
  generated_at?: string;
  ops: string[];
  rationale?: Record<string, string>;
};

describe('essentials-v1 preset', () => {
  it('version is essentials-v1', () => {
    expect(preset.version).toBe('essentials-v1');
  });

  it('ops array is length 150', () => {
    expect(Array.isArray(preset.ops)).toBe(true);
    expect(preset.ops.length).toBe(150);
  });

  it('every op is a non-empty string', () => {
    for (const op of preset.ops) {
      expect(typeof op).toBe('string');
      expect(op.length).toBeGreaterThan(0);
    }
  });

  it('ops contains no duplicates', () => {
    expect(new Set(preset.ops).size).toBe(150);
  });

  it('no ops start with __beta__ (D-18 invariant)', () => {
    const offenders = preset.ops.filter((op) => op.startsWith('__beta__'));
    expect(offenders).toEqual([]);
  });

  it('provides inline rationale for preset evolution review', () => {
    expect(preset.rationale).toBeDefined();
    expect(typeof preset.rationale).toBe('object');
    // At least a handful of rationales required — not all 150 to avoid
    // maintenance burden, but enough to document flagship ops.
    const rationaleKeys = Object.keys(preset.rationale ?? {});
    expect(rationaleKeys.length).toBeGreaterThanOrEqual(10);
    // Every rationale key must be a valid op in the preset (no dangling keys).
    const opsSet = new Set(preset.ops);
    for (const key of rationaleKeys) {
      expect(opsSet.has(key)).toBe(true);
    }
  });
});
