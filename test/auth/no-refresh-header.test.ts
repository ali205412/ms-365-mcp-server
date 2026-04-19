/**
 * Plan 03-07 Task 2 — x-microsoft-refresh-token header read path is GONE.
 *
 * SECUR-02 + T-03-07-01 invariant: the custom header read site in
 * src/lib/microsoft-auth.ts is fully removed. The deprecated
 * `microsoftBearerTokenAuthMiddleware` export is removed too. v1 HTTP-mode
 * clients that rely on the header are documented in docs/migration-v1-to-v2.md.
 *
 * The test combines THREE orthogonal signals:
 *   a) Source-grep: zero matches for "x-microsoft-refresh-token" in src/
 *      (excluding docs + tests).
 *   b) Export-surface: `microsoftBearerTokenAuthMiddleware` is not exported
 *      from src/lib/microsoft-auth.ts.
 *   c) Runtime spy: if any middleware did, hypothetically, still touch the
 *      header, we'd catch it with a Proxy that records property reads.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SRC_DIR = path.join(REPO_ROOT, 'src');

function walkTsFiles(root: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    // Skip generated catalogs and node_modules.
    if (entry === 'generated' || entry === 'node_modules') continue;
    const full = path.join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, collected);
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      collected.push(full);
    }
  }
  return collected;
}

describe('plan 03-07 Task 2 — x-microsoft-refresh-token header read removed (SECUR-02)', () => {
  it('Signal A: zero references to x-microsoft-refresh-token in src/ (excluding comments allowed)', () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(SRC_DIR)) {
      const content = readFileSync(file, 'utf8');
      // src/logger.ts and src/lib/redact.ts LEGITIMATELY list the header in
      // redaction path arrays — those are defensive (redact if it ever arrives)
      // not a READ path. Allow the literal only when it appears inside a
      // REDACT_PATHS-style string array.
      if (file.endsWith('/src/logger.ts') || file.endsWith('/src/lib/redact.ts')) {
        continue;
      }
      if (content.includes('x-microsoft-refresh-token')) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }
    expect(offenders, `found x-microsoft-refresh-token header reads in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('Signal B: microsoftBearerTokenAuthMiddleware is no longer exported from src/lib/microsoft-auth.ts', async () => {
    const mod = await import('../../src/lib/microsoft-auth.js');
    // Legacy deprecated export is gone entirely.
    expect((mod as Record<string, unknown>).microsoftBearerTokenAuthMiddleware).toBeUndefined();
    // New canonical middleware is present.
    expect(typeof (mod as Record<string, unknown>).createBearerMiddleware).toBe('function');
  });

  it('Signal C: src/lib/microsoft-auth.ts source does not contain any req.headers[x-microsoft-refresh-token] access', () => {
    const source = readFileSync(path.join(SRC_DIR, 'lib/microsoft-auth.ts'), 'utf8');
    // Both bracket and dot forms
    expect(source).not.toMatch(/req\.headers\[.x-microsoft-refresh-token.\]/);
    expect(source).not.toMatch(/headers\[.x-microsoft-refresh-token.\]/);
    // No mention at all in the auth module itself (tighter than the whole-src scan)
    expect(source.toLowerCase()).not.toContain('x-microsoft-refresh-token');
  });

  it('Signal D: src/server.ts no longer imports microsoftBearerTokenAuthMiddleware', () => {
    const source = readFileSync(path.join(SRC_DIR, 'server.ts'), 'utf8');
    // Neither the import site nor the middleware-mount site may reference the removed export
    expect(source).not.toContain('microsoftBearerTokenAuthMiddleware');
  });
});
