-- Backfill wren_mentions from existing data

-- Slack mentions
INSERT INTO wren_mentions (team_id, user_id, channel, source_title, source_snippet, source_ref, source_url, commitments_extracted, created_at)
SELECT DISTINCT ON (source_ref)
  team_id,
  creator_id,
  'slack',
  'Slack mention',
  LEFT(description, 300),
  source_ref,
  source_url,
  0,
  created_at
FROM commitments
WHERE source = 'slack'
  AND creator_id IS NOT NULL
  AND source_ref IS NOT NULL
ORDER BY source_ref, created_at ASC
ON CONFLICT DO NOTHING;

-- Meeting Hey Wren triggers
INSERT INTO wren_mentions (team_id, user_id, channel, source_title, source_snippet, source_ref, commitments_extracted, created_at)
SELECT DISTINCT ON (source_ref)
  team_id,
  creator_id,
  'meeting',
  COALESCE(metadata->>'meetingTitle', 'Meeting transcript'),
  LEFT(metadata->>'originalQuote', 300),
  source_ref,
  0,
  created_at
FROM commitments
WHERE source = 'recording'
  AND metadata->>'heyWrenTrigger' = 'true'
  AND creator_id IS NOT NULL
  AND source_ref IS NOT NULL
ORDER BY source_ref, created_at ASC
ON CONFLICT DO NOTHING;
