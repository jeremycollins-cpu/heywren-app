-- 047: Email folder cache and inbox rule management
-- Enables "Organize" feature — one-click email routing with Outlook rule creation.
-- Similar to email_subscriptions (one-click unsubscribe), but for folder organization.

-- ── email_folders: cached copy of user's Outlook mail folders ────────────
CREATE TABLE IF NOT EXISTS email_folders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  folder_id TEXT NOT NULL,            -- Microsoft Graph folder ID
  display_name TEXT NOT NULL,
  parent_folder_id TEXT,              -- For nested folders (nullable = top-level)
  is_custom BOOLEAN DEFAULT false,    -- true = user-created, false = system folder (Inbox, Sent, etc.)
  message_count INTEGER DEFAULT 0,
  unread_count INTEGER DEFAULT 0,

  last_synced_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(team_id, user_id, folder_id)
);

CREATE INDEX idx_email_folders_user ON email_folders(team_id, user_id);

-- RLS
ALTER TABLE email_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own folders"
  ON email_folders FOR SELECT
  USING (
    user_id = auth.uid()
    OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Service role can manage all folders"
  ON email_folders FOR ALL
  USING (auth.role() = 'service_role');


-- ── email_rules: user-created inbox organization rules ──────────────────
CREATE TABLE IF NOT EXISTS email_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What to match
  match_type TEXT NOT NULL CHECK (match_type IN ('from_email', 'from_domain', 'subject_contains')),
  match_value TEXT NOT NULL,          -- e.g. "vendor@x.com", "x.com", or "invoice"

  -- What to do
  target_folder_id TEXT NOT NULL,     -- Microsoft Graph folder ID
  target_folder_name TEXT NOT NULL,   -- Cached display name for UI
  mark_as_read BOOLEAN DEFAULT false,

  -- Outlook sync state
  outlook_rule_id TEXT,               -- Graph messageRule ID (null until synced)
  sync_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'synced', 'failed', 'disabled')),
  sync_error TEXT,
  last_synced_at TIMESTAMPTZ,

  -- Stats
  emails_moved INTEGER DEFAULT 0,
  last_applied_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(team_id, user_id, match_type, match_value)
);

CREATE INDEX idx_email_rules_user ON email_rules(team_id, user_id);
CREATE INDEX idx_email_rules_match ON email_rules(user_id, match_type, match_value);

-- RLS
ALTER TABLE email_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own rules"
  ON email_rules FOR SELECT
  USING (
    user_id = auth.uid()
    OR team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create their own rules"
  ON email_rules FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own rules"
  ON email_rules FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own rules"
  ON email_rules FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all rules"
  ON email_rules FOR ALL
  USING (auth.role() = 'service_role');
