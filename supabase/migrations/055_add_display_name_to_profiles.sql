-- Add display_name column to profiles.
-- Many API routes reference display_name, but migration 001 only created full_name.
-- This adds display_name and backfills it from full_name for existing rows.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill: copy full_name into display_name where display_name is null
UPDATE profiles SET display_name = full_name WHERE display_name IS NULL AND full_name IS NOT NULL;
