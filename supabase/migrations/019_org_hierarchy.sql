-- =============================================================================
-- Migration 019: Organization Hierarchy
-- Adds 3-level org structure: Organization → Department → Team
-- =============================================================================

-- ── 1. Create organizations table (top-level entity) ──────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  domain TEXT,                          -- corporate email domain (e.g. 'acme.com')
  logo_url TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  fiscal_week_start TEXT DEFAULT 'monday' CHECK (fiscal_week_start IN ('monday', 'sunday')),

  -- Stripe subscription (moved from teams)
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_plan TEXT DEFAULT 'trial' CHECK (subscription_plan IN ('trial', 'basic', 'pro', 'team', 'enterprise')),
  subscription_status TEXT DEFAULT 'trialing' CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'cancelled', 'incomplete')),
  trial_ends_at TIMESTAMP WITH TIME ZONE,
  max_users INTEGER DEFAULT 25,

  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_domain ON organizations(domain);
CREATE INDEX idx_organizations_stripe_customer ON organizations(stripe_customer_id);
CREATE INDEX idx_organizations_owner ON organizations(owner_id);

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 2. Create departments table (mid-level grouping) ──────────────────────────

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  head_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- department lead
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, slug)
);

CREATE INDEX idx_departments_org ON departments(organization_id);
CREATE INDEX idx_departments_head ON departments(head_user_id);

CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. Add hierarchy columns to teams ─────────────────────────────────────────
-- teams becomes the leaf-level working group under a department

ALTER TABLE teams ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE CASCADE;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX idx_teams_organization ON teams(organization_id);
CREATE INDEX idx_teams_department ON teams(department_id);

-- ── 4. Create organization_members table (canonical membership) ───────────────
-- Single source of truth for who belongs where in the hierarchy.
-- A user belongs to exactly 1 org, 1 department, 1 team.

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('org_admin', 'dept_manager', 'team_lead', 'member')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id)  -- 1 user per org
);

CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_members_dept ON organization_members(department_id);
CREATE INDEX idx_org_members_team ON organization_members(team_id);
CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_org_members_role ON organization_members(role);

CREATE TRIGGER update_org_members_updated_at BEFORE UPDATE ON organization_members
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. Add organization_id to profiles ────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX idx_profiles_organization ON profiles(organization_id);
CREATE INDEX idx_profiles_department ON profiles(department_id);

-- ── 6. Add organization_id to key data tables for roll-up queries ─────────────

ALTER TABLE commitments ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE missed_emails ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE missed_chats ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE awaiting_replies ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE meeting_transcripts ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

CREATE INDEX idx_commitments_org ON commitments(organization_id);
CREATE INDEX idx_missed_emails_org ON missed_emails(organization_id);
CREATE INDEX idx_missed_chats_org ON missed_chats(organization_id);
CREATE INDEX idx_awaiting_replies_org ON awaiting_replies(organization_id);
CREATE INDEX idx_meeting_transcripts_org ON meeting_transcripts(organization_id);
CREATE INDEX idx_activities_org ON activities(organization_id);

-- ── 7. RLS Policies ──────────────────────────────────────────────────────────

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

-- Organizations: users can see orgs they belong to
CREATE POLICY "Users can view their organization"
  ON organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organizations.id
      AND om.user_id = auth.uid()
    )
  );

-- Organizations: org_admin can update
CREATE POLICY "Org admins can update their organization"
  ON organizations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organizations.id
      AND om.user_id = auth.uid()
      AND om.role = 'org_admin'
    )
  );

-- Departments: visibility based on role
-- org_admin sees all departments, dept_manager/team_lead/member see their own
CREATE POLICY "Users can view departments based on role"
  ON departments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = departments.organization_id
      AND om.user_id = auth.uid()
      AND (
        om.role = 'org_admin'                    -- org admins see all depts
        OR om.department_id = departments.id     -- others see their own dept
      )
    )
  );

-- Departments: org_admin can insert/update
CREATE POLICY "Org admins can manage departments"
  ON departments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = departments.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'org_admin'
    )
  );

-- Organization members: visibility based on role hierarchy
CREATE POLICY "Users can view org members based on role"
  ON organization_members FOR SELECT
  USING (
    -- Users can always see their own row
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM organization_members my_membership
      WHERE my_membership.user_id = auth.uid()
      AND my_membership.organization_id = organization_members.organization_id
      AND (
        -- org_admin sees everyone in the org
        my_membership.role = 'org_admin'
        -- dept_manager sees everyone in their department
        OR (my_membership.role = 'dept_manager' AND my_membership.department_id = organization_members.department_id)
        -- team_lead sees everyone in their team
        OR (my_membership.role = 'team_lead' AND my_membership.team_id = organization_members.team_id)
        -- members see their own team
        OR (my_membership.role = 'member' AND my_membership.team_id = organization_members.team_id)
      )
    )
  );

-- Org members: only org_admin can insert/update/delete
CREATE POLICY "Org admins can manage org members"
  ON organization_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'org_admin'
    )
  );
