/**
 * Plan 03-01 Task 3 + 03-04 Task 2 — bin/create-tenant.mjs programmatic test.
 *
 * Uses pg-mem as the injected pool so the test never touches a real
 * Postgres. Mirrors the keytar-removal.test.ts pattern (test/keytar-removal
 * Test 12): import main() directly and invoke with argv + a `deps.pool`
 * override.
 *
 * Plan 03-04 extended bin/create-tenant to mint a per-tenant DEK and wrap
 * it with the KEK. Tests inject a fixed `kek` Buffer so they stay
 * deterministic and do not depend on MS365_MCP_KEK being set.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — .mjs import has no types; tests rely on runtime export shape.
import { main as createTenantMain } from '../../bin/create-tenant.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

const FIXED_KEK = Buffer.alloc(32, 0x5a);

function stripPgcryptoExtensionStmts(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !/\bextension\b.*\bpgcrypto\b/i.test(line))
    .join('\n');
}

async function makePool(): Promise<Pool> {
  const db = newDb();
  db.registerExtension('pgcrypto', () => {});
  const { Pool: PgMemPool } = db.adapters.createPg();
  const pool = new PgMemPool() as Pool;
  // Apply the tenants table plus the preset_version column used by create-tenant.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(
      (f) =>
        (f.startsWith('20260501000000') || f === '20260702000000_preset_version.sql') &&
        f.endsWith('.sql')
    )
    .sort();
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    const up = stripPgcryptoExtensionStmts(
      (sql.split(/^--\s*Down Migration\s*$/m)[0] ?? '').replace(/^--\s*Up Migration\s*$/m, '')
    );
    await pool.query(up);
  }
  return pool;
}

describe('plan 03-01 + 03-04 — bin/create-tenant.mjs', () => {
  let pool: Pool;
  let messages: string[];
  let deps: {
    pool: Pool;
    kek: Buffer;
    logger: { warn: (m: string) => void; info: (m: string) => void };
  };

  beforeEach(async () => {
    pool = await makePool();
    messages = [];
    deps = {
      pool,
      kek: FIXED_KEK,
      logger: {
        warn: (m: string) => messages.push(m),
        info: (m: string) => messages.push(m),
      },
    };
  });

  it('inserts a tenant row with wrapped_dek set (envelope JSONB) and returns its id', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const result = await createTenantMain(
      [
        `--id=${id}`,
        '--client-id=00000000-0000-0000-0000-000000000001',
        '--tenant-id=00000000-0000-0000-0000-000000000002',
        '--mode=delegated',
      ],
      deps
    );
    expect(result).toEqual({ id, wrappedDek: 'set' });

    const r = await pool.query<{
      id: string;
      mode: string;
      wrapped_dek: unknown;
      preset_version: string;
    }>(`SELECT id, mode, wrapped_dek, preset_version FROM tenants WHERE id = $1`, [id]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.mode).toBe('delegated');
    expect(r.rows[0]!.preset_version).toBe('discovery-v1');
    expect(r.rows[0]!.wrapped_dek).not.toBeNull();

    const envelope =
      typeof r.rows[0]!.wrapped_dek === 'string'
        ? JSON.parse(r.rows[0]!.wrapped_dek as string)
        : (r.rows[0]!.wrapped_dek as { v: number; iv: string; tag: string; ct: string });
    expect(envelope.v).toBe(1);
    expect(typeof envelope.iv).toBe('string');
    expect(typeof envelope.tag).toBe('string');
    expect(typeof envelope.ct).toBe('string');
    // 12-byte IV (base64 16 chars incl padding) + 16-byte tag (base64 24 chars).
    expect(Buffer.from(envelope.iv, 'base64').length).toBe(12);
    expect(Buffer.from(envelope.tag, 'base64').length).toBe(16);
  });

  it('logs an info message that wrapped_dek was set (plan 03-04)', async () => {
    await createTenantMain(
      [
        '--client-id=c',
        '--tenant-id=t',
        '--mode=delegated',
        '--id=22222222-2222-4222-8222-222222222222',
      ],
      deps
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]).toMatch(/wrapped_dek set/i);
    expect(messages[0]).toMatch(/03-04/);
  });

  it('rejects duplicate --id with tenant_already_exists', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    await createTenantMain(
      [`--id=${id}`, '--client-id=c', '--tenant-id=t', '--mode=delegated'],
      deps
    );
    await expect(
      createTenantMain([`--id=${id}`, '--client-id=c', '--tenant-id=t', '--mode=delegated'], deps)
    ).rejects.toThrow(/tenant_already_exists/);
  });

  it('rejects invalid --mode', async () => {
    await expect(
      createTenantMain(
        [
          '--id=44444444-4444-4444-8444-444444444444',
          '--client-id=c',
          '--tenant-id=t',
          '--mode=bogus',
        ],
        deps
      )
    ).rejects.toThrow(/invalid --mode/);
  });

  it('rejects missing required flags', async () => {
    await expect(createTenantMain(['--mode=delegated'], deps)).rejects.toThrow(/--client-id/);
    await expect(createTenantMain(['--client-id=c', '--mode=delegated'], deps)).rejects.toThrow(
      /--tenant-id/
    );
    await expect(createTenantMain(['--client-id=c', '--tenant-id=t'], deps)).rejects.toThrow(
      /--mode/
    );
  });

  it('accepts optional --slug and --cloud-type', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    await createTenantMain(
      [
        `--id=${id}`,
        '--client-id=c',
        '--tenant-id=t',
        '--mode=delegated',
        '--slug=example-corp',
        '--cloud-type=china',
      ],
      deps
    );
    const r = await pool.query<{ slug: string; cloud_type: string }>(
      `SELECT slug, cloud_type FROM tenants WHERE id = $1`,
      [id]
    );
    expect(r.rows[0]!.slug).toBe('example-corp');
    expect(r.rows[0]!.cloud_type).toBe('china');
  });

  it('defaults new CLI tenants to discovery-v1 and preserves explicit essentials-v1', async () => {
    const discoveryId = '77777777-7777-4777-8777-777777777777';
    await createTenantMain(
      [`--id=${discoveryId}`, '--client-id=c', '--tenant-id=t', '--mode=delegated'],
      deps
    );

    const staticId = '88888888-8888-4888-8888-888888888888';
    await createTenantMain(
      [
        `--id=${staticId}`,
        '--client-id=c',
        '--tenant-id=t',
        '--mode=delegated',
        '--preset-version=essentials-v1',
      ],
      deps
    );

    const { rows } = await pool.query<{ id: string; preset_version: string }>(
      `SELECT id, preset_version FROM tenants WHERE id IN ($1, $2) ORDER BY id`,
      [discoveryId, staticId]
    );
    expect(rows).toEqual([
      { id: discoveryId, preset_version: 'discovery-v1' },
      { id: staticId, preset_version: 'essentials-v1' },
    ]);
  });

  it('rejects invalid --preset-version values before insert', async () => {
    await expect(
      createTenantMain(
        [
          '--id=99999999-9999-4999-8999-999999999999',
          '--client-id=c',
          '--tenant-id=t',
          '--mode=delegated',
          '--preset-version=ESSENTIALS/V1!',
        ],
        deps
      )
    ).rejects.toThrow(/invalid --preset-version/);

    const { rows } = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM tenants'
    );
    expect(rows[0]!.count).toBe('0');
  });

  it('wrapped_dek contains no plaintext DEK bytes (SC#5 baseline)', async () => {
    // Use an injected generateTenantDek that captures the DEK so the test can
    // assert the persisted envelope does not leak its bytes.
    let capturedDek: Buffer | null = null;
    const captureDeps = {
      ...deps,
      generateTenantDek: (kek: Buffer) => {
        const dek = crypto.randomBytes(32);
        // Inline wrap using Node crypto (avoids importing envelope.ts into
        // the test — this path mirrors envelope.ts's encrypt exactly).
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
        const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
        const tag = cipher.getAuthTag();
        capturedDek = dek;
        return {
          dek,
          wrappedDek: {
            v: 1,
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            ct: ct.toString('base64'),
          },
        };
      },
    };

    const id = '66666666-6666-4666-8666-666666666666';
    await createTenantMain(
      [`--id=${id}`, '--client-id=c', '--tenant-id=t', '--mode=delegated'],
      captureDeps
    );

    const r = await pool.query<{ wrapped_dek: unknown }>(
      `SELECT wrapped_dek FROM tenants WHERE id = $1`,
      [id]
    );
    const stored =
      typeof r.rows[0]!.wrapped_dek === 'string'
        ? (r.rows[0]!.wrapped_dek as string)
        : JSON.stringify(r.rows[0]!.wrapped_dek);

    expect(capturedDek).not.toBeNull();
    const dek = capturedDek as unknown as Buffer;
    // Scan 4-byte windows: no slice of the plaintext DEK should appear in
    // either the base64 or the hex representation of the stored envelope.
    for (let i = 0; i <= dek.length - 4; i++) {
      const slice = dek.subarray(i, i + 4);
      expect(stored).not.toContain(slice.toString('base64').replace(/=/g, ''));
      expect(stored).not.toContain(slice.toString('hex'));
    }
  });
});
