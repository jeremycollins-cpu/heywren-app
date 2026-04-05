-- People insights: collaboration graphs, burnout risk, disconnect tracking, manager alerts, pulse surveys
-- These features leverage existing communication data to surface actionable people insights.

-- ── Collaboration edges: pre-computed interaction pairs ──────────────────────

CREATE TABLE collaboration_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  user_a UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Interaction counts by channel
  email_count INTEGER NOT NULL DEFAULT 0,
  chat_count INTEGER NOT NULL DEFAULT 0,
  meeting_count INTEGER NOT NULL DEFAULT 0,
  commitment_count INTEGER NOT NULL DEFAULT 0,        -- shared commitments

  -- Derived strength score (0-1 normalized)
  strength REAL NOT NULL DEFAULT 0 CHECK (strength >= 0 AND strength <= 1),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, month_start, user_a, user_b)
);

CREATE INDEX idx_collab_edges_org_month ON collaboration_edges(organization_id, month_start DESC);
CREATE INDEX idx_collab_edges_user_a ON collaboration_edges(user_a, month_start DESC);
CREATE INDEX idx_collab_edges_user_b ON collaboration_edges(user_b, month_start DESC);

-- ── Burnout risk scores: monthly per-user composite ─────────────────────────

CREATE TABLE burnout_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,

  -- Composite risk score (0-100, higher = more at risk)
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'moderate', 'high', 'critical')),

  -- Component signals (each 0-100)
  after_hours_score INTEGER DEFAULT 0,          -- frequency of after-hours work
  meeting_overload_score INTEGER DEFAULT 0,     -- % of work time in meetings
  commitment_overload_score INTEGER DEFAULT 0,  -- open/overdue commitment load
  response_acceleration_score INTEGER DEFAULT 0,-- response times getting shorter (overwork signal)
  sentiment_decline_score INTEGER DEFAULT 0,    -- sentiment dropping vs baseline
  streak_intensity_score INTEGER DEFAULT 0,     -- how long without a break

  -- Raw data behind signals
  after_hours_days INTEGER DEFAULT 0,           -- days with 3+ activities after hours
  avg_meeting_hours_per_week REAL DEFAULT 0,
  open_commitments INTEGER DEFAULT 0,
  overdue_commitments INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id, month_start)
);

CREATE INDEX idx_burnout_risk_org_month ON burnout_risk_scores(organization_id, month_start DESC);
CREATE INDEX idx_burnout_risk_user ON burnout_risk_scores(user_id, month_start DESC);
CREATE INDEX idx_burnout_risk_level ON burnout_risk_scores(risk_level, month_start DESC);

-- ── Disconnect events: after-hours work log ─────────────────────────────────

CREATE TABLE disconnect_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('after_hours_email', 'after_hours_chat', 'after_hours_meeting', 'weekend_work', 'late_night')),

  -- Context
  occurred_at TIMESTAMPTZ NOT NULL,               -- exact time of the activity
  source TEXT,                                     -- 'email', 'slack', 'calendar'
  hours_outside_schedule REAL DEFAULT 0,           -- how far outside work hours

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id, event_type, occurred_at)
);

CREATE INDEX idx_disconnect_org_date ON disconnect_events(organization_id, event_date DESC);
CREATE INDEX idx_disconnect_user ON disconnect_events(user_id, event_date DESC);

-- ── Manager alerts: proactive notifications ─────────────────────────────────

CREATE TABLE manager_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  target_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,  -- who the alert is about (null for org-wide)
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'burnout_risk', 'response_drop', 'siloed_employee',
    'sentiment_shift', 'overloaded', 'disconnect_pattern',
    'engagement_drop', 'new_collaboration'
  )),

  -- Alert content
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  data JSONB DEFAULT '{}',                        -- structured context (scores, comparisons, etc.)

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'dismissed', 'acted_on')),
  acknowledged_by UUID REFERENCES auth.users(id),
  acknowledged_at TIMESTAMPTZ,
  action_taken TEXT,                              -- manager's note on what they did

  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ                          -- auto-dismiss after this date
);

CREATE INDEX idx_manager_alerts_org_status ON manager_alerts(organization_id, status, created_at DESC);
CREATE INDEX idx_manager_alerts_target ON manager_alerts(target_user_id, status);
CREATE INDEX idx_manager_alerts_type ON manager_alerts(alert_type, created_at DESC);

-- ── Pulse responses: quick weekly check-in answers ──────────────────────────

CREATE TABLE pulse_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,

  -- Pulse data
  energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 5),   -- 1=drained, 5=energized
  blocker TEXT,                                   -- "What's your biggest blocker?"
  win TEXT,                                       -- "What's one win from this week?"
  focus_rating INTEGER CHECK (focus_rating >= 1 AND focus_rating <= 5),  -- "How focused were you?"

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id, week_start)
);

CREATE INDEX idx_pulse_org_week ON pulse_responses(organization_id, week_start DESC);
CREATE INDEX idx_pulse_user ON pulse_responses(user_id, week_start DESC);

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE collaboration_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE burnout_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE disconnect_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pulse_responses ENABLE ROW LEVEL SECURITY;

-- Collaboration edges: managers can view
CREATE POLICY "Managers can view collaboration edges"
  ON collaboration_edges FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = collaboration_edges.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- Burnout risk: managers can view, users can see their own
CREATE POLICY "Users can view own burnout risk"
  ON burnout_risk_scores FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Managers can view team burnout risk"
  ON burnout_risk_scores FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = burnout_risk_scores.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- Disconnect events: managers can view, users can see their own
CREATE POLICY "Users can view own disconnect events"
  ON disconnect_events FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Managers can view team disconnect events"
  ON disconnect_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = disconnect_events.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- Manager alerts: managers can view and manage
CREATE POLICY "Managers can view alerts"
  ON manager_alerts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = manager_alerts.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

CREATE POLICY "Managers can update alerts"
  ON manager_alerts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = manager_alerts.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- Pulse responses: users can manage their own, managers can view
CREATE POLICY "Users can manage own pulse responses"
  ON pulse_responses FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Managers can view team pulse responses"
  ON pulse_responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = pulse_responses.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- Service role handles all inserts/updates for computed tables
