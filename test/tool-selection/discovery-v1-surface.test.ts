/**
 * Phase 7 Plan 07-02 — discovery-v1 surface contract.
 *
 * Pins the first wave of discovery mode: a visible 12-alias meta preset
 * that is accepted by the existing selector DSL, while generated Graph and
 * product aliases remain outside that visible preset.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { compileEssentialsPreset } from '../../bin/modules/compile-preset.mjs';
import {
  computeEnabledToolsSet,
} from '../../src/lib/tool-selection/enabled-tools-parser.js';
import {
  DEFAULT_PRESET_VERSION,
  KNOWN_PRESET_VERSIONS,
  presetFor,
} from '../../src/lib/tool-selection/preset-loader.js';
import { validateSelectors } from '../../src/lib/tool-selection/registry-validator.js';

vi.mock('../../src/generated/client.js', () => ({
  api: {
    endpoints: [
      { alias: 'me.sendMail', method: 'post', path: '/me/sendMail' },
      { alias: 'me.ListMessages', method: 'get', path: '/me/messages' },
      { alias: '__powerbi__Groups_GetGroups', method: 'get', path: '/groups' },
    ],
  },
}));

const DISCOVERY_META_ALIASES = [
  'search-tools',
  'get-tool-schema',
  'execute-tool',
  'bookmark-tool',
  'list-bookmarks',
  'unbookmark-tool',
  'save-recipe',
  'list-recipes',
  'run-recipe',
  'record-fact',
  'recall-facts',
  'forget-fact',
] as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ESSENTIALS_PRESET_PATH = path.join(REPO_ROOT, 'src', 'presets', 'essentials-v1.json');

let tmpDirs: string[] = [];

function makeTmp(): string {
  const tmp = path.join(os.tmpdir(), `plan-07-02-discovery-${crypto.randomUUID()}`);
  fs.mkdirSync(path.join(tmp, 'generated'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'presets'), { recursive: true });
  tmpDirs.push(tmp);
  return tmp;
}

function makeFakeClient(aliases: readonly string[]): string {
  return [
    'export const api = {',
    '  endpoints: [',
    ...aliases.map(
      (alias) => `    { alias: ${JSON.stringify(alias)}, method: 'get', path: '/x' },`
    ),
    '  ],',
    '};',
    '',
  ].join('\n');
}

function stageEssentials(tmp: string): string[] {
  const essentials = JSON.parse(fs.readFileSync(ESSENTIALS_PRESET_PATH, 'utf-8')) as {
    ops: string[];
  };
  fs.writeFileSync(
    path.join(tmp, 'presets', 'essentials-v1.json'),
    JSON.stringify({ ...essentials, version: 'essentials-v1' })
  );
  return essentials.ops;
}

function stageDiscovery(tmp: string, ops: readonly string[] = DISCOVERY_META_ALIASES): void {
  fs.writeFileSync(
    path.join(tmp, 'presets', 'discovery-v1.json'),
    JSON.stringify({
      version: 'discovery-v1',
      generated_at: '2026-04-25T00:00:00Z',
      ops,
    })
  );
}

afterEach(() => {
  for (const tmp of tmpDirs) {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  tmpDirs = [];
});

describe('Phase 7 Plan 07-02 — discovery-v1 visible preset', () => {
  it('presetFor("discovery-v1") returns exactly the 12 SPEC meta aliases and no Graph aliases', () => {
    const preset = presetFor('discovery-v1');
    expect([...preset].sort()).toEqual([...DISCOVERY_META_ALIASES].sort());
    expect(preset.size).toBe(12);
    expect(Object.isFrozen(preset)).toBe(true);
    expect(preset.has('me.sendMail')).toBe(false);
    expect(preset.has('__powerbi__Groups_GetGroups')).toBe(false);
  });

  it('computeEnabledToolsSet(null, "discovery-v1") returns a frozen set of size 12', () => {
    const set = computeEnabledToolsSet(null, 'discovery-v1');
    expect(set.size).toBe(12);
    expect(Object.isFrozen(set)).toBe(true);
    expect([...set].sort()).toEqual([...DISCOVERY_META_ALIASES].sort());
  });

  it('+preset:discovery-v1 is accepted by selector validation and expands to the 12 aliases', () => {
    const validation = validateSelectors(['+preset:discovery-v1']);
    expect(validation.ok).toBe(true);

    const set = computeEnabledToolsSet('+preset:discovery-v1', 'unknown-empty');
    expect([...set].sort()).toEqual([...DISCOVERY_META_ALIASES].sort());
  });

  it('DEFAULT_PRESET_VERSION and KNOWN_PRESET_VERSIONS include discovery-v1', () => {
    expect(DEFAULT_PRESET_VERSION).toBe('discovery-v1');
    expect(KNOWN_PRESET_VERSIONS).toContain('discovery-v1');
  });

  it('compile-preset accepts only the bounded discovery meta alias allowlist', () => {
    const tmp = makeTmp();
    const essentialsOps = stageEssentials(tmp);
    stageDiscovery(tmp);
    fs.writeFileSync(path.join(tmp, 'generated', 'client.ts'), makeFakeClient(essentialsOps));

    const result = compileEssentialsPreset(path.join(tmp, 'generated'), path.join(tmp, 'presets'));
    expect(result.count).toBe(150);

    const out = fs.readFileSync(path.join(tmp, 'presets', 'generated-index.ts'), 'utf-8');
    expect(out).toContain('DISCOVERY_V1_OPS');
    expect(out).toContain('"discovery-v1"');
    for (const alias of DISCOVERY_META_ALIASES) {
      expect(out).toContain(JSON.stringify(alias));
    }

    const broken = makeTmp();
    const brokenEssentialsOps = stageEssentials(broken);
    stageDiscovery(broken, [...DISCOVERY_META_ALIASES, 'not-a-real-meta-tool']);
    fs.writeFileSync(
      path.join(broken, 'generated', 'client.ts'),
      makeFakeClient(brokenEssentialsOps)
    );

    expect(() =>
      compileEssentialsPreset(path.join(broken, 'generated'), path.join(broken, 'presets'))
    ).toThrow(/not-a-real-meta-tool|discovery-v1/);
  });
});
