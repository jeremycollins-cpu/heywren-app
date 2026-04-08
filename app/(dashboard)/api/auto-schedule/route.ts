// app/(dashboard)/api/auto-schedule/route.ts
// POST: Find a gap in the user's calendar and create an event for a todo.
// Uses Microsoft Graph API to read calendar and create events.
//
// Algorithm:
// 1. Fetch all events for the next 5 business days
// 2. Find gaps between events (respecting 15-min buffer)
// 3. Only schedule within work hours (from calendar_boundaries or default 9-5)
// 4. Pick the first gap that fits the requested duration
// 5. Create the calendar event via Graph API
// 6. Update the todo with the scheduled time

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getOutlookIntegration, graphFetch } from '@/lib/outlook/graph-client'

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

function isBusinessDay(date: Date, workDays: number[]): boolean {
  return workDays.includes(date.getDay())
}

function getWorkHoursForDay(
  date: Date,
  workStart: string,
  workEnd: string
): { start: Date; end: Date } {
  const [startH, startM] = workStart.split(':').map(Number)
  const [endH, endM] = workEnd.split(':').map(Number)

  const start = new Date(date)
  start.setHours(startH, startM, 0, 0)

  const end = new Date(date)
  end.setHours(endH, endM, 0, 0)

  return { start, end }
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

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const teamId = profile.current_team_id
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
    let currentToken = integration.access_token
    let scheduledSlot: TimeSlot | null = null

    const searchDate = new Date(now)
    let daysChecked = 0

    while (daysChecked < SEARCH_DAYS && !scheduledSlot) {
      // Skip to next business day if today is done or not a work day
      if (searchDate.toDateString() === now.toDateString()) {
        const { end: todayWorkEnd } = getWorkHoursForDay(searchDate, workStart, workEnd)
        if (now >= todayWorkEnd || !isBusinessDay(searchDate, effectiveWorkDays)) {
          searchDate.setDate(searchDate.getDate() + 1)
          continue
        }
      } else if (!isBusinessDay(searchDate, effectiveWorkDays)) {
        searchDate.setDate(searchDate.getDate() + 1)
        continue
      }

      // Fetch events for this day from Graph API
      const dayStart = new Date(searchDate)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(searchDate)
      dayEnd.setHours(23, 59, 59, 999)

      const calUrl = `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${dayStart.toISOString()}&endDateTime=${dayEnd.toISOString()}&$select=id,subject,start,end,isCancelled&$top=50`

      const { data: calData, token } = await graphFetch(
        calUrl,
        { token: currentToken },
        ctx
      )
      currentToken = token

      const events: TimeSlot[] = (calData?.value || [])
        .filter((e: any) => !e.isCancelled)
        .map((e: any) => ({
          start: new Date(e.start.dateTime + 'Z'),
          end: new Date(e.end.dateTime + 'Z'),
        }))

      // Get work hours for this day
      const { start: dayWorkStart, end: dayWorkEnd } = getWorkHoursForDay(searchDate, workStart, workEnd)

      // For today, don't schedule in the past
      const effectiveStart = searchDate.toDateString() === now.toDateString()
        ? new Date(Math.max(now.getTime(), dayWorkStart.getTime()))
        : dayWorkStart

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
    const eventBody = {
      subject: `[Todo] ${title}`,
      body: {
        contentType: 'Text',
        content: `Focus time scheduled by HeyWren for your todo: "${title}"`,
      },
      start: {
        dateTime: scheduledSlot.start.toISOString().replace('Z', ''),
        timeZone: 'UTC',
      },
      end: {
        dateTime: scheduledSlot.end.toISOString().replace('Z', ''),
        timeZone: 'UTC',
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
      const errorMsg = createdEvent.error.message || ''
      const errorCode = createdEvent.error.code || ''

      // Detect permission errors — user needs to re-authorize with Calendars.ReadWrite
      if (
        errorCode === 'ErrorAccessDenied' ||
        errorCode === 'Authorization_RequestDenied' ||
        errorMsg.includes('Access is denied') ||
        errorMsg.includes('Insufficient privileges') ||
        errorMsg.includes('MailboxNotEnabledForRESTAPI')
      ) {
        return NextResponse.json({
          error: 'Outlook needs additional permissions to create calendar events. Please disconnect and reconnect Outlook in Settings → Integrations.',
          needsReauth: true,
        }, { status: 403 })
      }

      console.error('[auto-schedule] Graph API error:', createdEvent.error)
      return NextResponse.json({
        error: errorMsg || 'Failed to create calendar event',
      }, { status: 500 })
    }

    // Update the todo with scheduled info
    await admin
      .from('todos')
      .update({
        notes: `Scheduled: ${scheduledSlot.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${scheduledSlot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${scheduledSlot.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${boundaries ? '' : '\n(Set Calendar Protection boundaries for better scheduling)'}`,
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
        day: scheduledSlot.start.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        time: `${scheduledSlot.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} – ${scheduledSlot.end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
      },
    })
  } catch (err) {
    console.error('Auto-schedule error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
