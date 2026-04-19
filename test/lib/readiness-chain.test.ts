/**
 * Plan 03-10 Task 2 — /readyz chain test.
 *
 * Phase 3 /readyz composes three readiness checks:
 *   1. postgres.readinessCheck — Postgres reachable (03-01)
 *   2. redis.readinessCheck    — Redis reachable (03-02)
 *   3. tenantsLoadedCheck(pool) — at least one non-disabled tenant (03-10)
 *
 * /readyz returns 200 ONLY when all three pass. If any one fails, returns 503.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

vi.mock('../../src/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', 'migrations');

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
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
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

async function mountReadyz(
  checks: Array<() => boolean | Promise<boolean>>
): Promise<{ server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  const { mountHealth } = await import('../../src/lib/health.js');
  const app = express();
  mountHealth(app, checks);
  return await new Promise((resolve) => {
    const s = http.createServer(app).listen(0, () => {
      const { port } = s.address() as AddressInfo;
      resolve({
        server: s,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => s.close(() => r())),
      });
    });
  });
}

describe('/readyz chain (plan 03-10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tenantsLoadedCheck returns true when at least one non-disabled tenant exists', async () => {
    const { tenantsLoadedCheck } = await import('../../src/lib/health.js');
    const pool = await makePool();
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id) VALUES ($1, 'delegated', 'cid', 'tid')`,
      ['11111111-1111-4111-8111-111111111111']
    );
    const check = tenantsLoadedCheck(pool);
    expect(await check()).toBe(true);
  });

  it('tenantsLoadedCheck returns false when NO tenants exist', async () => {
    const { tenantsLoadedCheck } = await import('../../src/lib/health.js');
    const pool = await makePool();
    const check = tenantsLoadedCheck(pool);
    expect(await check()).toBe(false);
  });

  it('tenantsLoadedCheck ignores disabled tenants', async () => {
    const { tenantsLoadedCheck } = await import('../../src/lib/health.js');
    const pool = await makePool();
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id, disabled_at)
         VALUES ($1, 'delegated', 'cid', 'tid', NOW())`,
      ['22222222-2222-4222-8222-222222222222']
    );
    const check = tenantsLoadedCheck(pool);
    expect(await check()).toBe(false);
  });

  it('tenantsLoadedCheck returns false when pool.query throws', async () => {
    const { tenantsLoadedCheck } = await import('../../src/lib/health.js');
    const errorPool = {
      query: vi.fn().mockRejectedValue(new Error('conn refused')),
    } as unknown as Pool;
    const check = tenantsLoadedCheck(errorPool);
    expect(await check()).toBe(false);
  });

  it('/readyz returns 200 when all three checks pass', async () => {
    const pgOk = vi.fn(async () => true);
    const redisOk = vi.fn(async () => true);
    const tenantsOk = vi.fn(async () => true);

    const { server, baseUrl, close } = await mountReadyz([pgOk, redisOk, tenantsOk]);
    try {
      const res = await fetch(`${baseUrl}/readyz`);
      expect(res.status).toBe(200);
      expect(pgOk).toHaveBeenCalled();
      expect(redisOk).toHaveBeenCalled();
      expect(tenantsOk).toHaveBeenCalled();
    } finally {
      await close();
      void server;
    }
  });

  it('/readyz returns 503 when Postgres check fails', async () => {
    const pgFail = vi.fn(async () => false);
    const redisOk = vi.fn(async () => true);
    const tenantsOk = vi.fn(async () => true);

    const { baseUrl, close } = await mountReadyz([pgFail, redisOk, tenantsOk]);
    try {
      const res = await fetch(`${baseUrl}/readyz`);
      expect(res.status).toBe(503);
    } finally {
      await close();
    }
  });

  it('/readyz returns 503 when Redis check fails', async () => {
    const pgOk = vi.fn(async () => true);
    const redisFail = vi.fn(async () => false);
    const tenantsOk = vi.fn(async () => true);

    const { baseUrl, close } = await mountReadyz([pgOk, redisFail, tenantsOk]);
    try {
      const res = await fetch(`${baseUrl}/readyz`);
      expect(res.status).toBe(503);
    } finally {
      await close();
    }
  });

  it('/readyz returns 503 when NO tenants are loaded', async () => {
    const pgOk = vi.fn(async () => true);
    const redisOk = vi.fn(async () => true);
    const tenantsFail = vi.fn(async () => false);

    const { baseUrl, close } = await mountReadyz([pgOk, redisOk, tenantsFail]);
    try {
      const res = await fetch(`${baseUrl}/readyz`);
      expect(res.status).toBe(503);
    } finally {
      await close();
    }
  });

  it('/readyz composes tenantsLoadedCheck with a real (pg-mem) pool', async () => {
    const pool = await makePool();
    // no tenants inserted — expect 503
    const { tenantsLoadedCheck } = await import('../../src/lib/health.js');
    const check = tenantsLoadedCheck(pool);

    const { baseUrl, close } = await mountReadyz([check]);
    try {
      const res503 = await fetch(`${baseUrl}/readyz`);
      expect(res503.status).toBe(503);
    } finally {
      await close();
    }

    // After inserting a tenant, the next /readyz composition should pass.
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id) VALUES ($1, 'delegated', 'cid', 'tid')`,
      ['33333333-3333-4333-8333-333333333333']
    );
    const check2 = tenantsLoadedCheck(pool);
    const { baseUrl: base2, close: close2 } = await mountReadyz([check2]);
    try {
      const res200 = await fetch(`${base2}/readyz`);
      expect(res200.status).toBe(200);
    } finally {
      await close2();
    }
  });
});
