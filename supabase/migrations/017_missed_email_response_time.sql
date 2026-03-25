-- Migration 017: Add expected_response_time to missed_emails
--
-- Tracks the AI-estimated expected response time for each email,
-- enabling urgency escalation when emails sit longer than expected.

ALTER TABLE missed_emails
  ADD COLUMN IF NOT EXISTS expected_response_time TEXT
    CHECK (expected_response_time IN ('same_day', 'next_day', 'this_week', 'no_rush'));
