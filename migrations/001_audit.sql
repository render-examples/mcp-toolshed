CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('analyst', 'implementer', 'admin')),
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  api_key_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  caller_role TEXT NOT NULL,
  caller_label TEXT,
  tool_name TEXT NOT NULL,
  arguments JSONB,
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'denied', 'error', 'unknown')),
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_tool_name_idx ON audit_events (tool_name);
CREATE INDEX IF NOT EXISTS audit_events_api_key_id_idx ON audit_events (api_key_id);
CREATE INDEX IF NOT EXISTS audit_events_started_idx ON audit_events (created_at) WHERE status = 'started';
