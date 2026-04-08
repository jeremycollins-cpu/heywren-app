-- 050: Email threat detection — phishing and scam alerts
-- Stores AI-analyzed threat assessments for suspicious emails.
-- Only high-confidence alerts are surfaced to users to maintain trust.

CREATE TABLE IF NOT EXISTS email_threat_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Email reference
  outlook_message_id TEXT NOT NULL,   -- Microsoft Graph message ID
  from_name TEXT,
  from_email TEXT NOT NULL,
  subject TEXT,
  received_at TIMESTAMPTZ,

  -- Threat assessment
  threat_level TEXT NOT NULL CHECK (threat_level IN ('critical', 'high', 'medium', 'low')),
  threat_type TEXT NOT NULL CHECK (threat_type IN (
    'phishing',              -- credential/data theft attempt
    'spoofing',              -- sender impersonation
    'bec',                   -- business email compromise
    'malware_link',          -- suspicious links to malware
    'payment_fraud',         -- fake invoice / payment redirect
    'impersonation'          -- pretending to be a known contact
  )),
  confidence REAL NOT NULL,           -- 0.0 to 1.0 — only show >= 0.75

  -- Signals detected (what made it suspicious)
  signals JSONB NOT NULL DEFAULT '[]',  -- Array of { signal: string, detail: string, weight: string }
  -- e.g. [{"signal":"spf_fail","detail":"SPF authentication failed","weight":"high"},
  --        {"signal":"urgency_language","detail":"Contains 'act immediately' pressure","weight":"medium"}]

  -- Header analysis results
  spf_result TEXT,                    -- pass / fail / softfail / none
  dkim_result TEXT,                   -- pass / fail / none
  dmarc_result TEXT,                  -- pass / fail / none
  reply_to_mismatch BOOLEAN DEFAULT false,
  sender_mismatch BOOLEAN DEFAULT false,

  -- User-facing explanation
  explanation TEXT NOT NULL,          -- clear, non-technical explanation
  recommended_actions TEXT[] NOT NULL DEFAULT '{}', -- what to do
  do_not_actions TEXT[] NOT NULL DEFAULT '{}',      -- what NOT to do

  -- User response
  status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (status IN (
    'unreviewed',
    'confirmed_threat',      -- user confirmed it's a threat
    'safe',                  -- user marked as safe (false positive)
    'reported',              -- reported to IT/admin
    'dismissed'              -- user dismissed
  )),
  user_feedback TEXT,                 -- optional feedback on accuracy

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(team_id, user_id, outlook_message_id)
);

CREATE INDEX idx_email_threats_user ON email_threat_alerts(team_id, user_id, status);
CREATE INDEX idx_email_threats_date ON email_threat_alerts(user_id, created_at DESC);

-- RLS
ALTER TABLE email_threat_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own threat alerts"
  ON email_threat_alerts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own threat alerts"
  ON email_threat_alerts FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all threat alerts"
  ON email_threat_alerts FOR ALL
  USING (auth.role() = 'service_role');
