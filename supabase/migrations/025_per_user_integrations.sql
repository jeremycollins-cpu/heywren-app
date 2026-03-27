-- Migration 025: Make integrations per-user instead of per-team
-- Previously: UNIQUE(team_id, provider) — one integration per team per provider
-- Now: UNIQUE(team_id, user_id, provider) — each user connects their own integrations

-- Step 1: Add user_id column (nullable initially for backfill)
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Step 2: Backfill user_id from config.connected_by (Slack) or config.microsoft_user_id mapping
-- For existing rows, use the connected_by field stored in config, or fall back to first team member
UPDATE integrations
SET user_id = COALESCE(
  -- Try connected_by from config (stored by Slack connect)
  (config->>'connected_by')::UUID,
  -- Fallback: first team member
  (SELECT tm.user_id FROM team_members tm WHERE tm.team_id = integrations.team_id LIMIT 1)
)
WHERE user_id IS NULL;

-- Step 3: Make user_id NOT NULL now that backfill is done
ALTER TABLE integrations ALTER COLUMN user_id SET NOT NULL;

-- Step 4: Drop the old unique constraint and add the new one
ALTER TABLE integrations DROP CONSTRAINT IF EXISTS integrations_team_id_provider_key;
ALTER TABLE integrations ADD CONSTRAINT integrations_team_id_user_id_provider_key UNIQUE(team_id, user_id, provider);

-- Step 5: Add index for common query patterns
CREATE INDEX IF NOT EXISTS idx_integrations_user_provider ON integrations(user_id, provider);

-- Step 6: Also add user_id to platform_sync_cursors if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_sync_cursors') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'platform_sync_cursors' AND column_name = 'user_id') THEN
      ALTER TABLE platform_sync_cursors ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
      -- Backfill from integrations
      UPDATE platform_sync_cursors psc
      SET user_id = (
        SELECT i.user_id FROM integrations i
        WHERE i.team_id = psc.team_id AND i.provider = psc.provider
        LIMIT 1
      );
    END IF;
  END IF;
END $$;

-- Step 7: RLS policy for integrations — users can only see their own
DROP POLICY IF EXISTS "Team members can view integrations" ON integrations;
CREATE POLICY "Users can view own integrations" ON integrations
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can manage own integrations" ON integrations
  FOR ALL USING (user_id = auth.uid());
