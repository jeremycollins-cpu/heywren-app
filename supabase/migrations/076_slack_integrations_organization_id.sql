-- Migration 076: Extend organization_id anchoring to slack_messages and integrations
--
-- Completes the pattern from migration 075. These were the two remaining tables
-- with team_id as primary scope but no organization_id column at all:
--
--   * integrations  — an Outlook/Slack connection belongs to a team, but we
--     need organization_id for audit/rollup queries (e.g. "all connections in
--     this org"), and so background jobs that iterate integrations and write
--     to org-anchored tables don't have to look up org_id separately.
--
--   * slack_messages — mostly archival. Adding organization_id lets compliance
--     queries roll up by org without a join through teams.
--
-- Strategy mirrors 075: ADD COLUMN, backfill from teams.organization_id, attach
-- the existing set_organization_id_from_team() BEFORE INSERT trigger so all
-- call sites keep using team_id and the DB auto-fills organization_id.

-- ── 1. integrations ────────────────────────────────────────────────────
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE integrations SET organization_id = teams.organization_id
FROM teams
WHERE integrations.team_id = teams.id
  AND integrations.organization_id IS NULL
  AND teams.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integrations_organization
  ON integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_integrations_org_provider
  ON integrations(organization_id, provider);

DROP TRIGGER IF EXISTS integrations_set_org_id ON integrations;
CREATE TRIGGER integrations_set_org_id
  BEFORE INSERT ON integrations
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();

-- ── 2. slack_messages ──────────────────────────────────────────────────
ALTER TABLE slack_messages
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE slack_messages SET organization_id = teams.organization_id
FROM teams
WHERE slack_messages.team_id = teams.id
  AND slack_messages.organization_id IS NULL
  AND teams.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_slack_messages_organization
  ON slack_messages(organization_id);

DROP TRIGGER IF EXISTS slack_messages_set_org_id ON slack_messages;
CREATE TRIGGER slack_messages_set_org_id
  BEFORE INSERT ON slack_messages
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();
