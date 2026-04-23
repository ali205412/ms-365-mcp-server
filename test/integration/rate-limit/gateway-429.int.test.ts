/**
 * Plan 06-04 Task 3 — Gateway 429 roundtrip integration test (OPS-08).
 *
 * Exercises the rate-limit middleware in-chain with the new migration applied
 * via pg-mem. Seeds two tenants with different budgets and asserts:
 *   - 5 requests under budget = 200
 *   - 6th request = 429 + Retry-After
 *   - tenant with NULL rate_limits inherits platform defaults (admits far more)
 *   - per-tenant isolation — A exhausted, B fresh
 *
 * Harness: pg-mem seeds tenants directly (skipping the full admin server
 * bootstrap); ioredis-mock backs the sliding-window. No Docker required.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Redis from 'ioredis-mock';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../src/logger.js', () => ({
  default: loggerMock,
  rawPinoLogger: loggerMock,
  enableConsoleLogging: vi.fn(),
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'migrations');

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
    const up = (sql.split(/^--\s*Down Migration\s*$/m)[0] ?? '')
      .replace(/^--\s*Up Migration\s*$/m, '')
      .split('\n')
      .filter((line) => !/\bextension\b.*\bpgcrypto\b/i.test(line))
      .join('\n');
    await pool.query(up);
  }
  return pool;
}

describe('plan 06-04 Task 3 — gateway 429 roundtrip (OPS-08)', () => {
  let redis: import('ioredis').Redis;
  let pool: Pool;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    redis = new (Redis as unknown as new () => import('ioredis').Redis)();
    pool = await makePool();

    const { registerSlidingWindow, __resetRegisteredForTesting } =
      await import('../../../src/lib/rate-limit/sliding-window.js');
    __resetRegisteredForTesting();
    registerSlidingWindow(redis);

    const { createRateLimitMiddleware } = await import('../../../src/lib/rate-limit/middleware.js');

    // Seed two tenants with different budgets. Use minimal schema columns —
    // pg-mem accepts any columns the migration defined; we only need id +
    // rate_limits for this test (other required cols have defaults).
    const TENANT_A = '11111111-1111-4111-8111-111111111111';
    const TENANT_B = '22222222-2222-4222-8222-222222222222';
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id, rate_limits)
       VALUES ($1, 'delegated', 'cid-a', '11111111-1111-4111-8111-aaaaaaaaaaaa',
               '{"request_per_min": 5, "graph_points_per_min": 10000}'::jsonb)`,
      [TENANT_A]
    );
    await pool.query(
      `INSERT INTO tenants (id, mode, client_id, tenant_id, rate_limits)
       VALUES ($1, 'delegated', 'cid-b', '22222222-2222-4222-8222-bbbbbbbbbbbb', NULL)`,
      [TENANT_B]
    );

    const app = express();
    // Simulate loadTenant — read the row directly and attach to req.tenant.
    app.use('/t/:tenantId/mcp', async (req, _res, next) => {
      const tid = req.params.tenantId;
      const { rows } = await pool.query('SELECT id, rate_limits FROM tenants WHERE id = $1', [tid]);
      if (rows.length === 0) {
        next();
        return;
      }
      (req as unknown as { tenant?: unknown }).tenant = rows[0];
      next();
    });
    app.use(createRateLimitMiddleware({ redis }));
    app.get('/t/:tenantId/mcp', (_req, res) => {
      res.status(200).send('ok');
    });

    server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(app).listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    try {
      await redis.quit();
    } catch {
      // already quit
    }
    await pool.end();
    vi.restoreAllMocks();
  });

  it('tenant A: 5 requests under budget = 200; 6th = 429 + Retry-After', async () => {
    const idA = '11111111-1111-4111-8111-111111111111';
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${baseUrl}/t/${idA}/mcp`);
      expect(res.status).toBe(200);
    }
    const denied = await fetch(`${baseUrl}/t/${idA}/mcp`);
    expect(denied.status).toBe(429);
    const ra = denied.headers.get('retry-after');
    expect(ra).toBeTruthy();
    expect(Number.parseInt(ra!, 10)).toBeGreaterThan(0);
  });

  it('tenant B (rate_limits: NULL) uses platform defaults — admits far more than tenant A', async () => {
    const idB = '22222222-2222-4222-8222-222222222222';
    // Tenant B inherits MS365_MCP_DEFAULT_REQ_PER_MIN=1000 default — well above tenant A's 5.
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/t/${idB}/mcp`);
      expect(res.status).toBe(200);
    }
  });

  it('per-tenant isolation: A exhausted, B fresh', async () => {
    const idA = '11111111-1111-4111-8111-111111111111';
    const idB = '22222222-2222-4222-8222-222222222222';
    for (let i = 0; i < 6; i++) {
      await fetch(`${baseUrl}/t/${idA}/mcp`);
    }
    const aDenied = await fetch(`${baseUrl}/t/${idA}/mcp`);
    expect(aDenied.status).toBe(429);
    const bOk = await fetch(`${baseUrl}/t/${idB}/mcp`);
    expect(bOk.status).toBe(200);
  });
});
