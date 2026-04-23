/**
 * Plan 05-03 + 05.1-07 — essentials preset compile step.
 *
 * Compiles src/presets/*.json (currently 6 presets: the legacy
 * `essentials-v1` cross-product default, plus 5 per-product essentials
 * added in plan 05.1-07) into a single emitted src/presets/generated-index.ts.
 *
 * The compile step is the typo-resistance contract (D-19, T-05-06 +
 * T-5.1-04 mitigation): every alias in every human-editable preset JSON
 * is checked against the fresh tool registry extracted from
 * src/generated/client.ts. An alias the registry does not know about
 * fails codegen loudly with a bounded preview of the offending names.
 *
 * Presets compiled:
 *   - essentials-v1        (150 ops — Plan 05-03, cross-product Graph default)
 *   - powerbi-essentials    (plan 05.1-07, __powerbi__* subset)
 *   - pwrapps-essentials    (plan 05.1-07, __pwrapps__* subset)
 *   - pwrauto-essentials    (plan 05.1-07, __pwrauto__* subset)
 *   - exo-essentials        (plan 05.1-07, __exo__* subset)
 *   - sp-admin-essentials   (plan 05.1-07, __spadmin__* subset)
 *
 * Per-preset contract (all six):
 *   - preset.version MUST equal the preset-name literal (enforced here,
 *     and pinned at runtime by the PRESET_VERSIONS map key).
 *   - preset.ops MUST be a non-empty array of non-empty strings.
 *   - essentials-v1 MUST have exactly 150 ops (D-19 legacy invariant).
 *   - every per-product preset op MUST carry the product's `__<prefix>__`
 *     prefix literal — prevents a preset from accidentally pulling in
 *     cross-product ops.
 *   - every op MUST appear as an `alias: "..."` literal in client.ts.
 *   - output is deterministic: each per-preset alias list is sorted
 *     lexicographically so git diffs on preset evolution highlight real
 *     changes, not ordering drift.
 *   - every emitted ReadonlySet<string> is Object.freeze()d at module load;
 *     consumers CANNOT mutate any preset set.
 *
 * Invocation: chained from bin/generate-graph-client.mjs after generateMcpTools
 * and (under FULL_COVERAGE=1) runBetaPipeline + runProductPipelines. Running
 * under FULL_COVERAGE=0 will throw on the 4 subscription ops in essentials-v1
 * (absent from the legacy 212-op endpoints.json) AND on ALL 5 per-product
 * presets (product aliases only exist under full coverage). That is
 * acceptable per plan guidance — surfaces the legacy/preset gap early.
 */
import fs from 'fs';
import path from 'path';

/**
 * Per-preset constraint metadata. Each entry drives:
 *   - which JSON filename to read from presetsDir
 *   - what `version` literal the JSON must carry
 *   - what TypeScript constant name to emit for the frozen Set
 *   - any preset-specific length / prefix invariants
 *
 * Ordered so `essentials-v1` is emitted first — keeps the existing
 * generated-index.ts layout stable (legacy-first ordering improves diff
 * locality during plan 05.1-07's initial landing).
 */
const PRESET_SPECS = Object.freeze([
  Object.freeze({
    version: 'essentials-v1',
    filename: 'essentials-v1.json',
    constName: 'ESSENTIALS_V1_OPS',
    exactCount: 150,
    prefix: null,
  }),
  Object.freeze({
    version: 'powerbi-essentials',
    filename: 'powerbi-essentials.json',
    constName: 'POWERBI_ESSENTIALS_OPS',
    exactCount: null,
    prefix: '__powerbi__',
  }),
  Object.freeze({
    version: 'pwrapps-essentials',
    filename: 'pwrapps-essentials.json',
    constName: 'PWRAPPS_ESSENTIALS_OPS',
    exactCount: null,
    prefix: '__pwrapps__',
  }),
  Object.freeze({
    version: 'pwrauto-essentials',
    filename: 'pwrauto-essentials.json',
    constName: 'PWRAUTO_ESSENTIALS_OPS',
    exactCount: null,
    prefix: '__pwrauto__',
  }),
  Object.freeze({
    version: 'exo-essentials',
    filename: 'exo-essentials.json',
    constName: 'EXO_ESSENTIALS_OPS',
    exactCount: null,
    prefix: '__exo__',
  }),
  Object.freeze({
    version: 'sp-admin-essentials',
    filename: 'sp-admin-essentials.json',
    constName: 'SP_ADMIN_ESSENTIALS_OPS',
    exactCount: null,
    prefix: '__spadmin__',
  }),
]);

/**
 * @returns {ReadonlyArray<{version: string, filename: string, constName: string, exactCount: number | null, prefix: string | null}>}
 *   Frozen per-preset constraint table — exported for tests + the
 *   preset-loader shape assertion.
 */
export function getPresetSpecs() {
  return PRESET_SPECS;
}

/**
 * Load and validate a single preset JSON against the registry + its spec.
 * Returns the sorted op list for downstream emit; throws on any invariant
 * violation with a bounded error message.
 *
 * @param {{ version: string, filename: string, exactCount: number | null, prefix: string | null }} spec
 * @param {string} presetJsonPath  Absolute path to the preset JSON.
 * @param {ReadonlySet<string>} registry  Aliases lifted from client.ts.
 * @returns {{ sortedOps: string[] }}
 */
function loadAndValidatePreset(spec, presetJsonPath, registry) {
  if (!fs.existsSync(presetJsonPath)) {
    throw new Error(`${presetJsonPath} missing`);
  }

  const preset = JSON.parse(fs.readFileSync(presetJsonPath, 'utf-8'));
  if (preset.version !== spec.version) {
    throw new Error(`expected version "${spec.version}", got "${preset.version}"`);
  }
  if (!Array.isArray(preset.ops)) {
    throw new Error(`${spec.version}: preset.ops must be an array`);
  }
  if (preset.ops.length === 0) {
    throw new Error(`${spec.version}: preset.ops must be non-empty`);
  }
  if (typeof spec.exactCount === 'number' && preset.ops.length !== spec.exactCount) {
    throw new Error(
      `${spec.version}: expected exactly ${spec.exactCount} ops, got ${preset.ops.length}`
    );
  }

  // Defensive: reject empty/whitespace aliases before registry check so
  // the error preview below stays meaningful.
  for (const op of preset.ops) {
    if (typeof op !== 'string' || op.length === 0) {
      throw new Error(
        `${spec.version}: preset.ops contains non-string or empty entry: ${JSON.stringify(op)}`
      );
    }
  }

  // Per-product presets must only carry prefixed aliases. Catches the
  // typical mistake of pasting a cross-product alias into the wrong preset
  // (e.g., a `__pwrapps__*` alias landing in the powerbi preset).
  if (spec.prefix !== null) {
    const unprefixed = preset.ops.filter((op) => !op.startsWith(spec.prefix));
    if (unprefixed.length > 0) {
      const previewCount = Math.min(5, unprefixed.length);
      const preview = unprefixed.slice(0, previewCount).join(', ');
      const tail =
        unprefixed.length > previewCount ? ` (and ${unprefixed.length - previewCount} more)` : '';
      throw new Error(
        `${spec.version}: ${unprefixed.length} op(s) missing prefix "${spec.prefix}": ${preview}${tail}`
      );
    }
  }

  // No duplicates (cheap, and protects the generated Set from silently
  // collapsing ops a human editor intended as distinct).
  const seen = new Set();
  for (const op of preset.ops) {
    if (seen.has(op)) {
      throw new Error(`${spec.version}: duplicate op "${op}"`);
    }
    seen.add(op);
  }

  const missing = preset.ops.filter((op) => !registry.has(op));
  if (missing.length > 0) {
    const previewCount = Math.min(10, missing.length);
    const preview = missing.slice(0, previewCount).join(', ');
    const tail =
      missing.length > previewCount ? ` (and ${missing.length - previewCount} more)` : '';
    // T-05-06 / T-5.1-04 mitigation: a preset op that cannot be resolved
    // against the fresh registry is almost always a typo or a stale alias.
    // Failing codegen loudly is cheaper than shipping a preset whose
    // `enabled_tools` set silently drops half the flagship ops.
    throw new Error(
      `${spec.version}: ${missing.length} preset op(s) NOT in registry: ${preview}${tail}`
    );
  }

  // Deterministic emit order: lexicographic sort on the alias list keeps
  // the generated file diff-friendly as presets evolve.
  return { sortedOps: [...preset.ops].sort() };
}

/**
 * Extract the alias registry from a generated client.ts source.
 *
 * Matches every `alias: "..."` / `alias: '...'` occurrence (case-
 * sensitive). Matches the openapi-zod-client emission pattern uniformly —
 * v1, beta (`__beta__` prefix), and plan-5.1 product prefixes all land
 * via the same literal.
 *
 * @param {string} clientTsContent
 * @returns {Set<string>}
 */
function extractRegistry(clientTsContent) {
  return new Set([...clientTsContent.matchAll(/alias:\s*["']([^"']+)["']/g)].map((m) => m[1]));
}

/**
 * Compile every preset JSON in `presetsDir` against the generated
 * client.ts registry and emit `presetsDir/generated-index.ts`.
 *
 * Retains the plan-05-03 signature + return shape so existing callers
 * (bin/generate-graph-client.mjs Step 5, test stubs) don't need edits.
 * The emitted file now carries six ReadonlySet<string> exports plus a
 * 6-entry PRESET_VERSIONS map.
 *
 * @param {string} generatedDir  Absolute path to src/generated (carries client.ts).
 * @param {string} presetsDir    Absolute path to src/presets (carries essentials-v1.json
 *                                + the five per-product *-essentials.json files;
 *                                generated-index.ts is (over)written here).
 * @returns {{count: number, presetTsPath: string, missing: string[]}}
 *   `count` preserves Plan 05-03 semantics (size of the essentials-v1
 *   ReadonlySet). `missing` is always `[]` on success — failures throw.
 * @throws {Error} when client.ts, any preset JSON, or any invariant fails.
 */
export function compileEssentialsPreset(generatedDir, presetsDir) {
  try {
    const clientPath = path.join(generatedDir, 'client.ts');
    const presetTsPath = path.join(presetsDir, 'generated-index.ts');

    if (!fs.existsSync(clientPath)) {
      throw new Error(`${clientPath} missing — run generate first`);
    }

    const clientCode = fs.readFileSync(clientPath, 'utf-8');
    const registry = extractRegistry(clientCode);

    // Per-preset compile pass. essentials-v1 is always first — its JSON
    // is the de-facto "is my preset infrastructure working" bellwether and
    // its failure should short-circuit before product-preset validation.
    const perPresetOps = new Map();
    for (const spec of PRESET_SPECS) {
      const presetJsonPath = path.join(presetsDir, spec.filename);
      // Per-product presets can legitimately be absent in environments
      // that predate plan 05.1-07. The legacy essentials-v1 entry remains
      // MANDATORY: its absence is a hard error (same as before this plan).
      if (spec.version !== 'essentials-v1' && !fs.existsSync(presetJsonPath)) {
        continue;
      }
      const { sortedOps } = loadAndValidatePreset(spec, presetJsonPath, registry);
      perPresetOps.set(spec.version, sortedOps);
    }

    // Emit generated-index.ts. Layout:
    //   1. header comment
    //   2. one `export const X_OPS: ReadonlySet<string> = Object.freeze(new Set(...))`
    //      per loaded preset (emit order matches PRESET_SPECS).
    //   3. the PRESET_VERSIONS map.
    const lines = [
      '// THIS FILE IS AUTO-GENERATED by bin/modules/compile-preset.mjs',
      '// DO NOT EDIT DIRECTLY. Regenerate with `npm run generate`.',
      '// Source: src/presets/*.json',
      '',
    ];

    const loadedSpecs = PRESET_SPECS.filter((spec) => perPresetOps.has(spec.version));
    for (const spec of loadedSpecs) {
      const ops = perPresetOps.get(spec.version);
      lines.push(
        `export const ${spec.constName}: ReadonlySet<string> = Object.freeze(new Set<string>([`
      );
      for (const op of ops) {
        lines.push(`  ${JSON.stringify(op)},`);
      }
      lines.push(']));');
      lines.push('');
    }

    lines.push(
      'export const PRESET_VERSIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map(['
    );
    for (const spec of loadedSpecs) {
      lines.push(`  [${JSON.stringify(spec.version)}, ${spec.constName}],`);
    }
    lines.push(']);');
    lines.push('');

    fs.writeFileSync(presetTsPath, lines.join('\n'));

    // Preserve Plan 05-03's return shape: `count` is the size of
    // essentials-v1 (the bellwether preset). Per-product counts are
    // recoverable from the emitted Sets at runtime.
    const essentialsOps = perPresetOps.get('essentials-v1') ?? [];
    return { count: essentialsOps.length, presetTsPath, missing: [] };
  } catch (error) {
    throw new Error(`compile-preset: ${error.message}`);
  }
}
