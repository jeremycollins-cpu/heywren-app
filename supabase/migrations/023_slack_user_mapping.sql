-- Add slack_user_id to profiles for linking HeyWren users to their Slack identity.
-- This enables relevance filtering: only create commitments for messages
-- that are actually relevant to the user (authored by them, @mentioning them, etc.)

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS slack_user_id TEXT;

-- Unique index (partial) — one HeyWren user per Slack user
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_slack_user_id
  ON profiles(slack_user_id) WHERE slack_user_id IS NOT NULL;
