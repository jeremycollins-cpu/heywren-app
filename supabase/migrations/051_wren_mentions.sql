-- Unified index of every explicit @HeyWren / "Hey Wren" / BCC trigger across all channels.
-- Powers the Wren Mentions page so users can see everything they asked Wren to track.

CREATE TABLE wren_mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('slack', 'email', 'meeting')),
  source_title TEXT NOT NULL,
  source_snippet TEXT,
  source_ref TEXT,
  source_url TEXT,
  participant_name TEXT,
  commitments_extracted INTEGER NOT NULL DEFAULT 0,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookups for the mentions page (user's mentions, newest first)
CREATE INDEX idx_wren_mentions_user_created ON wren_mentions(user_id, created_at DESC);
CREATE INDEX idx_wren_mentions_team ON wren_mentions(team_id);

-- RLS
ALTER TABLE wren_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own mentions"
  ON wren_mentions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Service role can insert mentions"
  ON wren_mentions FOR INSERT
  WITH CHECK (true);
