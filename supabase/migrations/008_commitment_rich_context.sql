-- 008: Add rich context fields to commitments
-- metadata: JSONB for extensible context (urgency, tone, stakeholders, originalQuote, commitmentType)
-- source_url: Direct link back to the original Slack message or Outlook email

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

-- Index for querying by urgency or commitment type within metadata
CREATE INDEX IF NOT EXISTS idx_commitments_metadata_gin ON commitments USING gin (metadata);

COMMENT ON COLUMN commitments.metadata IS 'Rich context: urgency, tone, commitmentType, stakeholders, originalQuote, channelName';
COMMENT ON COLUMN commitments.source_url IS 'Deep link to original Slack message or Outlook email';
