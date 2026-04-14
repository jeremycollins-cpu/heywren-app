-- Migration 066: Platform AI usage tracking
--
-- Logs HeyWren's own Anthropic API costs per Inngest function run.
-- Each row = one AI pipeline execution (e.g. one scan-missed-emails run
-- for a team, one meeting transcript processing, one daily draft generation).
--
-- The super-admin AI Cost Dashboard aggregates this for total spend,
-- per-module breakdown, daily trends, and per-team costs.

CREATE TABLE IF NOT EXISTS ai_platform_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Which AI module ran: 'detect-commitments', 'classify-missed-email',
  -- 'generate-drafts', 'generate-meeting-summary', 'detect-email-threats',
  -- 'detect-completion', 'generate-coaching', 'generate-themes', etc.
  module TEXT NOT NULL,

  -- Inngest function or API route that triggered the module
  trigger TEXT,

  -- Model used (typically 'claude-haiku-4-5-20251001')
  model TEXT NOT NULL DEFAULT 'claude-haiku-4-5-20251001',

  -- Token counts from the Anthropic API response
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,

  -- Estimated cost in USD cents (calculated from token counts + model pricing)
  estimated_cost_cents NUMERIC(10, 4) NOT NULL DEFAULT 0,

  -- How many items were processed (e.g. messages scanned, emails classified)
  items_processed INTEGER NOT NULL DEFAULT 0,

  -- Free-form context (e.g. batch size, tiers filtered, errors)
  metadata JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Query patterns: admin dashboard aggregates by date, module, and team
CREATE INDEX idx_ai_platform_usage_created ON ai_platform_usage(created_at DESC);
CREATE INDEX idx_ai_platform_usage_module_created ON ai_platform_usage(module, created_at DESC);
CREATE INDEX idx_ai_platform_usage_team_created ON ai_platform_usage(team_id, created_at DESC);

-- No RLS — only accessed via service-role from Inngest functions and admin API routes
