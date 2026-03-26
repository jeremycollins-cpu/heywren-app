-- =============================================================================
-- Migration 021: Invitations
-- Email-based invite system for organizations, departments, and teams
-- =============================================================================

-- ── 1. Create invitations table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('org_admin', 'dept_manager', 'team_lead', 'member')),
  token TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Prevent duplicate pending invites to the same email within an org
  UNIQUE(organization_id, email)
);

-- ── 2. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX idx_invitations_org ON invitations(organization_id);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_status ON invitations(status);
CREATE INDEX idx_invitations_invited_by ON invitations(invited_by);
CREATE INDEX idx_invitations_expires_at ON invitations(expires_at);

-- ── 3. RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- org_admin can see all invitations in their org
CREATE POLICY "Org admins can view all org invitations"
  ON invitations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = invitations.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'org_admin'
    )
  );

-- dept_manager can see invitations for their department
CREATE POLICY "Dept managers can view their department invitations"
  ON invitations FOR SELECT
  USING (
    invitations.department_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = invitations.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'dept_manager'
      AND om.department_id = invitations.department_id
    )
  );

-- org_admin can insert invitations
CREATE POLICY "Org admins can create invitations"
  ON invitations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = invitations.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'org_admin'
    )
  );

-- dept_manager can insert invitations for their department
CREATE POLICY "Dept managers can create department invitations"
  ON invitations FOR INSERT
  WITH CHECK (
    invitations.department_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = invitations.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'dept_manager'
      AND om.department_id = invitations.department_id
    )
  );

-- org_admin can update (revoke) any invitation in their org
CREATE POLICY "Org admins can update invitations"
  ON invitations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = invitations.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'org_admin'
    )
  );

-- The original inviter can update (revoke) their own invitations
CREATE POLICY "Inviters can update their own invitations"
  ON invitations FOR UPDATE
  USING (
    invited_by = auth.uid()
  );

-- Allow service-role to read invitations by token for acceptance flow
-- (handled via admin client, not RLS)

-- org_admin can delete invitations
CREATE POLICY "Org admins can delete invitations"
  ON invitations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = invitations.organization_id
      AND om.user_id = auth.uid()
      AND om.role = 'org_admin'
    )
  );
