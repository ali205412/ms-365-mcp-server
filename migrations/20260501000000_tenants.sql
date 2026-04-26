-- Up Migration
-- Plan 03-01: tenant registry.
--
-- Per D-11 single-schema row-level tenancy + D-12 cryptoshred semantics:
--   - Every tenant-owned row elsewhere (audit_log, delta_tokens, api_keys)
--     FKs to tenants.id ON DELETE CASCADE so a tenant row deletion removes
--     all tenant-owned hot state.
--   - wrapped_dek is a JSONB envelope ({v, iv, tag, ct}) — nullable at
--     insert time (03-04 wraps the real DEK); setting it to NULL is the
--     cryptoshred path (no ciphertext is ever recoverable again).
--   - slug is optional, admin-API / UI convenience only; routing is
--     GUID-only per D-13.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id                        uuid PRIMARY KEY,
  mode                      text NOT NULL CHECK (mode IN ('delegated', 'app-only', 'bearer')),
  client_id                 text NOT NULL,
  client_secret_ref         text,
  tenant_id                 text NOT NULL,
  cloud_type                text NOT NULL DEFAULT 'global' CHECK (cloud_type IN ('global', 'china')),
  redirect_uri_allowlist    jsonb NOT NULL DEFAULT '[]'::jsonb,
  cors_origins              jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_scopes            jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled_tools             text,
  wrapped_dek               jsonb,
  slug                      text UNIQUE,
  disabled_at               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT NOW(),
  updated_at                timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_disabled_at ON tenants (disabled_at) WHERE disabled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug) WHERE slug IS NOT NULL;

-- Down Migration
DROP TABLE IF EXISTS tenants CASCADE;
DROP EXTENSION IF EXISTS pgcrypto;
