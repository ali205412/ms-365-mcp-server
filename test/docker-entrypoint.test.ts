import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const ENTRYPOINT = path.join(ROOT, 'docker-entrypoint.sh');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeHarness(): { dir: string; log: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms365-entrypoint-'));
  tempDirs.push(dir);

  fs.copyFileSync(ENTRYPOINT, path.join(dir, 'docker-entrypoint.sh'));
  fs.chmodSync(path.join(dir, 'docker-entrypoint.sh'), 0o755);

  const fakeNode = path.join(dir, 'node');
  fs.writeFileSync(
    fakeNode,
    ['#!/bin/sh', 'printf "node %s\\n" "$*" >> "$NODE_INVOCATIONS"', 'exit 0', ''].join('\n')
  );
  fs.chmodSync(fakeNode, 0o755);

  return { dir, log: path.join(dir, 'node.log') };
}

function runEntrypoint(
  args: string[],
  env: Record<string, string> = {}
): { code: number | null; invocations: string[]; stdout: string; stderr: string } {
  const harness = makeHarness();
  const result = spawnSync('/bin/sh', ['./docker-entrypoint.sh', ...args], {
    cwd: harness.dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${harness.dir}:${process.env.PATH ?? ''}`,
      NODE_INVOCATIONS: harness.log,
      ...env,
    },
  });

  const invocations = fs.existsSync(harness.log)
    ? fs
        .readFileSync(harness.log, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

  return {
    code: result.status,
    invocations,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('docker-entrypoint.sh', () => {
  it('passes help/version commands directly to the CLI without requiring migrations', () => {
    const result = runEntrypoint(['--help']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('[entrypoint] Applying migrations');
    expect(result.invocations).toEqual(['node dist/index.js --help']);
  });

  it('prepends the server command for normal option-style container args', () => {
    const result = runEntrypoint(['--http', '127.0.0.1:3000']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[entrypoint] Applying migrations');
    expect(result.invocations).toEqual([
      'node bin/migrate.mjs up',
      'node dist/index.js --http 127.0.0.1:3000',
    ]);
  });

  it('preserves the migration opt-out switch', () => {
    const result = runEntrypoint(['node', 'dist/index.js'], {
      MS365_MCP_MIGRATE_ON_STARTUP: '0',
    });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('[entrypoint] Applying migrations');
    expect(result.invocations).toEqual(['node dist/index.js']);
  });
});
