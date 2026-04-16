-- Migration 069: Monthly Briefings
--
-- HeyWren's "personal business consultant" feature.
--
-- A monthly briefing is an AI-synthesized executive summary of the past month's
-- work, structured into sections (Highlights, Risks, Priorities, Projects, etc.)
-- The user can upload supporting context (slides, spreadsheets, screenshots),
-- chat to refine each section, and edit sections directly.
--
-- Tables:
--   monthly_briefings   — one row per (user, period); the briefing envelope
--   briefing_sections   — the structured content blocks; user-editable
--   briefing_uploads    — supporting files uploaded for context
--   briefing_messages   — chat-to-refine history (per briefing)
--
-- Storage:
--   briefing-context bucket — holds the uploaded source files (private).

-- ── monthly_briefings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Period this briefing covers (period_start is the 1st of the month UTC).
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  title TEXT,                        -- e.g. "March 2026 Briefing"
  subtitle TEXT,                     -- optional headline / theme
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'aggregating', 'extracting', 'synthesizing', 'ready', 'failed')),
  status_detail TEXT,                -- human-readable progress message
  error_message TEXT,                -- populated if status='failed'

  -- Snapshot of the aggregated data the AI synthesized from
  -- (kept so we can re-render or re-synthesize without re-aggregating).
  data_snapshot JSONB DEFAULT '{}'::jsonb,

  -- Aggregate cost tracking for this briefing
  total_cost_cents NUMERIC(10, 4) DEFAULT 0,

  generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One briefing per user per month (re-generation overwrites in place).
  UNIQUE (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_monthly_briefings_team ON monthly_briefings(team_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_briefings_user ON monthly_briefings(user_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_briefings_status ON monthly_briefings(status) WHERE status NOT IN ('ready', 'failed');

-- ── briefing_sections ──────────────────────────────────────────────────
-- Each briefing has many sections. Section types are open-ended so the AI
-- can introduce new sections (e.g. "UK Focus") when the data warrants it.
CREATE TABLE IF NOT EXISTS briefing_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID NOT NULL REFERENCES monthly_briefings(id) ON DELETE CASCADE,

  -- Canonical section types: highlights, risks, priorities, projects,
  -- context, lowlights, custom. Free-form so the AI can add ad-hoc sections.
  section_type TEXT NOT NULL,
  title TEXT NOT NULL,                       -- e.g. "Highlights", "Risks", "UK Attainment"
  summary TEXT,                              -- 1-3 sentence overview
  bullets JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ heading, detail, severity?, evidence? }]
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  order_index INTEGER NOT NULL DEFAULT 0,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,     -- user pinned this section
  user_edited BOOLEAN NOT NULL DEFAULT FALSE, -- regen will skip user-edited sections unless forced

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefing_sections_briefing ON briefing_sections(briefing_id, order_index);

-- ── briefing_uploads ──────────────────────────────────────────────────
-- Files the user uploaded as additional context for a briefing.
-- file_path points at an object in the 'briefing-context' storage bucket.
CREATE TABLE IF NOT EXISTS briefing_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID NOT NULL REFERENCES monthly_briefings(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,                   -- key in storage bucket
  mime_type TEXT,
  file_kind TEXT NOT NULL                    -- coarse classifier for the extractor
    CHECK (file_kind IN ('pdf', 'pptx', 'docx', 'xlsx', 'csv', 'image', 'text', 'other')),
  size_bytes INTEGER,

  -- Extraction state
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'extracting', 'ready', 'failed', 'skipped')),
  extracted_text TEXT,                       -- raw extracted text (truncated to budget)
  extracted_summary TEXT,                    -- AI-condensed summary used during synthesis
  extraction_error TEXT,

  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_briefing_uploads_briefing ON briefing_uploads(briefing_id);
CREATE INDEX IF NOT EXISTS idx_briefing_uploads_status ON briefing_uploads(extraction_status) WHERE extraction_status IN ('pending', 'extracting');

-- ── briefing_messages ─────────────────────────────────────────────────
-- Chat-to-refine history. Messages may carry a target_section_id when the
-- user is iterating on a specific section.
CREATE TABLE IF NOT EXISTS briefing_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id UUID NOT NULL REFERENCES monthly_briefings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  target_section_id UUID REFERENCES briefing_sections(id) ON DELETE SET NULL,

  -- Captures any structured action the assistant took (e.g. updated section X)
  action JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefing_messages_briefing ON briefing_messages(briefing_id, created_at);

-- ── updated_at triggers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_monthly_briefing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_monthly_briefings_updated_at ON monthly_briefings;
CREATE TRIGGER trg_monthly_briefings_updated_at
  BEFORE UPDATE ON monthly_briefings
  FOR EACH ROW EXECUTE FUNCTION set_monthly_briefing_updated_at();

DROP TRIGGER IF EXISTS trg_briefing_sections_updated_at ON briefing_sections;
CREATE TRIGGER trg_briefing_sections_updated_at
  BEFORE UPDATE ON briefing_sections
  FOR EACH ROW EXECUTE FUNCTION set_monthly_briefing_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────
ALTER TABLE monthly_briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefing_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefing_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefing_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own monthly briefings"
  ON monthly_briefings FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages all monthly briefings"
  ON monthly_briefings FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users access sections of their briefings"
  ON briefing_sections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM monthly_briefings mb
      WHERE mb.id = briefing_sections.briefing_id
      AND mb.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role manages all briefing sections"
  ON briefing_sections FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users access uploads of their briefings"
  ON briefing_uploads FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages all briefing uploads"
  ON briefing_uploads FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users access messages of their briefings"
  ON briefing_messages FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages all briefing messages"
  ON briefing_messages FOR ALL
  USING (auth.role() = 'service_role');

-- ── Storage bucket for uploaded context files ─────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('briefing-context', 'briefing-context', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can read/write objects under their own user-id prefix.
-- Convention: object key = "{user_id}/{briefing_id}/{file_name}"
DROP POLICY IF EXISTS "Users read own briefing context files" ON storage.objects;
CREATE POLICY "Users read own briefing context files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'briefing-context'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users upload own briefing context files" ON storage.objects;
CREATE POLICY "Users upload own briefing context files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'briefing-context'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users delete own briefing context files" ON storage.objects;
CREATE POLICY "Users delete own briefing context files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'briefing-context'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Service role manages all briefing context files" ON storage.objects;
CREATE POLICY "Service role manages all briefing context files"
  ON storage.objects FOR ALL
  USING (auth.role() = 'service_role' AND bucket_id = 'briefing-context');
