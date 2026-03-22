-- Add role to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin'));

-- Add subscription fields to teams
ALTER TABLE teams ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'trial' CHECK (subscription_plan IN ('trial', 'basic', 'pro', 'team'));
ALTER TABLE teams ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'trialing' CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'cancelled', 'incomplete'));
ALTER TABLE teams ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 5;

-- Add team_id and current_team_id to profiles for quick lookup
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_team_id UUID REFERENCES teams(id);

-- Add indexes for subscription lookups
CREATE INDEX IF NOT EXISTS idx_teams_stripe_customer_id ON teams(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_teams_stripe_subscription_id ON teams(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_teams_subscription_plan ON teams(subscription_plan);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_current_team_id ON profiles(current_team_id);

-- RLS policies for team members and integrations
CREATE POLICY IF NOT EXISTS "Team members can view their team members" ON team_members
FOR SELECT
USING (EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid()));

CREATE POLICY IF NOT EXISTS "Admins can insert team members" ON team_members
FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = team_members.team_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')));

CREATE POLICY IF NOT EXISTS "Team members can view integrations" ON integrations
FOR SELECT
USING (EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = integrations.team_id AND tm.user_id = auth.uid()));

CREATE POLICY IF NOT EXISTS "Admins can manage integrations" ON integrations
FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = integrations.team_id AND tm.user_id = auth.uid() AND tm.role IN ('owner', 'admin')));

-- Update teams policies for subscription info
CREATE POLICY IF NOT EXISTS "Users can update their team subscription info"
  ON teams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = teams.id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
    )
  );
