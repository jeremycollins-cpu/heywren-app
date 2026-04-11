-- Platform-wide application configuration (key-value store)
-- Used for super-admin tuneable settings like celebration trigger rate.

CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default celebration rate
INSERT INTO app_config (key, value)
VALUES ('celebration_trigger_rate', '"0.3"')
ON CONFLICT (key) DO NOTHING;

-- Only service-role should read/write this table
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;
