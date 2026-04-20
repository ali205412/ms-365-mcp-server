/**
 * Plan 04-01 Task 1 — opaque HMAC-signed cursor unit tests (D-14, T-04-02).
 *
 * Tests for src/lib/admin/cursor.ts. Covers:
 *   - Round-trip encode/decode (Test 1).
 *   - Tamper detection on body portion (Test 2).
 *   - Tamper detection on sig portion (Test 3).
 *   - Malformed cursor returns null (Test 4).
 *   - Different secrets fail decode — documents process-restart invalidation (Test 5).
 *   - Defensive decode — missing ts/id returns null (Test 6).
 *   - createCursorSecret returns 32-byte Buffer (Test 7).
 *   - CURSOR_SEPARATOR constant is exactly ':' (Test 8).
 *
 * Uses live node:crypto — no mocks — for deterministic HMAC output.
 */
import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, createCursorSecret, CURSOR_SEPARATOR } from '../cursor.js';

// Deterministic secret so tests are reproducible. 32 bytes (256 bits).
const SECRET_A = Buffer.from(
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  'hex'
);
const SECRET_B = Buffer.from(
  '00000000000000000000000000000000000000000000000000000000000000ff',
  'hex'
);

describe('cursor — round-trip and tamper detection', () => {
  it('Test 1: encode then decode returns exact payload', () => {
    const payload = { ts: 1234567890, id: 'abc-def' };
    const cursor = encodeCursor(payload, SECRET_A);
    const decoded = decodeCursor(cursor, SECRET_A);
    expect(decoded).toEqual(payload);
  });

  it('Test 2: tampered body portion → null', () => {
    const cursor = encodeCursor({ ts: 1, id: 'x' }, SECRET_A);
    const sepIdx = cursor.lastIndexOf(CURSOR_SEPARATOR);
    const body = cursor.slice(0, sepIdx);
    const sig = cursor.slice(sepIdx + 1);
    // Flip first character of body; base64url uses A-Za-z0-9_- so picking a
    // safe alternate char keeps the string parseable but changes the payload.
    const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
    const tampered = `${flipped}${CURSOR_SEPARATOR}${sig}`;
    expect(decodeCursor(tampered, SECRET_A)).toBeNull();
  });

  it('Test 3: tampered sig portion → null', () => {
    const cursor = encodeCursor({ ts: 1, id: 'x' }, SECRET_A);
    const sepIdx = cursor.lastIndexOf(CURSOR_SEPARATOR);
    const body = cursor.slice(0, sepIdx);
    const sig = cursor.slice(sepIdx + 1);
    const flippedSig = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const tampered = `${body}${CURSOR_SEPARATOR}${flippedSig}`;
    expect(decodeCursor(tampered, SECRET_A)).toBeNull();
  });

  it('Test 4: malformed cursor (no separator) → null', () => {
    expect(decodeCursor('nosignaturehere', SECRET_A)).toBeNull();
    expect(decodeCursor('', SECRET_A)).toBeNull();
    // No body before separator.
    expect(decodeCursor(':justsig', SECRET_A)).toBeNull();
  });

  it('Test 5: different secrets invalidate — process-restart model', () => {
    const cursor = encodeCursor({ ts: 42, id: 'x' }, SECRET_A);
    // Encoding with SECRET_A then decoding with SECRET_B must fail — this is
    // exactly the process-restart path: new secret ⇒ old cursors invalid.
    expect(decodeCursor(cursor, SECRET_B)).toBeNull();
  });

  it('Test 6: defensive decode — missing ts or id → null', () => {
    // Hand-craft a cursor whose body decodes to a malformed payload.
    const malformedBody = Buffer.from(
      JSON.stringify({ ts: 'not-a-number', id: 'x' }),
      'utf8'
    ).toString('base64url');
    // Recompute a valid sig over the bad body so the HMAC check passes and
    // we exercise the JSON-shape guard, not the HMAC guard.
    const sig = crypto
      .createHmac('sha256', SECRET_A)
      .update(malformedBody)
      .digest('base64url')
      .slice(0, 11);
    const cursor = `${malformedBody}${CURSOR_SEPARATOR}${sig}`;
    expect(decodeCursor(cursor, SECRET_A)).toBeNull();

    // Missing id.
    const noIdBody = Buffer.from(JSON.stringify({ ts: 1 }), 'utf8').toString('base64url');
    const sig2 = crypto
      .createHmac('sha256', SECRET_A)
      .update(noIdBody)
      .digest('base64url')
      .slice(0, 11);
    const cursor2 = `${noIdBody}${CURSOR_SEPARATOR}${sig2}`;
    expect(decodeCursor(cursor2, SECRET_A)).toBeNull();
  });

  it('Test 7: createCursorSecret returns a 32-byte Buffer', () => {
    const s = createCursorSecret();
    expect(Buffer.isBuffer(s)).toBe(true);
    expect(s.length).toBe(32);
    // Two calls must not return the same bytes.
    const s2 = createCursorSecret();
    expect(s.equals(s2)).toBe(false);
  });

  it('Test 8: CURSOR_SEPARATOR is exactly ":"', () => {
    expect(CURSOR_SEPARATOR).toBe(':');
  });
});
