/**
 * Plan 03-04 Task 2 — src/lib/crypto/dek.ts unit tests.
 *
 * generateTenantDek(kek) + unwrapTenantDek(envelope, kek):
 *   1. generateTenantDek returns { dek: 32B, wrappedDek: Envelope }
 *   2. round-trip: unwrapTenantDek returns the original DEK bytes
 *   3. Wrong KEK → unwrap throws (AES-GCM auth tag)
 *   4. Two generateTenantDek calls produce distinct DEKs
 */
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { generateTenantDek, unwrapTenantDek } from '../../src/lib/crypto/dek.js';

describe('plan 03-04 Task 2 — dek.ts', () => {
  it('generateTenantDek returns 32-byte DEK + wrapped envelope', () => {
    const kek = crypto.randomBytes(32);
    const { dek, wrappedDek } = generateTenantDek(kek);
    expect(dek.length).toBe(32);
    expect(wrappedDek.v).toBe(1);
    expect(typeof wrappedDek.iv).toBe('string');
    expect(typeof wrappedDek.tag).toBe('string');
    expect(typeof wrappedDek.ct).toBe('string');
  });

  it('round-trips: unwrapTenantDek(wrappedDek, kek) === dek', () => {
    const kek = crypto.randomBytes(32);
    const { dek, wrappedDek } = generateTenantDek(kek);
    const recovered = unwrapTenantDek(wrappedDek, kek);
    expect(recovered.equals(dek)).toBe(true);
  });

  it('throws on unwrap with wrong KEK (AES-GCM auth tag catches it)', () => {
    const kek = crypto.randomBytes(32);
    const wrongKek = crypto.randomBytes(32);
    const { wrappedDek } = generateTenantDek(kek);
    expect(() => unwrapTenantDek(wrappedDek, wrongKek)).toThrow();
  });

  it('two calls produce distinct DEKs', () => {
    const kek = crypto.randomBytes(32);
    const a = generateTenantDek(kek);
    const b = generateTenantDek(kek);
    expect(a.dek.equals(b.dek)).toBe(false);
    expect(a.wrappedDek.iv).not.toBe(b.wrappedDek.iv);
  });
});
