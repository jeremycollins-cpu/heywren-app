import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getOooUserIdsForDate } from '@/lib/team/ooo'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MANAGER_ROLES = ['org_admin', 'dept_manager', 'team_lead']

interface MemberProfile {
  user_id: string
  department_id: string | null
  profiles: { display_name: string; avatar_url: string | null } | null
}

interface WorkScheduleRow {
  user_id: string
  work_days: number[]
  start_time: string
  end_time: string
}

/**
 * GET /api/disconnect-tracking
 * Tracks right-to-disconnect compliance: after-hours work patterns,
 * weekend work, late night activity, and trend over time.
 *
 * Query params:
 *   - days: lookback window (default 30)
 *   - userId: filter to specific user (managers only)
 */
export async function GET(request: NextRequest) {
  try {
    let callerId: string | null = null
    try {
      const supabase = await createSessionClient()
      const { data: userData } = await supabase.auth.getUser()
      callerId = userData?.user?.id || null
    } catch { /* session failed */ }

    if (!callerId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const { searchParams } = new URL(request.url)
    const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30', 10)))
    const filterUserId = searchParams.get('userId')

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    const isManager = MANAGER_ROLES.includes(callerMembership.role)
    const orgId = callerMembership.organization_id

    // Get members (separate profile lookup — user_id FK points to auth.users, not profiles)
    const { data: rawMembers } = await admin
      .from('organization_members')
      .select('user_id, department_id')
      .eq('organization_id', orgId)

    const dcUserIds = (rawMembers || []).map((m: any) => m.user_id)
    const dcProfileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>()
    if (dcUserIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', dcUserIds)
      for (const p of profiles || []) {
        dcProfileMap.set(p.id, p)
      }
    }
    const members = (rawMembers || []).map((m: any) => ({
      ...m,
      profiles: dcProfileMap.get(m.user_id) || null,
    })) as MemberProfile[] | null

    if (!members) return NextResponse.json({
      individuals: [],
      orgSummary: {
        avgDisconnectScore: 100,
        totalAfterHoursEvents: 0,
        totalWeekendEvents: 0,
        peopleWorkingAfterHours: 0,
        peopleWorkingWeekends: 0,
      },
      lookbackDays: days,
    })

    // Exclude OOO users from disconnect tracking
    const today = new Date().toISOString().split('T')[0]
    const oooUserIds = await getOooUserIdsForDate(orgId, today)

    const targetIds = (filterUserId && isManager
      ? [filterUserId]
      : isManager
        ? members.map((m: MemberProfile) => m.user_id)
        : [callerId]
    ).filter((id: string) => !oooUserIds.has(id))

    const rangeStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // Fetch schedules + all communication activity
    const [schedulesResult, emailsResult, chatsResult, meetingsResult] = await Promise.all([
      admin
        .from('work_schedules')
        .select('user_id, work_days, start_time, end_time')
        .eq('organization_id', orgId)
        .in('user_id', targetIds),
      admin
        .from('missed_emails')
        .select('user_id, received_at')
        .in('user_id', targetIds)
        .gte('received_at', rangeStart),
      admin
        .from('missed_chats')
        .select('user_id, sent_at')
        .in('user_id', targetIds)
        .gte('sent_at', rangeStart),
      admin
        .from('outlook_calendar_events')
        .select('user_id, start_time, end_time')
        .in('user_id', targetIds)
        .gte('start_time', rangeStart)
        .eq('is_cancelled', false),
    ])

    const schedules = (schedulesResult.data || []) as WorkScheduleRow[]
    const scheduleMap = new Map<string, WorkScheduleRow>()
    for (const s of schedules) scheduleMap.set(s.user_id, s)
    const defaultSchedule: WorkScheduleRow = {
      user_id: '', work_days: [1, 2, 3, 4, 5], start_time: '08:00', end_time: '17:00',
    }

    type ActivityRow = { user_id: string; timestamp: string; source: string }
    const allActivity: ActivityRow[] = []

    for (const e of (emailsResult.data || []) as Array<{ user_id: string; received_at: string }>) {
      allActivity.push({ user_id: e.user_id, timestamp: e.received_at, source: 'email' })
    }
    for (const c of (chatsResult.data || []) as Array<{ user_id: string; sent_at: string }>) {
      allActivity.push({ user_id: c.user_id, timestamp: c.sent_at, source: 'chat' })
    }
    for (const m of (meetingsResult.data || []) as Array<{ user_id: string; start_time: string; end_time: string }>) {
      allActivity.push({ user_id: m.user_id, timestamp: m.start_time, source: 'meeting' })
    }

    // Compute per-person disconnect stats
    const memberMap = new Map<string, MemberProfile>()
    for (const m of members) memberMap.set(m.user_id, m)

    const individuals = targetIds.map(userId => {
      const schedule = scheduleMap.get(userId) || defaultSchedule
      const userActivity = allActivity.filter((a: ActivityRow) => a.user_id === userId)
      const member = memberMap.get(userId)
      const profile = member?.profiles as { display_name: string; avatar_url: string | null } | null

      const startHour = parseInt(schedule.start_time.split(':')[0], 10)
      const endHour = parseInt(schedule.end_time.split(':')[0], 10)
      const workDays = new Set(schedule.work_days)

      let afterHoursCount = 0
      let weekendCount = 0
      let lateNightCount = 0 // after 10pm
      const afterHoursDates = new Set<string>()
      const weekendDates = new Set<string>()

      // Hourly heatmap: 24 slots
      const hourlyHeatmap = new Array(24).fill(0)
      // Day of week heatmap: 7 slots (0=Sun)
      const weekdayHeatmap = new Array(7).fill(0)

      for (const activity of userActivity) {
        const d = new Date(activity.timestamp)
        const hour = d.getUTCHours()
        const dayOfWeek = d.getUTCDay()
        const dateKey = d.toISOString().split('T')[0]

        hourlyHeatmap[hour]++
        weekdayHeatmap[dayOfWeek]++

        const isWorkDay = workDays.has(dayOfWeek)
        const isWorkHours = hour >= startHour && hour < endHour

        if (!isWorkDay) {
          weekendCount++
          weekendDates.add(dateKey)
        } else if (!isWorkHours) {
          afterHoursCount++
          afterHoursDates.add(dateKey)
        }

        if (hour >= 22 || hour < 6) {
          lateNightCount++
        }
      }

      // Weekly trend of after-hours activity
      const weeklyTrend: Array<{ week: string; afterHours: number; weekend: number; total: number }> = []
      const weeksBack = Math.ceil(days / 7)
      const now = new Date()
      for (let w = weeksBack - 1; w >= 0; w--) {
        const wStart = new Date(now)
        wStart.setUTCDate(wStart.getUTCDate() - wStart.getUTCDay() + 1 - (w * 7))
        wStart.setUTCHours(0, 0, 0, 0)
        const wEnd = new Date(wStart)
        wEnd.setUTCDate(wEnd.getUTCDate() + 7)

        const weekActivity = userActivity.filter((a: ActivityRow) => {
          const d = new Date(a.timestamp)
          return d >= wStart && d < wEnd
        })

        let weekAfterHours = 0
        let weekWeekend = 0
        for (const a of weekActivity) {
          const d = new Date(a.timestamp)
          const isWorkDay = workDays.has(d.getUTCDay())
          const isWorkHours = d.getUTCHours() >= startHour && d.getUTCHours() < endHour
          if (!isWorkDay) weekWeekend++
          else if (!isWorkHours) weekAfterHours++
        }

        weeklyTrend.push({
          week: wStart.toISOString().split('T')[0],
          afterHours: weekAfterHours,
          weekend: weekWeekend,
          total: weekActivity.length,
        })
      }

      // Disconnect compliance score: lower after-hours % = better
      const totalActivity = userActivity.length
      const outsideHoursActivity = afterHoursCount + weekendCount
      const disconnectScore = totalActivity > 0
        ? Math.round((1 - outsideHoursActivity / totalActivity) * 100)
        : 100

      return {
        userId,
        name: profile?.display_name || 'Unknown',
        avatar: profile?.avatar_url || null,
        department: member?.department_id || null,
        disconnectScore,
        afterHoursCount,
        afterHoursDays: afterHoursDates.size,
        weekendCount,
        weekendDays: weekendDates.size,
        lateNightCount,
        totalActivity,
        hourlyHeatmap,
        weekdayHeatmap,
        weeklyTrend,
        schedule: {
          workDays: Array.from(workDays),
          startTime: schedule.start_time,
          endTime: schedule.end_time,
        },
      }
    })

    // Sort by worst disconnect score (most after-hours work first)
    individuals.sort((a: { disconnectScore: number }, b: { disconnectScore: number }) => a.disconnectScore - b.disconnectScore)

    // Org summary
    const orgSummary = {
      avgDisconnectScore: individuals.length > 0
        ? Math.round(individuals.reduce((s: number, i: { disconnectScore: number }) => s + i.disconnectScore, 0) / individuals.length)
        : 100,
      totalAfterHoursEvents: individuals.reduce((s: number, i: { afterHoursCount: number }) => s + i.afterHoursCount, 0),
      totalWeekendEvents: individuals.reduce((s: number, i: { weekendCount: number }) => s + i.weekendCount, 0),
      peopleWorkingAfterHours: individuals.filter((i: { afterHoursDays: number }) => i.afterHoursDays >= 3).length,
      peopleWorkingWeekends: individuals.filter((i: { weekendDays: number }) => i.weekendDays >= 2).length,
    }

    return NextResponse.json({
      individuals,
      orgSummary,
      lookbackDays: days,
    })
  } catch (err) {
    console.error('Disconnect tracking error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
