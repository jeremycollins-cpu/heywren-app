-- Migration 036: Add read status and folder tracking to emails
--
-- 1. Adds is_read and folder columns to outlook_messages for tracking
--    read state and folder origin from Microsoft Graph.
-- 2. Adds is_read and folder_name to missed_emails so the UI can show
--    "Unread" badges and folder context.
-- 3. Adds priority_folders and excluded_folders to email_preferences
--    so users can prioritize or exclude specific mail folders.

-- ── outlook_messages: track read status and folder ──────────────────
ALTER TABLE outlook_messages
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS folder_id TEXT,
  ADD COLUMN IF NOT EXISTS folder_name TEXT;

-- ── missed_emails: surface read status and folder ───────────────────
ALTER TABLE missed_emails
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS folder_name TEXT;

CREATE INDEX IF NOT EXISTS idx_missed_emails_is_read
  ON missed_emails(team_id, is_read) WHERE status = 'pending';

-- ── email_preferences: folder-based filtering ───────────────────────
ALTER TABLE email_preferences
  ADD COLUMN IF NOT EXISTS priority_folders TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS excluded_folders TEXT[] DEFAULT '{}';
