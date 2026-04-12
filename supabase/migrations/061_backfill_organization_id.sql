-- Phase 3: Backfill organization_id on all data tables.
-- Populates organization_id from team_id → teams.organization_id join.
-- Safe to run multiple times (only updates NULL rows).

-- Commitments
UPDATE commitments SET organization_id = teams.organization_id
FROM teams WHERE commitments.team_id = teams.id
AND commitments.organization_id IS NULL AND teams.organization_id IS NOT NULL;

-- Missed emails
UPDATE missed_emails SET organization_id = teams.organization_id
FROM teams WHERE missed_emails.team_id = teams.id
AND missed_emails.organization_id IS NULL AND teams.organization_id IS NOT NULL;

-- Missed chats
UPDATE missed_chats SET organization_id = teams.organization_id
FROM teams WHERE missed_chats.team_id = teams.id
AND missed_chats.organization_id IS NULL AND teams.organization_id IS NOT NULL;

-- Awaiting replies
UPDATE awaiting_replies SET organization_id = teams.organization_id
FROM teams WHERE awaiting_replies.team_id = teams.id
AND awaiting_replies.organization_id IS NULL AND teams.organization_id IS NOT NULL;

-- Meeting transcripts
UPDATE meeting_transcripts SET organization_id = teams.organization_id
FROM teams WHERE meeting_transcripts.team_id = teams.id
AND meeting_transcripts.organization_id IS NULL AND teams.organization_id IS NOT NULL;

-- Activities
UPDATE activities SET organization_id = teams.organization_id
FROM teams WHERE activities.team_id = teams.id
AND activities.organization_id IS NULL AND teams.organization_id IS NOT NULL;

-- Add indexes for organization_id queries (if not already present)
CREATE INDEX IF NOT EXISTS idx_commitments_org ON commitments(organization_id);
CREATE INDEX IF NOT EXISTS idx_missed_emails_org ON missed_emails(organization_id);
CREATE INDEX IF NOT EXISTS idx_missed_chats_org ON missed_chats(organization_id);
CREATE INDEX IF NOT EXISTS idx_awaiting_replies_org ON awaiting_replies(organization_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_org ON meeting_transcripts(organization_id);
