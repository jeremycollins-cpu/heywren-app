// inngest/functions/schedule-recall-bots.ts
// Auto-schedules HeyWren Notetaker bots for upcoming meetings with 3+ attendees.
// Runs every 15 minutes, scans calendar events in the next 30 minutes,
// and dispatches Recall.ai bots for eligible meetings.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { createBot, detectPlatform } from '@/lib/recall/client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── Main cron: scan calendars and dispatch bots ──

export const scheduleRecallBots = inngest.createFunction(
  {
    id: 'schedule-recall-bots',
    retries: 2,
    concurrency: { limit: 3 },
  },
  { cron: '*/15 * * * *' }, // Every 15 minutes
  async ({ step }) => {
    const supabase = getAdminClient()

    // Find teams with notetaker enabled
    const settings = await step.run('load-notetaker-settings', async () => {
      const { data } = await supabase
        .from('notetaker_settings')
        .select('*')
        .eq('auto_record_enabled', true)

      return data || []
    })

    if (settings.length === 0) {
      return { success: true, message: 'No teams with notetaker enabled' }
    }

    let totalDispatched = 0

    for (const setting of settings) {
      const dispatched = await step.run(`scan-team-${setting.team_id}`, async () => {
        return scanAndDispatchForTeam(supabase, setting)
      })
      totalDispatched += dispatched
    }

    return { success: true, dispatched: totalDispatched }
  }
)

async function scanAndDispatchForTeam(
  supabase: any,
  setting: any
): Promise<number> {
  const teamId = setting.team_id
  const minAttendees = setting.min_attendees || 3

  // Check billing: has the user exceeded their free tier?
  if (setting.notetaker_plan === 'free') {
    const used = setting.meetings_recorded_this_month || 0
    const limit = setting.free_meetings_limit || 2
    if (used >= limit) {
      return 0 // Free tier exhausted
    }
  }

  // Look for calendar events starting in the next 5-30 minutes
  // (5 min buffer so bot can join before the meeting starts)
  const now = new Date()
  const windowStart = new Date(now.getTime() + 5 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 30 * 60 * 1000)

  // Query calendar_events for this team's users
  const { data: events } = await supabase
    .from('calendar_events')
    .select('*')
    .eq('team_id', teamId)
    .gte('start_time', windowStart.toISOString())
    .lte('start_time', windowEnd.toISOString())
    .not('meeting_url', 'is', null)

  if (!events?.length) return 0

  let dispatched = 0

  for (const event of events) {
    // ── 3+ attendee filter ──
    const attendeeCount = Array.isArray(event.attendees) ? event.attendees.length : 0
    // Include organizer in count if not in attendees list
    const totalParticipants = attendeeCount + (event.organizer_email ? 1 : 0)

    if (totalParticipants < minAttendees) {
      continue // Skip 1:1s and small meetings
    }

    // Check if we already have a bot scheduled for this event
    const { data: existingBot } = await supabase
      .from('recall_bot_sessions')
      .select('id')
      .eq('calendar_event_id', event.event_id)
      .eq('team_id', teamId)
      .not('recall_status', 'in', '("error","cancelled")')
      .limit(1)
      .single()

    if (existingBot) continue // Already scheduled

    // Check for a valid meeting URL
    const meetingUrl = event.meeting_url || event.online_meeting_url
    if (!meetingUrl) continue

    try {
      // Create the Recall.ai bot
      const botName = setting.bot_display_name || 'HeyWren Notetaker'
      const recallBot = await createBot({
        meetingUrl,
        botName,
        joinAt: event.start_time, // Join at meeting start
      })

      // Record the session
      await supabase.from('recall_bot_sessions').insert({
        team_id: teamId,
        user_id: setting.user_id,
        recall_bot_id: recallBot.id,
        recall_status: 'pending',
        calendar_event_id: event.event_id,
        meeting_url: meetingUrl,
        meeting_title: event.subject || event.title || 'Meeting',
        meeting_platform: detectPlatform(meetingUrl),
        scheduled_start: event.start_time,
        attendee_count: totalParticipants,
        trigger_type: 'auto',
      })

      // Increment monthly usage counter
      await supabase
        .from('notetaker_settings')
        .update({
          meetings_recorded_this_month: (setting.meetings_recorded_this_month || 0) + 1,
        })
        .eq('id', setting.id)

      dispatched++
    } catch (err) {
      console.error(`[schedule-recall-bots] Failed to create bot for event ${event.event_id}:`, err)
    }
  }

  return dispatched
}

// ── Manual bot dispatch: user clicks "Record this meeting" ──

export const dispatchManualRecallBot = inngest.createFunction(
  {
    id: 'dispatch-manual-recall-bot',
    retries: 3,
  },
  { event: 'recall/bot.manual' },
  async ({ event, step }) => {
    const supabase = getAdminClient()
    const {
      team_id: teamId,
      user_id: userId,
      meeting_url: meetingUrl,
      meeting_title: meetingTitle,
    } = event.data as {
      team_id: string
      user_id: string
      meeting_url: string
      meeting_title?: string
    }

    // Load team's bot display name
    const setting = await step.run('load-settings', async () => {
      const { data } = await supabase
        .from('notetaker_settings')
        .select('bot_display_name, notetaker_plan, meetings_recorded_this_month, free_meetings_limit')
        .eq('team_id', teamId)
        .single()
      return data
    })

    // Check billing for free tier (manual still counts)
    if (setting?.notetaker_plan === 'free') {
      const used = setting.meetings_recorded_this_month || 0
      const limit = setting.free_meetings_limit || 2
      if (used >= limit) {
        return { success: false, error: 'Free tier limit reached. Upgrade to record more meetings.' }
      }
    }

    const recallBot = await step.run('create-recall-bot', async () => {
      return createBot({
        meetingUrl,
        botName: setting?.bot_display_name || 'HeyWren Notetaker',
      })
    })

    await step.run('insert-session', async () => {
      await supabase.from('recall_bot_sessions').insert({
        team_id: teamId,
        user_id: userId,
        recall_bot_id: recallBot.id,
        recall_status: 'pending',
        meeting_url: meetingUrl,
        meeting_title: meetingTitle || 'Manual Recording',
        meeting_platform: detectPlatform(meetingUrl),
        scheduled_start: new Date().toISOString(),
        trigger_type: 'manual',
      })

      // Increment usage
      if (setting) {
        await supabase
          .from('notetaker_settings')
          .update({
            meetings_recorded_this_month: (setting.meetings_recorded_this_month || 0) + 1,
          })
          .eq('team_id', teamId)
      }
    })

    return { success: true, botId: recallBot.id }
  }
)
