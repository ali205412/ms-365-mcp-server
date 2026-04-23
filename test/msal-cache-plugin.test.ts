/**
 * Plan 03-05 Task 1 — src/lib/msal-cache-plugin.ts unit tests.
 *
 * Covers:
 *   1. Cross-tenant key distinctness (TENANT-04 + Pitfall 2)
 *   2. Cross-user key distinctness within one tenant
 *   3. Round-trip: after-write with cacheHasChanged=true stores encrypted
 *      envelope; subsequent before-read decrypts and deserializes the same
 *      plaintext payload.
 *   4. after-write with cacheHasChanged=false is a no-op
 *   5. Decrypt failure on corrupt envelope: logger.warn called + redis.del(key)
 *      + ctx.tokenCache.deserialize NOT called.
 *   6. Missing key on beforeCacheAccess is a no-op (no deserialize call).
 *   7. Import-surface guard: plugin file only imports from @azure/msal-node,
 *      ioredis, ../logger.js, ./crypto/envelope.js, ./redis.js, ./redis-facade.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryRedisFacade } from '../src/lib/redis-facade.js';
import { createRedisCachePlugin } from '../src/lib/msal-cache-plugin.js';
import type { Envelope } from '../src/lib/crypto/envelope.js';

vi.mock('../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Re-import after mock so the plugin uses the mocked logger.
import logger from '../src/logger.js';

/**
 * Build a fake TokenCacheContext compatible with the MSAL ICachePlugin
 * interface. `serialize()` returns the last value set via `deserialize`,
 * otherwise a stable default string so afterCacheAccess writes predictable
 * ciphertext for round-trip assertions.
 */
function makeCtx(opts: { hasChanged: boolean; initialSerialized?: string }) {
  let stored = opts.initialSerialized ?? '{"AccessToken":{"x":"y"}}';
  const deserializeSpy = vi.fn((s: string) => {
    stored = s;
  });
  return {
    cacheHasChanged: opts.hasChanged,
    tokenCache: {
      serialize: () => stored,
      deserialize: deserializeSpy,
    },
    // expose the spy for assertions
    _deserializeSpy: deserializeSpy,
    _getStored: () => stored,
  } as unknown as {
    cacheHasChanged: boolean;
    tokenCache: { serialize(): string; deserialize(s: string): void };
    _deserializeSpy: ReturnType<typeof vi.fn>;
    _getStored(): string;
  };
}

describe('plan 03-05 Task 1 — msal-cache-plugin', () => {
  const dek = crypto.randomBytes(32);

  beforeEach(() => {
    vi.mocked(logger.info).mockClear?.();
    vi.mocked(logger.warn).mockClear?.();
    vi.mocked(logger.error).mockClear?.();
  });

  it('cross-tenant key distinctness (Pitfall 2, TENANT-04)', async () => {
    const redis = new MemoryRedisFacade();
    const pluginA = createRedisCachePlugin({
      redis,
      tenantId: 'T-A',
      clientId: 'c',
      userOid: 'user-1',
      scopeHash: 'abc123',
      dek,
    });
    const pluginB = createRedisCachePlugin({
      redis,
      tenantId: 'T-B',
      clientId: 'c',
      userOid: 'user-1',
      scopeHash: 'abc123',
      dek,
    });

    const ctxA = makeCtx({ hasChanged: true, initialSerialized: '{"tenantA":true}' });
    const ctxB = makeCtx({ hasChanged: true, initialSerialized: '{"tenantB":true}' });

    await pluginA.afterCacheAccess(ctxA as never);
    await pluginB.afterCacheAccess(ctxB as never);

    const keys = await redis.keys('mcp:cache:*');
    expect(keys.sort()).toEqual(['mcp:cache:T-A:c:user-1:abc123', 'mcp:cache:T-B:c:user-1:abc123']);
  });

  it('cross-user key distinctness within the same tenant', async () => {
    const redis = new MemoryRedisFacade();
    const pA = createRedisCachePlugin({
      redis,
      tenantId: 'T',
      clientId: 'c',
      userOid: 'userA',
      scopeHash: 'hash',
      dek,
    });
    const pB = createRedisCachePlugin({
      redis,
      tenantId: 'T',
      clientId: 'c',
      userOid: 'userB',
      scopeHash: 'hash',
      dek,
    });

    await pA.afterCacheAccess(makeCtx({ hasChanged: true }) as never);
    await pB.afterCacheAccess(makeCtx({ hasChanged: true }) as never);

    const keys = await redis.keys('mcp:cache:T:*');
    expect(keys.sort()).toEqual(['mcp:cache:T:c:userA:hash', 'mcp:cache:T:c:userB:hash']);
  });

  it('app-only userOid literal is used verbatim in the key', async () => {
    const redis = new MemoryRedisFacade();
    const plugin = createRedisCachePlugin({
      redis,
      tenantId: 'T',
      clientId: 'c',
      userOid: 'appOnly',
      scopeHash: 'hash',
      dek,
    });
    await plugin.afterCacheAccess(makeCtx({ hasChanged: true }) as never);
    const keys = await redis.keys('mcp:cache:T:*');
    expect(keys).toEqual(['mcp:cache:T:c:appOnly:hash']);
  });

  it('round-trip: after-write then before-read decrypts and calls deserialize with original plaintext', async () => {
    const redis = new MemoryRedisFacade();
    const plugin = createRedisCachePlugin({
      redis,
      tenantId: 'T1',
      clientId: 'c1',
      userOid: 'u1',
      scopeHash: 'sh1',
      dek,
    });

    const originalPlaintext = '{"AccessToken":{"a":"b"},"RefreshToken":{"c":"d"}}';
    const writeCtx = makeCtx({ hasChanged: true, initialSerialized: originalPlaintext });
    await plugin.afterCacheAccess(writeCtx as never);

    // Inspect the stored envelope shape — should be JSON-encoded Envelope.
    const stored = await redis.get('mcp:cache:T1:c1:u1:sh1');
    expect(stored).not.toBeNull();
    const env = JSON.parse(stored as string) as Envelope;
    expect(env.v).toBe(1);
    expect(typeof env.iv).toBe('string');
    expect(typeof env.tag).toBe('string');
    expect(typeof env.ct).toBe('string');

    // Read back via a fresh context — deserialize should receive identical plaintext.
    const readCtx = makeCtx({ hasChanged: false });
    await plugin.beforeCacheAccess(readCtx as never);
    expect(readCtx._deserializeSpy).toHaveBeenCalledWith(originalPlaintext);
  });

  it('afterCacheAccess with cacheHasChanged=false is a no-op', async () => {
    const redis = new MemoryRedisFacade();
    const plugin = createRedisCachePlugin({
      redis,
      tenantId: 'T',
      clientId: 'c',
      userOid: 'u',
      scopeHash: 'sh',
      dek,
    });
    const ctx = makeCtx({ hasChanged: false, initialSerialized: 'should-not-persist' });
    await plugin.afterCacheAccess(ctx as never);
    const stored = await redis.get('mcp:cache:T:c:u:sh');
    expect(stored).toBeNull();
  });

  it('beforeCacheAccess with no stored key is a no-op (no deserialize)', async () => {
    const redis = new MemoryRedisFacade();
    const plugin = createRedisCachePlugin({
      redis,
      tenantId: 'T',
      clientId: 'c',
      userOid: 'u',
      scopeHash: 'sh',
      dek,
    });
    const ctx = makeCtx({ hasChanged: false });
    await plugin.beforeCacheAccess(ctx as never);
    expect(ctx._deserializeSpy).not.toHaveBeenCalled();
  });

  it('decrypt failure drops the key + logs warn (tamper-resistance)', async () => {
    const redis = new MemoryRedisFacade();
    const plugin = createRedisCachePlugin({
      redis,
      tenantId: 'T',
      clientId: 'c',
      userOid: 'u',
      scopeHash: 'sh',
      dek,
    });

    // Seed a corrupt envelope — the JSON is valid but the ciphertext will fail
    // AES-GCM auth on decrypt.
    const corruptEnvelope: Envelope = {
      v: 1,
      iv: Buffer.alloc(12, 0).toString('base64'),
      tag: Buffer.alloc(16, 0).toString('base64'),
      ct: Buffer.alloc(32, 0).toString('base64'),
    };
    await redis.set('mcp:cache:T:c:u:sh', JSON.stringify(corruptEnvelope), 'EX', 3600);

    const ctx = makeCtx({ hasChanged: false });
    await expect(plugin.beforeCacheAccess(ctx as never)).resolves.toBeUndefined();

    // Key was deleted + deserialize NOT invoked.
    expect(await redis.get('mcp:cache:T:c:u:sh')).toBeNull();
    expect(ctx._deserializeSpy).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'T' }),
      expect.stringMatching(/decrypt/i)
    );
  });

  it('import-surface guard: no project-internal imports beyond logger + crypto/envelope', () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(
      path.resolve(__dirname, '..', 'src', 'lib', 'msal-cache-plugin.ts'),
      'utf8'
    );
    // Extract "from 'x'" bindings for each import line.
    const importLines = src.split('\n').filter((l) => /^import\s/.test(l.trim()));
    for (const line of importLines) {
      const m = /from\s+['"]([^'"]+)['"]/.exec(line);
      if (!m) continue;
      const spec = m[1];
      const allowed = new Set([
        '@azure/msal-node',
        'ioredis',
        '../logger.js',
        './crypto/envelope.js',
        './redis.js',
      ]);
      // External specifiers without leading ./ are acceptable library deps.
      if (!spec.startsWith('.')) {
        expect(
          allowed.has(spec) || spec === '@azure/msal-node' || spec === 'ioredis',
          `unexpected external import: ${spec}`
        ).toBe(true);
      } else {
        expect(allowed.has(spec), `unexpected relative import: ${spec}`).toBe(true);
      }
    }
  });
});
