-- 049: Calendar protection — boundaries and conflict tracking
-- Stores user-defined calendar boundaries (meeting limits, protected hours, focus days)
-- and detected conflicts for resolution.

-- ── calendar_boundaries: user preferences for calendar protection ────────
CREATE TABLE IF NOT EXISTS calendar_boundaries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Daily limits
  max_meeting_hours_per_day REAL DEFAULT 4,          -- max hours of meetings per day
  max_meetings_per_day INTEGER DEFAULT 6,            -- max number of meetings per day

  -- Protected time
  no_meetings_before TIME DEFAULT '09:00',           -- no meetings before this time
  no_meetings_after TIME DEFAULT '17:00',            -- no meetings after this time
  focus_days INTEGER[] DEFAULT '{}',                 -- days with no meetings (0=Sun..6=Sat)
  min_break_between_meetings INTEGER DEFAULT 0,      -- minimum minutes between meetings

  -- Notifications
  conflict_alerts BOOLEAN DEFAULT true,              -- alert on overlapping meetings
  boundary_alerts BOOLEAN DEFAULT true,              -- alert when boundaries are violated
  weekly_calendar_summary BOOLEAN DEFAULT true,      -- include calendar stats in weekly reflection

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(team_id, user_id)
);

CREATE INDEX idx_calendar_boundaries_user ON calendar_boundaries(team_id, user_id);

-- RLS
ALTER TABLE calendar_boundaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own boundaries"
  ON calendar_boundaries FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own boundaries"
  ON calendar_boundaries FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own boundaries"
  ON calendar_boundaries FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all boundaries"
  ON calendar_boundaries FOR ALL
  USING (auth.role() = 'service_role');


-- ── calendar_conflicts: detected overlapping or boundary-violating events ──
CREATE TABLE IF NOT EXISTS calendar_conflicts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Conflict type
  conflict_type TEXT NOT NULL CHECK (conflict_type IN (
    'overlap',              -- two meetings at the same time
    'exceeds_daily_hours',  -- total meeting hours exceed max
    'exceeds_daily_count',  -- total meetings exceed max count
    'outside_hours',        -- meeting outside protected hours
    'focus_day',            -- meeting on a focus day
    'no_break'              -- back-to-back with insufficient break
  )),

  -- Events involved
  event_a_id TEXT NOT NULL,           -- outlook_calendar_events.event_id
  event_a_subject TEXT,
  event_a_start TIMESTAMPTZ NOT NULL,
  event_a_end TIMESTAMPTZ NOT NULL,
  event_b_id TEXT,                    -- null for non-overlap conflicts
  event_b_subject TEXT,
  event_b_start TIMESTAMPTZ,
  event_b_end TIMESTAMPTZ,

  -- Details
  conflict_date DATE NOT NULL,
  description TEXT,                   -- human-readable description
  severity TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),

  -- Resolution
  status TEXT DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'resolved', 'dismissed')),
  resolution TEXT,                    -- how it was resolved
  resolved_at TIMESTAMPTZ,

  detected_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Avoid duplicate conflict detection
  UNIQUE(team_id, user_id, conflict_type, event_a_id, COALESCE(event_b_id, 'none'), conflict_date)
);

CREATE INDEX idx_calendar_conflicts_user ON calendar_conflicts(team_id, user_id, status);
CREATE INDEX idx_calendar_conflicts_date ON calendar_conflicts(user_id, conflict_date);

-- RLS
ALTER TABLE calendar_conflicts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own conflicts"
  ON calendar_conflicts FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own conflicts"
  ON calendar_conflicts FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all conflicts"
  ON calendar_conflicts FOR ALL
  USING (auth.role() = 'service_role');
