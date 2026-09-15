ALTER TABLE audit_events
  ADD COLUMN IF NOT EXISTS api_key_id INTEGER
    REFERENCES api_keys(id) ON DELETE SET NULL;

ALTER TABLE audit_events
  DROP CONSTRAINT IF EXISTS audit_events_status_check;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_status_check
  CHECK (status IN ('started', 'success', 'denied', 'error', 'unknown'));

CREATE INDEX IF NOT EXISTS audit_events_api_key_id_idx
  ON audit_events (api_key_id);

CREATE INDEX IF NOT EXISTS audit_events_started_idx
  ON audit_events (created_at)
  WHERE status = 'started';
