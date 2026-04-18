/**
 * Pure PII-redaction helpers for the pino logger.
 *
 * normalizePath() rewrites URL segments that look like OIDs, UUIDs, or
 * base64-encoded IDs to the `{id}` placeholder so log lines are
 * pattern-matchable without leaking real user identifiers.
 *
 * scrubHeaders() shallow-clones a header map with sensitive values replaced
 * by '[REDACTED]'.
 *
 * NO imports from project internals — this module is loaded before the
 * logger is constructed, so it cannot import from ./logger.js.
 */

// Ordering matters: match MOST specific patterns first (UUIDs, Outlook IDs)
// before the fallback long-alphanumeric pattern. The last regex would
// otherwise match inside a UUID and leave hyphenated residue.
const ID_TOKENS: RegExp[] = [
  // Canonical UUID (covers Azure object IDs in GUID form)
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // Outlook item IDs (REST v1.0 / Graph): start with A or a, then base64url body.
  // Allows '=' padding and '+' / '/' from REST v1.0; Graph uses '-' and '_'.
  /\/[Aa][A-Za-z0-9_\-=+/]{20,}={0,2}/g,
  // Generic long alphanumeric + common base64url chars (≥17 chars). Case-insensitive.
  // Threshold of 17 covers Graph OIDs like 'ABC123XYZ456DEF789' (18 chars).
  // Using {17,} (NOT {20,}) ensures the test matrix case /users/ABC123XYZ456DEF789 passes.
  /\/[A-Za-z0-9_\-=]{17,}(?=\/|$)/g,
];

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'prefer',
  'x-microsoft-refresh-token',
]);

/**
 * Rewrite URL path segments that look like OIDs, UUIDs, or base64-encoded IDs
 * to the `{id}` placeholder.
 *
 * Patterns covered (in priority order):
 *  1. Canonical UUID: /xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *  2. Outlook item IDs starting with A or a (base64url, ≥20 chars)
 *  3. Generic alphanumeric+base64url segment ≥17 chars (covers Graph OIDs)
 *
 * UPNs like `user@example.com` are preserved because '@' is not in any of the
 * character classes above.
 */
export function normalizePath(urlOrPath: string): string {
  let result = urlOrPath;
  for (const pattern of ID_TOKENS) {
    result = result.replace(pattern, '/{id}');
  }
  return result;
}

/**
 * Return a shallow-cloned header map with sensitive header values replaced by
 * '[REDACTED]'. Header names are compared case-insensitively. Headers whose
 * lowercased name starts with 'x-tenant-' are also redacted.
 */
export function scrubHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower) || lower.startsWith('x-tenant-')) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}
