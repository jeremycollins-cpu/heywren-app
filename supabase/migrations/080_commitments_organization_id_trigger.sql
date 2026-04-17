-- Migration 080: Attach set_organization_id_from_team() trigger to commitments
--
-- Problem: migration 019 added commitments.organization_id and migration 061
-- did a one-time backfill, but no BEFORE INSERT trigger was ever attached.
-- Most write paths (insertCommitmentIfNotDuplicate, Outlook/Slack backfills,
-- meeting transcripts, manual POST /api/commitments) pass only team_id, so
-- commitments created after 061 landed with organization_id = NULL.
--
-- The dashboard store and commitments page scope reads to
-- profiles.organization_id when it's set, which silently hides every commitment
-- with a null organization_id. That's why "this week's" commitments — all of
-- them freshly inserted — are missing from the UI.
--
-- Fix mirrors migrations 075/076: attach the existing
-- set_organization_id_from_team() trigger and backfill any null rows. Idempotent.

-- Ensure the helper function exists. It is defined in migration 075, but we
-- re-declare it here with CREATE OR REPLACE so this migration is self-contained
-- for environments that may have skipped 075.
CREATE OR REPLACE FUNCTION set_organization_id_from_team()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.team_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM teams WHERE id = NEW.team_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill any commitments inserted after 061 that still lack organization_id.
UPDATE commitments
SET organization_id = teams.organization_id
FROM teams
WHERE commitments.team_id = teams.id
  AND commitments.organization_id IS NULL
  AND teams.organization_id IS NOT NULL;

-- Auto-populate organization_id on future inserts from team_id.
DROP TRIGGER IF EXISTS commitments_set_org_id ON commitments;
CREATE TRIGGER commitments_set_org_id
  BEFORE INSERT ON commitments
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();
