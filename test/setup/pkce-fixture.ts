/**
 * PKCE pair fixture (plan 06-05, 06-06).
 *
 * Every integration test that touches /authorize or /token MUST generate a
 * fresh PKCE pair via newPkce() — hard-coded challenges collide across
 * concurrent integration tests that share a single Redis (Pitfall 5 in
 * 06-RESEARCH.md §Validation Architecture).
 *
 * Pattern mirrors src/server.ts PKCE challenge computation at ~line 296-299
 * (sha256 base64url encoding of a 32-byte random verifier).
 */
import crypto from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function newPkce(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}
