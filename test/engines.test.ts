import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('package.json engines field', () => {
  it('engines.node matches ">=20 <23" (exact format, optional whitespace)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    expect(pkg.engines.node).toMatch(/^>=20\s*<23$/);
  });

  it('process.version is on a supported runtime (>= Node 20)', () => {
    const major = Number(process.version.match(/^v(\d+)/)?.[1]);
    expect(major).toBeGreaterThanOrEqual(20);
  });
});
