-- Out-of-office periods: PTO, travel, sick, etc.
-- OOO users are excluded from scoring, streaks, anomaly detection, and alerts.
-- Their streak is frozen (not reset) while they're out.

CREATE TABLE ooo_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Period definition
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,

  -- Type and optional note
  ooo_type TEXT NOT NULL CHECK (ooo_type IN ('pto', 'travel', 'sick', 'other')),
  note TEXT,                                  -- optional reason visible to managers

  -- Backup/delegate for commitment handoff
  backup_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT valid_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_ooo_periods_org ON ooo_periods(organization_id, status);
CREATE INDEX idx_ooo_periods_user ON ooo_periods(user_id, status);
CREATE INDEX idx_ooo_periods_dates ON ooo_periods(start_date, end_date);

-- RLS
ALTER TABLE ooo_periods ENABLE ROW LEVEL SECURITY;

-- Users can manage their own OOO periods
CREATE POLICY "Users can manage own OOO periods"
  ON ooo_periods FOR ALL
  USING (user_id = auth.uid());

-- Managers can view team OOO periods
CREATE POLICY "Managers can view team OOO periods"
  ON ooo_periods FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = ooo_periods.organization_id
      AND om.user_id = auth.uid()
      AND om.role IN ('org_admin', 'dept_manager', 'team_lead')
    )
  );

-- Auto-complete expired OOO periods (optional: run via cron or check at read time)
