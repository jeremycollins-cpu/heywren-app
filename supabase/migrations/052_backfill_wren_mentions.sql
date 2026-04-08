-- Backfill wren_mentions from existing Slack @HeyWren mentions and meeting "Hey Wren" triggers.
-- This populates the Wren Mentions page with historical data.

-- 1. Slack @HeyWren mentions — one row per unique slack message that generated commitments
INSERT INTO wren_mentions (team_id, user_id, channel, source_title, source_snippet, source_ref, source_url, commitments_extracted, created_at)
SELECT
  c.team_id,
  c.creator_id,
  'slack',
  'Slack mention',
  LEFT(c.description, 300),
  c.source_ref,
  c.source_url,
  (SELECT COUNT(*) FROM commitments c2 WHERE c2.source_ref = c.source_ref AND c2.source = 'slack'),
  c.created_at
FROM commitments c
WHERE c.source = 'slack'
  AND c.creator_id IS NOT NULL
  AND c.source_ref IS NOT NULL
  AND c.id = (
    SELECT c3.id FROM commitments c3
    WHERE c3.source_ref = c.source_ref AND c3.source = 'slack'
    ORDER BY c3.created_at ASC
    LIMIT 1
  )
ON CONFLICT DO NOTHING;

-- 2. Meeting "Hey Wren" triggers — one row per transcript that had triggers
INSERT INTO wren_mentions (team_id, user_id, channel, source_title, source_snippet, source_ref, commitments_extracted, created_at)
SELECT
  c.team_id,
  c.creator_id,
  'meeting',
  COALESCE(c.metadata->>'meetingTitle', 'Meeting transcript'),
  LEFT(c.metadata->>'originalQuote', 300),
  c.source_ref,
  (SELECT COUNT(*) FROM commitments c2 WHERE c2.source_ref = c.source_ref AND c2.source = 'recording' AND c2.metadata->>'heyWrenTrigger' = 'true'),
  c.created_at
FROM commitments c
WHERE c.source = 'recording'
  AND c.metadata->>'heyWrenTrigger' = 'true'
  AND c.creator_id IS NOT NULL
  AND c.source_ref IS NOT NULL
  AND c.id = (
    SELECT c3.id FROM commitments c3
    WHERE c3.source_ref = c.source_ref AND c3.source = 'recording' AND c3.metadata->>'heyWrenTrigger' = 'true'
    ORDER BY c3.created_at ASC
    LIMIT 1
  )
ON CONFLICT DO NOTHING;
