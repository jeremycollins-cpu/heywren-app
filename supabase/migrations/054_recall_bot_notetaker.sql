-- Migration 054: Recall.ai Bot Notetaker
--
-- Adds infrastructure for the branded "HeyWren Notetaker" meeting bot.
-- Uses Recall.ai to join meetings with 3+ attendees, record, and transcribe.
-- Also adds meeting summary generation to existing transcript pipeline.

-- ── Bot sessions table: tracks each Recall.ai bot dispatch ──

CREATE TABLE IF NOT EXISTS recall_bot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Recall.ai identifiers
  recall_bot_id TEXT NOT NULL UNIQUE,
  recall_status TEXT DEFAULT 'pending' CHECK (recall_status IN (
    'pending', 'joining', 'in_meeting', 'recording', 'done', 'error', 'cancelled'
  )),

  -- Meeting context
  calendar_event_id TEXT,              -- From calendar sync (outlook event id, google event id)
  meeting_url TEXT NOT NULL,           -- Zoom/Meet/Teams join link
  meeting_title TEXT,
  meeting_platform TEXT CHECK (meeting_platform IN ('zoom', 'google_meet', 'teams', 'webex', 'other')),
  scheduled_start TIMESTAMP WITH TIME ZONE,
  attendee_count INTEGER DEFAULT 0,

  -- Linkage to transcript once recording completes
  transcript_id UUID REFERENCES meeting_transcripts(id) ON DELETE SET NULL,

  -- Recording metadata from Recall.ai
  recording_duration_seconds INTEGER,
  recording_url TEXT,                  -- Temporary URL to recording (7-day retention)

  -- Billing tracking
  billed_minutes NUMERIC(6,2) DEFAULT 0,
  billing_status TEXT DEFAULT 'pending' CHECK (billing_status IN ('pending', 'billed', 'free_tier', 'error')),

  -- User-initiated vs auto-scheduled
  trigger_type TEXT DEFAULT 'auto' CHECK (trigger_type IN ('auto', 'manual')),

  -- Error tracking
  error_message TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_recall_bot_sessions_team ON recall_bot_sessions(team_id);
CREATE INDEX IF NOT EXISTS idx_recall_bot_sessions_user ON recall_bot_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_recall_bot_sessions_recall_id ON recall_bot_sessions(recall_bot_id);
CREATE INDEX IF NOT EXISTS idx_recall_bot_sessions_status ON recall_bot_sessions(recall_status);
CREATE INDEX IF NOT EXISTS idx_recall_bot_sessions_calendar ON recall_bot_sessions(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_recall_bot_sessions_scheduled ON recall_bot_sessions(scheduled_start);

-- RLS
ALTER TABLE recall_bot_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view bot sessions" ON recall_bot_sessions
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = recall_bot_sessions.team_id
  AND tm.user_id = auth.uid()
));

CREATE POLICY "Team members can insert bot sessions" ON recall_bot_sessions
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = recall_bot_sessions.team_id
  AND tm.user_id = auth.uid()
));

CREATE POLICY "Team members can update bot sessions" ON recall_bot_sessions
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = recall_bot_sessions.team_id
  AND tm.user_id = auth.uid()
));

-- Trigger for updated_at
CREATE TRIGGER update_recall_bot_sessions_updated_at BEFORE UPDATE ON recall_bot_sessions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── Add summary_json to meeting_transcripts ──

ALTER TABLE meeting_transcripts
  ADD COLUMN IF NOT EXISTS summary_json JSONB;

-- Add 'recall_bot' as a valid provider
-- (provider is CHECK constrained, so we alter it)
ALTER TABLE meeting_transcripts
  DROP CONSTRAINT IF EXISTS meeting_transcripts_provider_check;

ALTER TABLE meeting_transcripts
  ADD CONSTRAINT meeting_transcripts_provider_check
  CHECK (provider IN ('zoom', 'teams', 'google_meet', 'manual', 'recall_bot'));

-- ── Notetaker settings per team ──

CREATE TABLE IF NOT EXISTS notetaker_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Feature toggle
  auto_record_enabled BOOLEAN DEFAULT TRUE,

  -- Attendee threshold (default 3 — skip 1:1s)
  min_attendees INTEGER DEFAULT 3 CHECK (min_attendees >= 2),

  -- Bot display
  bot_display_name TEXT DEFAULT 'HeyWren Notetaker',

  -- Usage tracking for billing
  meetings_recorded_this_month INTEGER DEFAULT 0,
  billing_cycle_start DATE DEFAULT CURRENT_DATE,

  -- Subscription tier
  notetaker_plan TEXT DEFAULT 'free' CHECK (notetaker_plan IN ('free', 'per_meeting', 'unlimited')),
  free_meetings_limit INTEGER DEFAULT 2,
  per_meeting_price_cents INTEGER DEFAULT 150,  -- $1.50

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RLS
ALTER TABLE notetaker_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view notetaker settings" ON notetaker_settings
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = notetaker_settings.team_id
  AND tm.user_id = auth.uid()
));

CREATE POLICY "Team admins can manage notetaker settings" ON notetaker_settings
FOR ALL
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = notetaker_settings.team_id
  AND tm.user_id = auth.uid()
  AND tm.role IN ('owner', 'admin')
));

CREATE TRIGGER update_notetaker_settings_updated_at BEFORE UPDATE ON notetaker_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
