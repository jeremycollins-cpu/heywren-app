-- Migration 075: Anchor monitoring tables on organization_id
--
-- Problem: ai_platform_usage, email_threat_alerts, email_subscriptions, and
-- system_errors are keyed by team_id. The read path (/api/system-health,
-- health-monitor) resolves the current user's team via multiple sources; the
-- write path (scan-email-threats, sync-outlook, reportError) uses
-- integrations.team_id. When those drift — stale profiles.current_team_id,
-- users switching teams, org restructures — rows are written under one team
-- and the user's dashboard queries another, silently partitioning the data
-- and producing "Last run: never" even for pipelines that ran fine.
--
-- Users are UNIQUE(organization_id, user_id) per migration 019, so
-- organization_id is the stable single-identity key. This migration:
--   1. Adds organization_id to each monitoring table.
--   2. Backfills it from teams.organization_id via the existing team_id.
--   3. Adds a BEFORE INSERT trigger that auto-populates organization_id from
--      team_id on future writes, so existing call sites keep working.

-- ── 1. ai_platform_usage ────────────────────────────────────────────────
ALTER TABLE ai_platform_usage
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE ai_platform_usage SET organization_id = teams.organization_id
FROM teams
WHERE ai_platform_usage.team_id = teams.id
  AND ai_platform_usage.organization_id IS NULL
  AND teams.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_platform_usage_org_created
  ON ai_platform_usage(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_platform_usage_org_module_created
  ON ai_platform_usage(organization_id, module, created_at DESC);

-- ── 2. email_threat_alerts ──────────────────────────────────────────────
ALTER TABLE email_threat_alerts
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE email_threat_alerts SET organization_id = teams.organization_id
FROM teams
WHERE email_threat_alerts.team_id = teams.id
  AND email_threat_alerts.organization_id IS NULL
  AND teams.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_threats_org_status
  ON email_threat_alerts(organization_id, status);

-- ── 3. email_subscriptions ──────────────────────────────────────────────
ALTER TABLE email_subscriptions
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE email_subscriptions SET organization_id = teams.organization_id
FROM teams
WHERE email_subscriptions.team_id = teams.id
  AND email_subscriptions.organization_id IS NULL
  AND teams.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_subscriptions_org_status
  ON email_subscriptions(organization_id, status);

-- ── 4. system_errors ────────────────────────────────────────────────────
-- Note: system_errors.team_id is typed UUID with no FK (per migration 056).
ALTER TABLE system_errors
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

UPDATE system_errors SET organization_id = teams.organization_id
FROM teams
WHERE system_errors.team_id = teams.id
  AND system_errors.organization_id IS NULL
  AND teams.organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_errors_org_created
  ON system_errors(organization_id, created_at DESC);

-- ── 5. Auto-populating trigger ───────────────────────────────────────────
-- Writers keep passing team_id; this trigger fills in organization_id.
-- Idempotent: won't overwrite a caller that already set organization_id.

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

DROP TRIGGER IF EXISTS ai_platform_usage_set_org_id ON ai_platform_usage;
CREATE TRIGGER ai_platform_usage_set_org_id
  BEFORE INSERT ON ai_platform_usage
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();

DROP TRIGGER IF EXISTS email_threat_alerts_set_org_id ON email_threat_alerts;
CREATE TRIGGER email_threat_alerts_set_org_id
  BEFORE INSERT ON email_threat_alerts
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();

DROP TRIGGER IF EXISTS email_subscriptions_set_org_id ON email_subscriptions;
CREATE TRIGGER email_subscriptions_set_org_id
  BEFORE INSERT ON email_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();

DROP TRIGGER IF EXISTS system_errors_set_org_id ON system_errors;
CREATE TRIGGER system_errors_set_org_id
  BEFORE INSERT ON system_errors
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();
