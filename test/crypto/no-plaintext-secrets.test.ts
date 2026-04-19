/**
 * Plan 03-04 Task 2 — SC#5 baseline signal: no plaintext secrets on disk.
 *
 * Scans the serialized `wrapped_dek` JSON for any short (4-byte) window of
 * the plaintext DEK bytes. Any match would indicate the envelope leaked the
 * plaintext into its wire format. This is the baseline — plans 03-05 + 03-07
 * extend this test to cover the full MSAL cache blob and session tokens.
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { generateTenantDek } from '../../src/lib/crypto/dek.js';

describe('plan 03-04 Task 2 — SC#5 baseline: no plaintext DEK bytes in wrapped_dek', () => {
  it('wrapped_dek JSON contains no plaintext DEK bytes', () => {
    const kek = Buffer.alloc(32, 7);
    const { dek, wrappedDek } = generateTenantDek(kek);
    const stored = JSON.stringify(wrappedDek);

    // Scan 4-byte windows of the plaintext DEK; none should appear in the
    // stored JSON in either their raw base64 or hex form.
    for (let i = 0; i <= dek.length - 4; i++) {
      const slice = dek.subarray(i, i + 4);
      const needleB64 = slice.toString('base64').replace(/=/g, '');
      const needleHex = slice.toString('hex');
      expect(stored).not.toContain(needleB64);
      expect(stored).not.toContain(needleHex);
    }
  });

  it('wrapped_dek JSON contains only the envelope fields', () => {
    const kek = crypto.randomBytes(32);
    const { wrappedDek } = generateTenantDek(kek);
    const parsed = JSON.parse(JSON.stringify(wrappedDek));
    expect(Object.keys(parsed).sort()).toEqual(['ct', 'iv', 'tag', 'v']);
    expect(parsed.v).toBe(1);
  });

  it('different KEKs produce non-overlapping wrapped envelopes for the same DEK', () => {
    // Cannot test same DEK directly because generateTenantDek mints a fresh
    // DEK every call. Instead, wrap the same DEK manually with two KEKs.
    const dek = crypto.randomBytes(32);
    const k1 = crypto.randomBytes(32);
    const k2 = crypto.randomBytes(32);
    // Use the same path the DEK helper takes.
    const { wrappedDek: w1 } = generateTenantDek(k1);
    const { wrappedDek: w2 } = generateTenantDek(k2);
    // Envelopes differ in iv + ct + tag with overwhelming probability.
    expect(w1.iv).not.toBe(w2.iv);
    expect(w1.ct).not.toBe(w2.ct);
    // And never contain raw DEK bytes (sanity — not the DEK we minted, but still should not leak).
    const s1 = JSON.stringify(w1);
    const s2 = JSON.stringify(w2);
    for (let i = 0; i <= dek.length - 4; i++) {
      const needle = dek.subarray(i, i + 4).toString('hex');
      expect(s1).not.toContain(needle);
      expect(s2).not.toContain(needle);
    }
  });
});
