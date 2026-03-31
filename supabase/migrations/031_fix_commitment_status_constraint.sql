-- =============================================================================
-- Migration 031: Add missing values to commitment_status enum
-- The application uses 'likely_complete' and 'dropped' but they were never
-- added to the enum type. Migration 026 already added 'open'.
-- =============================================================================

ALTER TYPE commitment_status ADD VALUE IF NOT EXISTS 'likely_complete';
ALTER TYPE commitment_status ADD VALUE IF NOT EXISTS 'dropped';
