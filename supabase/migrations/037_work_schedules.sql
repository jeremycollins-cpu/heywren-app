-- Work schedules for activity anomaly detection
-- Default: 8:00 AM - 5:00 PM, Monday-Friday in org timezone
-- Managers can override per-user; users can set their own

CREATE TABLE work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Schedule: which days and hours (in org timezone)
  work_days INTEGER[] DEFAULT '{1,2,3,4,5}',     -- 0=Sun, 1=Mon ... 6=Sat
  start_time TIME DEFAULT '08:00',
  end_time TIME DEFAULT '17:00',
  timezone TEXT,                                    -- override org timezone if remote

  -- Manager overrides for anomaly thresholds
  idle_threshold_minutes INTEGER DEFAULT 60,        -- alert after N minutes idle during work hours
  after_hours_alert BOOLEAN DEFAULT true,           -- flag after-hours work

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_work_schedules_org ON work_schedules(organization_id);
CREATE INDEX idx_work_schedules_user ON work_schedules(user_id);

-- Anomaly overrides: when a manager dismisses or explains an anomaly
CREATE TABLE activity_anomaly_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  anomaly_date DATE NOT NULL,
  anomaly_type TEXT NOT NULL,           -- 'idle', 'after_hours', 'ghost_day', 'response_drop', 'overloaded'
  reason TEXT,                          -- manager's explanation
  dismissed_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, user_id, anomaly_date, anomaly_type)
);

CREATE INDEX idx_anomaly_overrides_org_date ON activity_anomaly_overrides(organization_id, anomaly_date);
CREATE INDEX idx_anomaly_overrides_user ON activity_anomaly_overrides(user_id);

-- ── Row Level Security ──────────────────────────────────────────────────────

ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_anomaly_overrides ENABLE ROW LEVEL SECURITY;

-- Work schedules: users can view and edit their own
CREATE POLICY "Users can view their own work schedule"
  ON work_schedules FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own work schedule"
  ON work_schedules FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own work schedule"
  ON work_schedules FOR UPDATE
  USING (user_id = auth.uid());

-- Work schedules: managers can view schedules in their scope
CREATE POLICY "Managers can view team work schedules"
  ON work_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = work_schedules.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- Work schedules: org_admin and dept_manager can update any schedule in their scope
CREATE POLICY "Managers can update team work schedules"
  ON work_schedules FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = work_schedules.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager')
    )
  );

CREATE POLICY "Managers can insert team work schedules"
  ON work_schedules FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = work_schedules.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager')
    )
  );

-- Anomaly overrides: managers can view and create overrides in their org
CREATE POLICY "Managers can view anomaly overrides"
  ON activity_anomaly_overrides FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = activity_anomaly_overrides.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

CREATE POLICY "Managers can create anomaly overrides"
  ON activity_anomaly_overrides FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = activity_anomaly_overrides.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

CREATE POLICY "Managers can update anomaly overrides"
  ON activity_anomaly_overrides FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = activity_anomaly_overrides.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );
