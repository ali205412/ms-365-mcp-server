import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('npm package contents', () => {
  it('does not include local env, token cache, or planning files', () => {
    const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, npm_config_loglevel: 'silent' },
    });

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const pack = JSON.parse(result.stdout) as Array<{ files?: Array<{ path: string }> }>;
    const files = new Set((pack[0]?.files ?? []).map((file) => file.path));
    const forbidden = [...files].filter(
      (file) =>
        file === '.env' ||
        file.startsWith('.env.') ||
        file === '.token-cache.json' ||
        file === '.selected-account.json' ||
        file.startsWith('.planning/')
    );

    expect(forbidden).toEqual([]);
  });
});
