/**
 * Plan 03-04 Task 1 — src/lib/crypto/envelope.ts unit tests (SECUR-01).
 *
 * 13 behaviors covered, per PLAN.md Task 1 <behavior>:
 *   1. round-trip small plaintext
 *   2. 0-byte plaintext round-trips
 *   3. 1MB plaintext round-trips
 *   4. 1000 successive encrypts produce 1000 distinct IVs (IV freshness)
 *   5. 1000 successive encrypts produce 1000 distinct ciphertexts
 *   6. tampered iv → decrypt throws (AES-GCM auth tag)
 *   7. tampered tag → decrypt throws
 *   8. tampered ct → decrypt throws
 *   9. version mismatch (v=2) → decrypt throws
 *  10. 16-byte key → encrypt throws; decrypt throws
 *  11. 64-byte key → same errors
 *  12. generateDek returns 32-byte Buffer; two calls distinct
 *  13. JSON round-trip (envelope is JSON-serializable + re-parseable)
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  encryptWithKey,
  decryptWithKey,
  wrapWithDek,
  unwrapWithDek,
  wrapDek,
  unwrapDek,
  generateDek,
  type Envelope,
} from '../../src/lib/crypto/envelope.js';

describe('plan 03-04 Task 1 — envelope.ts (SECUR-01)', () => {
  const key = crypto.randomBytes(32);

  // 1
  it('round-trips small plaintext', () => {
    const pt = Buffer.from('hello world', 'utf8');
    const env = encryptWithKey(pt, key);
    expect(decryptWithKey(env, key).equals(pt)).toBe(true);
  });

  // 2
  it('round-trips empty (0-byte) plaintext', () => {
    const pt = Buffer.alloc(0);
    const env = encryptWithKey(pt, key);
    // Even with zero plaintext, envelope still has the 16-byte auth tag + 12-byte IV.
    expect(Buffer.from(env.tag, 'base64').length).toBe(16);
    expect(Buffer.from(env.iv, 'base64').length).toBe(12);
    expect(decryptWithKey(env, key).equals(pt)).toBe(true);
  });

  // 3
  it('round-trips 1MB plaintext', () => {
    const pt = crypto.randomBytes(1024 * 1024);
    const env = encryptWithKey(pt, key);
    expect(decryptWithKey(env, key).equals(pt)).toBe(true);
  });

  // 4
  it('produces 1000 distinct IVs for the same plaintext + key (IV freshness)', () => {
    const pt = Buffer.from('same plaintext', 'utf8');
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(encryptWithKey(pt, key).iv);
    }
    expect(seen.size).toBe(1000);
  });

  // 5
  it('produces 1000 distinct ciphertexts for the same plaintext + key (IV uniqueness forces ct uniqueness)', () => {
    const pt = Buffer.from('same plaintext', 'utf8');
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(encryptWithKey(pt, key).ct);
    }
    expect(seen.size).toBe(1000);
  });

  // 6
  it('throws on tampered iv (auth tag catches it)', () => {
    const pt = Buffer.from('victim', 'utf8');
    const env = encryptWithKey(pt, key);
    const ivBytes = Buffer.from(env.iv, 'base64');
    ivBytes[0] = ivBytes[0] ^ 0xff; // flip all bits in byte 0
    const tampered: Envelope = { ...env, iv: ivBytes.toString('base64') };
    expect(() => decryptWithKey(tampered, key)).toThrow();
  });

  // 7
  it('throws on tampered tag', () => {
    const pt = Buffer.from('victim', 'utf8');
    const env = encryptWithKey(pt, key);
    const tagBytes = Buffer.from(env.tag, 'base64');
    tagBytes[0] = tagBytes[0] ^ 0xff;
    const tampered: Envelope = { ...env, tag: tagBytes.toString('base64') };
    expect(() => decryptWithKey(tampered, key)).toThrow();
  });

  // 8
  it('throws on tampered ciphertext', () => {
    const pt = Buffer.from('victim with enough bytes to flip', 'utf8');
    const env = encryptWithKey(pt, key);
    const ctBytes = Buffer.from(env.ct, 'base64');
    ctBytes[0] = ctBytes[0] ^ 0xff;
    const tampered: Envelope = { ...env, ct: ctBytes.toString('base64') };
    expect(() => decryptWithKey(tampered, key)).toThrow();
  });

  // 9
  it('throws on unsupported version (v=2)', () => {
    const pt = Buffer.from('hello', 'utf8');
    const env = encryptWithKey(pt, key);
    const bad = { ...env, v: 2 as unknown as 1 };
    expect(() => decryptWithKey(bad, key)).toThrow(/Unsupported envelope version: 2/);
  });

  // 10
  it('throws on 16-byte key (both encrypt + decrypt)', () => {
    const shortKey = crypto.randomBytes(16);
    const pt = Buffer.from('x', 'utf8');
    expect(() => encryptWithKey(pt, shortKey)).toThrow(/AES-256-GCM requires a 32-byte key/);
    // Construct a valid envelope with the real key, then try to decrypt with short key.
    const env = encryptWithKey(pt, key);
    expect(() => decryptWithKey(env, shortKey)).toThrow(/AES-256-GCM requires a 32-byte key/);
  });

  // 11
  it('throws on 64-byte key (both encrypt + decrypt)', () => {
    const longKey = crypto.randomBytes(64);
    const pt = Buffer.from('x', 'utf8');
    expect(() => encryptWithKey(pt, longKey)).toThrow(/AES-256-GCM requires a 32-byte key/);
    const env = encryptWithKey(pt, key);
    expect(() => decryptWithKey(env, longKey)).toThrow(/AES-256-GCM requires a 32-byte key/);
  });

  // 12
  it('generateDek returns a 32-byte Buffer; two calls produce distinct keys', () => {
    const a = generateDek();
    const b = generateDek();
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(a.equals(b)).toBe(false);
  });

  // 13
  it('JSON round-trip: JSON.parse(JSON.stringify(envelope)) decrypts cleanly', () => {
    const pt = Buffer.from('round through JSON', 'utf8');
    const env = encryptWithKey(pt, key);
    const cloned: Envelope = JSON.parse(JSON.stringify(env));
    expect(decryptWithKey(cloned, key).equals(pt)).toBe(true);
  });

  // Alias sanity — wrapWithDek / unwrapWithDek / wrapDek / unwrapDek MUST all alias.
  it('alias exports (wrapWithDek/unwrapWithDek/wrapDek/unwrapDek) round-trip', () => {
    const pt = Buffer.from('alias roundtrip', 'utf8');
    const env1 = wrapWithDek(pt, key);
    expect(unwrapWithDek(env1, key).equals(pt)).toBe(true);

    const env2 = wrapDek(pt, key);
    expect(unwrapDek(env2, key).equals(pt)).toBe(true);

    // Also confirm identity (same function reference).
    expect(wrapWithDek).toBe(encryptWithKey);
    expect(unwrapWithDek).toBe(decryptWithKey);
    expect(wrapDek).toBe(encryptWithKey);
    expect(unwrapDek).toBe(decryptWithKey);
  });
});
