-- Migration 018: Community Signals — "Teach Wren"
--
-- Enables users to submit real-world examples of things HeyWren missed or got wrong.
-- An AI validation pipeline assesses each submission, and high-confidence validated
-- signals are promoted to "community patterns" that improve detection for all users.
--
-- This is the "community builds the product" feature.

-- ── Community signal submissions ──
CREATE TABLE IF NOT EXISTS community_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,

  -- What happened
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'missed_email',        -- Email that should have been flagged
    'missed_chat',         -- Slack message that should have been caught
    'wrong_priority',      -- Detected but wrong urgency/priority
    'false_positive',      -- Flagged but shouldn't have been
    'missing_pattern',     -- A pattern HeyWren doesn't recognize yet
    'other'
  )),

  -- The example
  title TEXT NOT NULL,                   -- Short description: "Vendor follow-up not flagged as urgent"
  description TEXT NOT NULL,             -- Detailed explanation of what happened and why it matters
  example_content TEXT,                  -- The actual message/email content (optional, for context)
  expected_behavior TEXT NOT NULL,       -- What HeyWren SHOULD have done
  source_platform TEXT CHECK (source_platform IN ('email', 'slack', 'teams', 'zoom', 'other')),

  -- AI validation
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN (
    'pending',             -- Awaiting AI review
    'validated',           -- AI confirmed this is a valid, actionable signal
    'promoted',            -- Validated + incorporated into detection patterns
    'rejected',            -- AI determined this is not actionable (with reason)
    'duplicate'            -- Similar signal already exists
  )),
  validation_confidence REAL CHECK (validation_confidence >= 0 AND validation_confidence <= 1),
  validation_reason TEXT,                -- AI explanation of why it was validated/rejected
  extracted_pattern TEXT,                -- The detection pattern extracted by AI (e.g. "vendor follow-ups should be high urgency")

  -- Attachments (screenshots, documents, etc.)
  attachments JSONB DEFAULT '[]'::jsonb,

  -- Community engagement
  vote_count INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Votes on community signals ──
CREATE TABLE IF NOT EXISTS community_signal_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID NOT NULL REFERENCES community_signals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(signal_id, user_id)
);

-- ── Promoted patterns (validated signals that feed into detection) ──
CREATE TABLE IF NOT EXISTS community_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES community_signals(id) ON DELETE SET NULL,

  -- The pattern itself
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'urgency_boost',       -- "This type of message should be higher urgency"
    'new_detection',       -- "This is a new pattern to detect"
    'priority_rule',       -- "Adjust priority scoring for this scenario"
    'sender_context',      -- "This sender relationship type matters"
    'response_time'        -- "This situation expects faster response"
  )),
  pattern_description TEXT NOT NULL,     -- Human-readable description
  pattern_rule TEXT NOT NULL,            -- Machine-readable rule for the AI prompt
  applies_to TEXT NOT NULL CHECK (applies_to IN ('email', 'slack', 'both')),

  -- Effectiveness tracking
  active BOOLEAN NOT NULL DEFAULT TRUE,
  times_applied INTEGER NOT NULL DEFAULT 0,
  positive_feedback INTEGER NOT NULL DEFAULT 0,
  negative_feedback INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_community_signals_team ON community_signals(team_id);
CREATE INDEX IF NOT EXISTS idx_community_signals_status ON community_signals(validation_status);
CREATE INDEX IF NOT EXISTS idx_community_signals_type ON community_signals(signal_type);
CREATE INDEX IF NOT EXISTS idx_community_signals_votes ON community_signals(vote_count DESC);
CREATE INDEX IF NOT EXISTS idx_community_signal_votes_signal ON community_signal_votes(signal_id);
CREATE INDEX IF NOT EXISTS idx_community_signal_votes_user ON community_signal_votes(user_id);
CREATE INDEX IF NOT EXISTS idx_community_patterns_active ON community_patterns(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_community_patterns_type ON community_patterns(pattern_type);

-- RLS
ALTER TABLE community_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_signal_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_patterns ENABLE ROW LEVEL SECURITY;

-- Signals: anyone can read, team members can create
CREATE POLICY "Anyone can view community signals"
  ON community_signals FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create signals"
  ON community_signals FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authors can update own signals"
  ON community_signals FOR UPDATE
  USING (user_id = auth.uid());

-- Votes: anyone can read, authenticated can vote
CREATE POLICY "Anyone can view votes"
  ON community_signal_votes FOR SELECT USING (true);

CREATE POLICY "Authenticated users can vote"
  ON community_signal_votes FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can remove own votes"
  ON community_signal_votes FOR DELETE
  USING (user_id = auth.uid());

-- Patterns: anyone can read, service role manages
CREATE POLICY "Anyone can view community patterns"
  ON community_patterns FOR SELECT USING (true);

CREATE POLICY "Service role can manage patterns"
  ON community_patterns FOR ALL
  USING (auth.role() = 'service_role');

-- Triggers
CREATE TRIGGER set_community_signals_updated_at
  BEFORE UPDATE ON community_signals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_community_patterns_updated_at
  BEFORE UPDATE ON community_patterns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
