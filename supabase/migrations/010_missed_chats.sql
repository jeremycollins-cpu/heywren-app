-- Missed chats: surfaces Slack messages where the user was tagged/mentioned but never responded to the thread
-- Mirrors the missed_emails pattern but for chat messages

CREATE TABLE IF NOT EXISTS missed_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slack_message_id UUID REFERENCES slack_messages(id) ON DELETE SET NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  sender_user_id TEXT NOT NULL,             -- Slack user ID of the person who tagged you
  sender_name TEXT,
  message_text TEXT NOT NULL,
  message_ts TEXT NOT NULL,                 -- Slack timestamp (unique message ID)
  thread_ts TEXT,                           -- Thread parent timestamp (if in a thread)
  permalink TEXT,                           -- Slack permalink to the message
  sent_at TIMESTAMPTZ NOT NULL,

  -- Classification
  urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  reason TEXT,                              -- Why this needs attention (e.g. "Direct question about deployment timeline")
  question_summary TEXT,                    -- The specific question or ask extracted
  category TEXT NOT NULL DEFAULT 'question' CHECK (category IN ('question', 'request', 'decision', 'follow_up', 'fyi')),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),

  -- User actions
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'snoozed', 'replied', 'dismissed')),
  snoozed_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(team_id, message_ts)
);

-- Indexes for common queries
CREATE INDEX idx_missed_chats_team_status ON missed_chats(team_id, status);
CREATE INDEX idx_missed_chats_team_urgency ON missed_chats(team_id, urgency);
CREATE INDEX idx_missed_chats_sent ON missed_chats(sent_at DESC);
CREATE INDEX idx_missed_chats_user ON missed_chats(user_id, status);

-- Auto-update updated_at
CREATE TRIGGER set_missed_chats_updated_at
  BEFORE UPDATE ON missed_chats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE missed_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view missed chats for their team"
  ON missed_chats FOR SELECT
  USING (
    team_id IN (
      SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update missed chats for their team"
  ON missed_chats FOR UPDATE
  USING (
    team_id IN (
      SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage all missed chats"
  ON missed_chats FOR ALL
  USING (auth.role() = 'service_role');
