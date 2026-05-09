-- Up Migration
-- Plan 03-01: tenant-scoped Graph delta-token persistence.
--
-- Schema ships in Phase 3; the actual write path + delta-query helper lands
-- in Phase 4 (MWARE-08). Composite PK (tenant_id, resource) ensures a single
-- row per (tenant, Graph resource) pair; callers UPSERT on the composite key
-- whenever they consume a delta-link.
--
-- Schema is intentionally narrow — delta_link opaque strings from Graph can
-- be arbitrarily long; relying on text with no length bound matches the
-- Microsoft docs contract.
CREATE TABLE IF NOT EXISTS delta_tokens (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  resource     text NOT NULL,
  delta_link   text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, resource)
);

-- Down Migration
DROP TABLE IF EXISTS delta_tokens;
