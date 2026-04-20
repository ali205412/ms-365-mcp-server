/**
 * TenantRow shape (plan 03-05 / 03-08, TENANT-01).
 *
 * Mirrors the Postgres `tenants` table schema
 * (migrations/20260501000000_tenants.sql). Loaded by load-tenant.ts middleware
 * (03-08) on cache miss; passed by reference into tenant-pool.ts (03-05) and
 * oauth-provider.ts (03-06).
 *
 * `client_secret_resolved` is NOT a column — it is the in-memory resolution of
 * the `client_secret_ref` reference (env: / kv: / inline-encrypted: schemes).
 * Done lazily at tenant-pool.acquire() time so plain SELECTs never materialize
 * a plaintext secret.
 *
 * `wrapped_dek` is nullable at rest because Phase 3 Plan 01 ships a seam where
 * `bin/create-tenant.mjs` inserts rows with NULL `wrapped_dek`; 03-04 closed
 * that seam so new rows carry a real envelope. Disabling a tenant sets it back
 * to NULL (cryptoshred — no ciphertext is recoverable once the DEK wrapper is
 * dropped).
 */
import type { Envelope } from '../crypto/envelope.js';

export type TenantMode = 'delegated' | 'app-only' | 'bearer';
export type CloudType = 'global' | 'china';

export interface TenantRow {
  id: string;
  mode: TenantMode;
  client_id: string;
  client_secret_ref: string | null;
  client_secret_resolved?: string;
  tenant_id: string;
  cloud_type: CloudType;
  redirect_uri_allowlist: string[];
  cors_origins: string[];
  allowed_scopes: string[];
  enabled_tools: string | null;
  /**
   * Plan 05-03 (D-19). The tenant's pinned preset version — migration
   * 20260702000000_preset_version.sql defaults this to 'essentials-v1' and
   * backfills pre-existing rows. NOT NULL in DB, so never null here.
   * Consumed by Plan 05-04 (dispatch guard) via preset-loader.presetFor().
   */
  preset_version: string;
  wrapped_dek: Envelope | null;
  slug: string | null;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
