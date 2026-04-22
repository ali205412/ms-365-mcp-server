/**
 * Tenant-seed fixture (plan 06-05).
 *
 * Inserts a tenant row with sensible defaults. Integration tests supply
 * overrides for tenant id, mode, client_id, etc. as needed.
 *
 * Schema notes:
 *   - Works against any migrated tenants table (Phase 3 core columns +
 *     optional Phase 5.1 sharepoint_domain + optional Phase 5 preset_version
 *     + optional Phase 6 rate_limits once plan 06-04 lands).
 *   - The rate_limits column is inserted only when the caller passes an
 *     explicit override AND the column exists on the schema. Falls back to
 *     inserting NULL / default when 06-04 hasn't yet run.
 *
 * Unlike test/setup/fixtures.ts (plan 03-01 minimal seed), this fixture
 * covers the full tenant-row surface — redirect_uri_allowlist, cors_origins,
 * allowed_scopes, wrapped_dek — so integration tests can drive /authorize
 * + /token end-to-end without manual column wiring.
 */
import type { Pool } from 'pg';
import crypto from 'node:crypto';

export interface SeedTenantOverrides {
  id?: string;
  mode?: 'delegated' | 'app-only' | 'bearer';
  client_id?: string;
  tenant_id?: string;
  cloud_type?: 'global' | 'china';
  redirect_uri_allowlist?: string[];
  cors_origins?: string[];
  allowed_scopes?: string[];
  wrapped_dek?: unknown;
  slug?: string | null;
  rate_limits?: { request_per_min: number; graph_points_per_min: number } | null;
}

/**
 * Insert a tenant row. Returns the tenant id.
 *
 * Defaults:
 *   - Fresh crypto.randomUUID() id
 *   - mode='delegated'
 *   - client_id='test-client-id'
 *   - tenant_id='test-aad-tenant'
 *   - cloud_type='global'
 *   - redirect_uri_allowlist=[], cors_origins=[], allowed_scopes=[]
 *   - wrapped_dek=NULL
 *   - rate_limits=null (platform defaults)
 */
export async function seedTenant(pool: Pool, overrides: SeedTenantOverrides = {}): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();
  const mode = overrides.mode ?? 'delegated';
  const clientId = overrides.client_id ?? 'test-client-id';
  const tenantId = overrides.tenant_id ?? 'test-aad-tenant';
  const cloudType = overrides.cloud_type ?? 'global';
  const redirectUriAllowlist = overrides.redirect_uri_allowlist ?? [];
  const corsOrigins = overrides.cors_origins ?? [];
  const allowedScopes = overrides.allowed_scopes ?? [];
  const wrappedDek = overrides.wrapped_dek ?? null;
  const slug = overrides.slug ?? null;
  const rateLimits = overrides.rate_limits ?? null;

  // Detect whether the rate_limits column exists on the current schema so
  // this fixture stays forward-compatible across Phase 6 plan ordering
  // (plan 06-04 adds the column; plan 06-05 — this helper — must work both
  // before and after 06-04 lands so OAuth integration tests don't break
  // during intermediate waves).
  const colCheck = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'tenants' AND column_name = 'rate_limits'
     ) AS exists`
  );
  const hasRateLimits = colCheck.rows[0]?.exists === true;

  if (hasRateLimits) {
    await pool.query(
      `INSERT INTO tenants (
         id, mode, client_id, tenant_id, cloud_type,
         redirect_uri_allowlist, cors_origins, allowed_scopes,
         wrapped_dek, slug, rate_limits
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11::jsonb)`,
      [
        id,
        mode,
        clientId,
        tenantId,
        cloudType,
        JSON.stringify(redirectUriAllowlist),
        JSON.stringify(corsOrigins),
        JSON.stringify(allowedScopes),
        wrappedDek ? JSON.stringify(wrappedDek) : null,
        slug,
        rateLimits ? JSON.stringify(rateLimits) : null,
      ]
    );
  } else {
    await pool.query(
      `INSERT INTO tenants (
         id, mode, client_id, tenant_id, cloud_type,
         redirect_uri_allowlist, cors_origins, allowed_scopes,
         wrapped_dek, slug
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)`,
      [
        id,
        mode,
        clientId,
        tenantId,
        cloudType,
        JSON.stringify(redirectUriAllowlist),
        JSON.stringify(corsOrigins),
        JSON.stringify(allowedScopes),
        wrappedDek ? JSON.stringify(wrappedDek) : null,
        slug,
      ]
    );
  }

  return id;
}
