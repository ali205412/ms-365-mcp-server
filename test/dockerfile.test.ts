import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const DOCKERFILE = path.join(ROOT, 'Dockerfile');
const CHECK_HEALTH = path.join(ROOT, 'bin', 'check-health.cjs');
const DOCKERIGNORE = path.join(ROOT, '.dockerignore');
const ROOT_COMPOSE = path.join(ROOT, 'docker-compose.yml');

function readDockerfile(): string {
  return fs.readFileSync(DOCKERFILE, 'utf8');
}

describe('Dockerfile hardening — SECUR-06 static assertions', () => {
  it('Test 1: Dockerfile contains USER nodejs directive', () => {
    const content = readDockerfile();
    expect(content).toContain('USER nodejs');
  });

  it('Test 2: Dockerfile contains HEALTHCHECK directive invoking bin/check-health.cjs', () => {
    const content = readDockerfile();
    expect(content).toContain('HEALTHCHECK');
    // HEALTHCHECK CMD line must reference bin/check-health.cjs
    const hasHealthcheckProbe = /HEALTHCHECK[\s\S]*?bin\/check-health\.cjs/m.test(content);
    expect(hasHealthcheckProbe).toBe(true);
  });

  it('Test 3: Dockerfile ENTRYPOINT contains /sbin/tini', () => {
    const content = readDockerfile();
    const entrypointLine = content.split('\n').find((line) => line.trim().startsWith('ENTRYPOINT'));
    expect(entrypointLine).toBeDefined();
    expect(entrypointLine).toContain('/sbin/tini');
    expect(entrypointLine).toContain('/app/docker-entrypoint.sh');
    expect(content).toContain('CMD ["node", "dist/index.js"]');
  });

  it('Test 4: Dockerfile creates nodejs user with UID 1001 and group 1001', () => {
    const content = readDockerfile();
    expect(content).toContain('addgroup -S -g 1001 nodejs');
    expect(content).toContain('adduser -S -u 1001 -G nodejs nodejs');
  });

  it('Test 5: Dockerfile contains at least three OCI image labels', () => {
    const content = readDockerfile();
    expect(content).toContain('org.opencontainers.image.title');
    expect(content).toContain('org.opencontainers.image.source');
    expect(content).toContain('org.opencontainers.image.licenses');
  });

  it('Test 6: Dockerfile contains STOPSIGNAL SIGTERM', () => {
    const content = readDockerfile();
    expect(content).toContain('STOPSIGNAL SIGTERM');
  });

  it('Test 7: Both builder and release stages use the same Node base image tag', () => {
    const content = readDockerfile();
    const fromRegex = /FROM\s+node:(\S+)\s+AS\s+(builder|release)/g;
    const matches: { tag: string; stage: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = fromRegex.exec(content)) !== null) {
      matches.push({ tag: match[1], stage: match[2] });
    }
    expect(matches.length).toBeGreaterThanOrEqual(2);
    const tags = matches.map((m) => m.tag);
    const allSame = tags.every((t) => t === tags[0]);
    expect(allSame).toBe(true);
  });

  it('Test 8: bin/check-health.cjs exists and is executable (POSIX only)', () => {
    if (process.platform === 'win32') return;
    expect(fs.existsSync(CHECK_HEALTH)).toBe(true);
    // Will throw if not executable
    expect(() => fs.accessSync(CHECK_HEALTH, fs.constants.X_OK)).not.toThrow();
  });

  it('Test 8b: image copies migration entrypoint assets', () => {
    const content = readDockerfile();
    expect(content).toContain('/app/docker-entrypoint.sh');
    expect(content).toContain('/app/bin/migrate.mjs');
    expect(content).toContain('/app/migrations');
  });

  it('Test 9: .dockerignore exists and excludes key directories/files', () => {
    expect(fs.existsSync(DOCKERIGNORE)).toBe(true);
    const content = fs.readFileSync(DOCKERIGNORE, 'utf8');
    const lines = content.split('\n').map((l) => l.trim());
    const required = ['.git', 'node_modules', 'dist', 'test', '.planning', 'coverage'];
    for (const entry of required) {
      expect(lines).toContain(entry);
    }
  });

  it('Test 10: root Compose requires public URL and CORS origins', () => {
    const content = fs.readFileSync(ROOT_COMPOSE, 'utf8');
    expect(content).toContain('${MS365_MCP_PUBLIC_URL:?');
    expect(content).toContain('${MS365_MCP_CORS_ORIGINS:?');
    expect(content).not.toContain('MS365_MCP_PUBLIC_URL:-http://localhost');
    expect(content).not.toContain('MS365_MCP_CORS_ORIGINS:-http://localhost');
  });
});
