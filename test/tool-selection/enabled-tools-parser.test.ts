/**
 * Plan 05-04 Task 1 — enabled-tools-parser.ts unit tests.
 *
 * Exercises the 5-step construction order from CONTEXT D-20:
 *   1. Start with empty set
 *   2. If ANY selector is `+...`, seed from preset_version preset
 *   3. Apply each selector additively
 *   4. Freeze
 *   5. Attach via WeakMap memoization
 *
 * Uses vi.mock to stub the generated client (src/generated/client.ts is
 * regen-time output and not present in this worktree). Also mocks
 * preset-loader so we can control the preset-under-test deterministically.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request } from 'express';

// Stubbed generated client — defines three workloads (mail, users, security)
// so workload-expansion tests have something to iterate.
vi.mock('../../src/generated/client.js', () => ({
  api: {
    endpoints: [
      { alias: 'list-mail-messages', method: 'get', path: '/me/messages' },
      { alias: 'send-mail', method: 'post', path: '/me/sendMail' },
      { alias: 'list-users', method: 'get', path: '/users' },
      { alias: 'create-user', method: 'post', path: '/users' },
      { alias: 'list-security-alerts', method: 'get', path: '/security/alerts_v2' },
      { alias: '__beta__security-incidents', method: 'get', path: '/security/incidents' },
    ],
  },
}));

// Stubbed preset-loader — essentials has 2 ops; unknown version fails closed.
vi.mock('../../src/lib/tool-selection/preset-loader.js', () => {
  const ESSENTIALS = Object.freeze(new Set<string>(['send-mail', 'list-users']));
  const EMPTY = Object.freeze(new Set<string>());
  return {
    ESSENTIALS_V1_OPS: ESSENTIALS,
    DEFAULT_PRESET_VERSION: 'essentials-v1',
    presetFor: (version: string): ReadonlySet<string> => {
      if (version === 'essentials-v1') return ESSENTIALS;
      return EMPTY;
    },
  };
});

describe('plan 05-04 Task 1 — enabled-tools-parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeEnabledToolsSet (pure core)', () => {
    it('Test 5: NULL input → preset from preset_version', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet(null, 'essentials-v1');
      expect(set.has('send-mail')).toBe(true);
      expect(set.has('list-users')).toBe(true);
      expect(set.size).toBe(2);
    });

    it('Test 5b: NULL + unknown preset_version → empty Set (fail-closed)', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet(null, 'unknown-preset');
      expect(set.size).toBe(0);
    });

    it('Test 6: empty string → empty Set (explicit no-tools)', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('', 'essentials-v1');
      expect(set.size).toBe(0);
    });

    it('Test 6b: whitespace-only string → empty Set', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('   ', 'essentials-v1');
      expect(set.size).toBe(0);
    });

    it('Test 7: "mail:*" → every mail-workload alias from the registry', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('mail:*', 'essentials-v1');
      // mail workload → aliases whose first segment is "mail"
      expect(set.has('list-mail-messages')).toBe(true);
      // send-mail starts with "send-" so it is NOT in the mail workload by
      // the first-segment classifier. Only aliases whose FIRST segment is
      // "mail" get pulled in. This is intentional — workload classification
      // is prefix-based on the path-classifier convention.
      expect(set.size).toBe(1);
    });

    it('Test 7b: "users:*" → every users-workload alias', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('users:*', 'essentials-v1');
      expect(set.has('list-users')).toBe(true);
      expect(set.has('create-user')).toBe(false);
      // "create-user" first segment is "create" not "users" — classifier
      // is strict first-segment, not substring. Test 7c covers that.
    });

    it('Test 7c: workload classifier strips __beta__ prefix', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('security:*', 'essentials-v1');
      // Both `list-security-alerts` AND `__beta__security-incidents` should
      // be included because the __beta__ prefix is stripped for workload
      // classification (05-PATTERNS + 05-RESEARCH).
      expect(set.has('list-security-alerts')).toBe(true);
      expect(set.has('__beta__security-incidents')).toBe(true);
      expect(set.size).toBe(2);
    });

    it('Test 8: "mail.messages.send,users.list" → set of exactly 2 elements', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('mail.messages.send,users.list', 'essentials-v1');
      expect(set.size).toBe(2);
      expect(set.has('mail.messages.send')).toBe(true);
      expect(set.has('users.list')).toBe(true);
      // Verifies replacement semantics: no preset leakage
      expect(set.has('send-mail')).toBe(false);
    });

    it('Test 9: "+security:*" → union of preset + security workload', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('+security:*', 'essentials-v1');
      // Additive seeds from preset first
      expect(set.has('send-mail')).toBe(true);
      expect(set.has('list-users')).toBe(true);
      // Then adds security workload (with __beta__ stripping)
      expect(set.has('list-security-alerts')).toBe(true);
      expect(set.has('__beta__security-incidents')).toBe(true);
      expect(set.size).toBe(4);
    });

    it('Test 9b: mixing additive + non-additive seeds from preset (any `+` triggers seed)', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('list-mail-messages,+security:*', 'essentials-v1');
      // Preset seeds because `+security:*` is additive
      expect(set.has('send-mail')).toBe(true);
      expect(set.has('list-users')).toBe(true);
      // Explicit op added
      expect(set.has('list-mail-messages')).toBe(true);
      // Workload expanded
      expect(set.has('list-security-alerts')).toBe(true);
    });

    it('Test 11: returned Set is frozen', async () => {
      const { computeEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const set = computeEnabledToolsSet('mail.messages.send', 'essentials-v1');
      expect(Object.isFrozen(set)).toBe(true);
      // Frozen Sets still allow .add() at the JS level but throw / no-op in strict;
      // the identity contract is what matters — callers must treat it as read-only.
    });
  });

  describe('ensureEnabledToolsSet (WeakMap memoization)', () => {
    it('Test 10: two calls with same req yield identity-equal Set', async () => {
      const { ensureEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const req = {} as Request;
      const first = ensureEnabledToolsSet(req, 'mail.messages.send', 'essentials-v1');
      const second = ensureEnabledToolsSet(req, 'mail.messages.send', 'essentials-v1');
      expect(first).toBe(second);
    });

    it('Test 10b: different request objects get independent Sets', async () => {
      const { ensureEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const reqA = {} as Request;
      const reqB = {} as Request;
      const setA = ensureEnabledToolsSet(reqA, 'mail.messages.send', 'essentials-v1');
      const setB = ensureEnabledToolsSet(reqB, 'users.list', 'essentials-v1');
      expect(setA).not.toBe(setB);
      expect(setA.has('mail.messages.send')).toBe(true);
      expect(setB.has('users.list')).toBe(true);
    });

    it('Test 10c: same req, parseSelectorList called only once despite multiple lookups', async () => {
      const { ensureEnabledToolsSet } = await import(
        '../../src/lib/tool-selection/enabled-tools-parser.js'
      );
      const req = {} as Request;
      // Invoke many times — all must return the same Set
      const results = Array.from({ length: 5 }).map(() =>
        ensureEnabledToolsSet(req, 'mail.messages.send', 'essentials-v1')
      );
      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBe(results[0]);
      }
    });
  });
});
