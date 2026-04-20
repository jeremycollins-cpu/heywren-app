-- Org-level kill switch for all Slack alerts (celebrations + daily digest).
-- When true, the daily digest and per-event celebration posts are suppressed
-- for every team in the organization.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS disable_slack_alerts BOOLEAN NOT NULL DEFAULT false;
