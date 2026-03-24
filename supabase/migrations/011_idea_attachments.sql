-- Add attachment support to feature requests
-- Uses a JSONB array to support multiple attachments per idea

ALTER TABLE feature_requests
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Each attachment entry: { url: string, name: string, type: string, size: number }

COMMENT ON COLUMN feature_requests.attachments IS 'Array of attachment objects: [{url, name, type, size}]';

-- Add team_id to feature_requests if not present (for team scoping)
ALTER TABLE feature_requests
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

-- Create storage bucket for idea attachments (run via Supabase dashboard or CLI)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('idea-attachments', 'idea-attachments', true)
-- ON CONFLICT DO NOTHING;
