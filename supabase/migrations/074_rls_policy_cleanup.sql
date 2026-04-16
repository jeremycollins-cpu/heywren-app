-- 074_rls_policy_cleanup.sql
-- Security audit: clean up dead policies, tighten overly permissive ones,
-- and add missing WITH CHECK clauses.
--
-- Addresses four findings:
--   1. Remove dead auth.role() = 'service_role' policies (17 tables)
--   2. Restrict community_signals / community_signal_votes / community_patterns
--      SELECT to authenticated users only
--   3. Drop overly broad FOR ALL policy on platform_sync_cursors
--   4. Add WITH CHECK to commitments UPDATE policy

BEGIN;

-- ============================================================================
-- 1. DROP DEAD service_role POLICIES
-- ============================================================================
-- Service-role clients bypass RLS entirely; these policies are never evaluated.
-- auth.role() is deprecated in newer Supabase versions. Removing dead code.

-- From 018_community_signals.sql
DROP POLICY IF EXISTS "Service role can manage patterns" ON community_patterns;

-- From 045_email_subscriptions.sql
DROP POLICY IF EXISTS "Service role can manage all subscriptions" ON email_subscriptions;

-- From 067_feedback_tables.sql
DROP POLICY IF EXISTS "Service role can manage all commitment feedback" ON commitment_feedback;
DROP POLICY IF EXISTS "Service role can manage all draft feedback" ON draft_feedback;

-- From 007_email_preferences.sql
DROP POLICY IF EXISTS "Service role can manage all email preferences" ON email_preferences;
DROP POLICY IF EXISTS "Service role can manage all feedback" ON missed_email_feedback;

-- From 006_missed_emails.sql
DROP POLICY IF EXISTS "Service role can manage all missed emails" ON missed_emails;

-- From 010_missed_chats.sql
DROP POLICY IF EXISTS "Service role can manage all missed chats" ON missed_chats;

-- From 044_email_engagement.sql
DROP POLICY IF EXISTS "Service role can manage all email sends" ON email_sends;
DROP POLICY IF EXISTS "Service role can manage all welcome drip state" ON welcome_drip_state;

-- From 034_smart_workflow_features.sql
DROP POLICY IF EXISTS "Service role can manage patterns" ON user_response_patterns;

-- From 033_notifications_and_commitment_category.sql
DROP POLICY IF EXISTS "Service role can manage all notifications" ON notifications;

-- From 050_email_threat_detection.sql
DROP POLICY IF EXISTS "Service role can manage all threat alerts" ON email_threat_alerts;

-- From 047_email_folders_and_rules.sql
DROP POLICY IF EXISTS "Service role can manage all folders" ON email_folders;
DROP POLICY IF EXISTS "Service role can manage all rules" ON email_rules;

-- From 049_calendar_protection.sql
DROP POLICY IF EXISTS "Service role can manage all boundaries" ON calendar_boundaries;
DROP POLICY IF EXISTS "Service role can manage all conflicts" ON calendar_conflicts;


-- ============================================================================
-- 2. RESTRICT community_signals / community_signal_votes / community_patterns
--    SELECT to authenticated users only
-- ============================================================================
-- Previously USING (true), which exposes user names, team IDs, and example
-- content to anonymous (unauthenticated) requests.

-- community_signals
DROP POLICY IF EXISTS "Anyone can view community signals" ON community_signals;
CREATE POLICY "Authenticated users can view community signals"
  ON community_signals FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- community_signal_votes
DROP POLICY IF EXISTS "Anyone can view votes" ON community_signal_votes;
CREATE POLICY "Authenticated users can view votes"
  ON community_signal_votes FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- community_patterns
DROP POLICY IF EXISTS "Anyone can view community patterns" ON community_patterns;
CREATE POLICY "Authenticated users can view community patterns"
  ON community_patterns FOR SELECT
  USING (auth.uid() IS NOT NULL);


-- ============================================================================
-- 3. RESTRICT platform_sync_cursors — drop the FOR ALL policy
-- ============================================================================
-- The FOR ALL policy lets any team member INSERT, UPDATE, and DELETE sync
-- cursors. Only service-role (which bypasses RLS) should write these.
-- Keep the SELECT-only policy so team members can still read cursor state.

DROP POLICY IF EXISTS "Team members can manage sync cursors" ON platform_sync_cursors;


-- ============================================================================
-- 4. ADD WITH CHECK to commitments UPDATE policy
-- ============================================================================
-- The existing policy has USING but no WITH CHECK, meaning a user who can
-- update a commitment could reassign it to someone else. Adding WITH CHECK
-- ensures the row still satisfies the policy after the update.

DROP POLICY IF EXISTS "Users can update their own commitments" ON commitments;
CREATE POLICY "Users can update their own commitments"
  ON commitments FOR UPDATE
  USING (creator_id = auth.uid() OR assignee_id = auth.uid())
  WITH CHECK (creator_id = auth.uid() OR assignee_id = auth.uid());

COMMIT;
