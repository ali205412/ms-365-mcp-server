/**
 * Post-regen tests for bin/modules/stub-missing-schemas.mjs.
 *
 * Contract:
 *   - Scans a generated client.ts for `microsoft_graph_*` identifiers that
 *     are referenced but never declared as `const` or `let`.
 *   - Injects `const <name>: z.ZodTypeAny = z.any();` stubs immediately
 *     after the `import { z } from 'zod';` line so later module-load-time
 *     references (e.g. `z.array(microsoft_graph_accessReview)`) resolve.
 *   - Runs idempotently: a second pass finds its own stubs and emits nothing.
 *   - Only namespaces under `microsoft_graph_*`. Other undefined identifiers
 *     are treated as real codegen bugs and left alone.
 *   - Throws when the `import { z } from 'zod'` anchor is missing (signals
 *     a shape change in the generated file the stubber can't safely patch).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { stubMissingSchemas } from '../../bin/modules/stub-missing-schemas.mjs';

function makeTmp() {
  const dir = path.join(os.tmpdir(), `stub-missing-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HEADER =
  "import { makeApi, Zodios, type ZodiosOptions } from './hack.js';\n" +
  "import { z } from 'zod';\n";

function makeClientWith({ consts = [], refs = [] }) {
  const constLines = consts
    .map((n) => `const ${n}: z.ZodTypeAny = z.object({}).passthrough();`)
    .join('\n');
  const refLines = refs
    .map((n, i) => `const __consumer_${i} = z.array(${n});`)
    .join('\n');
  return (
    HEADER +
    '\n' +
    constLines +
    '\n\n' +
    refLines +
    '\n\n' +
    'const endpoints = makeApi([]);\n'
  );
}

describe('stubMissingSchemas', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = makeTmp();
  });
  afterEach(() => {
    rmTmp(tmpDir);
  });

  it('stubs identifiers referenced but not declared', () => {
    const clientPath = path.join(tmpDir, 'client.ts');
    fs.writeFileSync(
      clientPath,
      makeClientWith({
        consts: ['microsoft_graph_user'],
        refs: ['microsoft_graph_user', 'microsoft_graph_accessReview'],
      })
    );

    const result = stubMissingSchemas(clientPath);

    expect(result.stubbed).toEqual(['microsoft_graph_accessReview']);
    const patched = fs.readFileSync(clientPath, 'utf-8');
    expect(patched).toContain(
      'const microsoft_graph_accessReview: z.ZodTypeAny = z.any();'
    );
  });

  it('injects stubs after `import { z } from "zod"` so forward refs resolve', () => {
    const clientPath = path.join(tmpDir, 'client.ts');
    fs.writeFileSync(
      clientPath,
      makeClientWith({ consts: [], refs: ['microsoft_graph_missing'] })
    );

    stubMissingSchemas(clientPath);

    const patched = fs.readFileSync(clientPath, 'utf-8');
    const zImportIdx = patched.indexOf("import { z } from 'zod';");
    const stubIdx = patched.indexOf('const microsoft_graph_missing:');
    const firstRefIdx = patched.indexOf('z.array(microsoft_graph_missing)');
    expect(zImportIdx).toBeGreaterThanOrEqual(0);
    expect(stubIdx).toBeGreaterThan(zImportIdx);
    expect(firstRefIdx).toBeGreaterThan(stubIdx);
  });

  it('is idempotent — second pass on the same file stubs nothing', () => {
    const clientPath = path.join(tmpDir, 'client.ts');
    fs.writeFileSync(
      clientPath,
      makeClientWith({ consts: [], refs: ['microsoft_graph_a', 'microsoft_graph_b'] })
    );

    const first = stubMissingSchemas(clientPath);
    const second = stubMissingSchemas(clientPath);

    expect(first.stubbed).toEqual(['microsoft_graph_a', 'microsoft_graph_b']);
    expect(second.stubbed).toEqual([]);
  });

  it('only stubs `microsoft_graph_*` identifiers', () => {
    const clientPath = path.join(tmpDir, 'client.ts');
    const source =
      HEADER +
      '\nconst __consumer_0 = z.array(someUnrelatedThing);\n' +
      'const __consumer_1 = z.array(microsoft_graph_unknown);\n' +
      'const endpoints = makeApi([]);\n';
    fs.writeFileSync(clientPath, source);

    const result = stubMissingSchemas(clientPath);

    expect(result.stubbed).toEqual(['microsoft_graph_unknown']);
    const patched = fs.readFileSync(clientPath, 'utf-8');
    expect(patched).not.toContain('const someUnrelatedThing');
  });

  it('emits nothing (no header/body) when no identifiers are missing', () => {
    const clientPath = path.join(tmpDir, 'client.ts');
    fs.writeFileSync(
      clientPath,
      makeClientWith({
        consts: ['microsoft_graph_user'],
        refs: ['microsoft_graph_user'],
      })
    );

    const before = fs.readFileSync(clientPath, 'utf-8');
    const result = stubMissingSchemas(clientPath);
    const after = fs.readFileSync(clientPath, 'utf-8');

    expect(result.stubbed).toEqual([]);
    expect(after).toBe(before);
    expect(after).not.toContain('stub-missing-schemas:');
  });

  it('recognises forward-declared `let` declarations as defined', () => {
    const clientPath = path.join(tmpDir, 'client.ts');
    const source =
      HEADER +
      "\nlet microsoft_graph_cycle: z.ZodTypeAny;\n" +
      'microsoft_graph_cycle = z.lazy(() => z.object({}).passthrough());\n' +
      'const __consumer_0 = z.array(microsoft_graph_cycle);\n' +
      'const endpoints = makeApi([]);\n';
    fs.writeFileSync(clientPath, source);

    const result = stubMissingSchemas(clientPath);

    expect(result.stubbed).toEqual([]);
  });

  it('throws when the `import { z } from "zod"` anchor is missing', () => {
    const clientPath = path.join(tmpDir, 'client.ts');
    fs.writeFileSync(
      clientPath,
      "import { makeApi } from './hack.js';\n" +
        'const __consumer_0 = z.array(microsoft_graph_x);\n' +
        'const endpoints = makeApi([]);\n'
    );

    expect(() => stubMissingSchemas(clientPath)).toThrowError(
      /cannot locate `import \{ z \} from 'zod'` anchor/
    );
  });
});
