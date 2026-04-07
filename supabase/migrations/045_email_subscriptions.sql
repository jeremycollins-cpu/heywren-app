-- email_subscriptions: tracks marketing/newsletter emails with unsubscribe links
-- Surfaces emails the user can one-click unsubscribe from to clean up their inbox

CREATE TABLE IF NOT EXISTS email_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Sender info (grouped by sender email for dedup)
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  sender_domain TEXT NOT NULL,

  -- Latest email sample
  subject TEXT NOT NULL,
  body_preview TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  outlook_message_id TEXT,          -- Microsoft Graph message ID for fetching headers
  is_read BOOLEAN DEFAULT false,

  -- Unsubscribe mechanism (from List-Unsubscribe header or body detection)
  unsubscribe_url TEXT,             -- HTTP(S) unsubscribe URL
  unsubscribe_mailto TEXT,          -- mailto: unsubscribe address
  has_one_click BOOLEAN DEFAULT false, -- RFC 8058: List-Unsubscribe-Post header present
  detection_method TEXT NOT NULL DEFAULT 'header', -- 'header', 'body_link', 'sender_pattern'

  -- Frequency stats
  email_count INTEGER DEFAULT 1,    -- How many emails from this sender in scan window
  first_seen_at TIMESTAMPTZ NOT NULL,

  -- User action
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'unsubscribed', 'kept', 'failed'
  unsubscribed_at TIMESTAMPTZ,
  unsubscribe_error TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_email_subscriptions_user ON email_subscriptions(team_id, user_id, status);
CREATE INDEX idx_email_subscriptions_sender ON email_subscriptions(user_id, from_email);
CREATE UNIQUE INDEX idx_email_subscriptions_unique_sender ON email_subscriptions(user_id, from_email)
  WHERE status = 'active';

-- RLS
ALTER TABLE email_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own subscriptions"
  ON email_subscriptions FOR SELECT
  USING (
    user_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own subscriptions"
  ON email_subscriptions FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all subscriptions"
  ON email_subscriptions FOR ALL
  USING (auth.role() = 'service_role');
