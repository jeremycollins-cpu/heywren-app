-- Company-wide holidays: everyone in the org is automatically OOO on these dates.
-- Org admins can manage holidays; the OOO utility checks this table alongside
-- individual ooo_periods so scores, streaks, and alerts are paused for all.

CREATE TABLE company_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_org_holiday UNIQUE (organization_id, date)
);

CREATE INDEX idx_company_holidays_org ON company_holidays(organization_id, date);

ALTER TABLE company_holidays ENABLE ROW LEVEL SECURITY;

-- All org members can view holidays
CREATE POLICY "Org members can view company holidays"
  ON company_holidays FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = company_holidays.organization_id
      AND om.user_id = auth.uid()
    )
  );

-- Only org admins can manage holidays
CREATE POLICY "Org admins can manage company holidays"
  ON company_holidays FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = company_holidays.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'org_admin'
    )
  );
