/**
 * HMAC-signed opaque pagination cursor (plan 04-01, D-14, T-04-02).
 *
 * Wire format:
 *   <base64url(JSON.stringify({ts, id}))><CURSOR_SEPARATOR><base64url(hmac_sha256)[:11]>
 *
 * Example:
 *   eyJ0cyI6MTIzNCwiaWQiOiJhYmMifQ:AbCdEfGhIjK
 *
 * Pure module with NO project-internal imports — safe to load before the
 * logger or OTel bootstrap runs. Mirrors the zero-dep convention of
 * src/lib/crypto/envelope.ts and src/lib/redact.ts.
 *
 * HMAC secret rotation:
 *   `createCursorSecret()` returns 32 cryptographically-random bytes. The
 *   bootstrap wires a single secret into the admin router deps; cursors issued
 *   under that secret are valid for the process lifetime. Process restart
 *   ⇒ fresh secret ⇒ existing cursors decode to `null`. Acceptable tradeoff
 *   per D-14: cursor state is ephemeral, and forcing clients to reissue their
 *   first page after a restart is simpler than managing a distributed secret.
 *
 * Threat mitigation (T-04-02 — client tampers cursor to enumerate across
 * tenants): `decodeCursor` recomputes the HMAC and returns `null` on mismatch.
 * Timing-safe comparison is explicitly NOT required (per RESEARCH.md:524) —
 * the cursor is a low-value authenticator; the HMAC's only job is to make
 * tampering detectable, not to prevent side-channel recovery of the secret.
 */
import crypto from 'node:crypto';

/**
 * Cursor payload: a `(timestamp, id)` tuple that the SQL WHERE clause uses
 * for stable tuple-comparison pagination. `ts` is typically `created_at_ms`;
 * `id` is the row's UUID or text PK.
 */
export interface CursorPayload {
  ts: number;
  id: string;
}

/**
 * 32-byte HMAC secret. Buffer so callers cannot accidentally serialize a
 * readable form into logs.
 */
export type CursorSecret = Buffer;

/**
 * Separator between body and signature portions of the encoded cursor.
 *
 * ':' is chosen because it is not part of the base64url alphabet
 * (`A-Z a-z 0-9 _ -`), so callers can use `str.lastIndexOf(':')` to split
 * unambiguously regardless of body length. Changing this constant would
 * break every outstanding cursor — don't do that except as part of a
 * deliberate format version bump.
 */
export const CURSOR_SEPARATOR = ':';

/**
 * Signature length in base64url characters. HMAC-SHA256 produces 32 bytes;
 * we truncate to the first 11 base64url chars (≈ 8 bytes of entropy). That
 * is sufficient to make tampering detectable at 1-in-2^64 (far below the
 * rate at which a low-value cursor could ever be brute-forced in practice).
 */
const SIG_LENGTH_CHARS = 11;

/** Generate a fresh 32-byte cursor secret at bootstrap. */
export function createCursorSecret(): CursorSecret {
  return crypto.randomBytes(32);
}

/**
 * Encode a cursor payload into an opaque string.
 *
 * Emission is stable: the JSON key order matches the TypeScript object-literal
 * declaration, and base64url-without-padding is deterministic, so repeated
 * calls with identical input produce identical output.
 */
export function encodeCursor(payload: CursorPayload, secret: CursorSecret): string {
  const body = Buffer.from(JSON.stringify({ ts: payload.ts, id: payload.id }), 'utf8').toString(
    'base64url'
  );
  const sig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url')
    .slice(0, SIG_LENGTH_CHARS);
  return `${body}${CURSOR_SEPARATOR}${sig}`;
}

/**
 * Decode + verify an opaque cursor. Returns null on any failure — malformed
 * separator, HMAC mismatch, unparseable JSON, or missing `ts`/`id` fields.
 * Never throws.
 *
 * Callers should treat `null` as "invalid cursor; start from the beginning
 * or return 400" — never crash. T-04-02 mitigation.
 */
export function decodeCursor(raw: string, secret: CursorSecret): CursorPayload | null {
  // Use lastIndexOf so a pathological body containing ':' (shouldn't happen
  // with base64url, but defensive) still splits sensibly.
  const sepIdx = raw.lastIndexOf(CURSOR_SEPARATOR);
  if (sepIdx <= 0 || sepIdx === raw.length - 1) return null;

  const body = raw.slice(0, sepIdx);
  const providedSig = raw.slice(sepIdx + 1);

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('base64url')
    .slice(0, SIG_LENGTH_CHARS);

  if (expectedSig !== providedSig) return null;

  try {
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
    if (
      typeof json !== 'object' ||
      json === null ||
      typeof (json as { ts?: unknown }).ts !== 'number' ||
      typeof (json as { id?: unknown }).id !== 'string'
    ) {
      return null;
    }
    const payload = json as { ts: number; id: string };
    return { ts: payload.ts, id: payload.id };
  } catch {
    return null;
  }
}
