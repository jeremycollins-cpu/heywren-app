-- Reminders: lightweight "don't forget" bookmarks on commitments and mentions.
-- One-click from any card → added to the reminders list.
-- Completing the reminder OR the linked commitment/mention marks both as done.

CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,

  -- What this reminder is about
  title TEXT NOT NULL,
  note TEXT,

  -- Link back to the source (commitment or mention)
  source_type TEXT CHECK (source_type IN ('commitment', 'mention', 'manual')),
  source_id UUID,  -- commitment.id or wren_mention.id

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'dismissed')),
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reminders_user_status ON reminders(user_id, status, created_at DESC);
CREATE INDEX idx_reminders_source ON reminders(source_type, source_id);
CREATE INDEX idx_reminders_team ON reminders(team_id);

-- RLS
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own reminders"
  ON reminders FOR ALL
  USING (user_id = auth.uid());
