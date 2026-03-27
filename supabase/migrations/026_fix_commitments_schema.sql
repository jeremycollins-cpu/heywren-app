-- 026: Fix commitments table schema to match application code
-- The codebase uses 'open' status, 'source_ref' column, and 'calendar' source
-- but the original migration (001) used enums without these values.

-- 1. Add source_ref column (TEXT — stores slack_messages.id or outlook_messages.id)
ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- 2. Add 'open' to the commitment_status enum
ALTER TYPE commitment_status ADD VALUE IF NOT EXISTS 'open';

-- 3. Add 'calendar' to the commitment_source enum
ALTER TYPE commitment_source ADD VALUE IF NOT EXISTS 'calendar';

-- 4. Index on source_ref for lookups
CREATE INDEX IF NOT EXISTS idx_commitments_source_ref ON commitments (source_ref);

-- 5. Migrate any existing source_message_id data to source_ref (if applicable)
UPDATE commitments
  SET source_ref = source_message_id::text
  WHERE source_ref IS NULL AND source_message_id IS NOT NULL;

COMMENT ON COLUMN commitments.source_ref IS 'Reference to source message ID (slack_messages.id, outlook_messages.id, or calendar event ID)';
