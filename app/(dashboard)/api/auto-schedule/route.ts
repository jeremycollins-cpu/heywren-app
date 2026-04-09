// app/(dashboard)/api/auto-schedule/route.ts
// POST: Find a gap in the user's calendar and create an event for a todo.
// Uses Microsoft Graph API to read calendar and create events.
//
// Algorithm:
// 1. Fetch user's timezone from Outlook mailbox settings
// 2. Fetch all events for the next 5 business days (in true UTC)
// 3. Find gaps between events (respecting 15-min buffer)
// 4. Only schedule within work hours (converted to UTC from user's timezone)
// 5. Pick the first gap that fits the requested duration
// 6. Create the calendar event via Graph API in the user's timezone
// 7. Update the todo with the scheduled time

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getOutlookIntegration, graphFetch } from '@/lib/outlook/graph-client'
import { resolveTeamId } from '@/lib/team/resolve-team'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const BUFFER_MINUTES = 15 // Minimum gap between meetings
const SEARCH_DAYS = 5     // Look ahead 5 business days
const DEFAULT_WORK_START = '09:00'
const DEFAULT_WORK_END = '17:00'

interface TimeSlot {
  start: Date
  end: Date
}

// ── Timezone helpers ────────────────────────────────────────────────────

// Map common Windows timezone names → IANA timezone names
const WINDOWS_TO_IANA: Record<string, string> = {
  'Pacific Standard Time': 'America/Los_Angeles',
  'Mountain Standard Time': 'America/Denver',
  'US Mountain Standard Time': 'America/Phoenix',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'Atlantic Standard Time': 'America/Halifax',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'E. Europe Standard Time': 'Europe/Bucharest',
  'FLE Standard Time': 'Europe/Helsinki',
  'GTB Standard Time': 'Europe/Athens',
  'Russian Standard Time': 'Europe/Moscow',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Singapore Standard Time': 'Asia/Singapore',
  'Arabian Standard Time': 'Asia/Dubai',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Taipei Standard Time': 'Asia/Taipei',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
}

function toIana(windowsTz: string): string {
  return WINDOWS_TO_IANA[windowsTz] || 'America/Los_Angeles'
}

/**
 * Get the UTC offset in milliseconds for a given IANA timezone at a specific date.
 * Positive = UTC is ahead of local (e.g., +25200000 for PDT = UTC+7h ahead of Pacific).
 */
function getUtcOffsetMs(ianaTimeZone: string, date: Date): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = date.toLocaleString('en-US', { timeZone: ianaTimeZone })
  return new Date(utcStr).getTime() - new Date(tzStr).getTime()
}

/**
 * Convert a "local time" (hour:minute in user's timezone) on a given date to a UTC Date.
 */
function localTimeToUtc(date: Date, hours: number, minutes: number, ianaTimeZone: string): Date {
  // Create a date at the specified hours/minutes in "server local" (UTC on Vercel)
  const local = new Date(date)
  local.setHours(hours, minutes, 0, 0)
  // Shift from user-local → UTC
  const offsetMs = getUtcOffsetMs(ianaTimeZone, local)
  return new Date(local.getTime() + offsetMs)
}

/**
 * Convert a UTC Date to a local datetime string (no Z suffix) for Graph API.
 */
function utcToLocalString(utcDate: Date, ianaTimeZone: string): string {
  // Format as YYYY-MM-DDTHH:mm:ss.000 in the user's timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ianaTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(utcDate)

  const get = (type: string) => parts.find(p => p.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.000`
}

/**
 * Format a UTC Date as a display string in the user's timezone.
 */
function formatLocalTime(utcDate: Date, ianaTimeZone: string): string {
  return utcDate.toLocaleTimeString('en-US', {
    timeZone: ianaTimeZone,
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatLocalDate(utcDate: Date, ianaTimeZone: string): string {
  return utcDate.toLocaleDateString('en-US', {
    timeZone: ianaTimeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
}

function formatLocalDateShort(utcDate: Date, ianaTimeZone: string): string {
  return utcDate.toLocaleDateString('en-US', {
    timeZone: ianaTimeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// ── Scheduling helpers ──────────────────────────────────────────────────

function isBusinessDay(date: Date, workDays: number[], ianaTimeZone: string): boolean {
  // Get the day-of-week in the user's timezone
  const dayStr = new Intl.DateTimeFormat('en-US', { timeZone: ianaTimeZone, weekday: 'short' }).format(date)
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return workDays.includes(dayMap[dayStr] ?? -1)
}

function getWorkHoursUtc(
  date: Date,
  workStart: string,
  workEnd: string,
  ianaTimeZone: string
): { start: Date; end: Date } {
  const [startH, startM] = workStart.split(':').map(Number)
  const [endH, endM] = workEnd.split(':').map(Number)

  return {
    start: localTimeToUtc(date, startH, startM, ianaTimeZone),
    end: localTimeToUtc(date, endH, endM, ianaTimeZone),
  }
}

function findGaps(
  events: TimeSlot[],
  workStart: Date,
  workEnd: Date,
  durationMinutes: number,
  bufferMinutes: number
): TimeSlot[] {
  const gaps: TimeSlot[] = []

  // Sort events by start time
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime())

  // Check gap from work start to first event
  let cursor = workStart

  for (const event of sorted) {
    // If event is outside work hours, skip
    if (event.end <= workStart || event.start >= workEnd) continue

    const eventStartWithBuffer = new Date(event.start.getTime() - bufferMinutes * 60000)
    const gapEnd = eventStartWithBuffer < workEnd ? eventStartWithBuffer : workEnd

    if (cursor < gapEnd) {
      const gapMinutes = (gapEnd.getTime() - cursor.getTime()) / 60000
      if (gapMinutes >= durationMinutes) {
        gaps.push({ start: new Date(cursor), end: new Date(gapEnd) })
      }
    }

    // Move cursor past event + buffer
    const eventEndWithBuffer = new Date(event.end.getTime() + bufferMinutes * 60000)
    if (eventEndWithBuffer > cursor) {
      cursor = eventEndWithBuffer
    }
  }

  // Check gap from last event to work end
  if (cursor < workEnd) {
    const gapMinutes = (workEnd.getTime() - cursor.getTime()) / 60000
    if (gapMinutes >= durationMinutes) {
      gaps.push({ start: new Date(cursor), end: new Date(workEnd) })
    }
  }

  return gaps
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { todoId, durationMinutes, title } = await request.json()
    if (!todoId || !durationMinutes || !title) {
      return NextResponse.json({ error: 'todoId, durationMinutes, and title are required' }, { status: 400 })
    }
    if (durationMinutes < 5 || durationMinutes > 480) {
      return NextResponse.json({ error: 'Duration must be between 5 and 480 minutes' }, { status: 400 })
    }

    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    const teamId = profile?.current_team_id || await resolveTeamId(admin, userData.user.id)
    if (!teamId) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }
    const userId = userData.user.id

    // Get Outlook integration
    const integration = await getOutlookIntegration(teamId, userId)
    if (!integration) {
      return NextResponse.json({ error: 'Outlook not connected. Connect Outlook to auto-schedule.' }, { status: 400 })
    }

    const ctx = {
      supabase: admin,
      integrationId: integration.id,
      refreshToken: integration.refresh_token,
    }

    // Get user's timezone from Outlook mailbox settings
    const { data: mailboxData, token: mbToken } = await graphFetch(
      'https://graph.microsoft.com/v1.0/me/mailboxSettings',
      { token: integration.access_token },
      ctx
    )
    const windowsTimeZone: string = mailboxData?.timeZone || 'Pacific Standard Time'
    const ianaTimeZone = toIana(windowsTimeZone)

    // Get user's calendar boundaries (or defaults)
    const { data: boundaries } = await admin
      .from('calendar_boundaries')
      .select('no_meetings_before, no_meetings_after, focus_days')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .single()

    const workStart = boundaries?.no_meetings_before || DEFAULT_WORK_START
    const workEnd = boundaries?.no_meetings_after || DEFAULT_WORK_END
    const focusDays: number[] = boundaries?.focus_days || []
    const workDays = [0, 1, 2, 3, 4, 5, 6].filter(d => !focusDays.includes(d) && d >= 1 && d <= 5)
    // Default to Mon-Fri excluding focus days; include weekends only if explicitly in workDays
    const effectiveWorkDays = workDays.length > 0 ? workDays : [1, 2, 3, 4, 5]

    // Search the next SEARCH_DAYS business days
    const now = new Date()
    let currentToken = mbToken
    let scheduledSlot: TimeSlot | null = null

    // Start from "today" in the user's timezone
    // We iterate by shifting a reference date by 1 day at a time
    const searchDate = new Date(now)
    let daysChecked = 0

    while (daysChecked < SEARCH_DAYS && !scheduledSlot) {
      if (!isBusinessDay(searchDate, effectiveWorkDays, ianaTimeZone)) {
        searchDate.setDate(searchDate.getDate() + 1)
        continue
      }

      // Get work hours in true UTC for this day
      const { start: dayWorkStart, end: dayWorkEnd } = getWorkHoursUtc(searchDate, workStart, workEnd, ianaTimeZone)

      // If today and work hours are already over, skip
      if (now >= dayWorkEnd) {
        searchDate.setDate(searchDate.getDate() + 1)
        continue
      }

      // Fetch events for this day from Graph API
      // Use a wider UTC window to ensure we capture all events for the user's local day
      const queryStart = new Date(dayWorkStart.getTime() - 2 * 3600000) // 2h before work start
      const queryEnd = new Date(dayWorkEnd.getTime() + 2 * 3600000)     // 2h after work end

      const calUrl = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${queryStart.toISOString()}&endDateTime=${queryEnd.toISOString()}&$select=id,subject,start,end,isAllDay,isCancelled&$top=100`

      const { data: calData, token } = await graphFetch(
        calUrl,
        { token: currentToken },
        ctx
      )
      currentToken = token

      // Parse events into true UTC TimeSlots
      const events: TimeSlot[] = (calData?.value || [])
        .filter((e: any) => !e.isCancelled)
        .map((e: any) => {
          // All-day events: block the entire work day
          if (e.isAllDay || !e.start?.dateTime) {
            return { start: dayWorkStart, end: dayWorkEnd }
          }

          // Graph API returns dateTime in the user's mailbox timezone (no Z suffix).
          // Convert from user-local to true UTC by applying the offset.
          const rawStart = new Date(e.start.dateTime) // parsed as UTC on server (wrong absolute time)
          const rawEnd = new Date(e.end.dateTime)
          const offsetMs = getUtcOffsetMs(ianaTimeZone, rawStart)
          return {
            start: new Date(rawStart.getTime() + offsetMs),
            end: new Date(rawEnd.getTime() + offsetMs),
          }
        })

      // For today, don't schedule in the past
      const effectiveStart = now > dayWorkStart ? now : dayWorkStart

      // Find gaps
      const gaps = findGaps(events, effectiveStart, dayWorkEnd, durationMinutes, BUFFER_MINUTES)

      if (gaps.length > 0) {
        // Use the first available gap
        const gap = gaps[0]
        scheduledSlot = {
          start: gap.start,
          end: new Date(gap.start.getTime() + durationMinutes * 60000),
        }
      }

      searchDate.setDate(searchDate.getDate() + 1)
      daysChecked++
    }

    if (!scheduledSlot) {
      return NextResponse.json({
        error: `No available ${durationMinutes}-minute slot found in the next ${SEARCH_DAYS} business days. Try a shorter duration or clear some meetings.`,
      }, { status: 404 })
    }

    // Create calendar event via Graph API
    // Convert the scheduled UTC slot to the user's local timezone for Graph
    const eventBody = {
      subject: `[Todo] ${title}`,
      body: {
        contentType: 'Text',
        content: `Focus time scheduled by HeyWren for your todo: "${title}"`,
      },
      start: {
        dateTime: utcToLocalString(scheduledSlot.start, ianaTimeZone),
        timeZone: windowsTimeZone,
      },
      end: {
        dateTime: utcToLocalString(scheduledSlot.end, ianaTimeZone),
        timeZone: windowsTimeZone,
      },
      showAs: 'busy',
      isReminderOn: true,
      reminderMinutesBeforeStart: 5,
    }

    const { data: createdEvent, token: finalToken } = await graphFetch(
      'https://graph.microsoft.com/v1.0/me/events',
      { method: 'POST', body: eventBody, token: currentToken },
      ctx
    )

    if (createdEvent?.error) {
      console.error('Graph calendar event creation failed:', JSON.stringify(createdEvent.error))
      const graphMsg = createdEvent.error.message || ''
      // If scope/permission error, give actionable message
      const isPermissionError = graphMsg.includes('Authorization') || graphMsg.includes('Access') || graphMsg.includes('Forbidden') || graphMsg.includes('MailboxNotEnabledForRESTAPI')
      return NextResponse.json({
        error: isPermissionError
          ? 'Calendar permission denied. Please disconnect and reconnect Outlook to grant calendar access.'
          : `Failed to create calendar event: ${graphMsg}`,
      }, { status: 500 })
    }

    // Update the todo with scheduled info (displayed in user's timezone)
    const displayStart = formatLocalTime(scheduledSlot.start, ianaTimeZone)
    const displayEnd = formatLocalTime(scheduledSlot.end, ianaTimeZone)
    const displayDate = formatLocalDateShort(scheduledSlot.start, ianaTimeZone)

    await admin
      .from('todos')
      .update({
        notes: `Scheduled: ${displayDate} ${displayStart} – ${displayEnd}${boundaries ? '' : '\n(Set Calendar Protection boundaries for better scheduling)'}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', todoId)
      .eq('user_id', userId)

    return NextResponse.json({
      success: true,
      scheduled: {
        start: scheduledSlot.start.toISOString(),
        end: scheduledSlot.end.toISOString(),
        eventId: createdEvent?.id,
        day: formatLocalDate(scheduledSlot.start, ianaTimeZone),
        time: `${displayStart} – ${displayEnd}`,
      },
    })
  } catch (err) {
    console.error('Auto-schedule error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
