-- Auto-create a default team for each department that has members but no teams,
-- and reassign members whose team_id doesn't match their department.
--
-- Problem: when members were moved to new departments via Team Management,
-- their department_id was updated but team_id still pointed to the original
-- "Routeware" team under General. This creates a mismatch where the department
-- shows members but the team tree can't display them.
--
-- Fix: for each department, create a team with the same name if one doesn't
-- exist, then update members in that department to point to its team.

-- Step 1: Create default teams for departments that don't have any
INSERT INTO teams (name, slug, organization_id, department_id, owner_id)
SELECT
  d.name,
  d.slug || '-team-' || substr(md5(random()::text), 1, 8),
  d.organization_id,
  d.id,
  d.head_user_id
FROM departments d
LEFT JOIN teams t ON t.department_id = d.id
WHERE t.id IS NULL
  AND d.organization_id IS NOT NULL
GROUP BY d.id;

-- Step 2: For each member, set their team_id to a team in their department
-- (only if their current team is in a DIFFERENT department)
UPDATE organization_members om
SET team_id = (
  SELECT t.id FROM teams t
  WHERE t.department_id = om.department_id
  ORDER BY t.created_at ASC
  LIMIT 1
)
WHERE om.department_id IS NOT NULL
AND (
  om.team_id IS NULL
  OR om.team_id NOT IN (
    SELECT t2.id FROM teams t2 WHERE t2.department_id = om.department_id
  )
);

-- Step 3: Also update profiles.current_team_id to match
UPDATE profiles p
SET current_team_id = om.team_id
FROM organization_members om
WHERE om.user_id = p.id
  AND om.team_id IS NOT NULL
  AND (p.current_team_id IS NULL OR p.current_team_id != om.team_id);

-- Step 4: Also sync team_members table (legacy)
INSERT INTO team_members (team_id, user_id, role)
SELECT om.team_id, om.user_id,
  CASE WHEN om.role = 'org_admin' THEN 'owner'
       WHEN om.role = 'dept_manager' THEN 'admin'
       ELSE 'member' END
FROM organization_members om
WHERE om.team_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = om.team_id AND tm.user_id = om.user_id
  );
