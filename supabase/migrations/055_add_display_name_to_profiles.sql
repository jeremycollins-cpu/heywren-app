-- Add display_name column to profiles if it doesn't already exist.
-- Production already has display_name (renamed from full_name).
-- This migration is a safe no-op for production but ensures new
-- environments have the column.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
