-- Create draft_queue table for AI-generated follow-up message drafts
CREATE TABLE IF NOT EXISTS draft_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  commitment_id UUID REFERENCES commitments(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_name TEXT,
  recipient_email TEXT,
  channel TEXT NOT NULL DEFAULT 'slack' CHECK (channel IN ('slack', 'email')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'sent', 'dismissed', 'edited')),
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for draft_queue
CREATE INDEX idx_draft_queue_team_id ON draft_queue(team_id);
CREATE INDEX idx_draft_queue_user_id ON draft_queue(user_id);
CREATE INDEX idx_draft_queue_status ON draft_queue(status);
CREATE INDEX idx_draft_queue_commitment_id ON draft_queue(commitment_id);

-- Create playbooks table for user-defined automation rules
CREATE TABLE IF NOT EXISTS playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('commitment_created', 'commitment_overdue', 'commitment_stale', 'meeting_upcoming', 'nudge_ignored', 'daily_schedule')),
  trigger_config JSONB DEFAULT '{}'::jsonb,
  action_type TEXT NOT NULL CHECK (action_type IN ('send_nudge', 'send_slack', 'send_email', 'create_draft', 'escalate', 'reassign')),
  action_config JSONB DEFAULT '{}'::jsonb,
  enabled BOOLEAN DEFAULT true,
  run_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for playbooks
CREATE INDEX idx_playbooks_team_id ON playbooks(team_id);
CREATE INDEX idx_playbooks_enabled ON playbooks(enabled);
CREATE INDEX idx_playbooks_trigger_type ON playbooks(trigger_type);

-- Trigger for updated_at on playbooks
CREATE TRIGGER update_playbooks_updated_at BEFORE UPDATE ON playbooks
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE draft_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;

-- draft_queue RLS policies

CREATE POLICY "Team members can view their team drafts"
  ON draft_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = draft_queue.team_id
      AND team_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own drafts"
  ON draft_queue FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = draft_queue.team_id
      AND team_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own drafts"
  ON draft_queue FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own drafts"
  ON draft_queue FOR DELETE
  USING (auth.uid() = user_id);

-- playbooks RLS policies

CREATE POLICY "Team members can view their team playbooks"
  ON playbooks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = playbooks.team_id
      AND team_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Team admins and owners can insert playbooks"
  ON playbooks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = playbooks.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Team admins and owners can update playbooks"
  ON playbooks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = playbooks.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = playbooks.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Team admins and owners can delete playbooks"
  ON playbooks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_members.team_id = playbooks.team_id
      AND team_members.user_id = auth.uid()
      AND team_members.role IN ('owner', 'admin')
    )
  );
