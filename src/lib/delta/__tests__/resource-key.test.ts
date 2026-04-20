/**
 * Plan 04-09 Task 1 — normalizeResourceKey unit tests (MWARE-08, D-17).
 *
 * Pure-function suite for src/lib/delta/resource-key.ts. Covers the
 * canonicalisation rules enforced by D-17 "Resource key shape":
 *   - lowercase
 *   - drop trailing slashes
 *   - drop query string
 *   - /me/<X> → users/<userOid>/<X> (when oid provided)
 *   - leading slash stripped
 *   - Pitfall 7 collision: all three /me, /users/<oid>, USERS/<oid>/ forms
 *     collapse to the same key.
 *
 * No project-internal imports or logger mocks — the module under test is pure.
 */
import { describe, it, expect } from 'vitest';
import { normalizeResourceKey } from '../resource-key.js';

describe('normalizeResourceKey (plan 04-09 Task 1, MWARE-08)', () => {
  it('Test 1: basic normalize passes a lowercase path through unchanged', () => {
    expect(normalizeResourceKey('users/alice/messages')).toBe('users/alice/messages');
  });

  it('Test 2: uppercase/mixed-case is lowercased', () => {
    expect(normalizeResourceKey('Users/Alice/Messages')).toBe('users/alice/messages');
  });

  it('Test 3: a single trailing slash is dropped', () => {
    expect(normalizeResourceKey('users/alice/messages/')).toBe('users/alice/messages');
  });

  it('Test 4: multiple trailing slashes are dropped', () => {
    expect(normalizeResourceKey('users/alice///')).toBe('users/alice');
  });

  it('Test 5: query string is stripped (both $top-only and $filter&$select)', () => {
    expect(normalizeResourceKey('users/alice/messages?$top=50')).toBe('users/alice/messages');
    expect(normalizeResourceKey('/users/alice/messages?$filter=x&$select=y')).toBe(
      'users/alice/messages'
    );
  });

  it('Test 6: /me/<X> rewrites to users/<oid>/<X> when oid supplied', () => {
    expect(normalizeResourceKey('/me/messages', 'alice-oid')).toBe('users/alice-oid/messages');
    expect(normalizeResourceKey('/Me/Messages', 'alice-oid')).toBe('users/alice-oid/messages');
  });

  it('Test 7: /me without oid is left as-is (minus leading slash)', () => {
    // Documented behavior per D-17: caller is responsible for /me resolution.
    // Without oid we still do the other normalizations (leading-slash strip)
    // but NEVER invent a user id.
    expect(normalizeResourceKey('/me/messages')).toBe('me/messages');
  });

  it('Test 8: leading slash is stripped', () => {
    expect(normalizeResourceKey('/users/alice/messages')).toBe('users/alice/messages');
  });

  it('Test 9: complex nested paths normalise without surprise', () => {
    expect(normalizeResourceKey('users/alice/mailFolders/inbox/messages')).toBe(
      'users/alice/mailfolders/inbox/messages'
    );
  });

  it('Test 10: empty / malformed input returns empty string (no throw)', () => {
    expect(normalizeResourceKey('')).toBe('');
    expect(normalizeResourceKey('/')).toBe('');
  });

  it('Test 11: normaliser is idempotent — normalising a normalised value is a fixed point', () => {
    const once = normalizeResourceKey('Users/Alice/Messages/?$top=5', 'oid');
    const twice = normalizeResourceKey(once, 'oid');
    expect(once).toBe(twice);
  });

  it('Test 12: Pitfall 7 collision fix — /me, users/<oid>, and USERS/<oid>/ all collapse', () => {
    const a = normalizeResourceKey('/me/messages', 'alice-oid');
    const b = normalizeResourceKey('users/alice-oid/messages');
    const c = normalizeResourceKey('USERS/alice-oid/messages/');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe('users/alice-oid/messages');
  });

  it('Test 13: security/alerts_v2 and similar paths preserve underscore characters', () => {
    expect(normalizeResourceKey('security/alerts_v2')).toBe('security/alerts_v2');
    expect(normalizeResourceKey('security/alerts_v2/')).toBe('security/alerts_v2');
  });
});
