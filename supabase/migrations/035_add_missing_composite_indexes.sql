-- =============================================================================
-- Migration 035: Add missing composite indexes for Disk IO optimization
-- Addresses frequent queries that were causing full table scans.
-- =============================================================================

-- missed_emails: queries filter on (user_id, team_id, status) and sort by received_at
CREATE INDEX IF NOT EXISTS idx_missed_emails_user_team_status
  ON missed_emails(user_id, team_id, status);

CREATE INDEX IF NOT EXISTS idx_missed_emails_team_user_status_received
  ON missed_emails(team_id, user_id, status, received_at DESC);

-- missed_email_feedback: queries filter on (team_id, user_id, feedback)
CREATE INDEX IF NOT EXISTS idx_missed_email_feedback_team_user_feedback
  ON missed_email_feedback(team_id, user_id, feedback);

-- outlook_messages: queries filter on (team_id, user_id)
CREATE INDEX IF NOT EXISTS idx_outlook_messages_team_user
  ON outlook_messages(team_id, user_id);

-- commitments: dashboard queries filter on (team_id, status) and sort by created_at
CREATE INDEX IF NOT EXISTS idx_commitments_team_status_created
  ON commitments(team_id, status, created_at DESC);

-- notifications: queries filter on (user_id, type)
CREATE INDEX IF NOT EXISTS idx_notifications_user_type
  ON notifications(user_id, type);

-- platform_sync_cursors: inngest functions filter on (team_id, provider, sync_status)
CREATE INDEX IF NOT EXISTS idx_platform_sync_cursors_team_provider_status
  ON platform_sync_cursors(team_id, provider, sync_status);
