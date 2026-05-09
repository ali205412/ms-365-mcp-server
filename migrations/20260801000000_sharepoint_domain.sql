-- Up Migration
-- Plan 5.1-06: tenants.sharepoint_domain column.
--
-- Per 05.1-RESEARCH §SharePoint Option A (recommended choice):
--   - Single-label SharePoint hostname (e.g., "contoso" for
--     contoso.sharepoint.com).
--   - NULL default; absence handled by dispatch (product-routing.ts) with
--     a structured MCP tool error `code: sp_admin_not_configured`
--     directing operators to PATCH /admin/tenants/{id} with the field.
--   - Admin PATCH /admin/tenants/{id} accepts the field via the existing
--     dynamic UPDATE builder (plan 04-02 shipped the addSet helper).
--   - Zod validation `/^[a-z0-9-]{1,63}$/` applied at admin PATCH AND at
--     dispatch (defense-in-depth against SQL injection or bypassed admin
--     controls). T-5.1-06-c mitigation.
--   - Dispatch time substitution into BOTH baseUrl
--     `https://{sharepoint_domain}-admin.sharepoint.com/_api/...` AND
--     scope `https://{sharepoint_domain}-admin.sharepoint.com/.default`.
--
-- Migration safety:
--   - ALTER TABLE tenants ADD COLUMN ... NULL is non-blocking on
--     PostgreSQL (fast path — no table rewrite for nullable columns with
--     no default value). Existing rows retain implicit NULL.
--   - No backfill needed — tenants that haven't configured SharePoint
--     admin access simply get NULL and dispatch returns the structured
--     error.
--   - Backward compatible: no existing callers reference this column;
--     extending the SELECT column list + Zod wire schema is additive.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS sharepoint_domain text NULL;

-- Down Migration
ALTER TABLE tenants DROP COLUMN IF EXISTS sharepoint_domain;
