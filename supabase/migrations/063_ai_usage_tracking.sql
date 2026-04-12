-- AI Usage Tracking
-- Stores Claude Code (and future AI tool) session data per user
-- so HeyWren can visualize AI usage patterns as part of work observability.

CREATE TABLE IF NOT EXISTS ai_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,

  -- Session identity
  session_id TEXT NOT NULL,
  tool TEXT NOT NULL DEFAULT 'claude_code',  -- claude_code, cursor, copilot, etc.

  -- Timing
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER GENERATED ALWAYS AS (
    CASE WHEN ended_at IS NOT NULL
      THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
      ELSE NULL
    END
  ) STORED,

  -- Token usage
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER GENERATED ALWAYS AS (input_tokens + output_tokens) STORED,
  estimated_cost_cents INTEGER NOT NULL DEFAULT 0,  -- stored in cents to avoid float issues

  -- Session metadata
  model TEXT,
  entrypoint TEXT,           -- cli, web, mobile, ide
  project_path TEXT,
  messages_count INTEGER NOT NULL DEFAULT 0,
  tool_calls_count INTEGER NOT NULL DEFAULT 0,

  -- Extensibility
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Prevent duplicate syncs
  UNIQUE(user_id, session_id, tool)
);

-- Indexes for dashboard queries
CREATE INDEX idx_ai_sessions_user_id ON ai_sessions(user_id);
CREATE INDEX idx_ai_sessions_team_id ON ai_sessions(team_id);
CREATE INDEX idx_ai_sessions_started_at ON ai_sessions(started_at DESC);
CREATE INDEX idx_ai_sessions_tool ON ai_sessions(tool);
CREATE INDEX idx_ai_sessions_user_started ON ai_sessions(user_id, started_at DESC);

-- RLS: users can only see their own sessions; team admins see team sessions
ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_sessions_select ON ai_sessions
  FOR SELECT USING (
    auth.uid() = user_id
    OR team_id IN (
      SELECT tm.team_id FROM team_members tm
      WHERE tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')
    )
  );

CREATE POLICY ai_sessions_insert ON ai_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY ai_sessions_update ON ai_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY ai_sessions_delete ON ai_sessions
  FOR DELETE USING (auth.uid() = user_id);
