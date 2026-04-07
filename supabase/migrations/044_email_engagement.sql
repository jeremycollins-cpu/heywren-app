-- =============================================================================
-- Migration 044: Email Engagement System
-- Adds email send tracking, email-specific preferences, and welcome drip state.
-- =============================================================================

-- Track every email sent for dedup, analytics, and deliverability monitoring
CREATE TABLE IF NOT EXISTS email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type TEXT NOT NULL,  -- 'weekly_recap', 'nudge', 'welcome_d0', 'achievement', etc.
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'bounced')),
  error TEXT,
  resend_id TEXT,            -- Resend API message ID for tracking
  idempotency_key TEXT,      -- Prevents duplicate sends
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_sends_user ON email_sends(user_id, email_type);
CREATE INDEX idx_email_sends_type_date ON email_sends(email_type, created_at DESC);
CREATE UNIQUE INDEX idx_email_sends_idempotency ON email_sends(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Add email engagement preferences to notification_preferences
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS email_weekly_recap BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_nudges BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_achievements BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_manager_briefing BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_reengagement BOOLEAN DEFAULT true;

-- Track welcome drip sequence progress per user
CREATE TABLE IF NOT EXISTS welcome_drip_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signup_at TIMESTAMPTZ NOT NULL,
  day0_sent_at TIMESTAMPTZ,
  day1_sent_at TIMESTAMPTZ,
  day3_sent_at TIMESTAMPTZ,
  day7_sent_at TIMESTAMPTZ,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_welcome_drip_pending ON welcome_drip_state(completed, signup_at)
  WHERE completed = false;

-- RLS
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE welcome_drip_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own email sends"
  ON email_sends FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all email sends"
  ON email_sends FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can view their own welcome drip state"
  ON welcome_drip_state FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all welcome drip state"
  ON welcome_drip_state FOR ALL
  USING (auth.role() = 'service_role');
