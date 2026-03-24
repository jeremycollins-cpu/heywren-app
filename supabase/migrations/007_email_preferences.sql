-- Email preferences: VIP contacts, blocked senders, and missed email settings
-- Feedback table: trains the AI classifier over time

-- User preferences for missed email scanning
CREATE TABLE IF NOT EXISTS email_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- VIP contacts: always surface these (JSON array of {name, email} or {domain})
  vip_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Blocked senders: always filter these out (JSON array of {email} or {domain})
  blocked_senders JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Minimum urgency to show: 'critical', 'high', 'medium', 'low'
  min_urgency TEXT NOT NULL DEFAULT 'low' CHECK (min_urgency IN ('critical', 'high', 'medium', 'low')),

  -- How far back to scan (in days)
  scan_window_days INTEGER NOT NULL DEFAULT 7 CHECK (scan_window_days >= 1 AND scan_window_days <= 30),

  -- Which categories to show (JSON array of category strings)
  enabled_categories JSONB NOT NULL DEFAULT '["question","request","decision","follow_up","introduction"]'::jsonb,

  -- Auto-dismiss emails older than N days (0 = never auto-dismiss)
  auto_dismiss_days INTEGER NOT NULL DEFAULT 0 CHECK (auto_dismiss_days >= 0 AND auto_dismiss_days <= 90),

  -- Whether to include the missed emails section in daily digest email
  include_in_digest BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(team_id, user_id)
);

-- Feedback on missed email classifications — improves AI over time
CREATE TABLE IF NOT EXISTS missed_email_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  missed_email_id UUID REFERENCES missed_emails(id) ON DELETE SET NULL,

  -- The sender info (denormalized for pattern learning)
  from_email TEXT NOT NULL,
  from_domain TEXT NOT NULL,  -- extracted from email for domain-level learning

  -- Feedback
  feedback TEXT NOT NULL CHECK (feedback IN ('valid', 'invalid')),
  -- Why was it invalid? Optional user-provided reason
  reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_email_preferences_user ON email_preferences(user_id);
CREATE INDEX idx_email_preferences_team ON email_preferences(team_id);
CREATE INDEX idx_missed_email_feedback_team ON missed_email_feedback(team_id, from_domain);
CREATE INDEX idx_missed_email_feedback_email ON missed_email_feedback(from_email, feedback);

-- Auto-update
CREATE TRIGGER set_email_preferences_updated_at
  BEFORE UPDATE ON email_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE missed_email_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own email preferences"
  ON email_preferences FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own feedback"
  ON missed_email_feedback FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all email preferences"
  ON email_preferences FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role can manage all feedback"
  ON missed_email_feedback FOR ALL
  USING (auth.role() = 'service_role');
