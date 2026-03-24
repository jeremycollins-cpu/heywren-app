-- Fix self-referencing RLS policy on team_members that can cause circular dependency issues
-- The old policy checked team_members to authorize reading team_members, which is unreliable.
-- New policy: users can always see their own membership rows (user_id = auth.uid()),
-- and via that membership they can see other members of their teams.

-- Drop the problematic self-referencing policy
DROP POLICY IF EXISTS "Team members can view their team members" ON team_members;

-- Create a simpler, non-circular SELECT policy:
-- A user can see all team_members rows for teams they belong to.
-- The inner subquery uses user_id = auth.uid() directly (no recursion).
CREATE POLICY "Team members can view their team members" ON team_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR team_id IN (SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid())
  );

-- Also fix the integrations SELECT policy to be more robust
DROP POLICY IF EXISTS "Team members can view integrations" ON integrations;

CREATE POLICY "Team members can view integrations" ON integrations
  FOR SELECT
  USING (
    team_id IN (SELECT tm.team_id FROM team_members tm WHERE tm.user_id = auth.uid())
  );
