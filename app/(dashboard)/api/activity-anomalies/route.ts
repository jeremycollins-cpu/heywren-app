import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface ActivityEvent {
  userId: string
  timestamp: string // ISO
  source: 'email' | 'chat' | 'meeting' | 'commitment'
}

interface WorkSchedule {
  user_id: string
  work_days: number[]
  start_time: string // "HH:MM"
  end_time: string   // "HH:MM"
  timezone: string | null
  idle_threshold_minutes: number
  after_hours_alert: boolean
}

interface Anomaly {
  userId: string
  displayName: string
  avatarUrl: string | null
  type: 'idle' | 'after_hours' | 'ghost_day' | 'response_drop' | 'overloaded'
  severity: 'info' | 'warning' | 'alert'
  date: string
  detail: string
  dismissed: boolean
}

/**
 * GET /api/activity-anomalies
 * Detects work activity anomalies for team members visible to the caller.
 * Returns anomalies for the past 7 days.
 *
 * Query params:
 *   - days: number of days to look back (default 7, max 30)
 */
export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      userId = userData?.user?.id || null
    } catch { /* session failed */ }

    const admin = getAdminClient()
    const { searchParams } = new URL(request.url)
    const daysParam = Math.min(30, Math.max(1, parseInt(searchParams.get('days') || '7', 10)))

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get caller's org membership - must be manager or admin
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, department_id, team_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization membership' }, { status: 404 })
    }

    const { organization_id, department_id, team_id, role } = callerMembership

    // Only managers+ can see anomalies
    if (role === 'member') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Get visible members based on role
    let memberQuery = admin
      .from('organization_members')
      .select('user_id, department_id, team_id, role')
      .eq('organization_id', organization_id)

    if (role === 'dept_manager') {
      memberQuery = memberQuery.eq('department_id', department_id)
    } else if (role === 'team_lead') {
      memberQuery = memberQuery.eq('team_id', team_id)
    }

    const { data: visibleMembers } = await memberQuery
    if (!visibleMembers || visibleMembers.length === 0) {
      return NextResponse.json({ anomalies: [], memberCount: 0 })
    }

    const memberUserIds = visibleMembers.map((m: { user_id: string }) => m.user_id)

    // Date range
    const now = new Date()
    const lookbackDate = new Date(now)
    lookbackDate.setDate(lookbackDate.getDate() - daysParam)
    const lookbackStr = lookbackDate.toISOString()

    // Get org timezone
    const { data: org } = await admin
      .from('organizations')
      .select('timezone')
      .eq('id', organization_id)
      .single()
    const orgTimezone = org?.timezone || 'America/New_York'

    // Fetch all data in parallel
    const [
      profilesRes,
      schedulesRes,
      emailsRes,
      chatsRes,
      meetingsRes,
      commitmentsRes,
      overridesRes,
      weeklyScoresRes,
    ] = await Promise.all([
      // Profiles for display
      admin.from('profiles')
        .select('id, display_name, email, avatar_url')
        .in('id', memberUserIds),

      // Work schedules
      admin.from('work_schedules')
        .select('user_id, work_days, start_time, end_time, timezone, idle_threshold_minutes, after_hours_alert')
        .eq('organization_id', organization_id)
        .in('user_id', memberUserIds),

      // Email activity (received timestamps)
      admin.from('missed_emails')
        .select('user_id, received_at, updated_at, status')
        .in('user_id', memberUserIds)
        .gte('received_at', lookbackStr),

      // Chat activity (sent timestamps)
      admin.from('missed_chats')
        .select('user_id, sent_at, updated_at, status')
        .in('user_id', memberUserIds)
        .gte('sent_at', lookbackStr),

      // Meeting activity
      admin.from('meeting_transcripts')
        .select('user_id, start_time, duration_minutes')
        .in('user_id', memberUserIds)
        .gte('start_time', lookbackStr),

      // Commitment activity (for overload detection)
      admin.from('commitments')
        .select('creator_id, status, created_at, completed_at, due_date')
        .in('creator_id', memberUserIds)
        .or(`created_at.gte.${lookbackStr},completed_at.gte.${lookbackStr}`),

      // Existing overrides/dismissals
      admin.from('activity_anomaly_overrides')
        .select('user_id, anomaly_date, anomaly_type')
        .eq('organization_id', organization_id)
        .gte('anomaly_date', lookbackDate.toISOString().split('T')[0]),

      // Weekly scores for response rate baseline
      admin.from('weekly_scores')
        .select('user_id, week_start, response_rate, commitments_completed, commitments_overdue')
        .eq('organization_id', organization_id)
        .in('user_id', memberUserIds)
        .order('week_start', { ascending: false })
        .limit(memberUserIds.length * 8), // ~8 weeks per member
    ])

    const profileMap = new Map(
      (profilesRes.data || []).map((p: { id: string; display_name: string; email: string; avatar_url: string | null }) => [p.id, p])
    )

    // Build schedule map (default schedule for missing entries)
    const defaultSchedule: Omit<WorkSchedule, 'user_id'> = {
      work_days: [1, 2, 3, 4, 5],
      start_time: '08:00',
      end_time: '17:00',
      timezone: null,
      idle_threshold_minutes: 60,
      after_hours_alert: true,
    }
    const scheduleMap = new Map<string, WorkSchedule>()
    for (const s of (schedulesRes.data || []) as WorkSchedule[]) {
      scheduleMap.set(s.user_id, s)
    }

    // Build override set for quick lookup
    const overrideSet = new Set<string>()
    for (const o of overridesRes.data || []) {
      overrideSet.add(`${o.user_id}:${o.anomaly_date}:${o.anomaly_type}`)
    }

    // Build per-user activity timeline
    const userActivities = new Map<string, ActivityEvent[]>()
    for (const uid of memberUserIds) {
      userActivities.set(uid, [])
    }

    for (const e of emailsRes.data || []) {
      userActivities.get(e.user_id)?.push({
        userId: e.user_id,
        timestamp: e.received_at,
        source: 'email',
      })
      // Also count status changes (replied/dismissed) as activity
      if (e.status === 'replied' || e.status === 'dismissed') {
        userActivities.get(e.user_id)?.push({
          userId: e.user_id,
          timestamp: e.updated_at,
          source: 'email',
        })
      }
    }

    for (const c of chatsRes.data || []) {
      userActivities.get(c.user_id)?.push({
        userId: c.user_id,
        timestamp: c.sent_at,
        source: 'chat',
      })
      if (c.status === 'replied') {
        userActivities.get(c.user_id)?.push({
          userId: c.user_id,
          timestamp: c.updated_at,
          source: 'chat',
        })
      }
    }

    for (const m of meetingsRes.data || []) {
      userActivities.get(m.user_id)?.push({
        userId: m.user_id,
        timestamp: m.start_time,
        source: 'meeting',
      })
    }

    // ── Detect anomalies ─────────────────────────────────────────────────
    const anomalies: Anomaly[] = []

    for (const uid of memberUserIds) {
      // Skip self
      if (uid === userId) continue

      const profile = profileMap.get(uid) as { display_name?: string; email?: string; avatar_url?: string | null } | undefined
      const displayName = profile?.display_name || profile?.email?.split('@')[0] || 'Unknown'
      const avatarUrl = profile?.avatar_url || null
      const schedule = scheduleMap.get(uid) || { user_id: uid, ...defaultSchedule }
      const tz = schedule.timezone || orgTimezone
      const activities = (userActivities.get(uid) || []).sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      )

      // Iterate each day in the lookback window
      for (let d = 0; d < daysParam; d++) {
        const dayDate = new Date(now)
        dayDate.setDate(dayDate.getDate() - d)
        const dateStr = dayDate.toISOString().split('T')[0]
        const dayOfWeek = dayDate.getDay() // 0=Sun

        // Skip non-work days
        if (!schedule.work_days.includes(dayOfWeek)) continue

        // Skip today (incomplete data)
        if (d === 0) continue

        // Get activities for this day
        const dayActivities = activities.filter(a => a.timestamp.startsWith(dateStr))

        // ── Ghost Day: zero activity on a work day ────────────────────
        if (dayActivities.length === 0) {
          const key = `${uid}:${dateStr}:ghost_day`
          anomalies.push({
            userId: uid,
            displayName,
            avatarUrl,
            type: 'ghost_day',
            severity: 'warning',
            date: dateStr,
            detail: 'No emails, chats, or meetings detected on this work day',
            dismissed: overrideSet.has(key),
          })
          continue // no point checking idle/after-hours if no activity at all
        }

        // ── After-Hours Work ──────────────────────────────────────────
        if (schedule.after_hours_alert) {
          const afterHoursEvents = dayActivities.filter(a => {
            const eventDate = new Date(a.timestamp)
            const hours = eventDate.getHours()
            const minutes = eventDate.getMinutes()
            const timeMinutes = hours * 60 + minutes
            const [startH, startM] = schedule.start_time.split(':').map(Number)
            const [endH, endM] = schedule.end_time.split(':').map(Number)
            const startMinutes = startH * 60 + startM
            const endMinutes = endH * 60 + endM
            return timeMinutes < startMinutes || timeMinutes > endMinutes
          })

          if (afterHoursEvents.length >= 3) {
            const key = `${uid}:${dateStr}:after_hours`
            anomalies.push({
              userId: uid,
              displayName,
              avatarUrl,
              type: 'after_hours',
              severity: 'info',
              date: dateStr,
              detail: `${afterHoursEvents.length} activities detected outside work hours (${schedule.start_time}-${schedule.end_time})`,
              dismissed: overrideSet.has(key),
            })
          }
        }

        // ── Idle Periods: gaps during work hours ──────────────────────
        const workHourActivities = dayActivities.filter(a => {
          const eventDate = new Date(a.timestamp)
          const hours = eventDate.getHours()
          const minutes = eventDate.getMinutes()
          const timeMinutes = hours * 60 + minutes
          const [startH, startM] = schedule.start_time.split(':').map(Number)
          const [endH, endM] = schedule.end_time.split(':').map(Number)
          return timeMinutes >= startH * 60 + startM && timeMinutes <= endH * 60 + endM
        }).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

        if (workHourActivities.length >= 2) {
          let maxGapMinutes = 0
          let gapStart = ''
          let gapEnd = ''
          for (let i = 1; i < workHourActivities.length; i++) {
            const gap = (new Date(workHourActivities[i].timestamp).getTime() -
                         new Date(workHourActivities[i - 1].timestamp).getTime()) / 60000
            if (gap > maxGapMinutes) {
              maxGapMinutes = gap
              gapStart = new Date(workHourActivities[i - 1].timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              gapEnd = new Date(workHourActivities[i].timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
            }
          }

          if (maxGapMinutes >= schedule.idle_threshold_minutes) {
            const gapHours = Math.round(maxGapMinutes / 60 * 10) / 10
            const key = `${uid}:${dateStr}:idle`
            anomalies.push({
              userId: uid,
              displayName,
              avatarUrl,
              type: 'idle',
              severity: maxGapMinutes >= 180 ? 'alert' : 'warning',
              date: dateStr,
              detail: `${gapHours}h gap in activity between ${gapStart} and ${gapEnd}`,
              dismissed: overrideSet.has(key),
            })
          }
        }
      }

      // ── Response Rate Drop ──────────────────────────────────────────
      const userWeeklyScores = (weeklyScoresRes.data || [])
        .filter((ws: { user_id: string }) => ws.user_id === uid)
        .sort((a: { week_start: string }, b: { week_start: string }) => b.week_start.localeCompare(a.week_start))

      if (userWeeklyScores.length >= 3) {
        const recentRate = (userWeeklyScores[0] as { response_rate: number | null }).response_rate || 0
        const avgPrior = userWeeklyScores.slice(1, 5)
          .reduce((sum: number, ws: { response_rate: number | null }) => sum + (ws.response_rate || 0), 0) / Math.min(4, userWeeklyScores.length - 1)
        const drop = avgPrior - recentRate
        if (drop >= 20 && avgPrior >= 50) {
          const dateStr = (userWeeklyScores[0] as { week_start: string }).week_start
          const key = `${uid}:${dateStr}:response_drop`
          anomalies.push({
            userId: uid,
            displayName,
            avatarUrl,
            type: 'response_drop',
            severity: drop >= 40 ? 'alert' : 'warning',
            date: dateStr,
            detail: `Response rate dropped ${Math.round(drop)}% (from ~${Math.round(avgPrior)}% to ${Math.round(recentRate)}%)`,
            dismissed: overrideSet.has(key),
          })
        }
      }

      // ── Commitment Overload ─────────────────────────────────────────
      const userCommitments = (commitmentsRes.data || [])
        .filter((c: { creator_id: string }) => c.creator_id === uid)
      const openCount = userCommitments.filter((c: { status: string }) =>
        c.status === 'open' || c.status === 'pending' || c.status === 'in_progress'
      ).length
      const overdueCount = userCommitments.filter((c: { status: string }) => c.status === 'overdue').length

      if (openCount >= 10 || overdueCount >= 3) {
        const dateStr = now.toISOString().split('T')[0]
        const key = `${uid}:${dateStr}:overloaded`
        anomalies.push({
          userId: uid,
          displayName,
          avatarUrl,
          type: 'overloaded',
          severity: overdueCount >= 5 ? 'alert' : 'warning',
          date: dateStr,
          detail: overdueCount > 0
            ? `${openCount} open commitments with ${overdueCount} overdue`
            : `${openCount} open commitments — may be overloaded`,
          dismissed: overrideSet.has(key),
        })
      }
    }

    // Sort: alerts first, then warnings, then info; within that, most recent first
    const severityOrder: Record<string, number> = { alert: 0, warning: 1, info: 2 }
    anomalies.sort((a, b) => {
      const sevDiff = (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2)
      if (sevDiff !== 0) return sevDiff
      return b.date.localeCompare(a.date)
    })

    // Build summary stats
    const undismissed = anomalies.filter(a => !a.dismissed)
    const summary = {
      total: undismissed.length,
      ghostDays: undismissed.filter(a => a.type === 'ghost_day').length,
      idlePeriods: undismissed.filter(a => a.type === 'idle').length,
      afterHours: undismissed.filter(a => a.type === 'after_hours').length,
      responseDrops: undismissed.filter(a => a.type === 'response_drop').length,
      overloaded: undismissed.filter(a => a.type === 'overloaded').length,
      membersWithAnomalies: new Set(undismissed.map(a => a.userId)).size,
    }

    return NextResponse.json({
      anomalies,
      summary,
      memberCount: memberUserIds.length - 1, // exclude self
      lookbackDays: daysParam,
    })
  } catch (err) {
    console.error('Activity anomalies error:', err)
    return NextResponse.json({ error: 'Failed to detect anomalies' }, { status: 500 })
  }
}

/**
 * POST /api/activity-anomalies
 * Dismiss/override an anomaly with an optional reason.
 */
export async function POST(request: NextRequest) {
  try {
    let callerId: string | null = null

    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    const admin = getAdminClient()

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { targetUserId, anomalyDate, anomalyType, reason } = body

    if (!targetUserId || !anomalyDate || !anomalyType) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Verify caller has permission
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership || callerMembership.role === 'member') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { error } = await admin
      .from('activity_anomaly_overrides')
      .upsert({
        organization_id: callerMembership.organization_id,
        user_id: targetUserId,
        anomaly_date: anomalyDate,
        anomaly_type: anomalyType,
        reason: reason || null,
        dismissed_by: callerId,
      }, { onConflict: 'organization_id,user_id,anomaly_date,anomaly_type' })

    if (error) {
      console.error('Override error:', error)
      return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Activity anomaly override error:', err)
    return NextResponse.json({ error: 'Failed to save override' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
