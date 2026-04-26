-- Up Migration
-- Plan 05-03: tenant preset_version column (D-19).
--
-- Per CONTEXT D-19:
--   - Each tenant's preset_version column records which essentials preset
--     the tenant is pinned to. Tenants are NEVER auto-migrated on preset
--     evolution — an admin PATCH is required to bump the version.
--   - Default 'essentials-v1' for freshly-inserted tenants.
--   - Pre-existing rows (tenants inserted before this migration) are
--     backfilled to 'essentials-v1' at migration time.
--   - Runtime consumers (loadTenant middleware, dispatch guard in 05-04)
--     resolve the Set<string> via src/lib/tool-selection/preset-loader.ts.
--
-- T-05-06 mitigation: unknown preset_version values resolve to an empty
-- frozen set at runtime (fail-closed). The 64-char + regex guard on the
-- admin PATCH Zod validator prevents pathological values from landing.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS preset_version text NOT NULL DEFAULT 'essentials-v1';

-- Explicit backfill — redundant with the DEFAULT on ADD COLUMN, but the
-- UPDATE keeps the intent auditable in the migration log (so ops reviewing
-- `pgmigrations` rows see the preset-version pin applied to every row).
UPDATE tenants
  SET preset_version = 'essentials-v1'
  WHERE preset_version IS NULL;

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS preset_version;
