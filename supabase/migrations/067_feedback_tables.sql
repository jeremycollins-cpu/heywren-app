-- Migration 067: Feedback tables for community-driven AI improvement
--
-- Adds feedback capture for three AI features:
--   1. Commitment detection (accept/reject + reason)
--   2. Email draft generation (implicit: track edits as feedback)
--   3. Email threat detection (aggregate existing user_feedback)
--
-- All three feed into the community_patterns table via weekly aggregation,
-- closing the loop: user feedback → better AI for everyone.

-- ── Commitment feedback ──
-- Captures why users accept/reject AI-detected commitments.
-- The review gate already has accept/reject — this adds structured reasons.
CREATE TABLE IF NOT EXISTS commitment_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  commitment_id UUID REFERENCES commitments(id) ON DELETE SET NULL,

  -- What the user said
  feedback TEXT NOT NULL CHECK (feedback IN ('accurate', 'inaccurate')),
  reason TEXT,  -- optional free-text explanation

  -- Context for pattern extraction
  source TEXT,           -- 'slack', 'outlook', 'recording' — where the commitment was detected
  commitment_type TEXT,  -- 'deliverable', 'meeting', 'follow_up', etc.
  direction TEXT,        -- 'inbound', 'outbound'
  original_quote TEXT,   -- the text that triggered detection

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_commitment_feedback_team ON commitment_feedback(team_id, feedback);
CREATE INDEX idx_commitment_feedback_user ON commitment_feedback(user_id, feedback);

-- ── Draft edit tracking ──
-- When users edit an AI-generated draft before sending, the diff is implicit
-- feedback: heavy edits = AI got it wrong, no edits = AI got it right.
CREATE TABLE IF NOT EXISTS draft_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What changed
  original_subject TEXT,
  original_body TEXT,
  edited_subject TEXT,
  edited_body TEXT,
  edit_distance_pct REAL,  -- 0.0 (no edits) to 1.0 (complete rewrite)

  -- Context
  commitment_id UUID REFERENCES commitments(id) ON DELETE SET NULL,
  action TEXT,  -- 'sent', 'sent_edited', 'deleted', 'skipped'

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_draft_feedback_team ON draft_feedback(team_id, action);

-- RLS
ALTER TABLE commitment_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own commitment feedback"
  ON commitment_feedback FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all commitment feedback"
  ON commitment_feedback FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can manage own draft feedback"
  ON draft_feedback FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all draft feedback"
  ON draft_feedback FOR ALL
  USING (auth.role() = 'service_role');
