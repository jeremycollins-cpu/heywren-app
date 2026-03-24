-- Missed emails: surfaces emails awaiting a response that may have slipped through the cracks
-- Filters out sales, automated, and newsletter emails using AI classification

CREATE TABLE IF NOT EXISTS missed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  outlook_message_id UUID REFERENCES outlook_messages(id) ON DELETE SET NULL,
  message_id TEXT NOT NULL,           -- Microsoft Graph message ID
  from_name TEXT,
  from_email TEXT NOT NULL,
  to_recipients TEXT,
  subject TEXT,
  body_preview TEXT,
  received_at TIMESTAMPTZ NOT NULL,

  -- AI classification results
  urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  reason TEXT,                         -- Why this email needs attention (e.g. "Direct question about Q3 budget")
  question_summary TEXT,               -- The specific question or ask extracted from the email
  category TEXT NOT NULL DEFAULT 'question' CHECK (category IN ('question', 'request', 'decision', 'follow_up', 'introduction')),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),

  -- User actions
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'snoozed', 'replied', 'dismissed')),
  snoozed_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(team_id, message_id)
);

-- Indexes for common queries
CREATE INDEX idx_missed_emails_team_status ON missed_emails(team_id, status);
CREATE INDEX idx_missed_emails_team_urgency ON missed_emails(team_id, urgency);
CREATE INDEX idx_missed_emails_received ON missed_emails(received_at DESC);
CREATE INDEX idx_missed_emails_user ON missed_emails(user_id, status);

-- Auto-update updated_at
CREATE TRIGGER set_missed_emails_updated_at
  BEFORE UPDATE ON missed_emails
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE missed_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view missed emails for their team"
  ON missed_emails FOR SELECT
  USING (
    team_id IN (
      SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update missed emails for their team"
  ON missed_emails FOR UPDATE
  USING (
    team_id IN (
      SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can manage all missed emails"
  ON missed_emails FOR ALL
  USING (auth.role() = 'service_role');
