/**
 * Bearer pass-through `tid` claim mismatch (plan 06-06, T-06-05, ROADMAP SC#4).
 *
 * Mitigation for T-06-05 (bearer pass-through tenant impersonation):
 * when the JWT's `tid` claim does not match the tenant row's Azure `tenant_id`, the
 * bearer middleware MUST reject with 401 and an audit entry with action
 * `auth.tid_mismatch` fires on the server side.
 *
 * This test drives the REAL `createBearerMiddleware` exported from
 * `src/lib/microsoft-auth.ts` (plan 03-06). The middleware returns 401 with
 * body `{ error: 'tenant_mismatch' }` on tid mismatch; we call that a
 * `tid_mismatch` (the action string used for the audit log entry emitted by
 * the orchestrator that mounts this middleware).
 *
 * Covered behaviours:
 *   1. bearer whose `tid` claim matches the URL `:tenantId` → calls next()
 *      (authorized; audit action would be `auth.bearer.success` downstream).
 *   2. bearer with mismatched `tid` → 401 tenant_mismatch + audit row
 *      `auth.tid_mismatch`.
 *   3. bearer with missing `tid` claim → 401 invalid_token (detail
 *      missing_tid_claim) + audit row `auth.tid_missing`.
 *   4. malformed JWT → 401 invalid_token, no audit (can't attribute to tenant).
 *   5. no Authorization header → middleware calls next() (pass-through to
 *      next auth strategy); the test mount returns 401 from a catch-all
 *      handler to prove the bearer middleware did not swallow the request.
 *
 * Runs under MS365_MCP_INTEGRATION=1 against Testcontainers Postgres from
 * the plan 06-05 globalSetup harness (audit log writes need real
 * Postgres so pg-mem's looser type inference doesn't mask schema drift).
 */
import { describe, it, expect, beforeEach, afterEach, vi, inject } from 'vitest';
import { Pool } from 'pg';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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

// Stable UUIDs — these double as the AAD `tid` the middleware matches on.
const TENANT_A = 'ccaaaaaa-cc00-4000-8000-0000aaaaaaaa';
const TENANT_B = 'ccbbbbbb-cc00-4000-8000-0000bbbbbbbb';

/**
 * Helper — craft a minimal JWT-shaped token (header.payload.signature) for
 * testing. This integration test injects a verifier that decodes the token so
 * it can exercise tenant mismatch behavior without remote Entra JWKS calls.
 */
function makeFakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' }), 'utf8').toString(
    'base64url'
  );
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signature = 'fake-signature';
  return `${header}.${payload}.${signature}`;
}

describe('plan 06-06 — bearer pass-through tid mismatch (T-06-05, SC#4)', () => {
  let pool: Pool;
  let server: http.Server | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    const pgUrl = inject('pgUrl' as never);
    if (!pgUrl) {
      throw new Error(
        'plan 06-06: pgUrl injection missing. Run with MS365_MCP_INTEGRATION=1 and ensure test/setup/integration-globalSetup.ts is configured.'
      );
    }

    pool = new Pool({ connectionString: pgUrl });

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      const up = (sql.split(/^--\s*Down Migration\s*$/m)[0] ?? '').replace(
        /^--\s*Up Migration\s*$/m,
        ''
      );
      try {
        await pool.query(up);
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (!/already exists|duplicate/i.test(msg)) throw err;
      }
    }

    const { seedTenant } = await import('../../fixtures/tenant-seed.js');
    await seedTenant(pool, {
      id: TENANT_A,
      mode: 'bearer',
      client_id: 'cid-a',
      tenant_id: TENANT_A,
    });
    await seedTenant(pool, {
      id: TENANT_B,
      mode: 'bearer',
      client_id: 'cid-b',
      tenant_id: TENANT_B,
    });

    // Mount the real createBearerMiddleware with an injected verifier. It
    // returns 401 on tid_mismatch
    // and missing tid claims; we wrap it with a post-middleware hook that
    // writes an audit row when the middleware short-circuited with 401.
    const { createBearerMiddleware } = await import('../../../src/lib/microsoft-auth.js');
    const { decodeJwt } = await import('jose');
    const bearer = createBearerMiddleware({
      verifyToken: async ({ token }) => decodeJwt(token),
    });

    const app = express();
    app.use(express.json());
    app.use(
      '/t/:tenantId/mcp',
      async (req, res, next) => {
        // Fast path: audit action chosen by inspecting the response after
        // the bearer middleware runs. We wrap res.json/res.status so we can
        // observe what the middleware decided BEFORE responding.
        const { tenantId } = req.params;
        const originalJson = res.json.bind(res);
        let captured: { status: number; body: unknown } | null = null;
        res.json = ((body: unknown) => {
          captured = { status: res.statusCode, body };
          return originalJson(body);
        }) as typeof res.json;

        await bearer(req, res, async (err?: unknown) => {
          if (err) return next(err);
          // bearer called next() — authorized or pass-through.
          if (!res.headersSent) return next();
        });

        // After the middleware returns, write the audit row if it 401'd.
        res.on('finish', () => {
          if (!captured) return;
          const { status, body } = captured;
          if (status !== 401) return;
          const err = (body as { error?: string; detail?: string })?.error;
          const detail = (body as { error?: string; detail?: string })?.detail;
          let action: string | null = null;
          if (err === 'tenant_mismatch') action = 'auth.tid_mismatch';
          else if (err === 'invalid_token' && detail === 'missing_tid_claim')
            action = 'auth.tid_missing';
          if (!action) return;
          // Best-effort audit write. Errors are suppressed because `finish`
          // runs after the HTTP response has been flushed; a failed audit
          // must not alter the client-visible response.
          pool
            .query(
              `INSERT INTO audit_log (id, tenant_id, actor, action, target, ip, request_id, result)
               VALUES ($1, $2, 'bearer-handler', $3, $4, '127.0.0.1', $5, 'failure')`,
              [
                `audit-bearer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                tenantId,
                action,
                tenantId,
                `req-bearer-${Date.now()}`,
              ]
            )
            .catch(() => {
              /* swallow — see comment above */
            });
        });
      },
      // Catch-all authorized handler: the bearer middleware calls next()
      // when the `tid` claim matches OR when no Authorization header is
      // present (pass-through). For this test we want 401 in the no-header
      // case because no next auth strategy is mounted.
      (req, res) => {
        if (!req.headers.authorization) {
          res.status(401).json({ error: 'no_auth_strategy_matched' });
          return;
        }
        res.status(200).send('ok');
      }
    );

    server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(app).listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
    try {
      await pool.query(`DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])`, [
        [TENANT_A, TENANT_B],
      ]);
      await pool.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]);
    } finally {
      await pool.end();
      vi.restoreAllMocks();
    }
  });

  it('bearer with correct tid for URL tenant → request passes (200)', async () => {
    const token = makeFakeJwt({ tid: TENANT_A, oid: 'user-1' });
    const res = await fetch(`${baseUrl}/t/${TENANT_A}/mcp`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('bearer for tenant A + URL for tenant B → 401 tenant_mismatch + audit tid_mismatch', async () => {
    const tokenForA = makeFakeJwt({ tid: TENANT_A, oid: 'user-1' });
    const res = await fetch(`${baseUrl}/t/${TENANT_B}/mcp`, {
      headers: { Authorization: `Bearer ${tokenForA}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('tenant_mismatch');

    // Give the fire-and-forget audit write a chance to land.
    await new Promise((r) => setTimeout(r, 100));

    // Audit row — action = auth.tid_mismatch.
    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND action = $2`,
      [TENANT_B, 'auth.tid_mismatch']
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('bearer with missing tid claim → 401 invalid_token + audit tid_missing', async () => {
    const tokenNoTid = makeFakeJwt({ oid: 'user-1' });
    const res = await fetch(`${baseUrl}/t/${TENANT_A}/mcp`, {
      headers: { Authorization: `Bearer ${tokenNoTid}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; detail?: string };
    expect(body.error).toBe('invalid_token');
    expect(body.detail).toBe('missing_tid_claim');

    await new Promise((r) => setTimeout(r, 100));

    const { rows } = await pool.query(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND action = $2`,
      [TENANT_A, 'auth.tid_missing']
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('malformed JWT → 401 invalid_token (no audit row — cannot attribute to tenant)', async () => {
    const res = await fetch(`${baseUrl}/t/${TENANT_A}/mcp`, {
      headers: { Authorization: `Bearer not.a.valid.jwt.at.all` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_token');
  });

  it('no Authorization header → 401 from pass-through catch-all (bearer middleware did not intercept)', async () => {
    const res = await fetch(`${baseUrl}/t/${TENANT_A}/mcp`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no_auth_strategy_matched');
  });

  it('case-insensitive tid comparison — JWT tid uppercase still matches URL (src/lib/microsoft-auth.ts:86)', async () => {
    // Per the middleware contract, tid comparison is case-insensitive.
    // This guards against accidental case-sensitivity regressions.
    const token = makeFakeJwt({ tid: TENANT_A.toUpperCase(), oid: 'user-1' });
    const res = await fetch(`${baseUrl}/t/${TENANT_A}/mcp`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
