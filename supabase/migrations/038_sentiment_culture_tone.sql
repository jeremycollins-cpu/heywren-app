-- Sentiment & culture tone analysis
-- Adds sentiment scoring to existing communication tables and
-- creates aggregate culture_snapshots for org-level tone tracking.
-- Privacy: only numeric scores stored, never surfaces message content to managers.
-- Aggregated monthly — sentiment is a slow-moving signal.

-- ── Add sentiment fields to missed_emails ───────────────────────────────────

ALTER TABLE missed_emails
  ADD COLUMN IF NOT EXISTS sentiment_score REAL CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  ADD COLUMN IF NOT EXISTS sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  ADD COLUMN IF NOT EXISTS tone_themes TEXT[];

-- ── Add sentiment fields to missed_chats ────────────────────────────────────

ALTER TABLE missed_chats
  ADD COLUMN IF NOT EXISTS sentiment_score REAL CHECK (sentiment_score >= -1 AND sentiment_score <= 1),
  ADD COLUMN IF NOT EXISTS sentiment_label TEXT CHECK (sentiment_label IN ('positive', 'neutral', 'negative')),
  ADD COLUMN IF NOT EXISTS tone_themes TEXT[];

-- ── Culture snapshots: monthly aggregate tone data per org ──────────────────

CREATE TABLE culture_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,                           -- 1st of the month

  -- Aggregate tone index (-1 to 1, weighted average across all comms)
  tone_index REAL NOT NULL DEFAULT 0 CHECK (tone_index >= -1 AND tone_index <= 1),
  sample_count INTEGER NOT NULL DEFAULT 0,            -- total messages scored

  -- Theme distribution: count of each tone theme across all comms that month
  theme_counts JSONB NOT NULL DEFAULT '{}',           -- e.g. {"gratitude": 12, "urgency": 8, "frustration": 3}

  -- Sentiment distribution
  positive_count INTEGER NOT NULL DEFAULT 0,
  neutral_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,

  -- Per-department breakdown (optional, for heatmap)
  department_scores JSONB NOT NULL DEFAULT '{}',      -- e.g. {"dept_id": {"tone": 0.3, "count": 15}}

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, month_start)
);

CREATE INDEX idx_culture_snapshots_org_month ON culture_snapshots(organization_id, month_start DESC);

-- ── Per-user sentiment aggregates (for individual trend lines) ──────────────

CREATE TABLE user_sentiment_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,

  avg_sentiment REAL NOT NULL DEFAULT 0 CHECK (avg_sentiment >= -1 AND avg_sentiment <= 1),
  message_count INTEGER NOT NULL DEFAULT 0,
  top_themes TEXT[] DEFAULT '{}',                     -- top 3 themes for the month
  positive_ratio REAL DEFAULT 0,                      -- % of messages that were positive

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id, month_start)
);

CREATE INDEX idx_user_sentiment_org_month ON user_sentiment_scores(organization_id, month_start DESC);
CREATE INDEX idx_user_sentiment_user ON user_sentiment_scores(user_id, month_start DESC);

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE culture_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sentiment_scores ENABLE ROW LEVEL SECURITY;

-- Culture snapshots: managers can view org-level data
CREATE POLICY "Managers can view culture snapshots"
  ON culture_snapshots FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = culture_snapshots.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- User sentiment: users can see their own
CREATE POLICY "Users can view own sentiment scores"
  ON user_sentiment_scores FOR SELECT
  USING (user_id = auth.uid());

-- User sentiment: managers can view team sentiment
CREATE POLICY "Managers can view team sentiment scores"
  ON user_sentiment_scores FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = user_sentiment_scores.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- Service role handles all inserts/updates (via API routes with admin client)
