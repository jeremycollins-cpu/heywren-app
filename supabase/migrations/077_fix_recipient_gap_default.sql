-- Fix recipient_gap being silently filtered out for users with an email_preferences row.
--
-- Migration 053 added 'recipient_gap' as a valid classifier category, but migration 007's
-- default for email_preferences.enabled_categories was never updated to include it.
-- As a result, any user who had a row in email_preferences (created on first settings
-- save or via onboarding) had recipient_gap silently dropped by the classifier filter
-- in lib/ai/classify-missed-email.ts. Only users with NO preferences row fell through
-- to the hardcoded TS fallback that includes recipient_gap — which is why only one user
-- in the field was seeing recipient_gap_alert emails.
--
-- This migration:
-- 1. Updates the column default so newly inserted rows include recipient_gap.
-- 2. Backfills existing rows that are missing recipient_gap in their enabled_categories.

-- 1. Update the default
ALTER TABLE email_preferences
  ALTER COLUMN enabled_categories
  SET DEFAULT '["question","request","decision","follow_up","introduction","recipient_gap"]'::jsonb;

-- 2. Backfill existing rows
UPDATE email_preferences
SET enabled_categories = enabled_categories || '["recipient_gap"]'::jsonb,
    updated_at = NOW()
WHERE NOT (enabled_categories ? 'recipient_gap');
