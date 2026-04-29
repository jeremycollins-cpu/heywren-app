-- Migration 083: Notes feature
--
-- Lets users snap photos of handwritten notes, presentation slides, whiteboards,
-- etc. and have them OCR'd + summarized by Claude vision, then organized into
-- hierarchical topics shareable with the team.
--
-- Tables:
--   note_topics  — hierarchical (parent_id self-FK), team-shareable
--   notes        — title, summary, transcription, body, status, note_date
--   note_images  — multi-image support; original photos retained for download
--
-- Storage bucket: `note-images` (private; signed URLs for download).

-- ─── note_topics ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  organization_id UUID,
  parent_id UUID REFERENCES note_topics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'indigo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_note_topics_team ON note_topics(team_id);
CREATE INDEX idx_note_topics_parent ON note_topics(parent_id);
CREATE INDEX idx_note_topics_user ON note_topics(user_id);

CREATE TRIGGER set_note_topics_updated_at
  BEFORE UPDATE ON note_topics
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS note_topics_set_org_id ON note_topics;
CREATE TRIGGER note_topics_set_org_id
  BEFORE INSERT ON note_topics
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();

ALTER TABLE note_topics ENABLE ROW LEVEL SECURITY;

-- Anyone in the same team can read topics (topics are team-shareable).
CREATE POLICY "Team members can view note topics"
  ON note_topics FOR SELECT
  USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Only the creator can modify their own topics.
CREATE POLICY "Users can insert own note topics"
  ON note_topics FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own note topics"
  ON note_topics FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own note topics"
  ON note_topics FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages note topics"
  ON note_topics FOR ALL
  USING (auth.role() = 'service_role');

-- ─── notes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  organization_id UUID,
  topic_id UUID REFERENCES note_topics(id) ON DELETE SET NULL,
  title TEXT,
  summary TEXT,            -- AI-generated executive summary
  transcription TEXT,      -- Raw OCR text (preserved verbatim)
  body TEXT,               -- User-editable; seeded from summary + transcription
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'ready', 'failed')),
  failure_reason TEXT,
  note_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Candidate todos / commitments extracted by AI; user accepts or dismisses.
  -- Shape: { todos: [{ title, accepted, dismissed }], commitments: [{ title, accepted, dismissed }] }
  extracted_actions JSONB NOT NULL DEFAULT '{"todos":[],"commitments":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notes_team ON notes(team_id);
CREATE INDEX idx_notes_user ON notes(user_id);
CREATE INDEX idx_notes_topic ON notes(topic_id);
CREATE INDEX idx_notes_user_date ON notes(user_id, note_date DESC);
CREATE INDEX idx_notes_status ON notes(status);

-- Full-text search across title, summary, transcription, body.
-- IMMUTABLE coalesce wrapper so the expression can be indexed.
CREATE INDEX idx_notes_fts ON notes USING GIN (
  to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(summary, '') || ' ' ||
    coalesce(transcription, '') || ' ' ||
    coalesce(body, '')
  )
);

CREATE TRIGGER set_notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS notes_set_org_id ON notes;
CREATE TRIGGER notes_set_org_id
  BEFORE INSERT ON notes
  FOR EACH ROW EXECUTE FUNCTION set_organization_id_from_team();

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- A user sees their own notes. Notes are not auto-shared with the team — only
-- topics are team-shareable so a teammate can attach their own notes to a
-- shared topic. Personal notes themselves stay private to the author.
CREATE POLICY "Users can view own notes"
  ON notes FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own notes"
  ON notes FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own notes"
  ON notes FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own notes"
  ON notes FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages notes"
  ON notes FOR ALL
  USING (auth.role() = 'service_role');

-- ─── note_images ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS note_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,    -- path within `note-images` bucket
  original_name TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  transcription TEXT,            -- per-image OCR (so we can show "page 3 said...")
  processed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_note_images_note ON note_images(note_id, position);
CREATE INDEX idx_note_images_user ON note_images(user_id);

ALTER TABLE note_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own note images"
  ON note_images FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own note images"
  ON note_images FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own note images"
  ON note_images FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own note images"
  ON note_images FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Service role manages note images"
  ON note_images FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Storage bucket ─────────────────────────────────────────────────────────
-- Private bucket; downloads via signed URLs from the API.
INSERT INTO storage.buckets (id, name, public)
VALUES ('note-images', 'note-images', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: a user can manage objects under a prefix matching their user_id.
-- Object paths are written as `<user_id>/<note_id>/<filename>` by the API.
CREATE POLICY "Users can read own note images in storage"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can upload own note images to storage"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own note images in storage"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'note-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ─── commitment source enum ─────────────────────────────────────────────────
-- Allow commitments extracted from notes to identify their origin.
ALTER TYPE commitment_source ADD VALUE IF NOT EXISTS 'note';
