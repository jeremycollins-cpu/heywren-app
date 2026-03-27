-- 026: Fix commitments table schema to match application code
-- The codebase uses 'open' status, 'source_ref' column, and 'calendar' source
-- but the original migration (001) defined different constraints and column names.

-- 1. Add source_ref column (TEXT, not UUID — stores slack_messages.id or outlook_messages.id)
ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- 2. Drop old CHECK constraint on status and replace with one that includes 'open'
ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_status_check;
ALTER TABLE commitments
  ADD CONSTRAINT commitments_status_check
  CHECK (status IN ('open', 'pending', 'in_progress', 'completed', 'overdue', 'cancelled'));

-- 3. Drop old CHECK constraint on source and replace with one that includes 'calendar'
ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_source_check;
ALTER TABLE commitments
  ADD CONSTRAINT commitments_source_check
  CHECK (source IN ('slack', 'outlook', 'calendar', 'manual', 'email'));

-- 4. Index on source_ref for lookups
CREATE INDEX IF NOT EXISTS idx_commitments_source_ref ON commitments (source_ref);

-- 5. Migrate any existing source_message_id data to source_ref (if applicable)
UPDATE commitments
  SET source_ref = source_message_id::text
  WHERE source_ref IS NULL AND source_message_id IS NOT NULL;

COMMENT ON COLUMN commitments.source_ref IS 'Reference to source message ID (slack_messages.id, outlook_messages.id, or calendar event ID)';
