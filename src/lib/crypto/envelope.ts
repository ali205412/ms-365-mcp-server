/**
 * AES-256-GCM envelope encryption primitives (plan 03-04, D-12 / SECUR-01).
 *
 * Wire format: { v: 1, iv: base64(12B), tag: base64(16B), ct: base64(...) }.
 * The `v` discriminator allows future alg upgrades (GCM-SIV, etc.) without
 * a ciphertext migration — the unwrap path branches on `v` before hitting
 * the actual cipher.
 *
 * Pure module — NO project-internal imports. Same constraint as
 * src/lib/redact.ts and src/lib/graph-errors.ts (Phase 1 + 2 gold standard
 * for "load before logger" modules).
 *
 * Pitfall 1 mitigation: `crypto.randomBytes(12)` is called PER encryption.
 * Never cache cipher instances; never derive an IV from the plaintext.
 *
 * Tested in test/crypto/envelope.test.ts: round-trip identity, tampered-tag
 * decrypt fails, version-mismatch decrypt fails, key-length validation.
 */
import crypto from 'node:crypto';

export interface Envelope {
  v: 1;
  iv: string; // base64-encoded 12-byte IV
  tag: string; // base64-encoded 16-byte auth tag
  ct: string; // base64-encoded ciphertext
}

const IV_LENGTH = 12; // 96 bits — NIST SP 800-38D recommendation for GCM
const TAG_LENGTH = 16; // 128 bits — default GCM auth tag length
const KEY_LENGTH = 32; // 256 bits — AES-256-GCM

function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
}

/**
 * Encrypt plaintext with a 32-byte key (either the KEK or a DEK).
 * IV is generated fresh per encryption — NEVER reuse an IV with the same key.
 *
 * @throws Error when key.length !== 32
 */
export function encryptWithKey(plaintext: Buffer, key: Buffer): Envelope {
  assertKeyLength(key);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
}

/**
 * Decrypt an envelope back to plaintext. Throws on any of:
 *   - unsupported version (envelope.v !== 1)
 *   - wrong key length (!= 32 bytes)
 *   - malformed IV / tag length
 *   - failed auth tag (tampered iv / tag / ct)
 */
export function decryptWithKey(envelope: Envelope, key: Buffer): Buffer {
  if (envelope.v !== 1) {
    throw new Error(`Unsupported envelope version: ${envelope.v}`);
  }
  assertKeyLength(key);
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ct = Buffer.from(envelope.ct, 'base64');
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid tag length: ${tag.length}`);
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag); // MUST be called before .final()
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

// DEK-specific aliases — callers use these for readability. Same function
// under a semantically clearer name for msal-cache-plugin.ts (03-05) and
// session-store callers (03-07).
export const wrapWithDek = encryptWithKey;
export const unwrapWithDek = decryptWithKey;

// KEK-specific aliases — wraps/unwraps DEKs for tenants.wrapped_dek storage.
export const wrapDek = encryptWithKey;
export const unwrapDek = decryptWithKey;

/**
 * Generate a fresh 256-bit DEK. Called once per tenant on insert.
 * Non-deterministic: two calls produce distinct keys (Node crypto.randomBytes).
 */
export function generateDek(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}
