-- Add user_id column to outlook_messages and outlook_calendar_events
-- This enables per-user data isolation instead of team-level sharing

-- outlook_messages: add user_id (nullable for backward compat with existing rows)
ALTER TABLE outlook_messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_outlook_messages_user_id ON outlook_messages(user_id);

-- outlook_calendar_events: add user_id (nullable for backward compat with existing rows)
ALTER TABLE outlook_calendar_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_outlook_calendar_events_user_id ON outlook_calendar_events(user_id);

-- Update unique constraints to include user_id for multi-user team support
-- Drop the old constraint and add new one that allows each user to have their own copy
ALTER TABLE outlook_calendar_events DROP CONSTRAINT IF EXISTS outlook_calendar_events_team_id_event_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outlook_calendar_events_team_user_event
  ON outlook_calendar_events (team_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), event_id);
