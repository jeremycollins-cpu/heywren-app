-- Migration 013: Ensure team association consistency
--
-- Problem: Users can end up in profiles with current_team_id = NULL and no
-- team_members row, preventing them from connecting integrations or seeing data.
-- This happened due to multiple team-resolution code paths with inconsistent behavior.
--
-- Fix:
-- 1. Backfill domain on teams that are missing it (so domain matching works)
-- 2. Fix orphaned profiles that have team_members but no current_team_id
-- 3. Add a check constraint concept via a repair function

-- ── 1. Backfill teams.domain from owner's email ──
-- Teams created by fallback paths (OAuth callbacks, onboarding) often had NULL domain.
-- This prevents future domain matching for teammates.
UPDATE teams t
SET domain = split_part(p.email, '@', 2)
FROM profiles p
WHERE t.owner_id = p.id
  AND t.domain IS NULL
  AND p.email IS NOT NULL
  AND p.email LIKE '%@%.%'
  AND split_part(p.email, '@', 2) NOT IN (
    'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com',
    'outlook.com', 'live.com', 'aol.com', 'icloud.com',
    'protonmail.com', 'proton.me', 'zoho.com', 'mail.com',
    'gmx.com', 'fastmail.com', 'hey.com', 'pm.me',
    'msn.com', 'me.com', 'mac.com', 'yahoo.co.uk',
    'yandex.com', 'tutanota.com'
  );

-- ── 2. Fix orphaned profiles: have team_members row but NULL current_team_id ──
UPDATE profiles p
SET current_team_id = tm.team_id
FROM team_members tm
WHERE p.id = tm.user_id
  AND p.current_team_id IS NULL;

-- ── 3. Fix reverse: have current_team_id but missing team_members row ──
INSERT INTO team_members (team_id, user_id, role)
SELECT p.current_team_id, p.id, 'member'
FROM profiles p
WHERE p.current_team_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.user_id = p.id AND tm.team_id = p.current_team_id
  )
ON CONFLICT (team_id, user_id) DO NOTHING;

-- ── 4. Auto-join: profiles with corporate email whose domain matches a team ──
-- These are users who signed up but never got associated with their company's team
WITH orphaned AS (
  SELECT p.id as user_id, p.email, t.id as team_id
  FROM profiles p
  JOIN teams t ON t.domain = split_part(p.email, '@', 2)
  WHERE p.current_team_id IS NULL
    AND p.email IS NOT NULL
    AND p.email LIKE '%@%.%'
    AND split_part(p.email, '@', 2) NOT IN (
      'gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com',
      'outlook.com', 'live.com', 'aol.com', 'icloud.com',
      'protonmail.com', 'proton.me', 'zoho.com', 'mail.com'
    )
)
INSERT INTO team_members (team_id, user_id, role)
SELECT team_id, user_id, 'member'
FROM orphaned
ON CONFLICT (team_id, user_id) DO NOTHING;

-- Update their profiles too
UPDATE profiles p
SET current_team_id = t.id
FROM teams t
WHERE p.current_team_id IS NULL
  AND t.domain = split_part(p.email, '@', 2)
  AND p.email IS NOT NULL
  AND p.email LIKE '%@%.%';

-- ── 5. Set owner_id on teams that don't have one ──
UPDATE teams t
SET owner_id = (
  SELECT tm.user_id
  FROM team_members tm
  WHERE tm.team_id = t.id AND tm.role = 'owner'
  LIMIT 1
)
WHERE t.owner_id IS NULL
  AND EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = t.id AND tm.role = 'owner'
  );
