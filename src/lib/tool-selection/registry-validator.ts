/**
 * Registry validator (plan 05-04, D-21).
 *
 * Validates every selector against the compiled tool registry. Unknown
 * selectors surface up to 3 Levenshtein-ranked (distance ≤ 3) suggestions so
 * operators recover from typos fast. Primary caller is the admin PATCH
 * handler (Plan 05-07) which enforces fail-on-unknown before persisting
 * operator edits to `tenants.enabled_tools`.
 *
 * Registry is built ONCE at module load from:
 *   - src/generated/client.ts (api.endpoints aliases)
 *   - src/presets/generated-index.ts (PRESET_VERSIONS keys)
 * No runtime mutation. Both Sets are frozen.
 *
 * Threat refs:
 *   - T-05-07 (selector injection): selector-ast.ts catches malformed chars
 *     before the AST walk; this module re-enforces via Zod (belt-and-
 *     suspenders) and hands invalid input back without attempting a
 *     Levenshtein pass (prevents accidentally "fixing" an injection
 *     attempt by offering a clean alternative).
 *   - T-05-07b (Levenshtein DoS): Zod caps selector length at 256; admin
 *     PATCH (Plan 05-07) caps array size at 500. Suggestion pool size is
 *     bounded by the registry (~14k aliases worst-case). fastest-levenshtein
 *     is O(n*m/32) — well under the cost ceiling.
 */
import { z } from 'zod';
import { distance } from 'fastest-levenshtein';
import { api } from '../../generated/client.js';
import { PRESET_VERSIONS } from '../../presets/generated-index.js';
import type { Selector } from './selector-ast.js';
import { parseSelectorList } from './selector-ast.js';

/**
 * Extract the "workload" prefix from an alias. Strips a leading `__beta__`
 * (beta ops belong to their underlying workload), then takes everything
 * before the first `-` or `.` — whichever comes first. Returns the original
 * alias if neither delimiter is present.
 *
 * Examples:
 *   "list-mail-messages"        → "list"
 *   "__beta__security-alerts"    → "security"
 *   "mail.messages.send"         → "mail"
 */
function extractWorkloadPrefix(alias: string): string {
  const stripped = alias.startsWith('__beta__') ? alias.slice('__beta__'.length) : alias;
  const dash = stripped.indexOf('-');
  const dot = stripped.indexOf('.');
  const dashIdx = dash === -1 ? Infinity : dash;
  const dotIdx = dot === -1 ? Infinity : dot;
  const cutoff = Math.min(dashIdx, dotIdx);
  return cutoff === Infinity ? stripped : stripped.slice(0, cutoff);
}

// Built once at module load, frozen to prevent downstream mutation.
const REGISTRY_ALIASES: ReadonlySet<string> = Object.freeze(
  new Set(
    api.endpoints
      .map((e) => e.alias)
      .filter((a): a is string => typeof a === 'string' && a.length > 0)
  )
);

const WORKLOAD_PREFIXES: ReadonlySet<string> = Object.freeze(
  new Set(
    [...REGISTRY_ALIASES].map(extractWorkloadPrefix).filter((w) => w.length > 0)
  )
);

const PRESET_NAMES: ReadonlySet<string> = Object.freeze(new Set(PRESET_VERSIONS.keys()));

/**
 * Zod schema for a single selector string. Used by admin PATCH handlers to
 * validate the wire payload BEFORE calling parseSelectorList + validateSelectors.
 * Mirrors the SELECTOR_CHAR regex in selector-ast.ts and bounds length at
 * 256 (T-05-07b DoS defense; enforced against the Levenshtein pass cost).
 */
export const SelectorZod = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_\-:.*+]+$/, { message: 'invalid selector characters' });

export type ValidationResult =
  | { ok: true }
  | { ok: false; invalid: string[]; suggestions: Record<string, string[]> };

/**
 * Validate an array of selector strings against the registry. On success
 * every selector resolves to a known op / workload / preset. On failure,
 * returns the unknown selectors with up to 3 Levenshtein suggestions each.
 *
 * The parser may throw on malformed input (invalid chars, `;` separator,
 * empty body). In that case we mark ALL input as invalid and return empty
 * suggestions — the caller should surface the parser's error message
 * verbatim rather than offering an auto-fix for an injection attempt.
 */
export function validateSelectors(selectors: string[]): ValidationResult {
  const invalid: string[] = [];
  const suggestions: Record<string, string[]> = {};

  let parsed: Selector[];
  try {
    parsed = parseSelectorList(selectors.join(','));
  } catch {
    // Grammar / charset violation — return the unfiltered input as invalid
    // without attempting Levenshtein. The admin handler surfaces the
    // parser's thrown message separately.
    return { ok: false, invalid: selectors.slice(), suggestions: {} };
  }

  for (const sel of parsed) {
    if (sel.kind === 'preset' || sel.kind === 'additive-preset') {
      if (!PRESET_NAMES.has(sel.value)) {
        invalid.push(sel.raw);
        suggestions[sel.raw] = topSuggestions(sel.value, PRESET_NAMES);
      }
      continue;
    }
    if (sel.kind === 'workload' || sel.kind === 'additive-workload') {
      if (!WORKLOAD_PREFIXES.has(sel.value)) {
        invalid.push(sel.raw);
        suggestions[sel.raw] = topSuggestions(sel.value, WORKLOAD_PREFIXES);
      }
      continue;
    }
    // op / additive-op
    if (!REGISTRY_ALIASES.has(sel.value)) {
      invalid.push(sel.raw);
      suggestions[sel.raw] = topSuggestions(sel.value, REGISTRY_ALIASES);
    }
  }

  if (invalid.length === 0) return { ok: true };
  return { ok: false, invalid, suggestions };
}

/**
 * Return up to 3 candidates from `pool` with Levenshtein distance ≤ 3 from
 * `query`, sorted by ascending distance. Empty pool or no matches within
 * range → empty array.
 */
function topSuggestions(query: string, pool: ReadonlySet<string>): string[] {
  const ranked: Array<{ value: string; dist: number }> = [];
  for (const candidate of pool) {
    const d = distance(query, candidate);
    if (d <= 3) {
      ranked.push({ value: candidate, dist: d });
    }
  }
  ranked.sort((a, b) => a.dist - b.dist);
  return ranked.slice(0, 3).map((r) => r.value);
}

export function getRegistryAliases(): ReadonlySet<string> {
  return REGISTRY_ALIASES;
}

export function getWorkloadPrefixes(): ReadonlySet<string> {
  return WORKLOAD_PREFIXES;
}
