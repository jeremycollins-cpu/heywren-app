-- Migration 072: Add columns for encrypted OAuth tokens (AES-256-GCM)
--
-- The new columns store the ciphertext, IV, and auth tag for each token.
-- During the migration period both the original plaintext columns and the
-- encrypted columns coexist. After the backfill script has been run and
-- verified, a future migration should DROP access_token and refresh_token.

-- Encrypted access token
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS encrypted_access_token TEXT,
  ADD COLUMN IF NOT EXISTS access_token_iv         TEXT,
  ADD COLUMN IF NOT EXISTS access_token_tag         TEXT;

-- Encrypted refresh token
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS encrypted_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_iv         TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token_tag         TEXT;

-- Add a comment for future reference
COMMENT ON COLUMN integrations.encrypted_access_token IS 'AES-256-GCM ciphertext of access_token (base64). See lib/crypto/integration-tokens.ts.';
COMMENT ON COLUMN integrations.encrypted_refresh_token IS 'AES-256-GCM ciphertext of refresh_token (base64). See lib/crypto/integration-tokens.ts.';
