-- System error log for real-time monitoring.
-- Every API route and background job logs errors here so the admin
-- dashboard can surface them before users report bugs.

CREATE TABLE system_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Where the error happened
  source TEXT NOT NULL,              -- e.g. 'api/ooo', 'inngest/sync-outlook'
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning', 'error', 'critical')),

  -- What happened
  message TEXT NOT NULL,
  details JSONB,                     -- stack trace, request body, extra context

  -- Who was affected
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  team_id UUID,

  -- When
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- For dedup / grouping
  error_key TEXT                     -- e.g. 'token_refresh_failed:outlook' for grouping
);

CREATE INDEX idx_system_errors_created ON system_errors(created_at DESC);
CREATE INDEX idx_system_errors_source ON system_errors(source, created_at DESC);
CREATE INDEX idx_system_errors_severity ON system_errors(severity, created_at DESC);
CREATE INDEX idx_system_errors_key ON system_errors(error_key, created_at DESC);

-- Auto-delete errors older than 30 days to prevent bloat
-- (run via cron or application-level cleanup)
