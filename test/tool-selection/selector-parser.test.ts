/**
 * Plan 05-04 Task 1 — selector-ast.ts unit tests.
 *
 * Covers the 6 selector kinds (workload, op, preset × regular/additive), the
 * character whitelist (T-05-07 injection defense), and the helpful error
 * message for the `;` separator mistake. No project-internal module mocking
 * — selector-ast.ts is a pure module with zero project imports, so the tests
 * exercise the real implementation.
 */
import { describe, it, expect } from 'vitest';
import {
  parseSelectorList,
  type Selector,
} from '../../src/lib/tool-selection/selector-ast.js';

describe('plan 05-04 Task 1 — selector-ast parser', () => {
  describe('selector kinds (Test 1: all 6 variants)', () => {
    it('parses workload selector', () => {
      const r = parseSelectorList('users:*');
      expect(r).toEqual<Selector[]>([{ kind: 'workload', raw: 'users:*', value: 'users' }]);
    });

    it('parses op selector (simple)', () => {
      const r = parseSelectorList('send-mail');
      expect(r).toEqual<Selector[]>([{ kind: 'op', raw: 'send-mail', value: 'send-mail' }]);
    });

    it('parses op selector with dot notation', () => {
      const r = parseSelectorList('mail.messages.send');
      expect(r).toEqual<Selector[]>([
        { kind: 'op', raw: 'mail.messages.send', value: 'mail.messages.send' },
      ]);
    });

    it('parses preset selector', () => {
      const r = parseSelectorList('preset:essentials-v1');
      expect(r).toEqual<Selector[]>([
        { kind: 'preset', raw: 'preset:essentials-v1', value: 'essentials-v1' },
      ]);
    });

    it('parses additive-workload selector', () => {
      const r = parseSelectorList('+security:*');
      expect(r).toEqual<Selector[]>([
        { kind: 'additive-workload', raw: '+security:*', value: 'security' },
      ]);
    });

    it('parses additive-op selector', () => {
      const r = parseSelectorList('+users.read');
      expect(r).toEqual<Selector[]>([
        { kind: 'additive-op', raw: '+users.read', value: 'users.read' },
      ]);
    });

    it('parses additive-preset selector', () => {
      const r = parseSelectorList('+preset:essentials-v1');
      expect(r).toEqual<Selector[]>([
        { kind: 'additive-preset', raw: '+preset:essentials-v1', value: 'essentials-v1' },
      ]);
    });

    it('parses a comma-separated list combining multiple kinds', () => {
      const r = parseSelectorList('+preset:essentials-v1,mail.messages.send,users:*');
      expect(r).toHaveLength(3);
      expect(r[0]!.kind).toBe('additive-preset');
      expect(r[1]!.kind).toBe('op');
      expect(r[2]!.kind).toBe('workload');
    });

    it('tolerates whitespace around commas', () => {
      const r = parseSelectorList('users:* , mail.messages.send ,  preset:essentials-v1');
      expect(r).toHaveLength(3);
    });
  });

  describe('invalid character rejection (Test 2: T-05-07 injection defense)', () => {
    it('rejects HTML/XSS-style content (< >)', () => {
      expect(() => parseSelectorList('users:*<script>')).toThrow(/invalid characters/);
    });

    it('rejects SQL injection tokens (spaces and quotes are off-whitelist)', () => {
      expect(() => parseSelectorList("users'; DROP TABLE")).toThrow(/invalid characters/);
    });

    it('rejects null bytes', () => {
      // The null byte short-circuits parseSelectorList before split — test via
      // a per-part that contains a null byte after split.
      expect(() => parseSelectorList('users\0evil')).toThrow(/invalid characters/);
    });

    it('rejects ampersand / shell operators', () => {
      expect(() => parseSelectorList('users&other')).toThrow(/invalid characters/);
    });

    it('rejects whitespace INSIDE a token (not just at trim positions)', () => {
      expect(() => parseSelectorList('bad token')).toThrow(/invalid characters/);
    });

    it('rejects path-traversal fragments', () => {
      expect(() => parseSelectorList('../etc/passwd')).toThrow(/invalid characters/);
    });

    it('rejects unicode homoglyph-style characters', () => {
      // Cyrillic "a" — looks like Latin but fails the ASCII whitelist.
      expect(() => parseSelectorList('users:\u0430')).toThrow(/invalid characters/);
    });
  });

  describe('semicolon separator (Test 3: helpful message)', () => {
    it('rejects `;` and names the correct separator', () => {
      expect(() => parseSelectorList('a;b')).toThrow(/must be "," not ";"/);
    });

    it('rejects even a single trailing `;`', () => {
      expect(() => parseSelectorList('mail.messages.send;')).toThrow(/must be "," not ";"/);
    });

    it('rejects leading `;`', () => {
      expect(() => parseSelectorList(';')).toThrow(/must be "," not ";"/);
    });
  });

  describe('empty / whitespace inputs (Test 4)', () => {
    it('returns [] for empty string', () => {
      expect(parseSelectorList('')).toEqual([]);
    });

    it('returns [] for whitespace-only input', () => {
      expect(parseSelectorList('   ')).toEqual([]);
    });

    it('returns [] for comma-only input (all empty parts filtered)', () => {
      expect(parseSelectorList(',,,')).toEqual([]);
    });

    it('throws on bare `+` (empty body)', () => {
      expect(() => parseSelectorList('+')).toThrow(/Empty selector body/);
    });

    it('throws on empty workload name (`:*`)', () => {
      expect(() => parseSelectorList(':*')).toThrow(/Empty workload name/);
    });

    it('throws on bare `preset:` (empty preset name)', () => {
      expect(() => parseSelectorList('preset:')).toThrow(/Empty preset name/);
    });
  });
});
