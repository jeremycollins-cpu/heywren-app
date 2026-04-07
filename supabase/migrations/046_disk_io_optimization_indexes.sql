-- 046: Add missing composite indexes to reduce Disk IO budget consumption
-- These cover the hottest query paths: sidebar badges, sync-outlook dedup,
-- drain-outlook-backlog scan, and missed-email scanning.

-- ── outlook_messages: duplicate check in sync-outlook (per-email lookup) ──
-- Query: .eq('team_id', x).eq('user_id', x).eq('message_id', x)
CREATE INDEX IF NOT EXISTS idx_outlook_messages_team_user_msgid
  ON outlook_messages(team_id, user_id, message_id);

-- ── outlook_messages: unprocessed scan in drain-outlook-backlog ──
-- Query: .eq('team_id', x).eq('user_id', x).eq('processed', false)
CREATE INDEX IF NOT EXISTS idx_outlook_messages_team_user_processed
  ON outlook_messages(team_id, user_id, processed)
  WHERE processed = false;

-- ── outlook_messages: received_at filter in scan-missed-emails & subscriptions ──
CREATE INDEX IF NOT EXISTS idx_outlook_messages_team_user_received
  ON outlook_messages(team_id, user_id, received_at DESC);

-- ── commitments: sidebar badge query (or filter on creator_id/assignee_id) ──
-- Query: .eq('team_id', x).or('creator_id.eq.X,assignee_id.eq.X').in('status', ['open','overdue'])
CREATE INDEX IF NOT EXISTS idx_commitments_team_creator_status
  ON commitments(team_id, creator_id, status);

CREATE INDEX IF NOT EXISTS idx_commitments_team_assignee_status
  ON commitments(team_id, assignee_id, status);

-- ── drafts: sidebar badge query ──
-- Query: .eq('team_id', x).eq('user_id', x).eq('status', 'pending')
CREATE INDEX IF NOT EXISTS idx_drafts_team_user_status
  ON draft_queue(team_id, user_id, status);

-- ── missed_chats: sidebar badge query ──
-- Query: .eq('team_id', x).eq('user_id', x).eq('status', 'pending')
CREATE INDEX IF NOT EXISTS idx_missed_chats_team_user_status
  ON missed_chats(team_id, user_id, status);

-- ── awaiting_replies: sidebar badge query ──
-- Query: .eq('team_id', x).eq('user_id', x).eq('status', 'waiting')
CREATE INDEX IF NOT EXISTS idx_awaiting_replies_team_user_status
  ON awaiting_replies(team_id, user_id, status);

-- ── outlook_calendar_events: scan-missed-emails meeting lookup ──
-- Query: .eq('team_id', x).eq('user_id', x).gte('start_time', x)
CREATE INDEX IF NOT EXISTS idx_outlook_calendar_team_user_start
  ON outlook_calendar_events(team_id, user_id, start_time);

-- ── notifications: header polling query ──
-- Query: .eq('user_id', x).eq('read', false)
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read)
  WHERE read = false;
