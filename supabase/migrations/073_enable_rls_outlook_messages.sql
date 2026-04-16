-- Migration 073: Enable RLS on outlook_messages
--
-- SECURITY FIX: The outlook_messages table was created outside of version-
-- controlled migrations (no CREATE TABLE statement exists in the migration
-- files). It stores sensitive email data (from_name, from_email, subject,
-- body_preview, to_recipients) but has NO Row Level Security enabled.
-- Without RLS, anyone with the anon key can read/write/delete every email.
--
-- All production writes go through SUPABASE_SERVICE_ROLE_KEY (Inngest sync
-- functions, admin routes), which bypasses RLS. We enable RLS and add a
-- SELECT policy for authenticated users to read their own messages, with a
-- backwards-compat clause for pre-migration-028 rows where user_id IS NULL.

ALTER TABLE outlook_messages ENABLE ROW LEVEL SECURITY;

-- Users can read their own messages. Pre-028 rows (user_id IS NULL) are
-- accessible via team membership as a fallback until backfilled.
CREATE POLICY "Users can view their own messages"
  ON outlook_messages FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.team_id = outlook_messages.team_id
        AND tm.user_id = auth.uid()
      )
    )
  );

-- No INSERT/UPDATE/DELETE policies — all writes go through service-role.
