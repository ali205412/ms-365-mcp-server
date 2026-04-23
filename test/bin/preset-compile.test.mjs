/**
 * Plan 05-03 Task 1 — compileEssentialsPreset codegen step tests.
 *
 * Contract (bin/modules/compile-preset.mjs):
 *   - Reads src/presets/essentials-v1.json + src/generated/client.ts.
 *   - Extracts every `alias: "x"` / `alias: 'x'` occurrence into a Set.
 *   - Throws when a preset op is NOT in the registry (T-05-06 typo-resistance).
 *   - Throws when preset.ops.length !== 150 (D-19 invariant).
 *   - Emits src/presets/generated-index.ts with a frozen ReadonlySet<string>.
 *
 * Tests stage a tmp workspace rather than mutating the real src/ tree, and
 * copy the REAL essentials-v1.json into the tmp presets/ dir so the tests
 * exercise the actual preset composition (not a synthetic fixture).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { compileEssentialsPreset } from '../../bin/modules/compile-preset.mjs';

const REAL_PRESET_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  'src',
  'presets',
  'essentials-v1.json'
);

function makeTmp() {
  const dir = path.join(os.tmpdir(), `plan-05-03-preset-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(dir, 'generated'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'presets'), { recursive: true });
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Emit a synthetic client.ts whose aliases cover the provided list. Matches
 * the output shape of openapi-zod-client so the compile step's regex lifts
 * them out the same way it would in production.
 */
function makeFakeClient(aliases) {
  const lines = [
    'import { makeApi } from "./hack.js";',
    'export const api = makeApi([',
    ...aliases.map(
      (alias) => `  { alias: "${alias}", method: "get", path: "/x", parameters: [] },`
    ),
    ']);',
    '',
  ];
  return lines.join('\n');
}

describe('plan 05-03 task 1 — compileEssentialsPreset', () => {
  let tmp;
  let realPreset;

  beforeEach(() => {
    tmp = makeTmp();
    realPreset = JSON.parse(fs.readFileSync(REAL_PRESET_PATH, 'utf-8'));
  });

  afterEach(() => {
    rmTmp(tmp);
  });

  it('Test 5: emits generated-index.ts with ESSENTIALS_V1_OPS size 150 when every preset op is in the registry', () => {
    // Registry has ALL 150 preset ops plus 10 extras (stress the Set-build).
    const extras = Array.from({ length: 10 }, (_, i) => `extra-${i}`);
    const registry = [...realPreset.ops, ...extras];
    fs.writeFileSync(path.join(tmp, 'generated', 'client.ts'), makeFakeClient(registry));
    fs.writeFileSync(path.join(tmp, 'presets', 'essentials-v1.json'), JSON.stringify(realPreset));

    const result = compileEssentialsPreset(path.join(tmp, 'generated'), path.join(tmp, 'presets'));

    expect(result.count).toBe(150);

    const out = fs.readFileSync(path.join(tmp, 'presets', 'generated-index.ts'), 'utf-8');
    expect(out).toContain('ESSENTIALS_V1_OPS');
    expect(out).toContain('PRESET_VERSIONS');
    expect(out).toContain('Object.freeze');
    // Every preset op must be a literal in the emitted TS file.
    for (const op of realPreset.ops) {
      expect(out).toContain(`"${op}"`);
    }
  });

  it('Test 6: throws when a preset op is NOT in the registry (T-05-06 typo-resistance)', () => {
    // Drop the first real op from the synthetic registry to force a miss.
    // Post-Phase-5 the preset uses Microsoft operationIds (e.g.
    // `me.messages.ListAttachments`), so we read one off the real preset
    // rather than hard-coding a friendly name that no longer exists.
    const dropped = realPreset.ops[0];
    const registry = realPreset.ops.filter((op) => op !== dropped);
    fs.writeFileSync(path.join(tmp, 'generated', 'client.ts'), makeFakeClient(registry));
    fs.writeFileSync(path.join(tmp, 'presets', 'essentials-v1.json'), JSON.stringify(realPreset));

    expect(() =>
      compileEssentialsPreset(path.join(tmp, 'generated'), path.join(tmp, 'presets'))
    ).toThrow(/NOT in registry/);
  });

  it('throws when preset version is wrong', () => {
    const registry = realPreset.ops;
    fs.writeFileSync(path.join(tmp, 'generated', 'client.ts'), makeFakeClient(registry));
    fs.writeFileSync(
      path.join(tmp, 'presets', 'essentials-v1.json'),
      JSON.stringify({ ...realPreset, version: 'essentials-v99' })
    );

    expect(() =>
      compileEssentialsPreset(path.join(tmp, 'generated'), path.join(tmp, 'presets'))
    ).toThrow(/essentials-v1/);
  });

  it('throws when preset.ops.length !== 150', () => {
    const registry = realPreset.ops;
    fs.writeFileSync(path.join(tmp, 'generated', 'client.ts'), makeFakeClient(registry));
    fs.writeFileSync(
      path.join(tmp, 'presets', 'essentials-v1.json'),
      JSON.stringify({ ...realPreset, ops: realPreset.ops.slice(0, 149) })
    );

    expect(() =>
      compileEssentialsPreset(path.join(tmp, 'generated'), path.join(tmp, 'presets'))
    ).toThrow(/150 ops/);
  });

  it('throws when generated/client.ts is missing (dev invariant)', () => {
    fs.writeFileSync(path.join(tmp, 'presets', 'essentials-v1.json'), JSON.stringify(realPreset));

    expect(() =>
      compileEssentialsPreset(path.join(tmp, 'generated'), path.join(tmp, 'presets'))
    ).toThrow(/client\.ts/);
  });

  it('throws when essentials-v1.json is missing', () => {
    fs.writeFileSync(path.join(tmp, 'generated', 'client.ts'), makeFakeClient(realPreset.ops));

    expect(() =>
      compileEssentialsPreset(path.join(tmp, 'generated'), path.join(tmp, 'presets'))
    ).toThrow(/essentials-v1\.json/);
  });

  it('Test 7: emits TS whose ESSENTIALS_V1_OPS Set is Object.isFrozen at runtime', async () => {
    const registry = realPreset.ops;
    fs.writeFileSync(path.join(tmp, 'generated', 'client.ts'), makeFakeClient(registry));
    fs.writeFileSync(path.join(tmp, 'presets', 'essentials-v1.json'), JSON.stringify(realPreset));

    compileEssentialsPreset(path.join(tmp, 'generated'), path.join(tmp, 'presets'));

    // Import-check via raw source: `Object.freeze(new Set(...))` invariant.
    const out = fs.readFileSync(path.join(tmp, 'presets', 'generated-index.ts'), 'utf-8');
    expect(out).toMatch(/Object\.freeze\(new Set<string>\(\[/);
  });
});
