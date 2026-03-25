-- Migration 015: Meeting Transcripts
--
-- Stores meeting transcripts from any source (Teams, Zoom, manual upload).
-- HeyWren only needs the transcript text — no audio/video storage.
-- Supports "Hey Wren" wake word detection for explicit commitment triggers.

-- Add 'recording' to the commitment_source enum (used for meeting-sourced commitments)
ALTER TYPE commitment_source ADD VALUE IF NOT EXISTS 'recording';

CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source tracking
  provider TEXT NOT NULL CHECK (provider IN ('zoom', 'teams', 'google_meet', 'manual')),
  external_meeting_id TEXT,         -- Platform-specific meeting ID

  -- Meeting details
  title TEXT,
  start_time TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER,
  organizer_name TEXT,
  organizer_email TEXT,
  attendees JSONB DEFAULT '[]'::jsonb,

  -- Transcript content
  transcript_text TEXT NOT NULL,
  transcript_segments JSONB,        -- Optional: timestamped segments [{speaker, text, start_s, end_s}]

  -- Processing state
  transcript_status TEXT DEFAULT 'pending' CHECK (transcript_status IN ('pending', 'processing', 'ready', 'failed')),
  processed BOOLEAN DEFAULT FALSE,
  commitments_found INTEGER DEFAULT 0,
  hey_wren_triggers INTEGER DEFAULT 0,  -- Count of "Hey Wren" invocations detected

  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(team_id, provider, external_meeting_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_team_id ON meeting_transcripts(team_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_user_id ON meeting_transcripts(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_processed ON meeting_transcripts(processed);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_start_time ON meeting_transcripts(start_time);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_provider ON meeting_transcripts(provider);

-- RLS
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view meeting transcripts" ON meeting_transcripts
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = meeting_transcripts.team_id
  AND tm.user_id = auth.uid()
));

CREATE POLICY "Team members can insert meeting transcripts" ON meeting_transcripts
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = meeting_transcripts.team_id
  AND tm.user_id = auth.uid()
));

CREATE POLICY "Team members can update meeting transcripts" ON meeting_transcripts
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = meeting_transcripts.team_id
  AND tm.user_id = auth.uid()
));

-- Trigger for updated_at
CREATE TRIGGER update_meeting_transcripts_updated_at BEFORE UPDATE ON meeting_transcripts
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
