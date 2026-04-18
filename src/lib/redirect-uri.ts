/**
 * redirect_uri allowlist validator per D-02 policy (plan 01-06, AUTH-06).
 *
 * Always forbidden: javascript:, data:, file:, about:, vbscript: (regardless of mode)
 * Always permitted: http://localhost:* / http://127.0.0.1:* / http://[::1]:* (loopback)
 * Always permitted: https://<host> when host matches policy.publicUrlHost
 * Dev mode only:    any https://
 * Prod mode:        everything else is rejected with { ok: false, reason }
 *
 * Phase 3 note: this validator accepts a publicUrlHost parameter so per-tenant
 * allowlists (TENANT-01) can be injected at call time without rewriting the
 * pure function. Phase 3 can grow the policy shape to include
 * `extraAllowedHosts: string[]` without breaking existing callers.
 *
 * Pure function — no project imports, no side effects.
 */

export type RedirectUriMode = 'dev' | 'prod';

export interface RedirectUriPolicy {
  mode: RedirectUriMode;
  /** Parsed host of MS365_MCP_PUBLIC_URL; null when PUBLIC_URL is unset. */
  publicUrlHost: string | null;
}

const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'about:', 'vbscript:']);
// Node's URL parser preserves brackets on IPv6 hostnames (`[::1]`), while the
// WHATWG URL spec and some other implementations strip them to `::1`. Accept
// both literal forms so the validator works regardless of upstream host parsing.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function validateRedirectUri(
  raw: string,
  policy: RedirectUriPolicy
): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'not a valid URL' };
  }

  if (FORBIDDEN_SCHEMES.has(url.protocol)) {
    return { ok: false, reason: `forbidden scheme: ${url.protocol}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `non-http(s) scheme: ${url.protocol}` };
  }

  // Loopback: HTTP only, hostname must be localhost / 127.0.0.1 / ::1 / [::1].
  // Node's URL parser preserves brackets on IPv6 literals in `hostname`; we
  // accept both bracketed and unbracketed forms for cross-implementation safety.
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) {
    return { ok: true };
  }

  // Host matches configured PUBLIC_URL — always OK regardless of mode.
  if (url.protocol === 'https:' && policy.publicUrlHost && url.hostname === policy.publicUrlHost) {
    return { ok: true };
  }

  // Dev mode permits any https://.
  if (policy.mode === 'dev' && url.protocol === 'https:') {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `host not in allowlist (mode=${policy.mode}): ${url.hostname}`,
  };
}
