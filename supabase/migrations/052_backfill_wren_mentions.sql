-- Backfill wren_mentions from existing Slack @HeyWren mentions and meeting "Hey Wren" triggers.
-- This populates the Wren Mentions page with historical data.

-- 1. Slack @HeyWren mentions — one row per unique slack message that generated commitments
INSERT INTO wren_mentions (team_id, user_id, channel, source_title, source_snippet, source_ref, source_url, commitments_extracted, created_at)
SELECT
  commit_row.team_id,
  commit_row.creator_id,
  'slack',
  'Slack mention',
  LEFT(commit_row.description, 300),
  commit_row.source_ref,
  commit_row.source_url,
  (SELECT COUNT(*) FROM commitments counter WHERE counter.source_ref = commit_row.source_ref AND counter.source = 'slack'),
  commit_row.created_at
FROM commitments commit_row
WHERE commit_row.source = 'slack'
  AND commit_row.creator_id IS NOT NULL
  AND commit_row.source_ref IS NOT NULL
  AND commit_row.id = (
    SELECT dedup.id FROM commitments dedup
    WHERE dedup.source_ref = commit_row.source_ref AND dedup.source = 'slack'
    ORDER BY dedup.created_at ASC
    LIMIT 1
  )
ON CONFLICT DO NOTHING;

-- 2. Meeting "Hey Wren" triggers — one row per transcript that had triggers
INSERT INTO wren_mentions (team_id, user_id, channel, source_title, source_snippet, source_ref, commitments_extracted, created_at)
SELECT
  commit_row.team_id,
  commit_row.creator_id,
  'meeting',
  COALESCE(commit_row.metadata->>'meetingTitle', 'Meeting transcript'),
  LEFT(commit_row.metadata->>'originalQuote', 300),
  commit_row.source_ref,
  (SELECT COUNT(*) FROM commitments counter WHERE counter.source_ref = commit_row.source_ref AND counter.source = 'recording' AND counter.metadata->>'heyWrenTrigger' = 'true'),
  commit_row.created_at
FROM commitments commit_row
WHERE commit_row.source = 'recording'
  AND commit_row.metadata->>'heyWrenTrigger' = 'true'
  AND commit_row.creator_id IS NOT NULL
  AND commit_row.source_ref IS NOT NULL
  AND commit_row.id = (
    SELECT dedup.id FROM commitments dedup
    WHERE dedup.source_ref = commit_row.source_ref AND dedup.source = 'recording' AND dedup.metadata->>'heyWrenTrigger' = 'true'
    ORDER BY dedup.created_at ASC
    LIMIT 1
  )
ON CONFLICT DO NOTHING;
