-- Migration 014: Awaiting Replies
--
-- Tracks messages the user SENT that haven't received a response.
-- The reverse of missed_emails (which tracks incoming messages the user missed).
-- Sources: Outlook sent mail, Slack messages the user posted.

CREATE TABLE IF NOT EXISTS awaiting_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source reference
  source TEXT NOT NULL CHECK (source IN ('outlook', 'slack')),
  source_message_id TEXT,          -- Microsoft Graph message ID or Slack message_ts
  conversation_id TEXT,            -- Thread/conversation grouping
  permalink TEXT,                  -- Deep link to original message

  -- Message details
  to_recipients TEXT NOT NULL,     -- Who we're waiting on
  to_name TEXT,                    -- Primary recipient display name
  subject TEXT,
  body_preview TEXT,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Channel context (Slack)
  channel_id TEXT,
  channel_name TEXT,

  -- Classification
  urgency TEXT DEFAULT 'medium' CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  category TEXT DEFAULT 'follow_up' CHECK (category IN ('question', 'request', 'decision', 'follow_up', 'introduction', 'deliverable')),
  wait_reason TEXT,                -- AI-generated: "Asked for budget approval", "Requested meeting time"
  days_waiting INTEGER DEFAULT 0,

  -- Status tracking
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'replied', 'dismissed', 'snoozed')),
  snoozed_until TIMESTAMP WITH TIME ZONE,
  replied_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(team_id, source_message_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_awaiting_replies_team_id ON awaiting_replies(team_id);
CREATE INDEX IF NOT EXISTS idx_awaiting_replies_user_id ON awaiting_replies(user_id);
CREATE INDEX IF NOT EXISTS idx_awaiting_replies_status ON awaiting_replies(status);
CREATE INDEX IF NOT EXISTS idx_awaiting_replies_sent_at ON awaiting_replies(sent_at);
CREATE INDEX IF NOT EXISTS idx_awaiting_replies_conversation_id ON awaiting_replies(conversation_id);

-- RLS
ALTER TABLE awaiting_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view awaiting replies" ON awaiting_replies
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = awaiting_replies.team_id
  AND tm.user_id = auth.uid()
));

CREATE POLICY "Team members can update awaiting replies" ON awaiting_replies
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = awaiting_replies.team_id
  AND tm.user_id = auth.uid()
));

-- Trigger for updated_at
CREATE TRIGGER update_awaiting_replies_updated_at BEFORE UPDATE ON awaiting_replies
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
