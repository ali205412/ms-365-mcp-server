-- Up Migration
-- Plan 03-01: tenant-scoped admin API keys.
--
-- Schema ships in Phase 3; mint/verify/rotate endpoints land in Phase 4
-- (ADMIN-02). Per D-12, plaintext keys are NEVER stored:
--   - key_hash holds an argon2id hash (with per-key random salt embedded
--     in the argon2 output per RFC 9106).
--   - display_suffix retains the last 4-8 chars of the raw key for admin UI
--     and operator logs — lets a human recognize which key they're looking at
--     without revealing enough entropy to forge.
--   - revoked_at is the soft-delete marker — rows are never hard-deleted so
--     audit_log rows referencing the key remain joinable.
--
-- Partial index (tenant_id, revoked_at) WHERE revoked_at IS NULL accelerates
-- the hot path: "look up an active key for this tenant" without scanning
-- revoked keys.
CREATE TABLE api_keys (
  id              text PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  key_hash        text NOT NULL,
  display_suffix  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  last_used_at    timestamptz,
  revoked_at      timestamptz
);

CREATE INDEX idx_api_keys_tenant_active ON api_keys (tenant_id, revoked_at) WHERE revoked_at IS NULL;

-- Down Migration
DROP TABLE IF EXISTS api_keys;
