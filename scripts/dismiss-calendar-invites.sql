-- Run this in Supabase SQL Editor to dismiss calendar invite items from the waiting room
-- Step 1: Preview what will be dismissed
SELECT id, subject, LEFT(body_preview, 100) as body_snippet
FROM awaiting_replies
WHERE status IN ('waiting', 'snoozed')
  AND (
    subject ~* '^(Accepted|Declined|Tentative|Cancell?ed):'
    OR subject ILIKE '%out of office%'
    OR subject ILIKE '%automatic reply%'
    OR body_preview ILIKE '%join the meeting now%'
    OR body_preview ILIKE '%microsoft teams meeting%'
    OR body_preview ILIKE '%join zoom meeting%'
    OR body_preview ILIKE '%zoom.us/j/%'
    OR body_preview ILIKE '%you updated the meeting%'
    OR body_preview ILIKE '%meeting id:%'
    OR body_preview ILIKE '%dial-in number%'
    OR (
      (
        subject ~* '\msync\M'
        OR subject ~* '\mstandup\M'
        OR subject ~* '\mweekly\M'
        OR subject ~* '\mdaily\M'
        OR subject ~* '\mmonthly\M'
        OR subject ~* '\mbiweekly\M'
        OR subject ~* '\mcheck.in\M'
        OR subject ~* '\mcatch.up\M'
        OR subject ~* '\mhuddle\M'
        OR subject ~* '\mretro\M'
        OR subject ~* '\mkickoff\M'
        OR subject ~* '\mplanning\M'
        OR subject ~* '\mreview\M'
        OR subject LIKE '%/%Sync%'
        OR subject LIKE '%/%Update%'
      )
      AND (
        body_preview ILIKE '%when:%'
        OR body_preview ILIKE '%passcode:%'
        OR body_preview ILIKE '%join%'
        OR body_preview ILIKE '%you have been invited%'
      )
    )
  );

-- Step 2: If the preview looks correct, run the UPDATE below
-- UPDATE awaiting_replies
-- SET status = 'dismissed'
-- WHERE status IN ('waiting', 'snoozed')
--   AND (
--     subject ~* '^(Accepted|Declined|Tentative|Cancell?ed):'
--     OR subject ILIKE '%out of office%'
--     OR subject ILIKE '%automatic reply%'
--     OR body_preview ILIKE '%join the meeting now%'
--     OR body_preview ILIKE '%microsoft teams meeting%'
--     OR body_preview ILIKE '%join zoom meeting%'
--     OR body_preview ILIKE '%zoom.us/j/%'
--     OR body_preview ILIKE '%you updated the meeting%'
--     OR body_preview ILIKE '%meeting id:%'
--     OR body_preview ILIKE '%dial-in number%'
--     OR (
--       (
--         subject ~* '\msync\M'
--         OR subject ~* '\mstandup\M'
--         OR subject ~* '\mweekly\M'
--         OR subject ~* '\mdaily\M'
--         OR subject ~* '\mmonthly\M'
--         OR subject ~* '\mbiweekly\M'
--         OR subject ~* '\mcheck.in\M'
--         OR subject ~* '\mcatch.up\M'
--         OR subject ~* '\mhuddle\M'
--         OR subject ~* '\mretro\M'
--         OR subject ~* '\mkickoff\M'
--         OR subject ~* '\mplanning\M'
--         OR subject ~* '\mreview\M'
--         OR subject LIKE '%/%Sync%'
--         OR subject LIKE '%/%Update%'
--       )
--       AND (
--         body_preview ILIKE '%when:%'
--         OR body_preview ILIKE '%passcode:%'
--         OR body_preview ILIKE '%join%'
--         OR body_preview ILIKE '%you have been invited%'
--       )
--     )
--   );
