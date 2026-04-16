-- Migration 070: Fix overly permissive RLS INSERT policies + drop exec_sql
--
-- SECURITY FIX: Three INSERT policies allowed any authenticated user to write
-- rows attributed to other users:
--   - wren_mentions:           WITH CHECK (true)
--   - community_signals:       WITH CHECK (auth.uid() IS NOT NULL)
--   - community_signal_votes:  WITH CHECK (auth.uid() IS NOT NULL)
--
-- All three should enforce user_id = auth.uid().
-- Additionally removes the exec_sql RPC function which allowed arbitrary SQL execution.

-- ── 1. wren_mentions: replace the INSERT policy ────────────────────────────

DROP POLICY IF EXISTS "Service role can insert mentions" ON wren_mentions;

CREATE POLICY "Service role can insert mentions" ON wren_mentions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── 2. community_signals: replace the INSERT policy ────────────────────────

DROP POLICY IF EXISTS "Authenticated users can create signals" ON community_signals;

CREATE POLICY "Authenticated users can create signals" ON community_signals
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND team_id IN (
      SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid()
    )
  );

-- ── 3. community_signal_votes: replace the INSERT policy ───────────────────

DROP POLICY IF EXISTS "Authenticated users can vote" ON community_signal_votes;

CREATE POLICY "Authenticated users can vote" ON community_signal_votes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── 4. Drop the exec_sql RPC function (arbitrary SQL execution) ────────────

DROP FUNCTION IF EXISTS exec_sql(text);
DROP FUNCTION IF EXISTS exec_sql(sql text);
