-- Migration 065: Anthropic Admin API integration
--
-- Adds two tables:
--   anthropic_admin_credentials — one encrypted admin key per organization,
--     used by a nightly cron to pull per-user daily telemetry from Anthropic.
--   ai_daily_rollups — authoritative per-user daily aggregates from the
--     Anthropic Admin API. Lives alongside ai_sessions (the hook-derived
--     per-session table) — the dashboard merges both on display.

-- ── 1. Encrypted admin credentials, one per org ─────────────────────────────

CREATE TABLE IF NOT EXISTS anthropic_admin_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- AES-256-GCM ciphertext + IV + auth tag, all base64. Encryption key
  -- lives in the ANTHROPIC_ADMIN_ENCRYPTION_KEY env var (32 bytes hex).
  encrypted_key TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_tag TEXT NOT NULL,
  -- Fingerprint of the raw key — SHA-256 prefix, safe to store, so we can
  -- show "you already connected key ending ab12" without decrypting.
  key_fingerprint TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IN ('success', 'failed', 'in_progress')),
  last_sync_error TEXT,
  last_sync_row_count INTEGER,
  subscription_type TEXT,  -- 'team' | 'enterprise' — captured on first sync
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

-- RLS: only org admins can see the credential row's metadata (never the key).
-- Writes go through service-role routes that do their own admin gating.
ALTER TABLE anthropic_admin_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY aac_select ON anthropic_admin_credentials
  FOR SELECT USING (
    organization_id IN (
      SELECT om.organization_id FROM organization_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('org_admin')
    )
  );

-- ── 2. Daily per-user rollups from the Admin API ────────────────────────────

CREATE TABLE IF NOT EXISTS ai_daily_rollups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- user_email lets us attribute rollups even when the user isn't yet in
  -- our auth system (e.g. a contractor with a Claude seat but no HeyWren
  -- account). Populated from Anthropic's response.
  user_email TEXT,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'anthropic_admin_api'
    CHECK (source IN ('anthropic_admin_api')),

  num_sessions INTEGER NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cache_creation_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,

  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  commits INTEGER NOT NULL DEFAULT 0,
  prs_opened INTEGER NOT NULL DEFAULT 0,
  tool_acceptance_rate NUMERIC(5, 4),

  -- Free-form room for per-model breakdowns and any fields Anthropic
  -- adds later (e.g. terminal_type distribution).
  metadata JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- When user_id is null (contractor without HeyWren account), dedupe on
  -- email + date + source instead. Two partial unique indexes below cover
  -- both cases.
  CHECK (user_id IS NOT NULL OR user_email IS NOT NULL)
);

CREATE UNIQUE INDEX idx_ai_daily_rollups_user_date_source
  ON ai_daily_rollups(user_id, date, source)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX idx_ai_daily_rollups_email_date_source
  ON ai_daily_rollups(organization_id, user_email, date, source)
  WHERE user_id IS NULL AND user_email IS NOT NULL;

CREATE INDEX idx_ai_daily_rollups_org_date ON ai_daily_rollups(organization_id, date DESC);
CREATE INDEX idx_ai_daily_rollups_team_date ON ai_daily_rollups(team_id, date DESC);

ALTER TABLE ai_daily_rollups ENABLE ROW LEVEL SECURITY;

-- Users see their own rollups; org admins see their whole org's.
CREATE POLICY rollups_select ON ai_daily_rollups
  FOR SELECT USING (
    (user_id IS NOT NULL AND auth.uid() = user_id)
    OR organization_id IN (
      SELECT om.organization_id FROM organization_members om
      WHERE om.user_id = auth.uid() AND om.role IN ('org_admin')
    )
  );

-- Writes happen only via the cron's service-role client.
