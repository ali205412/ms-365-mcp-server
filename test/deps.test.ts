/**
 * Static package.json invariants (FOUND-03 + D-03 dependency sanity).
 *
 * Requirement: FOUND-03 — winston removed; pino present.
 * Requirement: D-03 — @opentelemetry/sdk-node present.
 *
 * These tests MUST FAIL before package.json is updated (RED phase).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

describe('deps: package.json invariants (FOUND-03, D-03)', () => {
  it('package.json.dependencies.pino is defined', () => {
    expect(pkg.dependencies?.['pino']).toBeDefined();
  });

  it('package.json.dependencies["@opentelemetry/sdk-node"] is defined', () => {
    expect(pkg.dependencies?.['@opentelemetry/sdk-node']).toBeDefined();
  });

  it('package.json.dependencies.winston is NOT defined (removed)', () => {
    expect(pkg.dependencies?.['winston']).toBeUndefined();
  });

  it('package.json.devDependencies["pino-pretty"] is defined', () => {
    expect(pkg.devDependencies?.['pino-pretty']).toBeDefined();
  });
});
