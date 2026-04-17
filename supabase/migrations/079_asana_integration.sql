-- Asana Integration
-- Stores Asana tasks assigned to a connected user (synced via Inngest) and
-- links HeyWren commitments back to the Asana task created from them.

-- ── Asana tasks table ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asana_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Asana identity (gid = Asana's globally unique ID)
  asana_gid TEXT NOT NULL,
  workspace_gid TEXT NOT NULL,
  project_gid TEXT,
  project_name TEXT,

  -- Task fields
  name TEXT NOT NULL,
  notes TEXT,
  permalink_url TEXT,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  due_on DATE,
  due_at TIMESTAMPTZ,
  assignee_gid TEXT,

  -- Provenance — set when the row was created via "Send to Asana" from a
  -- HeyWren commitment, NULL when the task was pulled in by background sync.
  created_from_commitment_id UUID REFERENCES commitments(id) ON DELETE SET NULL,

  -- Asana timestamps
  asana_created_at TIMESTAMPTZ,
  asana_modified_at TIMESTAMPTZ,

  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, asana_gid)
);

-- ── Asana sync cursors ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS asana_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,

  asana_user_gid TEXT NOT NULL,
  default_workspace_gid TEXT,
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle',  -- idle, syncing, error
  sync_error TEXT,
  tasks_synced INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id)
);

-- ── Link column on commitments ──────────────────────────────────
-- One commitment maps to at most one Asana task (the one we created from it).
-- Reverse direction (task → commitment) is captured by created_from_commitment_id
-- on asana_tasks.

ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS asana_gid TEXT,
  ADD COLUMN IF NOT EXISTS asana_url TEXT;

CREATE INDEX IF NOT EXISTS idx_commitments_asana_gid
  ON commitments(asana_gid)
  WHERE asana_gid IS NOT NULL;

-- ── Indexes ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_asana_tasks_user_id ON asana_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_asana_tasks_team_id ON asana_tasks(team_id);
CREATE INDEX IF NOT EXISTS idx_asana_tasks_completed ON asana_tasks(user_id, completed);
CREATE INDEX IF NOT EXISTS idx_asana_tasks_due_on ON asana_tasks(due_on) WHERE due_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asana_tasks_project ON asana_tasks(project_gid) WHERE project_gid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asana_tasks_commitment ON asana_tasks(created_from_commitment_id) WHERE created_from_commitment_id IS NOT NULL;

-- ── RLS ─────────────────────────────────────────────────────────

ALTER TABLE asana_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY asana_tasks_select ON asana_tasks
  FOR SELECT USING (
    auth.uid() = user_id
    OR team_id IN (
      SELECT tm.team_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY asana_tasks_insert ON asana_tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY asana_tasks_update ON asana_tasks
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY asana_tasks_delete ON asana_tasks
  FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE asana_sync_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY asana_sync_cursors_select ON asana_sync_cursors
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY asana_sync_cursors_insert ON asana_sync_cursors
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY asana_sync_cursors_update ON asana_sync_cursors
  FOR UPDATE USING (auth.uid() = user_id);
