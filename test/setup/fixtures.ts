/**
 * Shared tenant-fixture helpers (plan 03-01 Task 3, Wave 0).
 *
 * Provides INSERT / DELETE helpers that integration and unit tests can use
 * to spin up and cryptoshred tenant rows deterministically. 03-04's DEK
 * wrap plan extends these with `generateTenantDek(kek)` — for now
 * wrapped_dek stays NULL (matching bin/create-tenant.mjs semantics).
 *
 * Usage:
 *   import { createTenantFixture, cleanupTenantFixture, makeTenantId } from '../setup/fixtures';
 *   const id = makeTenantId();
 *   const row = await createTenantFixture(pool, { id, mode: 'delegated' });
 *   // ... run assertions ...
 *   await cleanupTenantFixture(pool, id);
 */
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export interface TenantFixtureOverrides {
  id?: string;
  mode?: 'delegated' | 'app-only' | 'bearer';
  clientId?: string;
  tenantId?: string;
  cloudType?: 'global' | 'china';
  slug?: string | null;
}

export interface TenantFixtureRow {
  id: string;
  mode: string;
  client_id: string;
  tenant_id: string;
  cloud_type: string;
  slug: string | null;
  wrapped_dek: unknown;
}

/** Fresh v4 GUID suitable for Entra tenant-id-shaped tests. */
export function makeTenantId(): string {
  return randomUUID();
}

/**
 * INSERT a tenant row and SELECT it back. Returns the inserted row as a
 * plain object (snake_case column names — matches pg's default row shape).
 */
export async function createTenantFixture(
  pool: Pool,
  overrides: TenantFixtureOverrides = {}
): Promise<TenantFixtureRow> {
  const id = overrides.id ?? makeTenantId();
  const mode = overrides.mode ?? 'delegated';
  const clientId = overrides.clientId ?? 'fixture-client-id';
  const tenantId = overrides.tenantId ?? 'fixture-tenant-id';
  const cloudType = overrides.cloudType ?? 'global';
  const slug = overrides.slug ?? null;

  await pool.query(
    `INSERT INTO tenants (id, mode, client_id, tenant_id, cloud_type, slug, wrapped_dek)
       VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
    [id, mode, clientId, tenantId, cloudType, slug]
  );

  const r = await pool.query<TenantFixtureRow>(`SELECT * FROM tenants WHERE id = $1`, [id]);
  if (r.rows.length === 0) {
    throw new Error(`createTenantFixture: row not found after INSERT for id=${id}`);
  }
  return r.rows[0]!;
}

/** DELETE the tenant row (and cascading children) by id. Idempotent. */
export async function cleanupTenantFixture(pool: Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
}
