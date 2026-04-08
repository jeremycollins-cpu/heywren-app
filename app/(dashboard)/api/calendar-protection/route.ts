// app/(dashboard)/api/calendar-protection/route.ts
// GET: Fetch boundaries, conflicts, and calendar stats for the current user
// POST: Create/update calendar boundaries
// PATCH: Resolve or dismiss a conflict

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

    // Fetch boundaries, conflicts, and upcoming events in parallel
    const now = new Date()
    const sevenDaysLater = new Date(now.getTime() + 7 * 86400000).toISOString()

    const [boundariesRes, conflictsRes, eventsRes] = await Promise.all([
      admin.from('calendar_boundaries')
        .select('*')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .single(),
      admin.from('calendar_conflicts')
        .select('*')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .eq('status', 'unresolved')
        .gte('conflict_date', now.toISOString().split('T')[0])
        .order('conflict_date', { ascending: true })
        .limit(20),
      admin.from('outlook_calendar_events')
        .select('event_id, subject, start_time, end_time, attendees, is_cancelled, organizer_name')
        .eq('team_id', teamId)
        .or(`user_id.eq.${userId},user_id.is.null`)
        .eq('is_cancelled', false)
        .gte('start_time', now.toISOString())
        .lte('start_time', sevenDaysLater)
        .order('start_time', { ascending: true }),
    ])

    const boundaries = boundariesRes.data || null
    const conflicts = conflictsRes.data || []
    const events = eventsRes.data || []

    // Calculate daily stats for the next 7 days
    const dailyStats: Array<{
      date: string
      dayName: string
      meetingCount: number
      meetingHours: number
      conflicts: number
    }> = []

    for (let i = 0; i < 7; i++) {
      const day = new Date(now)
      day.setDate(day.getDate() + i)
      const dateStr = day.toISOString().split('T')[0]

      const dayEvents = events.filter(e => {
        const eventDate = new Date(e.start_time).toISOString().split('T')[0]
        return eventDate === dateStr
      })

      const totalMinutes = dayEvents.reduce((sum, e) => {
        const start = new Date(e.start_time).getTime()
        const end = new Date(e.end_time).getTime()
        return sum + (end - start) / 60000
      }, 0)

      const dayConflicts = conflicts.filter(c => c.conflict_date === dateStr).length

      dailyStats.push({
        date: dateStr,
        dayName: day.toLocaleDateString('en-US', { weekday: 'short' }),
        meetingCount: dayEvents.length,
        meetingHours: Math.round(totalMinutes / 60 * 10) / 10,
        conflicts: dayConflicts,
      })
    }

    return NextResponse.json({
      boundaries,
      conflicts,
      dailyStats,
      totalConflicts: conflicts.length,
    })
  } catch (err) {
    console.error('Calendar protection GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const admin = getAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id')
      .eq('id', userData.user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('calendar_boundaries')
      .upsert(
        {
          team_id: profile.current_team_id,
          user_id: userData.user.id,
          max_meeting_hours_per_day: body.max_meeting_hours_per_day ?? 4,
          max_meetings_per_day: body.max_meetings_per_day ?? 6,
          no_meetings_before: body.no_meetings_before ?? '09:00',
          no_meetings_after: body.no_meetings_after ?? '17:00',
          focus_days: body.focus_days ?? [],
          min_break_between_meetings: body.min_break_between_meetings ?? 0,
          conflict_alerts: body.conflict_alerts ?? true,
          boundary_alerts: body.boundary_alerts ?? true,
          weekly_calendar_summary: body.weekly_calendar_summary ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'team_id,user_id' }
      )
      .select()
      .single()

    if (error) {
      console.error('Failed to save boundaries:', error)
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
    }

    return NextResponse.json({ boundaries: data })
  } catch (err) {
    console.error('Calendar protection POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { conflictId, action } = await request.json()
    if (!conflictId || !['resolve', 'dismiss'].includes(action)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const admin = getAdminClient()

    const { error } = await admin
      .from('calendar_conflicts')
      .update({
        status: action === 'resolve' ? 'resolved' : 'dismissed',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', conflictId)
      .eq('user_id', userData.user.id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Calendar protection PATCH error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
