-- Add pending_review and dismissed to commitment_status enum.
-- pending_review: auto-detected commitments that need user confirmation
-- dismissed: rejected commitments that don't count toward metrics

ALTER TYPE commitment_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE commitment_status ADD VALUE IF NOT EXISTS 'dismissed';
