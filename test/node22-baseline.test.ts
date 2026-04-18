import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Node 22 baseline — native globals', () => {
  it('File global is available natively (no polyfill import needed)', () => {
    expect(typeof globalThis.File).toBe('function');
  });

  it('Blob global is available natively', () => {
    expect(typeof globalThis.Blob).toBe('function');
  });

  it('test/setup.ts does NOT contain a globalThis.File assignment (polyfill removed)', () => {
    const setupSrc = fs.readFileSync(path.resolve('test/setup.ts'), 'utf8');
    // Match both `globalThis.File =` and the TypeScript cast form `}).File = class File {}`
    const matches = setupSrc.match(/\bFile\s*=\s*class\s+File/g) ?? [];
    expect(matches).toHaveLength(0);
  });
});
