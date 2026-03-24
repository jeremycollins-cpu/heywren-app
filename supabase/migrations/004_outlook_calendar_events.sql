-- Create outlook_calendar_events table for storing synced calendar events
CREATE TABLE IF NOT EXISTS outlook_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  subject TEXT,
  organizer_name TEXT,
  organizer_email TEXT,
  attendees JSONB DEFAULT '[]'::jsonb,
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  location TEXT,
  body_preview TEXT,
  is_cancelled BOOLEAN DEFAULT FALSE,
  processed BOOLEAN DEFAULT FALSE,
  commitments_found INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_id, event_id)
);

-- Indexes for calendar event queries
CREATE INDEX IF NOT EXISTS idx_outlook_calendar_events_team_id ON outlook_calendar_events(team_id);
CREATE INDEX IF NOT EXISTS idx_outlook_calendar_events_start_time ON outlook_calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_outlook_calendar_events_processed ON outlook_calendar_events(processed);

-- Add 'calendar' to the commitment_source enum
ALTER TYPE commitment_source ADD VALUE IF NOT EXISTS 'calendar';

-- RLS policies
ALTER TABLE outlook_calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view calendar events" ON outlook_calendar_events
FOR SELECT
USING (EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = outlook_calendar_events.team_id AND tm.user_id = auth.uid()));
