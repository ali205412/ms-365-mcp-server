/**
 * Plan 05-04 Task 2 — dispatch-guard.ts unit tests.
 *
 * Exercises the pure `checkDispatch` helper at the dispatch boundary:
 *   - `null` return on pass (tool alias is in the enabled set)
 *   - Structured rejection envelope on miss
 *   - Fail-closed behavior on undefined set / tenantId / presetVersion
 *
 * Integration with AsyncLocalStorage + executeGraphTool is covered by the
 * dispatch-enforcement integration test; this file is the minimal spec for
 * the pure function.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  checkDispatch,
  setStdioFallback,
  _getStdioFallbackForTest,
} from '../../src/lib/tool-selection/dispatch-guard.js';

describe('plan 05-04 Task 2 — dispatch-guard (pure helper)', () => {
  // Reset stdio fallback between tests — it is a module-level mutable
  // handle and cross-test pollution would skew fail-closed assertions.
  beforeEach(() => {
    setStdioFallback(undefined);
  });
  afterEach(() => {
    setStdioFallback(undefined);
  });

  describe('Test 5: pass (tool in enabled set)', () => {
    it('returns null when alias is in the set', () => {
      const set: ReadonlySet<string> = new Set(['send-mail']);
      expect(checkDispatch('send-mail', set, 'tenant-1', 'essentials-v1')).toBeNull();
    });

    it('returns null for every alias when called repeatedly', () => {
      const set: ReadonlySet<string> = new Set(['a', 'b', 'c']);
      expect(checkDispatch('a', set, 't', 'p')).toBeNull();
      expect(checkDispatch('b', set, 't', 'p')).toBeNull();
      expect(checkDispatch('c', set, 't', 'p')).toBeNull();
    });
  });

  describe('Test 6: reject (tool not in enabled set)', () => {
    it('returns CallToolResult with isError=true and D-20 envelope shape', () => {
      const set: ReadonlySet<string> = new Set(['send-mail']);
      const r = checkDispatch('not-allowed', set, 'tenant-1', 'essentials-v1');
      expect(r).not.toBeNull();
      if (r === null) throw new Error('unreachable');
      expect(r.isError).toBe(true);
      expect(r.content[0]).toBeDefined();
      expect(r.content[0]!.type).toBe('text');
      const payload = JSON.parse(r.content[0]!.text);
      expect(payload.error).toBe('tool_not_enabled_for_tenant');
      expect(payload.tool).toBe('not-allowed');
      expect(payload.tenantId).toBe('tenant-1');
      expect(payload.enabled_preset_version).toBe('essentials-v1');
      expect(typeof payload.hint).toBe('string');
      expect(payload.hint.length).toBeGreaterThan(0);
    });

    it('hint references the admin PATCH path for self-service fix', () => {
      const set: ReadonlySet<string> = new Set([]);
      const r = checkDispatch('some-tool', set, 'tenant-xyz', 'essentials-v1');
      if (r === null) throw new Error('unreachable');
      const payload = JSON.parse(r.content[0]!.text);
      expect(payload.hint).toContain('/admin/tenants/');
      expect(payload.hint).toContain('tenant-xyz');
    });
  });

  describe('fail-closed behavior (T-05-09 defense)', () => {
    it('undefined enabledSet → reject with unknown tenant fallback', () => {
      const r = checkDispatch('send-mail', undefined, undefined, undefined);
      expect(r).not.toBeNull();
      if (r === null) throw new Error('unreachable');
      expect(r.isError).toBe(true);
      const payload = JSON.parse(r.content[0]!.text);
      expect(payload.error).toBe('tool_not_enabled_for_tenant');
      expect(payload.tenantId).toBe('unknown');
      expect(payload.enabled_preset_version).toBe('unknown');
    });

    it('undefined enabledSet with defined tenant still rejects', () => {
      const r = checkDispatch('send-mail', undefined, 'tenant-9', 'essentials-v1');
      expect(r).not.toBeNull();
      if (r === null) throw new Error('unreachable');
      const payload = JSON.parse(r.content[0]!.text);
      expect(payload.tenantId).toBe('tenant-9');
      expect(payload.enabled_preset_version).toBe('essentials-v1');
    });

    it('empty Set (explicit no-tools) rejects every alias', () => {
      const set: ReadonlySet<string> = new Set();
      const r = checkDispatch('anything', set, 'tenant-1', 'essentials-v1');
      expect(r).not.toBeNull();
      if (r === null) throw new Error('unreachable');
      expect(r.isError).toBe(true);
    });
  });

  describe('does not throw (MCP transport stability)', () => {
    it('never throws on pass path', () => {
      expect(() => checkDispatch('send-mail', new Set(['send-mail']), 't', 'p')).not.toThrow();
    });

    it('never throws on reject path', () => {
      expect(() => checkDispatch('denied', new Set(['send-mail']), 't', 'p')).not.toThrow();
    });

    it('never throws on fail-closed path', () => {
      expect(() => checkDispatch('denied', undefined, undefined, undefined)).not.toThrow();
    });
  });

  describe('stdio-mode fallback (Pitfall 8)', () => {
    it('falls back to the stdio registration when ALS is empty', () => {
      setStdioFallback({
        enabledToolsSet: new Set(['tool-a']),
        tenantId: 'stdio-tenant',
        presetVersion: 'stdio-v1',
      });
      // ALS triple is all undefined → falls back to stdio registration
      expect(checkDispatch('tool-a', undefined, undefined, undefined)).toBeNull();
    });

    it('fallback preserves tenantId + presetVersion in rejection envelope', () => {
      setStdioFallback({
        enabledToolsSet: new Set(['tool-a']),
        tenantId: 'stdio-tenant',
        presetVersion: 'stdio-v1',
      });
      const r = checkDispatch('not-in-fallback', undefined, undefined, undefined);
      expect(r).not.toBeNull();
      if (r === null) throw new Error('unreachable');
      const payload = JSON.parse(r.content[0]!.text);
      expect(payload.tenantId).toBe('stdio-tenant');
      expect(payload.enabled_preset_version).toBe('stdio-v1');
    });

    it('ALS triple wins over stdio fallback when both are present', () => {
      setStdioFallback({
        enabledToolsSet: new Set(['stdio-only-tool']),
        tenantId: 'stdio-tenant',
        presetVersion: 'stdio-v1',
      });
      // ALS says HTTP with different enabled set → the ALS set wins
      const alsSet = new Set(['http-only-tool']);
      expect(checkDispatch('http-only-tool', alsSet, 'http-tenant', 'essentials-v1')).toBeNull();
      // And stdio tool fails under ALS
      const r = checkDispatch('stdio-only-tool', alsSet, 'http-tenant', 'essentials-v1');
      expect(r).not.toBeNull();
      if (r === null) throw new Error('unreachable');
      const payload = JSON.parse(r.content[0]!.text);
      expect(payload.tenantId).toBe('http-tenant');
    });

    it('clearing the fallback via setStdioFallback(undefined) returns to fail-closed', () => {
      setStdioFallback({
        enabledToolsSet: new Set(['tool-a']),
        tenantId: 't',
        presetVersion: 'p',
      });
      expect(_getStdioFallbackForTest()).toBeDefined();
      setStdioFallback(undefined);
      expect(_getStdioFallbackForTest()).toBeUndefined();
      // With fallback cleared, undefined ALS → reject with 'unknown'
      const r = checkDispatch('tool-a', undefined, undefined, undefined);
      if (r === null) throw new Error('unreachable');
      const payload = JSON.parse(r.content[0]!.text);
      expect(payload.tenantId).toBe('unknown');
    });
  });
});
