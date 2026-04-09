-- Add recipient_gap to missed_emails.category constraint
-- This new category flags emails where someone is mentioned by name
-- and asked a question but not included in To/CC recipients.

ALTER TABLE missed_emails DROP CONSTRAINT IF EXISTS missed_emails_category_check;
ALTER TABLE missed_emails ADD CONSTRAINT missed_emails_category_check
  CHECK (category IN ('question', 'request', 'decision', 'follow_up', 'introduction', 'recipient_gap'));
