/**
 * Pure delta-token resource-key normaliser (plan 04-09, MWARE-08).
 *
 * Collapses Graph resource path variations to a single canonical key for
 * (tenant_id, resource) lookups in the delta_tokens table.
 *
 * Rules (applied in order):
 *   1. lowercase (Graph paths are case-insensitive per OData)
 *   2. drop query string (?$filter=..., ?$top=..., etc.)
 *   3. drop trailing slashes (any number)
 *   4. /me/<X> → users/<userOid>/<X> when userOid provided; when oid is
 *      absent we leave the /me prefix alone — the caller is responsible for
 *      resolving it (D-17: "caller is responsible")
 *   5. strip leading slash
 *
 * This module has NO project-internal imports — it is a pure zero-dep helper
 * in the style of src/lib/redact.ts. Callers (Zod refinements, tool handlers)
 * own their own validation and logging; this module just returns a string.
 *
 * Pitfall 7 (04-RESEARCH.md lines 788-798) avoidance: tool aliases like
 * "mail.list-messages" are NOT valid resource keys — they can collide across
 * tools that share the same Graph resource. Callers MUST pass a Graph path.
 * The normaliser here makes /me/messages, users/<oid>/messages, and
 * USERS/<oid>/messages/ all collapse to the same canonical key.
 */

export function normalizeResourceKey(input: string, userOid?: string): string {
  if (!input) return '';

  // 1. Lowercase.
  let result = input.toLowerCase();

  // 2. Drop query string (first '?' onward).
  const qIdx = result.indexOf('?');
  if (qIdx !== -1) result = result.substring(0, qIdx);

  // 3. Drop all trailing slashes.
  result = result.replace(/\/+$/, '');

  // 4. /me/<X> → users/<userOid>/<X> when oid is supplied.
  //    Leave /me alone when oid is absent — see module docstring.
  if (userOid && (result.startsWith('/me/') || result === '/me')) {
    const tail = result === '/me' ? '' : result.substring(3); // preserves the leading '/'
    result = `users/${userOid}${tail}`;
  }

  // 5. Strip leading slash.
  if (result.startsWith('/')) result = result.substring(1);

  return result;
}
