-- Add last_active_at column to profiles for tracking actual platform usage.
-- Supabase's built-in last_sign_in_at only updates on login events,
-- so users who stay logged in appear stale. This column is updated
-- by middleware on every authenticated page visit (throttled to once per 5 min).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP WITH TIME ZONE;

-- Backfill from Supabase auth so existing users don't show "Never"
UPDATE profiles
SET last_active_at = auth_users.last_sign_in_at
FROM auth.users AS auth_users
WHERE profiles.id = auth_users.id
  AND profiles.last_active_at IS NULL
  AND auth_users.last_sign_in_at IS NOT NULL;
