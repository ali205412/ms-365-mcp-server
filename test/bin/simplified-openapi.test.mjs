/**
 * Plan 05-01 Task 1 — full-surface simplified-openapi + download-openapi snapshot tests.
 *
 * Tests 1-3 assert the NEW `createAndSaveSimplifiedOpenAPIFullSurface` export:
 *   - passes through all paths (no endpoint-filter)
 *   - flattens recursive `$ref` cycles without throwing / infinite recursion
 *   - enforces a depth cap (default 3) to prevent OOM on deep schema trees
 *
 * Tests 4-5 assert the extended `downloadGraphOpenAPI` honors
 * `MS365_MCP_USE_SNAPSHOT=1`:
 *   - skips network when snapshot exists
 *   - falls back to existing snapshot on network failure instead of throwing
 *
 * Threat mitigations:
 *   - T-05-01 (spec download tampering / unavailability): snapshot-first path.
 *   - T-05-02 (codegen OOM from recursive $ref): depth cap + cycle handling.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import {
  createAndSaveSimplifiedOpenAPIFullSurface,
  createAndSaveSimplifiedOpenAPI,
} from '../../bin/modules/simplified-openapi.mjs';
import { downloadGraphOpenAPI } from '../../bin/modules/download-openapi.mjs';

const FIXTURE_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  'fixtures',
  'mini-graph-v1.yaml'
);

function makeTmpDir() {
  const dir = path.join(os.tmpdir(), `plan-05-01-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rmTmp(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Walk a schema tree and detect unresolved cycles (a schema that appears twice
 * on the same path without being behind a $ref). Returns true if cycle found.
 */
function hasCycle(node, ancestors = new Set()) {
  if (!node || typeof node !== 'object') return false;
  if (ancestors.has(node)) return true;
  const next = new Set(ancestors);
  next.add(node);
  if (Array.isArray(node)) {
    for (const item of node) {
      if (hasCycle(item, next)) return true;
    }
    return false;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === '$ref') continue; // $ref is a pointer, not a cycle
    if (hasCycle(value, next)) return true;
  }
  return false;
}

/**
 * Measure the deepest nesting of `properties` objects reachable from the
 * component schemas. Returns the max depth observed.
 */
function maxPropertyDepth(obj, current = 0) {
  if (!obj || typeof obj !== 'object') return current;
  if (Array.isArray(obj)) {
    let max = current;
    for (const item of obj) {
      max = Math.max(max, maxPropertyDepth(item, current));
    }
    return max;
  }
  let max = current;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const prop of Object.values(value)) {
        max = Math.max(max, maxPropertyDepth(prop, current + 1));
      }
    } else {
      max = Math.max(max, maxPropertyDepth(value, current));
    }
  }
  return max;
}

describe('plan 05-01 task 1 — createAndSaveSimplifiedOpenAPIFullSurface', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('Test 1: retains all fixture paths (no endpoint-filter applied)', () => {
    const outPath = path.join(tmpDir, 'trimmed.yaml');
    const input = yaml.load(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const inputPathCount = Object.keys(input.paths).length;

    createAndSaveSimplifiedOpenAPIFullSurface(FIXTURE_PATH, outPath);

    expect(fs.existsSync(outPath)).toBe(true);
    const output = yaml.load(fs.readFileSync(outPath, 'utf8'));
    const outputPathCount = Object.keys(output.paths).length;
    expect(outputPathCount).toBe(inputPathCount);
    expect(outputPathCount).toBeGreaterThanOrEqual(10);
  });

  it('Test 2: recursive $ref (directoryObject.members) flattens without throwing', () => {
    const outPath = path.join(tmpDir, 'trimmed.yaml');
    expect(() => createAndSaveSimplifiedOpenAPIFullSurface(FIXTURE_PATH, outPath)).not.toThrow();

    const output = yaml.load(fs.readFileSync(outPath, 'utf8'));
    // directoryObject survives (it is referenced from /directoryObjects/{…}).
    expect(output.components.schemas).toHaveProperty('directoryObject');
    // No cycle is reachable from `paths` when traversing without following $ref pointers.
    expect(hasCycle(output.paths)).toBe(false);
  });

  it('Test 3 (T-05-02): depth cap default 3 truncates schemas beyond depth 3', () => {
    const outPath = path.join(tmpDir, 'trimmed.yaml');
    createAndSaveSimplifiedOpenAPIFullSurface(FIXTURE_PATH, outPath);

    const output = yaml.load(fs.readFileSync(outPath, 'utf8'));
    // The fixture's `directoryObject.deeplyNested.level2.level3.level4.level5`
    // is 5 levels deep; depth cap must truncate beyond 3.
    const deepestReachable = maxPropertyDepth(output.components.schemas, 0);
    expect(deepestReachable).toBeLessThanOrEqual(4); // 3 nested properties + the outer schema
  });

  it('Test 3b (T-05-02): custom maxDepth option honored', () => {
    const outPath = path.join(tmpDir, 'trimmed.yaml');
    createAndSaveSimplifiedOpenAPIFullSurface(FIXTURE_PATH, outPath, { maxDepth: 2 });
    const output = yaml.load(fs.readFileSync(outPath, 'utf8'));
    const deepestReachable = maxPropertyDepth(output.components.schemas, 0);
    expect(deepestReachable).toBeLessThanOrEqual(3);
  });

  it('does NOT regress the legacy createAndSaveSimplifiedOpenAPI export', () => {
    expect(typeof createAndSaveSimplifiedOpenAPI).toBe('function');
  });
});

describe('plan 05-01 task 1 — downloadGraphOpenAPI + MS365_MCP_USE_SNAPSHOT', () => {
  let tmpDir;
  let targetFile;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    targetFile = path.join(tmpDir, 'openapi.yaml');
  });

  afterEach(() => {
    rmTmp(tmpDir);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('Test 4 (T-05-01): MS365_MCP_USE_SNAPSHOT=1 + file exists -> returns false, no network', async () => {
    fs.writeFileSync(
      targetFile,
      'openapi: "3.0.0"\ninfo: {title: snap, version: "1.0"}\npaths: {}\n'
    );
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await downloadGraphOpenAPI(tmpDir, targetFile, undefined, false);

    expect(result).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    // Target file should still exist and be untouched.
    expect(fs.existsSync(targetFile)).toBe(true);
  });

  it('Test 5 (T-05-01): MS365_MCP_USE_SNAPSHOT=1 + network fails + file exists -> returns false (no throw)', async () => {
    fs.writeFileSync(
      targetFile,
      'openapi: "3.0.0"\ninfo: {title: snap, version: "1.0"}\npaths: {}\n'
    );
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '1');
    const fetchSpy = vi.fn().mockRejectedValue(new Error('ENETUNREACH'));
    vi.stubGlobal('fetch', fetchSpy);

    // forceDownload=true forces attempted fetch; snapshot flag makes it fall back.
    const result = await downloadGraphOpenAPI(tmpDir, targetFile, undefined, true);

    expect(result).toBe(false);
    expect(fs.existsSync(targetFile)).toBe(true);
  });

  it('baseline: MS365_MCP_USE_SNAPSHOT unset + file missing + network ok -> downloads (true)', async () => {
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '0');
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => 'openapi: "3.0.0"\n',
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await downloadGraphOpenAPI(tmpDir, targetFile, undefined, false);

    expect(result).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fs.existsSync(targetFile)).toBe(true);
  });

  it('baseline: MS365_MCP_USE_SNAPSHOT unset + network fails + file missing -> throws', async () => {
    vi.stubEnv('MS365_MCP_USE_SNAPSHOT', '0');
    const fetchSpy = vi.fn().mockRejectedValue(new Error('ENETUNREACH'));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(downloadGraphOpenAPI(tmpDir, targetFile, undefined, false)).rejects.toThrow();
  });
});
