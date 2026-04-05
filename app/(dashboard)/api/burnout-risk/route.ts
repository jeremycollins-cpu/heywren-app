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
  profiles: { display_name: string; avatar_url: string | null; job_title: string | null } | null
}

interface WorkScheduleRow {
  user_id: string
  work_days: number[]
  start_time: string
  end_time: string
}

/**
 * GET /api/burnout-risk
 * Computes burnout risk index for each org member.
 * Composite of: after-hours work, meeting overload, commitment overload,
 * response acceleration, sentiment decline, streak intensity.
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
    const selfOnly = searchParams.get('self') === 'true'

    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    // Non-managers can only see their own
    if (!selfOnly && !MANAGER_ROLES.includes(callerMembership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const orgId = callerMembership.organization_id

    // Get members to analyze
    const { data: members } = await admin
      .from('organization_members')
      .select('user_id, department_id, profiles(display_name, avatar_url, job_title)')
      .eq('organization_id', orgId) as { data: MemberProfile[] | null }

    if (!members || members.length === 0) {
      return NextResponse.json({
        scores: [],
        riskDistribution: { critical: 0, high: 0, moderate: 0, low: 0 },
        orgAvgRisk: 0,
      })
    }

    // Exclude OOO users from burnout risk analysis
    const today = new Date().toISOString().split('T')[0]
    const oooUserIds = await getOooUserIdsForDate(orgId, today)

    const targetMembers = (selfOnly
      ? members.filter((m: MemberProfile) => m.user_id === callerId)
      : members
    ).filter((m: MemberProfile) => !oooUserIds.has(m.user_id))
    const memberIds = targetMembers.map((m: MemberProfile) => m.user_id)

    // Parallel queries for all burnout signals
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString()
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

    const [
      weeklyScoresResult,
      memberScoresResult,
      calendarResult,
      commitmentsResult,
      scheduleResult,
      sentimentResult,
      disconnectResult,
    ] = await Promise.all([
      admin
        .from('weekly_scores')
        .select('user_id, week_start, meetings_attended, commitments_overdue, commitments_created, response_rate, total_points')
        .in('user_id', memberIds)
        .gte('week_start', fourWeeksAgo.split('T')[0])
        .order('week_start', { ascending: true }),
      admin
        .from('member_scores')
        .select('user_id, current_streak')
        .eq('organization_id', orgId)
        .in('user_id', memberIds),
      admin
        .from('outlook_calendar_events')
        .select('user_id, start_time, end_time')
        .in('user_id', memberIds)
        .gte('start_time', fourWeeksAgo)
        .eq('is_cancelled', false),
      admin
        .from('commitments')
        .select('assignee_id, status, due_date')
        .in('assignee_id', memberIds)
        .in('status', ['pending', 'in_progress', 'overdue', 'open']),
      admin
        .from('work_schedules')
        .select('user_id, work_days, start_time, end_time')
        .eq('organization_id', orgId)
        .in('user_id', memberIds),
      admin
        .from('user_sentiment_scores')
        .select('user_id, month_start, avg_sentiment')
        .eq('organization_id', orgId)
        .in('user_id', memberIds)
        .order('month_start', { ascending: true }),
      admin
        .from('missed_emails')
        .select('user_id, received_at')
        .in('user_id', memberIds)
        .gte('received_at', twoWeeksAgo)
        .not('sentiment_score', 'is', null),
    ])

    type WeeklyScoreRow = { user_id: string; week_start: string; meetings_attended: number | null; commitments_overdue: number | null; commitments_created: number | null; response_rate: number | null; total_points: number | null }
    type MemberScoreRow = { user_id: string; current_streak: number | null }
    type CalendarRow = { user_id: string; start_time: string; end_time: string }
    type CommitmentRow = { assignee_id: string; status: string; due_date: string | null }
    type SentimentRow = { user_id: string; month_start: string; avg_sentiment: number }

    const weeklyScores = (weeklyScoresResult.data || []) as WeeklyScoreRow[]
    const memberScores = (memberScoresResult.data || []) as MemberScoreRow[]
    const calendarEvents = (calendarResult.data || []) as CalendarRow[]
    const commitments = (commitmentsResult.data || []) as CommitmentRow[]
    const schedules = (scheduleResult.data || []) as WorkScheduleRow[]
    const sentiments = (sentimentResult.data || []) as SentimentRow[]

    // Build schedule map
    const scheduleMap = new Map<string, WorkScheduleRow>()
    for (const s of schedules) scheduleMap.set(s.user_id, s)
    const defaultSchedule: WorkScheduleRow = {
      user_id: '', work_days: [1, 2, 3, 4, 5], start_time: '08:00', end_time: '17:00',
    }

    // Compute burnout risk per person
    const scores = targetMembers.map((member: MemberProfile) => {
      const userId = member.user_id
      const profile = member.profiles as { display_name: string; avatar_url: string | null; job_title: string | null } | null
      const schedule = scheduleMap.get(userId) || defaultSchedule

      // 1. After-hours score (0-100)
      const userCalEvents = calendarEvents.filter((e: CalendarRow) => e.user_id === userId)
      const endHour = parseInt(schedule.end_time.split(':')[0], 10)
      let afterHoursDays = 0
      const daysSeen = new Set<string>()
      for (const evt of userCalEvents) {
        const d = new Date(evt.start_time)
        const dayKey = d.toISOString().split('T')[0]
        if (d.getUTCHours() >= endHour && !daysSeen.has(dayKey)) {
          afterHoursDays++
          daysSeen.add(dayKey)
        }
      }
      const afterHoursScore = Math.min(100, Math.round((afterHoursDays / 20) * 100))

      // 2. Meeting overload score (0-100)
      let totalMeetingHours = 0
      for (const evt of userCalEvents) {
        const start = new Date(evt.start_time).getTime()
        const end = new Date(evt.end_time).getTime()
        totalMeetingHours += (end - start) / (1000 * 60 * 60)
      }
      const workHoursPerWeek = 40
      const weeksCovered = 4
      const meetingPct = totalMeetingHours / (workHoursPerWeek * weeksCovered) * 100
      const meetingOverloadScore = Math.min(100, Math.round(meetingPct * 2))

      // 3. Commitment overload (0-100)
      const userCommitments = commitments.filter((c: CommitmentRow) => c.assignee_id === userId)
      const openCount = userCommitments.length
      const overdueCount = userCommitments.filter((c: CommitmentRow) => c.status === 'overdue').length
      const commitmentOverloadScore = Math.min(100, (openCount * 5) + (overdueCount * 15))

      // 4. Response acceleration (0-100) - getting faster = overwork signal
      const userWeekly = weeklyScores
        .filter((w: WeeklyScoreRow) => w.user_id === userId)
        .sort((a: WeeklyScoreRow, b: WeeklyScoreRow) => a.week_start.localeCompare(b.week_start))
      let responseAccelScore = 0
      if (userWeekly.length >= 2) {
        const recent = userWeekly.slice(-2)
        const rateChange = (recent[1].response_rate || 0) - (recent[0].response_rate || 0)
        // Rising response rate with rising workload = potential overwork
        const workloadChange = (recent[1].commitments_created || 0) - (recent[0].commitments_created || 0)
        if (rateChange > 10 && workloadChange > 2) {
          responseAccelScore = Math.min(100, Math.round(rateChange + workloadChange * 10))
        }
      }

      // 5. Sentiment decline (0-100)
      const userSentiment = sentiments
        .filter((s: SentimentRow) => s.user_id === userId)
        .sort((a: SentimentRow, b: SentimentRow) => a.month_start.localeCompare(b.month_start))
      let sentimentDeclineScore = 0
      if (userSentiment.length >= 2) {
        const current = userSentiment[userSentiment.length - 1]
        const previous = userSentiment[userSentiment.length - 2]
        const decline = previous.avg_sentiment - current.avg_sentiment
        if (decline > 0) {
          sentimentDeclineScore = Math.min(100, Math.round(decline * 100))
        }
      }

      // 6. Streak intensity (0-100) — long streaks without break
      const userMemberScore = memberScores.find((m: MemberScoreRow) => m.user_id === userId)
      const streak = userMemberScore?.current_streak || 0
      const streakScore = Math.min(100, Math.round((streak / 12) * 100))

      // Composite weighted score
      const weights = {
        afterHours: 0.25,
        meetingOverload: 0.20,
        commitmentOverload: 0.20,
        responseAccel: 0.10,
        sentimentDecline: 0.15,
        streakIntensity: 0.10,
      }

      const riskScore = Math.round(
        afterHoursScore * weights.afterHours +
        meetingOverloadScore * weights.meetingOverload +
        commitmentOverloadScore * weights.commitmentOverload +
        responseAccelScore * weights.responseAccel +
        sentimentDeclineScore * weights.sentimentDecline +
        streakScore * weights.streakIntensity
      )

      const riskLevel = riskScore >= 75 ? 'critical'
        : riskScore >= 50 ? 'high'
        : riskScore >= 25 ? 'moderate'
        : 'low'

      return {
        userId,
        name: profile?.display_name || 'Unknown',
        avatar: profile?.avatar_url || null,
        jobTitle: profile?.job_title || null,
        department: member.department_id,
        riskScore,
        riskLevel,
        signals: {
          afterHours: { score: afterHoursScore, days: afterHoursDays },
          meetingOverload: { score: meetingOverloadScore, pct: Math.round(meetingPct) },
          commitmentOverload: { score: commitmentOverloadScore, open: openCount, overdue: overdueCount },
          responseAcceleration: { score: responseAccelScore },
          sentimentDecline: { score: sentimentDeclineScore },
          streakIntensity: { score: streakScore, weeks: streak },
        },
      }
    })

    // Sort by risk score descending
    scores.sort((a: { riskScore: number }, b: { riskScore: number }) => b.riskScore - a.riskScore)

    // Summary stats
    const riskDistribution = {
      critical: scores.filter((s: { riskLevel: string }) => s.riskLevel === 'critical').length,
      high: scores.filter((s: { riskLevel: string }) => s.riskLevel === 'high').length,
      moderate: scores.filter((s: { riskLevel: string }) => s.riskLevel === 'moderate').length,
      low: scores.filter((s: { riskLevel: string }) => s.riskLevel === 'low').length,
    }

    return NextResponse.json({
      scores,
      riskDistribution,
      orgAvgRisk: scores.length > 0
        ? Math.round(scores.reduce((s: number, r: { riskScore: number }) => s + r.riskScore, 0) / scores.length)
        : 0,
    })
  } catch (err) {
    console.error('Burnout risk error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
