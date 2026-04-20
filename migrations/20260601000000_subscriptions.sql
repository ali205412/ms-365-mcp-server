-- Up Migration
-- Plan 04-07 / 04-08: per-tenant Microsoft Graph subscription registry.
--
-- Per D-17:
--   - graph_subscription_id is the remote ID from Graph (opaque string).
--   - client_state is AES-GCM-encrypted with the tenant DEK (NEVER plaintext).
--   - expires_at is updated after every successful renewal PATCH.
--
-- Index strategy:
--   - idx_subscriptions_tenant_graph_id: webhook handler looks up
--     (tenant_id, graph_subscription_id) to fetch the encrypted clientState.
--   - idx_subscriptions_tenant_expires: renewal cron scans rows with
--     (disabled_at IS NULL AND expires_at < NOW() + interval '1 hour').
--
-- FK cascade carries the Phase-3 cryptoshred contract: deleting a tenant
-- also drops every subscription row (matches audit_log, api_keys, delta_tokens).
CREATE TABLE subscriptions (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  graph_subscription_id   text NOT NULL,
  resource                text NOT NULL,
  change_type             text NOT NULL,
  notification_url        text NOT NULL,
  client_state            jsonb NOT NULL, -- Envelope {v, iv, tag, ct}
  expires_at              timestamptz NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT NOW(),
  updated_at              timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_subscriptions_tenant_graph_id
  ON subscriptions (tenant_id, graph_subscription_id);

-- Partial index for the renewal cron: only rows near expiration.
-- Using a partial WHERE clause would require an immutable expression on NOW(),
-- which Postgres rejects. The full (tenant_id, expires_at) index is the
-- correct compromise — the cron scans with tenant JOIN anyway.
CREATE INDEX idx_subscriptions_tenant_expires
  ON subscriptions (tenant_id, expires_at);

-- Down Migration
DROP TABLE IF EXISTS subscriptions;
