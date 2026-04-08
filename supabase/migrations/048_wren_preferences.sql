-- 048: Wren AI assistant personality preferences
-- Lets users configure how Wren communicates: tone, proactivity, channel preference.
-- Stored as JSONB on profiles for simplicity (no new table needed).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wren_preferences JSONB DEFAULT '{
  "tone": "balanced",
  "proactivity": "standard",
  "channel": "slack_first",
  "morning_brief": true,
  "weekly_reflection": true
}'::jsonb;

COMMENT ON COLUMN profiles.wren_preferences IS 'User preferences for Wren AI assistant: tone (direct/balanced/encouraging), proactivity (minimal/standard/proactive), channel (slack_first/email_first/in_app_only), morning_brief, weekly_reflection';
