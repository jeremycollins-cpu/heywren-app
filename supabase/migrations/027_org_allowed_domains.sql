-- Add allowed_domains array to organizations for multi-domain companies
-- The primary 'domain' column remains as the main domain; allowed_domains lists additional ones

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS allowed_domains JSONB DEFAULT '[]'::jsonb;

-- Backfill: seed allowed_domains with the existing primary domain where set
UPDATE organizations
SET allowed_domains = jsonb_build_array(domain)
WHERE domain IS NOT NULL AND domain != '' AND (allowed_domains IS NULL OR allowed_domains = '[]'::jsonb);
