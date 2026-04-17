-- Audit log for scheduled job runs (Inngest crons).
-- Lets us see at a glance why a function didn't send emails: no data, auth failed,
-- all users opted out, all deduped, etc. Without this, silent data-gate bugs
-- like the recipient_gap default bug (migration 077) can go undetected for weeks.
--
-- One row per function invocation. Per-user outcomes summarized in `outcomes`
-- as { sent: N, skipped: N, failed: N, no_data: N, opted_out: N, deduped: N }.

CREATE TABLE IF NOT EXISTS job_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed')),
  users_considered INTEGER DEFAULT 0,
  outcomes JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_started ON job_runs(job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status, started_at DESC);

ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;

-- Only service role can write; admins can read via server-side queries.
CREATE POLICY "Service role full access to job_runs"
  ON job_runs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
