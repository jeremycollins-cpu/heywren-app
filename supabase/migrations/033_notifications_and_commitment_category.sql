-- =============================================================================
-- Migration 033: Notifications hub + commitment category + stale cleanup
-- =============================================================================

-- 1. Notifications table for persistent in-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'missed_email', 'stale_commitment', 'weekly_review', 'anomaly', 'achievement', 'nudge'
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,           -- optional deep link (e.g. /missed-emails, /commitments/abc)
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_read ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all notifications"
  ON notifications FOR ALL
  USING (auth.role() = 'service_role');

-- 2. Add category column to commitments (stores commitmentType from AI detection)
ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_commitments_category ON commitments(team_id, category);

-- 3. Add stale_notified_at to commitments to track when we last prompted about staleness
ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS stale_notified_at TIMESTAMPTZ;
