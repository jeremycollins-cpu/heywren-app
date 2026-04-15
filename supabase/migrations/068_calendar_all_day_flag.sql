-- Migration 068: Add is_all_day flag to calendar events
--
-- All-day events (holidays, OOO, birthdays) were being stored with
-- empty start_time/end_time, causing the meeting hours calculation
-- to produce garbage values (e.g. "662h in meetings this week").

ALTER TABLE outlook_calendar_events ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN DEFAULT FALSE;

-- Backfill: mark events with midnight-to-midnight times as all-day
UPDATE outlook_calendar_events
SET is_all_day = TRUE
WHERE start_time::time = '00:00:00'
  AND end_time::time = '00:00:00'
  AND start_time != end_time;
