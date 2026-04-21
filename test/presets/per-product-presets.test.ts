/**
 * Plan 05.1-07 — per-product essentials preset JSON invariants.
 *
 * Each of the 5 per-product preset files ships a curated subset of the
 * __<prefix>__ alias catalog produced by its matching plan-5.1-0X pipeline.
 * These tests pin the shape and content contracts on the human-editable
 * JSONs — orthogonal to the compile step (which validates ops against the
 * fresh registry). Here we only assert the JSON stands on its own.
 *
 * Invariants (all 5 per-product presets):
 *   - version matches the filename stem
 *   - product literal matches the known Product enum member
 *   - prefix literal matches `__<product>__` (sp-admin maps to __spadmin__)
 *   - ops is a non-empty array of 8-15 prefixed string aliases
 *   - no duplicates
 *   - rationale block has at least one entry keyed on an op literal
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PerProductPreset {
  version: string;
  generated_at?: string;
  product: string;
  prefix: string;
  sections?: Record<string, number>;
  rationale?: Record<string, string>;
  ops: string[];
}

const presetsDir = path.resolve(__dirname, '../../src/presets');

const PRESETS: ReadonlyArray<{
  filename: string;
  version: string;
  product: string;
  prefix: string;
  minOps: number;
  maxOps: number;
}> = [
  {
    filename: 'powerbi-essentials.json',
    version: 'powerbi-essentials',
    product: 'powerbi',
    prefix: '__powerbi__',
    minOps: 8,
    maxOps: 15,
  },
  {
    filename: 'pwrapps-essentials.json',
    version: 'pwrapps-essentials',
    product: 'pwrapps',
    prefix: '__pwrapps__',
    minOps: 8,
    maxOps: 15,
  },
  {
    filename: 'pwrauto-essentials.json',
    version: 'pwrauto-essentials',
    product: 'pwrauto',
    prefix: '__pwrauto__',
    minOps: 8,
    maxOps: 15,
  },
  {
    filename: 'exo-essentials.json',
    version: 'exo-essentials',
    product: 'exo',
    prefix: '__exo__',
    minOps: 8,
    maxOps: 15,
  },
  {
    filename: 'sp-admin-essentials.json',
    version: 'sp-admin-essentials',
    product: 'sp-admin',
    prefix: '__spadmin__',
    minOps: 8,
    maxOps: 15,
  },
];

for (const p of PRESETS) {
  describe(`${p.version} preset`, () => {
    const preset = JSON.parse(
      readFileSync(path.join(presetsDir, p.filename), 'utf-8')
    ) as PerProductPreset;

    it(`version is "${p.version}"`, () => {
      expect(preset.version).toBe(p.version);
    });

    it(`product is "${p.product}"`, () => {
      expect(preset.product).toBe(p.product);
    });

    it(`prefix is "${p.prefix}"`, () => {
      expect(preset.prefix).toBe(p.prefix);
    });

    it(`ops is an array of length in [${p.minOps}, ${p.maxOps}]`, () => {
      expect(Array.isArray(preset.ops)).toBe(true);
      expect(preset.ops.length).toBeGreaterThanOrEqual(p.minOps);
      expect(preset.ops.length).toBeLessThanOrEqual(p.maxOps);
    });

    it('every op is a non-empty string', () => {
      for (const op of preset.ops) {
        expect(typeof op).toBe('string');
        expect(op.length).toBeGreaterThan(0);
      }
    });

    it(`every op starts with "${p.prefix}"`, () => {
      for (const op of preset.ops) {
        expect(op.startsWith(p.prefix)).toBe(true);
      }
    });

    it('ops contains no duplicates', () => {
      expect(new Set(preset.ops).size).toBe(preset.ops.length);
    });

    it('every op is <= 64 chars (MCP alias cap)', () => {
      for (const op of preset.ops) {
        expect(op.length).toBeLessThanOrEqual(64);
      }
    });

    it('no ops start with __beta__ (product presets are not beta catalogs)', () => {
      const offenders = preset.ops.filter((op) => op.startsWith('__beta__'));
      expect(offenders).toEqual([]);
    });

    it('rationale has at least one entry keyed on an op literal', () => {
      expect(preset.rationale).toBeDefined();
      expect(typeof preset.rationale).toBe('object');
      const rationaleKeys = Object.keys(preset.rationale ?? {});
      expect(rationaleKeys.length).toBeGreaterThanOrEqual(1);
      const opsSet = new Set(preset.ops);
      for (const key of rationaleKeys) {
        expect(opsSet.has(key)).toBe(true);
      }
    });
  });
}

describe('per-product preset set-wide invariants', () => {
  it('no two presets share an op (prefix uniqueness guarantees this by construction)', () => {
    const seen = new Map<string, string>();
    for (const p of PRESETS) {
      const preset = JSON.parse(
        readFileSync(path.join(presetsDir, p.filename), 'utf-8')
      ) as PerProductPreset;
      for (const op of preset.ops) {
        const prior = seen.get(op);
        expect(prior, `${op} appears in both ${prior} and ${p.version}`).toBeUndefined();
        seen.set(op, p.version);
      }
    }
  });

  it('all 5 per-product preset files are present', () => {
    for (const p of PRESETS) {
      const presetPath = path.join(presetsDir, p.filename);
      expect(() => readFileSync(presetPath, 'utf-8')).not.toThrow();
    }
  });
});
