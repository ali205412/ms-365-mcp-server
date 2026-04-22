-- Up Migration
-- Plan 06-04 (D-11): tenants.rate_limits JSONB column.
--
-- Per 06-CONTEXT.md §D-11:
--   - JSONB shape: { "request_per_min": int, "graph_points_per_min": int }
--   - NULL default; absence inherits platform defaults from env vars
--     (MS365_MCP_DEFAULT_REQ_PER_MIN / MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN).
--   - Admin PATCH /admin/tenants/{id} accepts the field via the existing
--     dynamic UPDATE builder (plan 04-02 shipped the addSet helper).
--   - Zod validation `RateLimitsZod` applied at admin PATCH (defense against
--     negative / zero / Infinity values).
--
-- Migration safety:
--   - ALTER TABLE tenants ADD COLUMN ... NULL is non-blocking on
--     PostgreSQL (fast path — no table rewrite for nullable columns with
--     no default value).
--   - No backfill — existing tenants pick up platform defaults on first
--     request via the rate-limit middleware's resolveRateLimits(tenant) helper.
--   - Backward compatible: no existing callers reference this column.

ALTER TABLE tenants
  ADD COLUMN rate_limits JSONB DEFAULT NULL;

COMMENT ON COLUMN tenants.rate_limits IS
  'Per-tenant rate-limit overrides as JSONB. Keys: request_per_min, graph_points_per_min. NULL inherits from MS365_MCP_DEFAULT_REQ_PER_MIN / MS365_MCP_DEFAULT_GRAPH_POINTS_PER_MIN env vars.';

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS rate_limits;
