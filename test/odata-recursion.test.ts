import { describe, it, expect } from 'vitest';
import { removeODataProps } from '../src/graph-client.js';

/**
 * Pure-function unit tests for `removeODataProps`.
 *
 * FOUND-04 / Plan 01-09 Task 2:
 *   - Module-level helper with MAX_REMOVE_ODATA_DEPTH = 100 depth guard
 *   - WeakSet cycle guard (prevents stack overflow on self-referencing payloads)
 *   - Strips `@odata.*` keys EXCEPT `@odata.nextLink` (existing contract — see
 *     test/odata-nextlink.test.ts). Phase 1 does not change that contract.
 *   - Returns a new object (immutable) — does not mutate input.
 *
 * The tests here are pure (no mocks, no filesystem) so they run fast and stay
 * isolated from the rest of the Graph request pipeline.
 */
describe('removeODataProps (FOUND-04 / Plan 01-09)', () => {
  it('Test 1: handles self-cycle without stack overflow (T-01-09a DoS mitigation)', () => {
    // A self-referencing payload must not stack-overflow the process. The
    // WeakSet cycle guard ensures the function terminates.
    const obj: Record<string, unknown> = { foo: 'bar' };
    obj.self = obj;
    const start = Date.now();
    const result = removeODataProps(obj as unknown);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
  });

  it('Test 2: 150-level deep tree returns without recursion error (depth cap)', () => {
    // Build a 150-level deep tree. The depth guard at MAX_REMOVE_ODATA_DEPTH=100
    // silently truncates deeper levels rather than stack-overflowing.
    const makeTree = (n: number): Record<string, unknown> =>
      n === 0 ? { leaf: true } : { '@odata.etag': 'drop', child: makeTree(n - 1) };
    const tree = makeTree(150);
    expect(() => removeODataProps(tree as unknown)).not.toThrow();
  });

  it('Test 3: strips non-nextLink @odata keys while preserving regular fields', () => {
    // Existing behavior preserves @odata.nextLink (see test/odata-nextlink.test.ts).
    // All other @odata.* keys are stripped.
    const result = removeODataProps({ '@odata.etag': 'x', foo: 'y' });
    expect(result).toEqual({ foo: 'y' });
  });

  it('Test 4: primitive passthrough — null, strings, numbers returned as-is', () => {
    expect(removeODataProps(null)).toBe(null);
    expect(removeODataProps('str')).toBe('str');
    expect(removeODataProps(42)).toBe(42);
    expect(removeODataProps(undefined)).toBe(undefined);
    expect(removeODataProps(true)).toBe(true);
  });

  it('Test 5: arrays handled — per-element recursion with @odata stripping', () => {
    const result = removeODataProps([{ '@odata.etag': 'x' }, { '@odata.etag': 'y', kept: 1 }]);
    expect(result).toEqual([{}, { kept: 1 }]);
  });
});
