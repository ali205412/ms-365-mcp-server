/**
 * Per-tenant DEK helpers (plan 03-04, D-12 / SECUR-01).
 *
 * Wraps the envelope.ts primitives with tenant-aware semantics:
 *   - generateTenantDek(kek): returns a fresh 32-byte DEK + its KEK-wrapped envelope.
 *   - unwrapTenantDek(envelope, kek): returns the unwrapped DEK Buffer.
 *
 * DEKs NEVER leave the server process — once unwrapped they live only in
 * TenantPool's PoolEntry struct (in-memory) and are GC'd on tenant eviction.
 */
import { generateDek, wrapDek, unwrapDek, type Envelope } from './envelope.js';

export interface TenantDekBundle {
  dek: Buffer; // 32 bytes — kept in memory only, NEVER persisted
  wrappedDek: Envelope; // stored as JSONB in tenants.wrapped_dek
}

/**
 * Mint a fresh per-tenant DEK and wrap it with the KEK. Call site: tenant
 * onboarding (bin/create-tenant.mjs) + admin API tenant insert.
 *
 * @throws Error when kek.length !== 32 (propagated from envelope.ts).
 */
export function generateTenantDek(kek: Buffer): TenantDekBundle {
  const dek = generateDek();
  const wrappedDek = wrapDek(dek, kek);
  return { dek, wrappedDek };
}

/**
 * Unwrap a tenant's stored envelope back to its plaintext DEK. Call site:
 * TenantPool acquire (03-05) — one unwrap per tenant per pool lifetime.
 *
 * @throws Error when envelope is tampered, kek is wrong, or kek.length !== 32.
 */
export function unwrapTenantDek(wrappedDek: Envelope, kek: Buffer): Buffer {
  return unwrapDek(wrappedDek, kek);
}
