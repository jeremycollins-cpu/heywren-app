-- Add user_id column to outlook_messages and outlook_calendar_events
-- This enables per-user data isolation instead of team-level sharing

-- outlook_messages: add user_id (nullable for backward compat with existing rows)
ALTER TABLE outlook_messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_outlook_messages_user_id ON outlook_messages(user_id);

-- outlook_calendar_events: add user_id (nullable for backward compat with existing rows)
ALTER TABLE outlook_calendar_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_outlook_calendar_events_user_id ON outlook_calendar_events(user_id);
