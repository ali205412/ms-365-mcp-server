import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static-file triage tests for Plan 01-09 (FOUND-04).
 *
 * These tests do not exercise runtime behavior. They pin file-system and
 * source-level invariants that the plan established so a future contributor
 * cannot accidentally reintroduce the bugs / tech debt that Plan 01-09 removed.
 *
 * Every assertion maps to a CONCERNS.md item or to the "residual keytar"
 * confirmation sweep that runs after Plan 01-08.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

describe('CONCERNS.md triage (FOUND-04 / Plan 01-09)', () => {
  it('Test A: stray test-calendar-fix.js deleted from repo root', () => {
    expect(fs.existsSync(path.join(repoRoot, 'test-calendar-fix.js'))).toBe(false);
  });

  it('Test B: stray test-real-calendar.js deleted from repo root', () => {
    expect(fs.existsSync(path.join(repoRoot, 'test-real-calendar.js'))).toBe(false);
  });

  it('Test C: test/calendar-fix.test.js renamed to .ts', () => {
    expect(fs.existsSync(path.join(repoRoot, 'test', 'calendar-fix.test.js'))).toBe(false);
  });

  it('Test D: test/calendar-fix.test.ts exists', () => {
    expect(fs.existsSync(path.join(repoRoot, 'test', 'calendar-fix.test.ts'))).toBe(true);
  });

  it('Test E: test/auth-paths.test.ts uses os.tmpdir (portable)', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'test', 'auth-paths.test.ts'), 'utf8');
    expect(src).toMatch(/os\.tmpdir/);
  });

  it('Test F: test/auth-paths.test.ts does NOT contain hardcoded /tmp/test-cache/', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'test', 'auth-paths.test.ts'), 'utf8');
    expect(src).not.toMatch(/\/tmp\/test-cache\//);
  });

  it('Test G: src/graph-client.ts has exactly ONE removeODataProps declaration', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'src', 'graph-client.ts'), 'utf8');
    const matches = src.match(/\b(function|const)\s+removeODataProps\b/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('Test H: src/graph-client.ts uses WeakSet cycle guard', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'src', 'graph-client.ts'), 'utf8');
    expect(src).toMatch(/WeakSet/);
  });

  it('Test I: src/graph-tools.ts uses endpointsMap for O(1) lookup', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'src', 'graph-tools.ts'), 'utf8');
    expect(src).toMatch(/endpointsMap/);
  });

  it('Test J: src/graph-tools.ts does NOT contain endpointsData.find(', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'src', 'graph-tools.ts'), 'utf8');
    expect(src).not.toMatch(/endpointsData\.find\(/);
  });

  it('Test K: CONCERNS.md has phase-pointer annotations', () => {
    const src = fs.readFileSync(
      path.join(repoRoot, '.planning', 'codebase', 'CONCERNS.md'),
      'utf8'
    );
    // Phase pointers must exist — we accept either "Phase 2" or "Phase 3" as
    // the marker, since both show up in the deferred-items matrix.
    const hasPhase2 = /Deferred to:?\s*Phase 2/.test(src) || /Phase 2\s*\(/.test(src);
    const hasPhase3 = /Deferred to:?\s*Phase 3/.test(src) || /Phase 3\s*\(/.test(src);
    expect(hasPhase2 || hasPhase3).toBe(true);
  });
});
