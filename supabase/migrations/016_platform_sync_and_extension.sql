-- Migration 016: Platform Sync & Chrome Extension Support
--
-- Adds support for:
--   1. Chrome extension as a transcript source (real-time caption capture)
--   2. Zoom OAuth integration (cloud recording transcript sync)
--   3. Google Meet integration (recording transcript sync)
--   4. Microsoft Teams recording transcript sync (extends existing Outlook OAuth)
--
-- Also adds a platform_sync_cursors table to track last-synced state per integration.

-- ── Extend provider check constraint on meeting_transcripts ──
-- Add 'chrome_extension' as a valid provider
ALTER TABLE meeting_transcripts DROP CONSTRAINT IF EXISTS meeting_transcripts_provider_check;
ALTER TABLE meeting_transcripts ADD CONSTRAINT meeting_transcripts_provider_check
  CHECK (provider IN ('zoom', 'teams', 'google_meet', 'manual', 'chrome_extension'));

-- ── Platform sync cursors ──
-- Tracks the last sync point for each integration so we only pull new recordings.
CREATE TABLE IF NOT EXISTS platform_sync_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('zoom', 'google_meet', 'teams')),

  -- Cursor state
  last_synced_at TIMESTAMP WITH TIME ZONE,
  last_recording_id TEXT,           -- Platform-specific ID of last synced recording
  cursor_token TEXT,                -- Pagination cursor / next page token

  -- Sync metadata
  sync_status TEXT DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
  sync_error TEXT,
  recordings_synced INTEGER DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(team_id, provider)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_platform_sync_cursors_team ON platform_sync_cursors(team_id);
CREATE INDEX IF NOT EXISTS idx_platform_sync_cursors_status ON platform_sync_cursors(sync_status);

-- RLS
ALTER TABLE platform_sync_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view sync cursors" ON platform_sync_cursors
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = platform_sync_cursors.team_id
  AND tm.user_id = auth.uid()
));

CREATE POLICY "Team members can manage sync cursors" ON platform_sync_cursors
FOR ALL
USING (EXISTS (
  SELECT 1 FROM team_members tm
  WHERE tm.team_id = platform_sync_cursors.team_id
  AND tm.user_id = auth.uid()
));

-- ── Extension auth tokens ──
-- Stores Chrome extension authentication tokens linked to user sessions.
CREATE TABLE IF NOT EXISTS extension_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  token_hash TEXT NOT NULL UNIQUE,   -- SHA-256 hash of the token (never store plaintext)
  device_name TEXT,                  -- e.g., "Chrome on MacBook Pro"

  last_used_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_extension_tokens_hash ON extension_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_extension_tokens_user ON extension_tokens(user_id);

ALTER TABLE extension_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own extension tokens" ON extension_tokens
FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can manage own extension tokens" ON extension_tokens
FOR ALL
USING (user_id = auth.uid());

-- Trigger for updated_at on sync cursors
CREATE TRIGGER update_platform_sync_cursors_updated_at BEFORE UPDATE ON platform_sync_cursors
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
