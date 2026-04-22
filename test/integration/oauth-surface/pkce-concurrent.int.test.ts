/**
 * Two-flow concurrent PKCE integration test (plan 06-05, ROADMAP SC#4).
 *
 * Verifies that two concurrent /authorize + /token flows for different
 * tenants do NOT cross-contaminate via the Redis PKCE store (03-03).
 *
 * Per 06-RESEARCH.md §Validation Architecture §6:
 *   - Each flow uses a freshly-generated PKCE pair (newPkce() — Pitfall 5
 *     guards against cross-test challenge collisions).
 *   - /authorize of flow A runs first; /authorize of flow B runs before
 *     A's /token — interleaving proves the store discriminates correctly
 *     by (tenantId, clientCodeChallenge).
 *   - Cross-verifier attempts (tenant A's code presented to tenant B's
 *     /token) must fail.
 *
 * Design choice: rather than wiring the full `createAuthorizeHandler` +
 * `createTenantTokenHandler` + MSAL stub surface (which adds Entra round-
 * trip mocking and tenant-row seeding work that belongs to plan 06-06 multi-
 * tenant integration tests), this file mounts a simplified /authorize +
 * /token simulator that exercises the SAME `RedisPkceStore.put` /
 * `takeByChallenge` pair the real handlers use. SC#4's "two concurrent
 * PKCE flows ... no cross-contamination" clause is a PKCE-store property,
 * not an end-to-end OAuth property; this test proves it at the store
 * layer while staying independent of Entra test fixtures.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import { newPkce } from '../../setup/pkce-fixture.js';

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

describe('plan 06-05 — two concurrent PKCE flows (ROADMAP SC#4)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    const { MemoryRedisFacade } = await import('../../../src/lib/redis-facade.js');
    const { RedisPkceStore } = await import('../../../src/lib/pkce-store/redis-store.js');
    const redis = new MemoryRedisFacade();
    const pkceStore = new RedisPkceStore(
      redis as unknown as import('../../../src/lib/redis.js').RedisClient
    );

    const app = express();
    app.use(express.json());

    // Simplified /authorize — stores the client challenge against the tenant,
    // returns a 302 whose `code` query param is the challenge itself (so the
    // /token simulator can look it up without Microsoft-side plumbing).
    app.get('/t/:tenantId/authorize', async (req, res) => {
      const codeChallenge = String(req.query.code_challenge ?? '');
      const redirectUri = String(req.query.redirect_uri ?? '');
      const state = String(req.query.state ?? '');
      if (!codeChallenge || !redirectUri) {
        res.status(400).json({ error: 'invalid_request' });
        return;
      }
      await pkceStore.put(req.params.tenantId, {
        state,
        clientCodeChallenge: codeChallenge,
        clientCodeChallengeMethod: 'S256',
        serverCodeVerifier: 'server-verifier-stub',
        clientId: 'test-client',
        redirectUri,
        tenantId: req.params.tenantId,
        createdAt: Date.now(),
      });
      res
        .status(302)
        .set('Location', `${redirectUri}?code=${encodeURIComponent(codeChallenge)}&state=${state}`)
        .end();
    });

    // Simplified /token — hashes the submitted verifier, looks up by challenge,
    // validates redirect_uri match, returns a stub token on success.
    app.post('/t/:tenantId/token', async (req, res) => {
      const body = req.body as Record<string, unknown>;
      const code = String(body?.code ?? '');
      const clientVerifier = String(body?.code_verifier ?? '');
      const redirectUri = String(body?.redirect_uri ?? '');
      if (!code || !clientVerifier) {
        res.status(400).json({ error: 'invalid_request' });
        return;
      }
      const computed = crypto.createHash('sha256').update(clientVerifier).digest('base64url');

      const entry = await pkceStore.takeByChallenge(req.params.tenantId, code);
      if (!entry) {
        res.status(400).json({ error: 'invalid_grant', reason: 'pkce_not_found' });
        return;
      }
      if (computed !== entry.clientCodeChallenge) {
        res.status(400).json({ error: 'invalid_grant', reason: 'pkce_verifier_mismatch' });
        return;
      }
      if (entry.redirectUri !== redirectUri) {
        res.status(400).json({ error: 'invalid_grant', reason: 'redirect_uri_mismatch' });
        return;
      }
      res.status(200).json({
        access_token: 'fake-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    });

    server = await new Promise<http.Server>((resolve) => {
      const s = http.createServer(app).listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    vi.restoreAllMocks();
  });

  it('two concurrent PKCE flows do not cross-contaminate', async () => {
    const pkceA = newPkce();
    const pkceB = newPkce();

    // A starts /authorize
    const respA1 = await fetch(
      `${baseUrl}/t/tenant-a/authorize?code_challenge=${encodeURIComponent(pkceA.challenge)}&redirect_uri=${encodeURIComponent('http://localhost/cbA')}&state=stateA`,
      { redirect: 'manual' }
    );
    expect(respA1.status).toBe(302);

    // B starts /authorize (interleaved)
    const respB1 = await fetch(
      `${baseUrl}/t/tenant-b/authorize?code_challenge=${encodeURIComponent(pkceB.challenge)}&redirect_uri=${encodeURIComponent('http://localhost/cbB')}&state=stateB`,
      { redirect: 'manual' }
    );
    expect(respB1.status).toBe(302);

    // Cross-contamination probe: submit A's code to tenant-B's /token →
    // takeByChallenge returns null because the key includes tenant-B's id.
    const crossResp = await fetch(`${baseUrl}/t/tenant-b/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pkceA.challenge,
        code_verifier: pkceA.verifier,
        redirect_uri: 'http://localhost/cbA',
      }),
    });
    expect(crossResp.status).toBe(400);
    const crossBody = (await crossResp.json()) as { reason: string };
    expect(crossBody.reason).toBe('pkce_not_found');

    // Correct flows (matching tenants) succeed in parallel.
    const [tokA, tokB] = await Promise.all([
      fetch(`${baseUrl}/t/tenant-a/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: pkceA.challenge,
          code_verifier: pkceA.verifier,
          redirect_uri: 'http://localhost/cbA',
        }),
      }),
      fetch(`${baseUrl}/t/tenant-b/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: pkceB.challenge,
          code_verifier: pkceB.verifier,
          redirect_uri: 'http://localhost/cbB',
        }),
      }),
    ]);
    expect(tokA.status).toBe(200);
    expect(tokB.status).toBe(200);
  });

  it('wrong code_verifier against own tenant → 400', async () => {
    const pkceOwn = newPkce();
    const pkceOther = newPkce();
    await fetch(
      `${baseUrl}/t/tenant-a/authorize?code_challenge=${encodeURIComponent(pkceOwn.challenge)}&redirect_uri=${encodeURIComponent('http://localhost/cb')}&state=s`,
      { redirect: 'manual' }
    );
    const res = await fetch(`${baseUrl}/t/tenant-a/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pkceOwn.challenge,
        code_verifier: pkceOther.verifier, // wrong verifier
        redirect_uri: 'http://localhost/cb',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('pkce_verifier_mismatch');
  });

  it('wrong redirect_uri at /token → 400', async () => {
    const pkce = newPkce();
    await fetch(
      `${baseUrl}/t/tenant-a/authorize?code_challenge=${encodeURIComponent(pkce.challenge)}&redirect_uri=${encodeURIComponent('http://localhost/cb1')}&state=s`,
      { redirect: 'manual' }
    );
    const res = await fetch(`${baseUrl}/t/tenant-a/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pkce.challenge,
        code_verifier: pkce.verifier,
        redirect_uri: 'http://localhost/cb2', // different from the one at /authorize
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('redirect_uri_mismatch');
  });

  it('second /token with the same challenge → 400 (GETDEL atomicity, T-03-03-01)', async () => {
    const pkce = newPkce();
    await fetch(
      `${baseUrl}/t/tenant-a/authorize?code_challenge=${encodeURIComponent(pkce.challenge)}&redirect_uri=${encodeURIComponent('http://localhost/cb')}&state=s`,
      { redirect: 'manual' }
    );
    const first = await fetch(`${baseUrl}/t/tenant-a/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pkce.challenge,
        code_verifier: pkce.verifier,
        redirect_uri: 'http://localhost/cb',
      }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/t/tenant-a/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: pkce.challenge,
        code_verifier: pkce.verifier,
        redirect_uri: 'http://localhost/cb',
      }),
    });
    expect(second.status).toBe(400);
    const body = (await second.json()) as { reason: string };
    expect(body.reason).toBe('pkce_not_found');
  });
});
