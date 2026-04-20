/**
 * Selector AST parser (plan 05-04, D-21).
 *
 * Transforms operator-edited `tenants.enabled_tools` text into a
 * discriminated-union AST that downstream expanders (enabled-tools-parser)
 * consume. Pure module: no project-internal imports, no filesystem reads, no
 * I/O. The only side effect is a thrown Error on invalid input — callers
 * (loadTenant middleware, admin PATCH validator) are responsible for turning
 * that into the appropriate HTTP response.
 *
 * Grammar (EBNF):
 *   enabled_tools  = selector { "," selector }
 *   selector       = [ "+" ] atom
 *   atom           = preset_ref | workload | op
 *   preset_ref     = "preset:" preset_name
 *   workload       = workload_name ":*"
 *   op             = identifier { "." identifier }
 *   identifier     = [a-zA-Z0-9_-]+
 *
 * Security (T-05-07 selector injection defense):
 *   The `SELECTOR_CHAR` regex is a character whitelist — every code unit in
 *   every comma-separated part MUST satisfy `[a-zA-Z0-9_\-:.*+]`. Anything
 *   outside the whitelist (spaces, quotes, `<`, `>`, `;`, `&`, null bytes,
 *   path-traversal fragments, unicode homoglyphs) throws. No dynamic
 *   `new RegExp(input)` exists anywhere in this module.
 *
 * The `;` separator gets an explicit error message rather than the generic
 * "invalid characters" message because it is the most common operator
 * mistake (SQL-style delimiter habit).
 */

export type SelectorKind =
  | 'workload'
  | 'op'
  | 'preset'
  | 'additive-workload'
  | 'additive-op'
  | 'additive-preset';

export interface Selector {
  /** Discriminator — see SelectorKind. */
  kind: SelectorKind;
  /** Original text (including leading `+` if additive), preserved for error messages. */
  raw: string;
  /** Normalized body — "users" for workload, "users.list" for op, "essentials-v1" for preset. */
  value: string;
}

const SELECTOR_CHAR = /^[a-zA-Z0-9_\-:.*+]+$/;

/**
 * Parse a comma-separated list of selectors. Empty / whitespace-only input
 * returns an empty array. Presence of `;` triggers an explicit "use `,`"
 * error (the most common operator mistake). Every part passes through the
 * SELECTOR_CHAR whitelist before the single-selector parser runs.
 */
export function parseSelectorList(text: string): Selector[] {
  const raw = text.trim();
  if (raw === '') return [];

  if (raw.includes(';')) {
    throw new Error(`Selector separator must be "," not ";": ${JSON.stringify(raw)}`);
  }

  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const out: Selector[] = [];
  for (const part of parts) {
    if (!SELECTOR_CHAR.test(part)) {
      throw new Error(`Selector contains invalid characters: ${JSON.stringify(part)}`);
    }
    out.push(parseSingle(part));
  }
  return out;
}

function parseSingle(raw: string): Selector {
  const isAdditive = raw.startsWith('+');
  const body = isAdditive ? raw.slice(1) : raw;

  if (body.length === 0) {
    throw new Error(`Empty selector body: ${JSON.stringify(raw)}`);
  }

  if (body.startsWith('preset:')) {
    const name = body.slice('preset:'.length);
    if (name.length === 0) {
      throw new Error(`Empty preset name: ${JSON.stringify(raw)}`);
    }
    return { kind: isAdditive ? 'additive-preset' : 'preset', raw, value: name };
  }

  if (body.endsWith(':*')) {
    const name = body.slice(0, -2);
    if (name.length === 0) {
      throw new Error(`Empty workload name: ${JSON.stringify(raw)}`);
    }
    return { kind: isAdditive ? 'additive-workload' : 'workload', raw, value: name };
  }

  // op alias like "users.list" or "__beta__security-alerts-v2-list"
  return { kind: isAdditive ? 'additive-op' : 'op', raw, value: body };
}
