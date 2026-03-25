-- Migration 019: Add sender_email to awaiting_replies
-- Fixes user scoping: the scan stores the actual token owner's email,
-- so the API can filter by the logged-in user's email instead of relying
-- on potentially-incorrect user_id attribution.

ALTER TABLE awaiting_replies
  ADD COLUMN IF NOT EXISTS sender_email TEXT;

-- Backfill: set sender_email from the user profile for existing rows
UPDATE awaiting_replies ar
SET sender_email = p.email
FROM profiles p
WHERE ar.user_id = p.id
AND ar.sender_email IS NULL;
