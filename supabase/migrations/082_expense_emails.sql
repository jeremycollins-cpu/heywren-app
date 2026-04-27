-- Expense emails: surfaces receipts, invoices, and order confirmations from
-- the user's inbox so they can be downloaded and grouped by vendor for
-- expense reporting. Source emails live in outlook_messages; this table
-- stores the classification + extracted vendor/amount fields.

CREATE TABLE IF NOT EXISTS expense_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  outlook_message_id UUID REFERENCES outlook_messages(id) ON DELETE SET NULL,
  message_id TEXT NOT NULL,            -- Microsoft Graph message ID (used for fetching attachments live)

  -- Sender (denormalized so we can show vendor info even if the source
  -- outlook_messages row is purged for retention)
  from_name TEXT,
  from_email TEXT NOT NULL,
  subject TEXT,
  body_preview TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  web_link TEXT,                       -- Outlook deeplink for "View in Outlook"

  -- Extracted / classified fields
  vendor TEXT NOT NULL,                -- Display vendor name (e.g. "Uber", "AWS")
  vendor_domain TEXT NOT NULL,         -- Sender domain, used as the canonical group key
  amount NUMERIC(12, 2),               -- Total charged (NULL if not extractable)
  currency TEXT,                       -- ISO 4217 code (USD, EUR, GBP, ...)
  receipt_date DATE,                   -- Transaction date if different from received_at
  category TEXT NOT NULL DEFAULT 'receipt'
    CHECK (category IN ('receipt', 'invoice', 'order_confirmation', 'subscription', 'other')),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),

  -- Attachment metadata (resolved live from Graph on first download)
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_count INTEGER NOT NULL DEFAULT 0,

  -- User actions
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewed', 'exported', 'dismissed')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(team_id, message_id)
);

CREATE INDEX idx_expense_emails_team_user ON expense_emails(team_id, user_id);
CREATE INDEX idx_expense_emails_user_status ON expense_emails(user_id, status);
CREATE INDEX idx_expense_emails_vendor_domain ON expense_emails(team_id, user_id, vendor_domain);
CREATE INDEX idx_expense_emails_received ON expense_emails(received_at DESC);

CREATE TRIGGER set_expense_emails_updated_at
  BEFORE UPDATE ON expense_emails
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE expense_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own expense emails"
  ON expense_emails FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own expense emails"
  ON expense_emails FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all expense emails"
  ON expense_emails FOR ALL
  USING (auth.role() = 'service_role');

-- Track which outlook_messages have been classified for expense detection,
-- so the scanner doesn't re-process the same emails. Reuses the existing
-- `processed` column pattern but with a dedicated flag so the column doesn't
-- collide with commitment-detection processing.
ALTER TABLE outlook_messages
  ADD COLUMN IF NOT EXISTS expense_scanned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_outlook_messages_expense_unscanned
  ON outlook_messages(team_id, user_id, expense_scanned)
  WHERE expense_scanned = FALSE;
