-- =============================================================================
-- Migration 022: Gamification Notification Preferences
-- Per-user preferences for gamification-related notifications.
-- =============================================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Notification toggles
  achievement_notifications BOOLEAN DEFAULT true,   -- notify when I earn badges
  streak_notifications BOOLEAN DEFAULT true,        -- notify about streak milestones
  leaderboard_notifications BOOLEAN DEFAULT true,   -- notify about rank changes
  challenge_notifications BOOLEAN DEFAULT true,     -- notify about challenge progress
  weekly_digest BOOLEAN DEFAULT true,               -- receive weekly summary
  celebration_posts BOOLEAN DEFAULT true,           -- post my achievements to team channel

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(organization_id, user_id)
);

-- Indexes
CREATE INDEX idx_notification_preferences_org ON notification_preferences(organization_id);
CREATE INDEX idx_notification_preferences_user ON notification_preferences(user_id);

-- RLS
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notification preferences"
  ON notification_preferences
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own notification preferences"
  ON notification_preferences
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification preferences"
  ON notification_preferences
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_notification_preferences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_preferences_updated_at();
