-- Up Migration
-- Plan 03-01: synchronous tenant-scoped audit trail.
--
-- Per D-13 sync-audit contract + MWARE-07 requestId carry-over from Phase 2:
--   - id is caller-supplied (nanoid-shaped text) — NOT gen_random_uuid() —
--     so writers can stamp IDs before INSERT for client-side retry idempotency.
--   - request_id is NOT NULL because every audit row must correlate to a
--     specific request; orphan audit rows are a data-integrity bug.
--   - meta is JSONB schema-on-read — per-action-type shape documented inline
--     by each writer (src/lib/audit.ts in 03-10). Never contains raw PII per
--     D-01 redaction policy.
--   - (tenant_id, ts DESC) is the primary query path (tenant time-range scans);
--     (tenant_id, action, ts DESC) accelerates per-action filters in the
--     admin API (Phase 4). request_id single-column index supports
--     Microsoft-support cross-correlation (ODataError.requestId from
--     02-04).
CREATE TABLE audit_log (
  id          text PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor       text NOT NULL,
  action      text NOT NULL,
  target      text,
  ip          text,
  request_id  text NOT NULL,
  result      text NOT NULL CHECK (result IN ('success', 'failure')),
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_tenant_ts ON audit_log (tenant_id, ts DESC);
CREATE INDEX idx_audit_log_action ON audit_log (tenant_id, action, ts DESC);
CREATE INDEX idx_audit_log_request_id ON audit_log (request_id);

-- Down Migration
DROP TABLE IF EXISTS audit_log;
