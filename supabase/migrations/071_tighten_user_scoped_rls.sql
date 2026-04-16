-- Migration 071: Tighten user-scoped RLS policies
--
-- SECURITY FIX: Several SELECT policies use an overly broad OR clause that
-- lets any team member read every other member's personal data:
--
--   email_subscriptions  (migration 045) — SELECT has OR team_id IN (...)
--   email_folders         (migration 047) — SELECT has OR team_id IN (...)
--   email_rules           (migration 047) — SELECT has OR team_id IN (...)
--
-- These tables store per-user email configuration and should never be
-- visible to teammates. The OR clause is removed; only user_id = auth.uid()
-- is retained.
--
-- Additionally, outlook_calendar_events (migration 004) has a team-scoped
-- SELECT policy that should be user-scoped. Migration 024 fixed user
-- isolation for other tables but missed this one. Migration 028 added
-- a user_id column. We now scope reads to the owning user, with a
-- backwards-compatibility clause for pre-028 rows where user_id IS NULL
-- (those remain visible to team members).
--
-- Finally, the commitments INSERT policy (migration 001) only checks team
-- membership, allowing any team member to insert a commitment with an
-- arbitrary creator_id/assignee_id. Tighten it to also require
-- creator_id = auth.uid().


-- ── 1. email_subscriptions: restrict SELECT to owning user only ───────────
-- Previously allowed: user_id = auth.uid() OR team_id IN (SELECT ...)
-- Now: user_id = auth.uid() only

DROP POLICY IF EXISTS "Users can view their own subscriptions" ON email_subscriptions;

CREATE POLICY "Users can view their own subscriptions"
  ON email_subscriptions FOR SELECT
  USING (user_id = auth.uid());


-- ── 2. email_folders: restrict SELECT to owning user only ─────────────────
-- Previously allowed: user_id = auth.uid() OR team_id IN (SELECT ...)
-- Now: user_id = auth.uid() only

DROP POLICY IF EXISTS "Users can view their own folders" ON email_folders;

CREATE POLICY "Users can view their own folders"
  ON email_folders FOR SELECT
  USING (user_id = auth.uid());


-- ── 3. email_rules: restrict SELECT to owning user only ──────────────────
-- Previously allowed: user_id = auth.uid() OR team_id IN (SELECT ...)
-- Now: user_id = auth.uid() only

DROP POLICY IF EXISTS "Users can view their own rules" ON email_rules;

CREATE POLICY "Users can view their own rules"
  ON email_rules FOR SELECT
  USING (user_id = auth.uid());


-- ── 4. outlook_calendar_events: switch from team-scoped to user-scoped ────
-- The original policy (migration 004) only checked team membership.
-- Migration 028 added user_id but the policy was never updated.
-- New policy: user can see their own events, PLUS legacy rows where
-- user_id IS NULL remain visible to team members (backward compat).

DROP POLICY IF EXISTS "Team members can view calendar events" ON outlook_calendar_events;

CREATE POLICY "Team members can view calendar events"
  ON outlook_calendar_events FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      -- Backwards compatibility: pre-migration-028 rows have NULL user_id.
      -- These remain visible to team members until backfilled.
      user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm.team_id = outlook_calendar_events.team_id
        AND tm.user_id = auth.uid()
      )
    )
  );


-- ── 5. commitments: tighten INSERT to enforce creator_id ownership ────────
-- The original policy (migration 001) only checked team membership,
-- meaning any team member could insert a commitment with someone else's
-- creator_id. Now we also require creator_id = auth.uid().

DROP POLICY IF EXISTS "Users can insert commitments in their teams" ON commitments;

CREATE POLICY "Users can insert commitments in their teams"
  ON commitments FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = commitments.team_id
      AND team_members.user_id = auth.uid()
    )
  );
