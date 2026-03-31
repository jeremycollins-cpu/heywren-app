-- =============================================================================
-- Migration 032: Add general notification preferences
-- Adds slack_notifications, email_digests, overdue_alerts, weekly_review
-- to notification_preferences table.
-- =============================================================================

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS slack_notifications BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_digests BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS overdue_alerts BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS weekly_review BOOLEAN DEFAULT true;
