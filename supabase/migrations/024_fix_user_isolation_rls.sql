-- SECURITY FIX: Tighten RLS policies to enforce user-level isolation
-- Previously, all policies only checked team membership (team_id),
-- allowing any team member to read/update any other member's data.

-- ── Commitments: only creator or assignee can see/update ──
DROP POLICY IF EXISTS "Users can view commitments in their teams" ON commitments;
CREATE POLICY "Users can view their own commitments"
  ON commitments FOR SELECT
  USING (creator_id = auth.uid() OR assignee_id = auth.uid());

DROP POLICY IF EXISTS "Users can update commitments in their teams" ON commitments;
CREATE POLICY "Users can update their own commitments"
  ON commitments FOR UPDATE
  USING (creator_id = auth.uid() OR assignee_id = auth.uid());

-- ── Missed emails: only the owning user ──
DROP POLICY IF EXISTS "Users can view missed emails for their team" ON missed_emails;
CREATE POLICY "Users can view their own missed emails"
  ON missed_emails FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update missed emails for their team" ON missed_emails;
CREATE POLICY "Users can update their own missed emails"
  ON missed_emails FOR UPDATE
  USING (user_id = auth.uid());

-- ── Awaiting replies: only the owning user ──
DROP POLICY IF EXISTS "Team members can view awaiting replies" ON awaiting_replies;
CREATE POLICY "Users can view their own awaiting replies"
  ON awaiting_replies FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Team members can update awaiting replies" ON awaiting_replies;
CREATE POLICY "Users can update their own awaiting replies"
  ON awaiting_replies FOR UPDATE
  USING (user_id = auth.uid());

-- ── Missed chats: only the owning user ──
DROP POLICY IF EXISTS "Users can view missed chats for their team" ON missed_chats;
CREATE POLICY "Users can view their own missed chats"
  ON missed_chats FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update missed chats for their team" ON missed_chats;
CREATE POLICY "Users can update their own missed chats"
  ON missed_chats FOR UPDATE
  USING (user_id = auth.uid());
