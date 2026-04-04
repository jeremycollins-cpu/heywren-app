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
