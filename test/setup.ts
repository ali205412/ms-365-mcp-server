// test/setup.ts
// Node 18 File/Blob polyfill removed — Node 20+ ships these natively.
// This file is retained as a vitest setupFiles hook for future global setup.

// Plan 05-04 (TENANT-08): existing test files that invoke executeGraphTool
// directly (without seeding requestContext with a tenant triple) used to
// proceed straight to Graph. The new dispatch-guard rejects undefined-ALS
// calls by default (fail-closed for stdio + HTTP production paths).
//
// Test files that DO want to exercise the guard mock the registry and seed
// the context themselves (see test/tool-selection/). For all OTHER existing
// test files, the intent is to drive executeGraphTool WITHOUT caring about
// tenant isolation — they pre-date Plan 05-04 and were written against a
// flat dispatch surface.
//
// We solve this with a permissive global stdio fallback registered at setup
// time. Any test that wants strict dispatch-guard behavior (see
// test/tool-selection/dispatch-guard.test.ts + dispatch-enforcement.int
// .test.ts) explicitly calls `setStdioFallback(undefined)` in its
// beforeEach to drop the permissive seed.
import { setStdioFallback } from '../src/lib/tool-selection/dispatch-guard.js';

// Universal permissive fallback: every tool alias is always allowed.
// Subclass Set so `.has()` returns true for every key while the other
// Set primitives still work normally for callers that touch `.size`,
// iterate, etc.
class PermissiveSet extends Set<string> {
  override has(_value: string): boolean {
    return true;
  }
}

const PERMISSIVE: ReadonlySet<string> = new PermissiveSet();

setStdioFallback({
  enabledToolsSet: PERMISSIVE,
  tenantId: 'test-permissive',
  presetVersion: 'test-permissive',
});
