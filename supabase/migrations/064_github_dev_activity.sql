-- Drop the original provider CHECK constraint from migration 001 which only
-- allowed slack, outlook, teams. New providers (zoom, google_meet, claude_code,
-- github) are validated at the application layer.
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_provider_check;

-- GitHub Integration: Developer Activity Tracking
-- Stores GitHub events (commits, PRs, reviews) per user for engineering
-- work observability and cross-referencing with AI usage data.

-- ── GitHub events table ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS github_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Event identity
  github_id TEXT NOT NULL,              -- GitHub's unique ID for the event
  event_type TEXT NOT NULL,             -- commit, pr_opened, pr_merged, pr_reviewed, pr_closed

  -- Common fields
  repo_name TEXT NOT NULL,              -- owner/repo format
  title TEXT,                           -- PR title or commit message (first line)
  url TEXT,                             -- Link to the commit/PR on GitHub

  -- Author info
  github_username TEXT NOT NULL,

  -- Timing
  event_at TIMESTAMPTZ NOT NULL,        -- When the event occurred

  -- PR-specific fields
  additions INTEGER,
  deletions INTEGER,
  changed_files INTEGER,
  review_state TEXT,                    -- approved, changes_requested, commented (for reviews)

  -- Extensibility
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate events
  UNIQUE(user_id, github_id, event_type)
);

-- ── GitHub sync cursors ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS github_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,

  github_username TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle',  -- idle, syncing, error
  sync_error TEXT,
  events_synced INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id)
);

-- ── Indexes ─────────────────────────────────────────────────────

CREATE INDEX idx_github_events_user_id ON github_events(user_id);
CREATE INDEX idx_github_events_team_id ON github_events(team_id);
CREATE INDEX idx_github_events_event_at ON github_events(event_at DESC);
CREATE INDEX idx_github_events_event_type ON github_events(event_type);
CREATE INDEX idx_github_events_user_event_at ON github_events(user_id, event_at DESC);
CREATE INDEX idx_github_events_repo ON github_events(repo_name);

-- ── RLS ─────────────────────────────────────────────────────────

ALTER TABLE github_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY github_events_select ON github_events
  FOR SELECT USING (
    auth.uid() = user_id
    OR team_id IN (
      SELECT tm.team_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY github_events_insert ON github_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY github_events_update ON github_events
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY github_events_delete ON github_events
  FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE github_sync_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY github_sync_cursors_select ON github_sync_cursors
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY github_sync_cursors_insert ON github_sync_cursors
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY github_sync_cursors_update ON github_sync_cursors
  FOR UPDATE USING (auth.uid() = user_id);
