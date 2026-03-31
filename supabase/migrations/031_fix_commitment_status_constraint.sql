-- =============================================================================
-- Migration 031: Fix commitment status CHECK constraint
-- The original CHECK constraint (migration 001) only allows:
--   pending, in_progress, completed, overdue, cancelled
-- But the application also uses: open, likely_complete, dropped
-- Migration 026 tried ALTER TYPE but the column uses TEXT + CHECK, not an enum.
-- =============================================================================

-- Drop the old CHECK constraint and replace with one that includes all valid statuses
ALTER TABLE commitments
  DROP CONSTRAINT IF EXISTS commitments_status_check;

ALTER TABLE commitments
  ADD CONSTRAINT commitments_status_check
  CHECK (status IN ('pending', 'open', 'in_progress', 'completed', 'likely_complete', 'overdue', 'cancelled', 'dropped'));
