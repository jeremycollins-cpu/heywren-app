-- =============================================================================
-- Migration 020: Gamification — Points, Leaderboards, Achievements, Streaks
-- Metrics-only system: no content/text is ever stored, only counts and scores.
-- =============================================================================

-- ── 1. Weekly scores — snapshot of each member's activity per week ───────────

CREATE TABLE IF NOT EXISTS weekly_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Week identifier (Monday of the week)
  week_start DATE NOT NULL,

  -- Raw activity counts (no content, just numbers)
  commitments_created INTEGER DEFAULT 0,
  commitments_completed INTEGER DEFAULT 0,
  commitments_overdue INTEGER DEFAULT 0,
  missed_emails_resolved INTEGER DEFAULT 0,
  missed_chats_resolved INTEGER DEFAULT 0,
  meetings_attended INTEGER DEFAULT 0,
  action_items_generated INTEGER DEFAULT 0,
  on_time_completions INTEGER DEFAULT 0,
  avg_days_to_close REAL,              -- average days from creation to completion

  -- Calculated points
  points_earned INTEGER DEFAULT 0,      -- total points for this week
  bonus_points INTEGER DEFAULT 0,       -- streak multiplier bonus, etc.
  total_points INTEGER DEFAULT 0,       -- points_earned + bonus_points

  -- Response metrics
  response_rate REAL DEFAULT 0,         -- % of missed items addressed (0-100)
  on_time_rate REAL DEFAULT 0,          -- % completed before due date (0-100)

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, week_start)
);

CREATE INDEX idx_weekly_scores_org ON weekly_scores(organization_id);
CREATE INDEX idx_weekly_scores_dept ON weekly_scores(department_id);
CREATE INDEX idx_weekly_scores_team ON weekly_scores(team_id);
CREATE INDEX idx_weekly_scores_user ON weekly_scores(user_id);
CREATE INDEX idx_weekly_scores_week ON weekly_scores(week_start);
CREATE INDEX idx_weekly_scores_points ON weekly_scores(total_points DESC);
CREATE INDEX idx_weekly_scores_user_week ON weekly_scores(user_id, week_start DESC);

-- ── 2. All-time cumulative scores ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS member_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Lifetime totals
  total_points INTEGER DEFAULT 0,
  total_commitments_completed INTEGER DEFAULT 0,
  total_on_time INTEGER DEFAULT 0,
  total_missed_resolved INTEGER DEFAULT 0,
  total_weeks_active INTEGER DEFAULT 0,

  -- Current streak
  current_streak INTEGER DEFAULT 0,     -- consecutive weeks with points > threshold
  longest_streak INTEGER DEFAULT 0,
  streak_updated_at DATE,               -- last week the streak was evaluated

  -- Rankings (updated weekly)
  org_rank INTEGER,
  dept_rank INTEGER,
  team_rank INTEGER,
  prev_org_rank INTEGER,                -- last week's rank for delta display
  prev_dept_rank INTEGER,
  prev_team_rank INTEGER,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_member_scores_org ON member_scores(organization_id);
CREATE INDEX idx_member_scores_user ON member_scores(user_id);
CREATE INDEX idx_member_scores_points ON member_scores(total_points DESC);
CREATE INDEX idx_member_scores_streak ON member_scores(current_streak DESC);

CREATE TRIGGER update_member_scores_updated_at BEFORE UPDATE ON member_scores
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 3. Achievement definitions ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,            -- e.g. 'first_week', 'streak_4', 'closer_100'
  name TEXT NOT NULL,                   -- display name
  description TEXT NOT NULL,            -- what it takes to earn it
  category TEXT NOT NULL CHECK (category IN ('completion', 'response', 'streak', 'volume', 'speed', 'team')),
  tier TEXT NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
  icon TEXT NOT NULL DEFAULT 'trophy',  -- icon identifier for the UI
  threshold INTEGER NOT NULL,           -- the number to hit (e.g. 5 completions, 4 week streak)
  points_reward INTEGER DEFAULT 0,      -- bonus points awarded on unlock
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ── 4. Member achievements (earned badges) ──────────────────────────────────

CREATE TABLE IF NOT EXISTS member_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  week_earned DATE,                     -- which week triggered it
  UNIQUE(user_id, achievement_id)
);

CREATE INDEX idx_member_achievements_org ON member_achievements(organization_id);
CREATE INDEX idx_member_achievements_user ON member_achievements(user_id);
CREATE INDEX idx_member_achievements_earned ON member_achievements(earned_at DESC);

-- ── 5. Team challenges (time-boxed collective goals) ────────────────────────

CREATE TABLE IF NOT EXISTS team_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('organization', 'department', 'team')),
  scope_id UUID NOT NULL,               -- org_id, dept_id, or team_id depending on scope
  title TEXT NOT NULL,
  description TEXT,
  target_metric TEXT NOT NULL CHECK (target_metric IN ('commitments_completed', 'points_earned', 'response_rate', 'on_time_rate', 'streak_members')),
  target_value INTEGER NOT NULL,        -- goal to hit
  current_value INTEGER DEFAULT 0,      -- current progress
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'cancelled')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_team_challenges_org ON team_challenges(organization_id);
CREATE INDEX idx_team_challenges_status ON team_challenges(status);
CREATE INDEX idx_team_challenges_dates ON team_challenges(starts_at, ends_at);

CREATE TRIGGER update_team_challenges_updated_at BEFORE UPDATE ON team_challenges
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 6. Seed achievement definitions ─────────────────────────────────────────

INSERT INTO achievements (slug, name, description, category, tier, icon, threshold, points_reward, sort_order) VALUES
  -- Completion achievements (Bronze → Platinum)
  ('first_five',        'Getting Started',    'Complete your first 5 commitments',           'completion', 'bronze',   'rocket',     5,    25,  10),
  ('closer_25',         'Reliable',           'Complete 25 commitments',                      'completion', 'silver',   'check-circle', 25, 50,  11),
  ('closer_100',        'Closer',             'Complete 100 commitments',                     'completion', 'gold',     'award',      100,  100, 12),
  ('closer_500',        'Machine',            'Complete 500 commitments',                     'completion', 'platinum', 'zap',        500,  250, 13),

  -- Response achievements
  ('responder_10',      'On It',              'Resolve 10 missed emails or chats',            'response',   'bronze',   'mail',       10,   25,  20),
  ('responder_50',      'Inbox Hero',         'Resolve 50 missed emails or chats',            'response',   'silver',   'mail-check', 50,   50,  21),
  ('responder_200',     'Zero Inbox',         'Resolve 200 missed emails or chats',           'response',   'gold',     'inbox',      200,  100, 22),

  -- Streak achievements
  ('streak_2',          'Momentum',           'Stay productive for 2 consecutive weeks',      'streak',     'bronze',   'flame',      2,    25,  30),
  ('streak_4',          'Streak Machine',     'Stay productive for 4 consecutive weeks',      'streak',     'silver',   'flame',      4,    75,  31),
  ('streak_8',          'Unstoppable',        'Stay productive for 8 consecutive weeks',      'streak',     'gold',     'flame',      8,    150, 32),
  ('streak_16',         'Legendary',          'Stay productive for 16 consecutive weeks',     'streak',     'platinum', 'flame',      16,   300, 33),

  -- Speed achievements
  ('speed_demon',       'Speed Demon',        'Average close time under 1 day for a week',    'speed',      'silver',   'timer',      1,    50,  40),
  ('early_bird_5',      'Early Bird',         'Complete 5 items before their due date',        'speed',      'bronze',   'clock',      5,    25,  41),
  ('early_bird_25',     'Always Ahead',       'Complete 25 items before their due date',       'speed',      'silver',   'clock',      25,   75,  42),

  -- Volume achievements (weekly)
  ('power_week_20',     'Power Week',         'Earn 200+ points in a single week',            'volume',     'silver',   'trending-up', 200, 50,  50),
  ('power_week_50',     'Legendary Week',     'Earn 500+ points in a single week',            'volume',     'gold',     'trophy',     500,  150, 51),

  -- Team achievements
  ('team_player',       'Team Player',        'Respond to all mentions in a single week',     'team',       'bronze',   'users',      1,    25,  60),
  ('most_improved',     'Most Improved',      'Biggest points jump week over week',           'team',       'silver',   'trending-up', 1,   50,  61)
ON CONFLICT (slug) DO NOTHING;

-- ── 7. RLS Policies ────────────────────────────────────────────────────────

ALTER TABLE weekly_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_challenges ENABLE ROW LEVEL SECURITY;

-- Achievements definitions: readable by everyone
CREATE POLICY "Anyone can view achievement definitions"
  ON achievements FOR SELECT
  USING (true);

-- Weekly scores: visible based on org role (same pattern as org_members)
CREATE POLICY "Users can view weekly scores based on role"
  ON weekly_scores FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = weekly_scores.organization_id
      AND om.user_id = auth.uid()
      AND (
        om.role = 'org_admin'
        OR (om.role = 'dept_manager' AND om.department_id = weekly_scores.department_id)
        OR (om.role IN ('team_lead', 'member') AND om.team_id = weekly_scores.team_id)
      )
    )
  );

-- Member scores: same visibility pattern
CREATE POLICY "Users can view member scores based on role"
  ON member_scores FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = member_scores.organization_id
      AND om.user_id = auth.uid()
    )
  );

-- Member achievements: visible to org members
CREATE POLICY "Users can view member achievements in their org"
  ON member_achievements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = member_achievements.organization_id
      AND om.user_id = auth.uid()
    )
  );

-- Team challenges: visible to org members
CREATE POLICY "Users can view team challenges in their org"
  ON team_challenges FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM organization_members om
      WHERE om.organization_id = team_challenges.organization_id
      AND om.user_id = auth.uid()
    )
  );
