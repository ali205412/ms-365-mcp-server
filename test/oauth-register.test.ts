/**
 * Pure-function matrix for validateRedirectUri (plan 01-06, AUTH-06).
 *
 * Enforces D-02 redirect_uri allowlist policy:
 *   - Always forbidden: javascript:, data:, file:, about:, vbscript:
 *   - Always permitted: http://{localhost,127.0.0.1,::1}:* (loopback)
 *   - Always permitted: https://<host> when host === publicUrlHost
 *   - Dev mode only:    any https://
 *   - Prod mode:        everything else is rejected
 *
 * These tests MUST FAIL on first run (RED phase) because
 * src/lib/redirect-uri.ts does not yet exist.
 */
import { describe, it, expect } from 'vitest';
import { validateRedirectUri } from '../src/lib/redirect-uri.js';

const policy_prod = { mode: 'prod' as const, publicUrlHost: null };
const policy_dev = { mode: 'dev' as const, publicUrlHost: null };
const policy_prod_example = { mode: 'prod' as const, publicUrlHost: 'mcp.example.com' };

describe('validateRedirectUri — forbidden schemes (D-02, always rejected)', () => {
  it('rejects javascript:alert(1)', () => {
    const result = validateRedirectUri('javascript:alert(1)', policy_prod);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/forbidden scheme|javascript/i);
    }
  });

  it('rejects data:text/html,<script>', () => {
    const result = validateRedirectUri('data:text/html,<script>', policy_prod);
    expect(result.ok).toBe(false);
  });

  it('rejects file:///etc/passwd', () => {
    const result = validateRedirectUri('file:///etc/passwd', policy_prod);
    expect(result.ok).toBe(false);
  });

  it('rejects about:blank', () => {
    const result = validateRedirectUri('about:blank', policy_prod);
    expect(result.ok).toBe(false);
  });

  it("rejects vbscript:msgbox('x')", () => {
    const result = validateRedirectUri("vbscript:msgbox('x')", policy_prod);
    expect(result.ok).toBe(false);
  });

  it('still rejects javascript: in dev mode (forbidden always wins)', () => {
    const result = validateRedirectUri('javascript:alert(1)', policy_dev);
    expect(result.ok).toBe(false);
  });
});

describe('validateRedirectUri — loopback (always permitted)', () => {
  it('permits http://localhost:3000/cb in prod', () => {
    expect(validateRedirectUri('http://localhost:3000/cb', policy_prod)).toEqual({ ok: true });
  });

  it('permits http://localhost:54321/cb (arbitrary port) in prod', () => {
    expect(validateRedirectUri('http://localhost:54321/cb', policy_prod)).toEqual({ ok: true });
  });

  it('permits http://127.0.0.1:3000/cb in prod', () => {
    expect(validateRedirectUri('http://127.0.0.1:3000/cb', policy_prod)).toEqual({ ok: true });
  });

  it('permits http://[::1]:3000/cb (IPv6 loopback) in prod', () => {
    // Pitfall: new URL('http://[::1]:3000/cb').hostname returns '::1' (brackets
    // stripped). The validator's LOOPBACK_HOSTS set must include '::1' verbatim.
    expect(validateRedirectUri('http://[::1]:3000/cb', policy_prod)).toEqual({ ok: true });
  });

  it('permits http://localhost:3000/cb in dev', () => {
    expect(validateRedirectUri('http://localhost:3000/cb', policy_dev)).toEqual({ ok: true });
  });
});

describe('validateRedirectUri — https host allowlist', () => {
  it('rejects https://evil.com/cb in prod with no publicUrlHost configured', () => {
    const result = validateRedirectUri('https://evil.com/cb', policy_prod);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/allowlist|host/i);
    }
  });

  it('permits https://evil.com/cb in dev mode (dev is permissive per D-02)', () => {
    expect(validateRedirectUri('https://evil.com/cb', policy_dev)).toEqual({ ok: true });
  });

  it('permits https://mcp.example.com/cb when publicUrlHost matches', () => {
    expect(validateRedirectUri('https://mcp.example.com/cb', policy_prod_example)).toEqual({
      ok: true,
    });
  });

  it('permits https://mcp.example.com:8443/cb when publicUrlHost matches (port ignored)', () => {
    // Port differences must not affect the host-match check.
    expect(validateRedirectUri('https://mcp.example.com:8443/cb', policy_prod_example)).toEqual({
      ok: true,
    });
  });

  it('still rejects https://other.example.com/cb when publicUrlHost=mcp.example.com in prod', () => {
    const result = validateRedirectUri('https://other.example.com/cb', policy_prod_example);
    expect(result.ok).toBe(false);
  });
});

describe('validateRedirectUri — malformed input', () => {
  it('rejects the string "not a url"', () => {
    const result = validateRedirectUri('not a url', policy_prod);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/not a valid URL/i);
    }
  });

  it('rejects an empty string', () => {
    const result = validateRedirectUri('', policy_prod);
    expect(result.ok).toBe(false);
  });

  it('rejects ftp://server/cb (non-http(s) scheme, not in forbidden set)', () => {
    const result = validateRedirectUri('ftp://server/cb', policy_prod);
    expect(result.ok).toBe(false);
  });
});
