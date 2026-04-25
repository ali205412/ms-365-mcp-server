-- Up Migration
-- Plan 07-01: tenant-scoped memory substrate for discovery-mode tools.
--
-- Per Phase 7 SPEC Part 4:
--   - Bookmarks, recipes, and facts are tenant-owned durable rows.
--   - Every table FKs to tenants(id) ON DELETE CASCADE so tenant deletion
--     removes all associated memory state.
--   - This migration is additive only; it does not rewrite existing tenant
--     rows or change static-preset defaults.
--   - Full-text fact recall is the default path through content_tsv.
--   - Optional pgvector storage/indexing is applied by bin/migrate.mjs after
--     regular Up migrations when MS365_MCP_PGVECTOR_ENABLED is enabled and
--     pg_available_extensions advertises the vector extension.

CREATE TABLE tenant_tool_bookmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alias text NOT NULL,
  label text,
  note text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, alias)
);

CREATE INDEX idx_tenant_tool_bookmarks_tenant
  ON tenant_tool_bookmarks (tenant_id);

CREATE TABLE tenant_tool_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  alias text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX idx_tenant_tool_recipes_tenant
  ON tenant_tool_recipes (tenant_id);

CREATE TABLE tenant_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope text NOT NULL,
  content text NOT NULL,
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_facts_tenant_scope
  ON tenant_facts (tenant_id, scope);

CREATE INDEX idx_tenant_facts_content_tsv
  ON tenant_facts USING gin (content_tsv);

-- Down Migration
DROP TABLE IF EXISTS tenant_facts;
DROP TABLE IF EXISTS tenant_tool_recipes;
DROP TABLE IF EXISTS tenant_tool_bookmarks;
