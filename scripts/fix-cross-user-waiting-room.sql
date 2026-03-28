-- Fix cross-user data leak in awaiting_replies
-- Run this in the Supabase SQL Editor after deploying the scan fix.
--
-- This script identifies and removes waiting room items where the user_id
-- doesn't match the Outlook integration owner. These items were created when
-- the Graph /me token verification failed and emails were attributed to the
-- wrong user.
--
-- Step 1: Preview affected rows (run this first to see what will be deleted)

SELECT
  ar.id,
  ar.user_id AS attributed_to,
  p1.email AS attributed_email,
  ar.to_name,
  ar.subject,
  ar.sent_at,
  ar.source,
  i.config->>'email' AS integration_owner_email
FROM awaiting_replies ar
JOIN integrations i
  ON i.team_id = ar.team_id
  AND i.user_id = ar.user_id
  AND i.provider = 'outlook'
JOIN profiles p1 ON p1.id = ar.user_id
WHERE ar.source = 'outlook'
  AND i.config->>'email' IS NOT NULL
  AND lower(i.config->>'email') != lower(p1.email);

-- Step 2: If the preview looks correct, uncomment and run the DELETE below.
-- This deletes waiting room items where the user's profile email doesn't match
-- the email stored in their Outlook integration config (meaning the integration
-- belongs to someone else's mailbox).

-- DELETE FROM awaiting_replies
-- WHERE id IN (
--   SELECT ar.id
--   FROM awaiting_replies ar
--   JOIN integrations i
--     ON i.team_id = ar.team_id
--     AND i.user_id = ar.user_id
--     AND i.provider = 'outlook'
--   JOIN profiles p1 ON p1.id = ar.user_id
--   WHERE ar.source = 'outlook'
--     AND i.config->>'email' IS NOT NULL
--     AND lower(i.config->>'email') != lower(p1.email)
-- );

-- Step 3: Alternatively, if you want to simply clear ALL waiting room items
-- and let each user re-scan fresh (safest approach), uncomment this:

-- DELETE FROM awaiting_replies WHERE status IN ('waiting', 'snoozed');

-- After cleanup, each user should visit The Waiting Room and click "Scan Now"
-- to repopulate with correctly-scoped data.
