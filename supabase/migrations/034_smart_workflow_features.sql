-- =============================================================================
-- Migration 034: Smart workflow features
-- CC/FYI detection, delegation tracking, response patterns, recurring commitments
-- =============================================================================

-- 1. Add cc_recipients to outlook_messages for TO vs CC distinction
ALTER TABLE outlook_messages
  ADD COLUMN IF NOT EXISTS cc_recipients TEXT;

-- 2. Add resolution_type to missed_emails and awaiting_replies for tracking HOW items were resolved
-- Values: 'email_reply', 'phone_call', 'in_person', 'delegated', 'auto_meeting', null (legacy/default)
ALTER TABLE missed_emails
  ADD COLUMN IF NOT EXISTS resolution_type TEXT;

ALTER TABLE awaiting_replies
  ADD COLUMN IF NOT EXISTS resolution_type TEXT;

-- 3. Add delegated_to for tracking who work was forwarded to
ALTER TABLE missed_emails
  ADD COLUMN IF NOT EXISTS delegated_to TEXT;

ALTER TABLE awaiting_replies
  ADD COLUMN IF NOT EXISTS delegated_to TEXT;

-- 4. Response pattern tracking per user
CREATE TABLE IF NOT EXISTS user_response_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

  -- Learned patterns (updated weekly by cron)
  avg_response_hours_critical REAL,
  avg_response_hours_high REAL,
  avg_response_hours_medium REAL,
  avg_response_hours_low REAL,
  peak_response_hours INTEGER[] DEFAULT '{}', -- hours of day when user most responds (0-23)
  typical_batch_times INTEGER[] DEFAULT '{}', -- e.g. {8, 16} for 8am and 4pm batchers

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, team_id)
);

ALTER TABLE user_response_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own patterns" ON user_response_patterns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage patterns" ON user_response_patterns FOR ALL USING (auth.role() = 'service_role');

-- 5. Recurring commitments
ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS recurrence TEXT; -- 'daily', 'weekly', 'biweekly', 'monthly', null
ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS recurrence_parent_id UUID REFERENCES commitments(id) ON DELETE SET NULL;
