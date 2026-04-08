// inngest/functions/scan-calendar-conflicts.ts
// Scans each user's upcoming calendar events against their boundaries.
// Detects: overlaps, daily hour/count limits, outside-hours meetings, focus days, back-to-back.
// Runs at 7 AM PT weekdays — after sync-outlook (6 AM) pulls latest calendar data.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface CalEvent {
  event_id: string
  subject: string
  start_time: string
  end_time: string
}

interface Conflict {
  conflict_type: string
  event_a_id: string
  event_a_subject: string | null
  event_a_start: string
  event_a_end: string
  event_b_id: string | null
  event_b_subject: string | null
  event_b_start: string | null
  event_b_end: string | null
  conflict_date: string
  description: string
  severity: string
}

function eventsOverlap(a: CalEvent, b: CalEvent): boolean {
  const aStart = new Date(a.start_time).getTime()
  const aEnd = new Date(a.end_time).getTime()
  const bStart = new Date(b.start_time).getTime()
  const bEnd = new Date(b.end_time).getTime()
  return aStart < bEnd && bStart < aEnd
}

function minutesBetween(endA: string, startB: string): number {
  return (new Date(startB).getTime() - new Date(endA).getTime()) / 60000
}

function eventDurationMinutes(e: CalEvent): number {
  return (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 60000
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

export const scanCalendarConflicts = inngest.createFunction(
  { id: 'scan-calendar-conflicts', retries: 2, concurrency: { limit: 5 } },
  { cron: 'TZ=America/Los_Angeles 0 7 * * 1-5' }, // 7 AM PT weekdays
  async ({ step }) => {
    const supabase = getAdminClient()

    // Get all users with calendar boundaries configured
    const users = await step.run('fetch-users-with-boundaries', async () => {
      const { data } = await supabase
        .from('calendar_boundaries')
        .select('*')

      return data || []
    })

    if (users.length === 0) {
      return { success: true, scanned: 0, reason: 'No users with boundaries configured' }
    }

    let totalConflicts = 0
    let usersScanned = 0

    for (const boundary of users) {
      await step.run(`scan-${boundary.user_id}`, async () => {
        const now = new Date()
        const sevenDaysLater = new Date(now.getTime() + 7 * 86400000).toISOString()

        // Fetch upcoming events for this user
        const { data: events } = await supabase
          .from('outlook_calendar_events')
          .select('event_id, subject, start_time, end_time')
          .eq('team_id', boundary.team_id)
          .or(`user_id.eq.${boundary.user_id},user_id.is.null`)
          .eq('is_cancelled', false)
          .gte('start_time', now.toISOString())
          .lte('start_time', sevenDaysLater)
          .order('start_time', { ascending: true })

        if (!events || events.length === 0) return

        const conflicts: Conflict[] = []

        // Group events by date
        const eventsByDate = new Map<string, CalEvent[]>()
        for (const e of events) {
          const date = new Date(e.start_time).toISOString().split('T')[0]
          if (!eventsByDate.has(date)) eventsByDate.set(date, [])
          eventsByDate.get(date)!.push(e)
        }

        for (const [date, dayEvents] of eventsByDate) {
          const dayOfWeek = new Date(date).getDay()

          // ── Check: Focus day ──
          if (boundary.focus_days?.includes(dayOfWeek) && dayEvents.length > 0) {
            conflicts.push({
              conflict_type: 'focus_day',
              event_a_id: dayEvents[0].event_id,
              event_a_subject: dayEvents[0].subject,
              event_a_start: dayEvents[0].start_time,
              event_a_end: dayEvents[0].end_time,
              event_b_id: null,
              event_b_subject: null,
              event_b_start: null,
              event_b_end: null,
              conflict_date: date,
              description: `${dayEvents.length} meeting${dayEvents.length !== 1 ? 's' : ''} scheduled on your focus day`,
              severity: 'warning',
            })
          }

          // ── Check: Daily limits ──
          const totalMinutes = dayEvents.reduce((sum, e) => sum + eventDurationMinutes(e), 0)
          const totalHours = totalMinutes / 60

          if (boundary.max_meeting_hours_per_day && totalHours > boundary.max_meeting_hours_per_day) {
            conflicts.push({
              conflict_type: 'exceeds_daily_hours',
              event_a_id: dayEvents[0].event_id,
              event_a_subject: `${dayEvents.length} meetings`,
              event_a_start: dayEvents[0].start_time,
              event_a_end: dayEvents[dayEvents.length - 1].end_time,
              event_b_id: null,
              event_b_subject: null,
              event_b_start: null,
              event_b_end: null,
              conflict_date: date,
              description: `${totalHours.toFixed(1)}h of meetings exceeds your ${boundary.max_meeting_hours_per_day}h daily limit`,
              severity: totalHours > boundary.max_meeting_hours_per_day * 1.5 ? 'critical' : 'warning',
            })
          }

          if (boundary.max_meetings_per_day && dayEvents.length > boundary.max_meetings_per_day) {
            conflicts.push({
              conflict_type: 'exceeds_daily_count',
              event_a_id: dayEvents[0].event_id,
              event_a_subject: `${dayEvents.length} meetings`,
              event_a_start: dayEvents[0].start_time,
              event_a_end: dayEvents[dayEvents.length - 1].end_time,
              event_b_id: null,
              event_b_subject: null,
              event_b_start: null,
              event_b_end: null,
              conflict_date: date,
              description: `${dayEvents.length} meetings exceeds your limit of ${boundary.max_meetings_per_day}`,
              severity: 'warning',
            })
          }

          // ── Per-event checks ──
          for (let i = 0; i < dayEvents.length; i++) {
            const event = dayEvents[i]
            const eventStart = new Date(event.start_time)
            const eventStartMinutes = eventStart.getHours() * 60 + eventStart.getMinutes()
            const eventEnd = new Date(event.end_time)
            const eventEndMinutes = eventEnd.getHours() * 60 + eventEnd.getMinutes()

            // ── Check: Outside hours ──
            if (boundary.no_meetings_before) {
              const beforeLimit = timeToMinutes(boundary.no_meetings_before)
              if (eventStartMinutes < beforeLimit) {
                conflicts.push({
                  conflict_type: 'outside_hours',
                  event_a_id: event.event_id,
                  event_a_subject: event.subject,
                  event_a_start: event.start_time,
                  event_a_end: event.end_time,
                  event_b_id: null, event_b_subject: null, event_b_start: null, event_b_end: null,
                  conflict_date: date,
                  description: `"${event.subject}" starts before your ${boundary.no_meetings_before} boundary`,
                  severity: 'info',
                })
              }
            }

            if (boundary.no_meetings_after) {
              const afterLimit = timeToMinutes(boundary.no_meetings_after)
              if (eventEndMinutes > afterLimit) {
                conflicts.push({
                  conflict_type: 'outside_hours',
                  event_a_id: event.event_id,
                  event_a_subject: event.subject,
                  event_a_start: event.start_time,
                  event_a_end: event.end_time,
                  event_b_id: null, event_b_subject: null, event_b_start: null, event_b_end: null,
                  conflict_date: date,
                  description: `"${event.subject}" ends after your ${boundary.no_meetings_after} boundary`,
                  severity: 'info',
                })
              }
            }

            // ── Check: Overlap with next event ──
            for (let j = i + 1; j < dayEvents.length; j++) {
              const nextEvent = dayEvents[j]
              if (eventsOverlap(event, nextEvent)) {
                conflicts.push({
                  conflict_type: 'overlap',
                  event_a_id: event.event_id,
                  event_a_subject: event.subject,
                  event_a_start: event.start_time,
                  event_a_end: event.end_time,
                  event_b_id: nextEvent.event_id,
                  event_b_subject: nextEvent.subject,
                  event_b_start: nextEvent.start_time,
                  event_b_end: nextEvent.end_time,
                  conflict_date: date,
                  description: `"${event.subject}" overlaps with "${nextEvent.subject}"`,
                  severity: 'critical',
                })
              }
            }

            // ── Check: Insufficient break ──
            if (boundary.min_break_between_meetings && boundary.min_break_between_meetings > 0 && i < dayEvents.length - 1) {
              const nextEvent = dayEvents[i + 1]
              const gap = minutesBetween(event.end_time, nextEvent.start_time)
              if (gap >= 0 && gap < boundary.min_break_between_meetings) {
                conflicts.push({
                  conflict_type: 'no_break',
                  event_a_id: event.event_id,
                  event_a_subject: event.subject,
                  event_a_start: event.start_time,
                  event_a_end: event.end_time,
                  event_b_id: nextEvent.event_id,
                  event_b_subject: nextEvent.subject,
                  event_b_start: nextEvent.start_time,
                  event_b_end: nextEvent.end_time,
                  conflict_date: date,
                  description: `Only ${Math.round(gap)}min between "${event.subject}" and "${nextEvent.subject}" (need ${boundary.min_break_between_meetings}min)`,
                  severity: 'warning',
                })
              }
            }
          }
        }

        // Upsert conflicts (avoid duplicates via unique constraint)
        for (const conflict of conflicts) {
          await supabase
            .from('calendar_conflicts')
            .upsert(
              {
                team_id: boundary.team_id,
                user_id: boundary.user_id,
                ...conflict,
              },
              { onConflict: 'team_id,user_id,conflict_type,event_a_id,COALESCE(event_b_id, \'none\'),conflict_date' }
            )
        }

        totalConflicts += conflicts.length
        usersScanned++
      })
    }

    return { success: true, usersScanned, totalConflicts }
  }
)
