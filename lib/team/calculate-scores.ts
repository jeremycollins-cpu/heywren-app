// lib/team/calculate-scores.ts
// Calculates weekly activity scores for all members in an organization.
// Only produces numeric metrics — never exposes message content or titles.

import { createClient } from '@supabase/supabase-js'
import { getOooUserIds } from '@/lib/team/ooo'

// ── Points configuration ──────────────────────────────────────────────────────

export const POINTS = {
  COMMITMENT_COMPLETED: 10,
  ON_TIME_BONUS: 5,           // completed before due date
  MISSED_EMAIL_RESOLVED: 5,
  MISSED_CHAT_RESOLVED: 5,
  MEETING_ACTION_ITEM: 3,
  COMMITMENT_CREATED: 2,
  OVERDUE_PENALTY: -3,
  // Streak multipliers (applied to base points)
  STREAK_2_MULTIPLIER: 1.1,
  STREAK_4_MULTIPLIER: 1.25,
  STREAK_8_MULTIPLIER: 1.5,
  STREAK_16_MULTIPLIER: 2.0,
} as const

// Minimum points in a week to count toward streak
export const STREAK_THRESHOLD = 20

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Returns the Monday of the week containing the given date.
 */
export function getWeekStart(date: Date = new Date()): string {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1)
  d.setUTCDate(diff)
  return d.toISOString().split('T')[0]
}

/**
 * Returns the Monday of the previous week.
 */
export function getPreviousWeekStart(weekStart: string): string {
  const d = new Date(weekStart)
  d.setUTCDate(d.getUTCDate() - 7)
  return d.toISOString().split('T')[0]
}

export interface WeeklyMemberScore {
  userId: string
  organizationId: string
  departmentId: string
  teamId: string
  weekStart: string
  commitmentsCreated: number
  commitmentsCompleted: number
  commitmentsOverdue: number
  missedEmailsResolved: number
  missedChatsResolved: number
  meetingsAttended: number
  actionItemsGenerated: number
  onTimeCompletions: number
  avgDaysToClose: number | null
  pointsEarned: number
  bonusPoints: number
  totalPoints: number
  responseRate: number
  onTimeRate: number
}

/**
 * Calculates weekly scores for all members in an organization.
 * Queries only counts/aggregates — never reads message content.
 */
export async function calculateWeeklyScores(
  organizationId: string,
  weekStart?: string
): Promise<WeeklyMemberScore[]> {
  const supabase = getAdminClient()
  const week = weekStart || getWeekStart()
  const weekEnd = new Date(week)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7)
  const weekEndStr = weekEnd.toISOString()
  const weekStartStr = new Date(week).toISOString()

  // Get all members in the org
  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id, organization_id, department_id, team_id')
    .eq('organization_id', organizationId)

  if (!members || members.length === 0) return []

  // Exclude users who are OOO for the entire scoring week
  const weekEndDate = new Date(week)
  weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)
  const oooUserIds = await getOooUserIds(organizationId, week, weekEndDate.toISOString().split('T')[0])
  const activeMembers = members.filter((m: any) => !oooUserIds.has(m.user_id))

  if (activeMembers.length === 0) return []

  const userIds = activeMembers.map((m: any) => m.user_id)
  const memberMap = new Map(activeMembers.map((m: any) => [m.user_id, m]))

  // ── Fetch activity counts in parallel (all team-scoped, no content) ────────

  const teamIds = [...new Set(members.map((m: any) => m.team_id))]

  const [
    commitmentsRes,
    missedEmailsRes,
    missedChatsRes,
    meetingsRes,
  ] = await Promise.all([
    // Commitments created/completed/overdue this week
    supabase
      .from('commitments')
      .select('creator_id, status, created_at, completed_at, due_date')
      .in('team_id', teamIds)
      .in('creator_id', userIds)
      .gte('created_at', weekStartStr)
      .lt('created_at', weekEndStr),

    // Missed emails resolved this week (status changed from pending)
    supabase
      .from('missed_emails')
      .select('user_id, updated_at, status')
      .in('team_id', teamIds)
      .in('user_id', userIds)
      .in('status', ['replied', 'dismissed'])
      .gte('updated_at', weekStartStr)
      .lt('updated_at', weekEndStr),

    // Missed chats resolved this week
    supabase
      .from('missed_chats')
      .select('user_id, updated_at, status')
      .in('team_id', teamIds)
      .in('user_id', userIds)
      .in('status', ['replied', 'dismissed'])
      .gte('updated_at', weekStartStr)
      .lt('updated_at', weekEndStr),

    // Meetings attended this week
    supabase
      .from('meeting_transcripts')
      .select('user_id, commitments_found')
      .in('team_id', teamIds)
      .in('user_id', userIds)
      .gte('start_time', weekStartStr)
      .lt('start_time', weekEndStr),
  ])

  // Also get completions that happened this week (may have been created earlier)
  const { data: completedThisWeek } = await supabase
    .from('commitments')
    .select('creator_id, completed_at, created_at, due_date')
    .in('team_id', teamIds)
    .in('creator_id', userIds)
    .eq('status', 'completed')
    .gte('completed_at', weekStartStr)
    .lt('completed_at', weekEndStr)

  // Count pending missed items for response rate denominator
  const { data: totalMissedEmails } = await supabase
    .from('missed_emails')
    .select('user_id')
    .in('team_id', teamIds)
    .in('user_id', userIds)
    .gte('created_at', weekStartStr)
    .lt('created_at', weekEndStr)

  const { data: totalMissedChats } = await supabase
    .from('missed_chats')
    .select('user_id')
    .in('team_id', teamIds)
    .in('user_id', userIds)
    .gte('created_at', weekStartStr)
    .lt('created_at', weekEndStr)

  // ── Aggregate per user ─────────────────────────────────────────────────────

  // Get current streaks for bonus calculation
  const { data: currentScores } = await supabase
    .from('member_scores')
    .select('user_id, current_streak')
    .eq('organization_id', organizationId)
    .in('user_id', userIds)

  const streakMap = new Map((currentScores || []).map((s: any) => [s.user_id, s.current_streak || 0]))

  const scores: WeeklyMemberScore[] = activeMembers.map((member: any) => {
    const uid = member.user_id

    // Commitments created this week
    const created = (commitmentsRes.data || []).filter((c: any) => c.creator_id === uid)
    const commitmentsCreated = created.length

    // Commitments completed this week (regardless of when created)
    const completed = (completedThisWeek || []).filter((c: any) => c.creator_id === uid)
    const commitmentsCompleted = completed.length

    // On-time completions (completed before or on due date)
    const onTimeCompletions = completed.filter((c: any) => {
      if (!c.due_date || !c.completed_at) return false
      return new Date(c.completed_at) <= new Date(c.due_date)
    }).length

    // Overdue items
    const commitmentsOverdue = created.filter((c: any) => c.status === 'overdue').length

    // Average days to close
    const closeTimes = completed
      .filter((c: any) => c.created_at && c.completed_at)
      .map((c: any) => (new Date(c.completed_at!).getTime() - new Date(c.created_at).getTime()) / 86400000)
    const avgDaysToClose = closeTimes.length > 0
      ? Math.round(closeTimes.reduce((a: number, b: number) => a + b, 0) / closeTimes.length * 10) / 10
      : null

    // Missed items resolved
    const missedEmailsResolved = (missedEmailsRes.data || []).filter((e: any) => e.user_id === uid).length
    const missedChatsResolved = (missedChatsRes.data || []).filter((c: any) => c.user_id === uid).length

    // Meetings & action items
    const userMeetings = (meetingsRes.data || []).filter((m: any) => m.user_id === uid)
    const meetingsAttended = userMeetings.length
    const actionItemsGenerated = userMeetings.reduce((s: number, m: any) => s + (m.commitments_found || 0), 0)

    // Response rate
    const totalMissedForUser = (totalMissedEmails || []).filter((e: any) => e.user_id === uid).length
      + (totalMissedChats || []).filter((c: any) => c.user_id === uid).length
    const totalResolvedForUser = missedEmailsResolved + missedChatsResolved
    const responseRate = totalMissedForUser > 0
      ? Math.round(totalResolvedForUser / totalMissedForUser * 100)
      : 100 // no missed items = perfect

    // On-time rate
    const onTimeRate = commitmentsCompleted > 0
      ? Math.round(onTimeCompletions / commitmentsCompleted * 100)
      : 0

    // ── Calculate points ──────────────────────────────────────────────────
    let pointsEarned =
      (commitmentsCompleted * POINTS.COMMITMENT_COMPLETED) +
      (onTimeCompletions * POINTS.ON_TIME_BONUS) +
      (missedEmailsResolved * POINTS.MISSED_EMAIL_RESOLVED) +
      (missedChatsResolved * POINTS.MISSED_CHAT_RESOLVED) +
      (actionItemsGenerated * POINTS.MEETING_ACTION_ITEM) +
      (commitmentsCreated * POINTS.COMMITMENT_CREATED) +
      (commitmentsOverdue * POINTS.OVERDUE_PENALTY)

    pointsEarned = Math.max(0, pointsEarned)

    // Streak bonus
    const currentStreak = streakMap.get(uid) || 0
    let streakMultiplier = 1.0
    if (currentStreak >= 16) streakMultiplier = POINTS.STREAK_16_MULTIPLIER
    else if (currentStreak >= 8) streakMultiplier = POINTS.STREAK_8_MULTIPLIER
    else if (currentStreak >= 4) streakMultiplier = POINTS.STREAK_4_MULTIPLIER
    else if (currentStreak >= 2) streakMultiplier = POINTS.STREAK_2_MULTIPLIER

    const bonusPoints = Math.round(pointsEarned * (streakMultiplier - 1))
    const totalPoints = pointsEarned + bonusPoints

    return {
      userId: uid,
      organizationId: member.organization_id,
      departmentId: member.department_id,
      teamId: member.team_id,
      weekStart: week,
      commitmentsCreated,
      commitmentsCompleted,
      commitmentsOverdue,
      missedEmailsResolved,
      missedChatsResolved,
      meetingsAttended,
      actionItemsGenerated,
      onTimeCompletions,
      avgDaysToClose,
      pointsEarned,
      bonusPoints,
      totalPoints,
      responseRate,
      onTimeRate,
    }
  })

  return scores
}

/**
 * Persists weekly scores to the database and updates cumulative member_scores.
 */
export async function persistWeeklyScores(scores: WeeklyMemberScore[], oooUserIds?: Set<string>): Promise<void> {
  if (scores.length === 0) return

  const supabase = getAdminClient()

  // Upsert weekly scores
  const weeklyRows = scores.map(s => ({
    organization_id: s.organizationId,
    department_id: s.departmentId,
    team_id: s.teamId,
    user_id: s.userId,
    week_start: s.weekStart,
    commitments_created: s.commitmentsCreated,
    commitments_completed: s.commitmentsCompleted,
    commitments_overdue: s.commitmentsOverdue,
    missed_emails_resolved: s.missedEmailsResolved,
    missed_chats_resolved: s.missedChatsResolved,
    meetings_attended: s.meetingsAttended,
    action_items_generated: s.actionItemsGenerated,
    on_time_completions: s.onTimeCompletions,
    avg_days_to_close: s.avgDaysToClose,
    points_earned: s.pointsEarned,
    bonus_points: s.bonusPoints,
    total_points: s.totalPoints,
    response_rate: s.responseRate,
    on_time_rate: s.onTimeRate,
  }))

  const { error: weeklyError } = await supabase
    .from('weekly_scores')
    .upsert(weeklyRows, { onConflict: 'user_id,week_start' })

  if (weeklyError) {
    console.error('[persistWeeklyScores] weekly_scores upsert failed:', weeklyError)
  }

  // Update cumulative member_scores and streaks
  for (const score of scores) {
    const weekAboveThreshold = score.totalPoints >= STREAK_THRESHOLD

    // Get existing cumulative score
    const { data: existing } = await supabase
      .from('member_scores')
      .select('*')
      .eq('organization_id', score.organizationId)
      .eq('user_id', score.userId)
      .single()

    const currentStreak = existing?.current_streak || 0
    const longestStreak = existing?.longest_streak || 0
    // OOO users: freeze streak (don't increment or reset)
    const isOoo = oooUserIds?.has(score.userId) ?? false
    const newStreak = isOoo ? currentStreak : (weekAboveThreshold ? currentStreak + 1 : 0)
    const newLongest = Math.max(longestStreak, newStreak)

    const { error: scoreError } = await supabase
      .from('member_scores')
      .upsert({
        organization_id: score.organizationId,
        user_id: score.userId,
        total_points: (existing?.total_points || 0) + score.totalPoints,
        total_commitments_completed: (existing?.total_commitments_completed || 0) + score.commitmentsCompleted,
        total_on_time: (existing?.total_on_time || 0) + score.onTimeCompletions,
        total_missed_resolved: (existing?.total_missed_resolved || 0) + score.missedEmailsResolved + score.missedChatsResolved,
        total_weeks_active: (existing?.total_weeks_active || 0) + (score.totalPoints > 0 ? 1 : 0),
        current_streak: newStreak,
        longest_streak: newLongest,
        streak_updated_at: score.weekStart,
        prev_org_rank: existing?.org_rank || null,
        prev_dept_rank: existing?.dept_rank || null,
        prev_team_rank: existing?.team_rank || null,
      }, { onConflict: 'organization_id,user_id' })

    if (scoreError) {
      console.error('[persistWeeklyScores] member_scores upsert failed:', scoreError)
    }
  }

  // Update rankings within the org
  if (scores.length > 0) {
    await updateRankings(scores[0].organizationId)
  }
}

/**
 * Recalculates org/dept/team rankings based on total_points.
 */
async function updateRankings(organizationId: string): Promise<void> {
  const supabase = getAdminClient()

  const { data: allScores } = await supabase
    .from('member_scores')
    .select('user_id, total_points')
    .eq('organization_id', organizationId)
    .order('total_points', { ascending: false })

  if (!allScores) return

  // Get member org assignments for dept/team grouping
  const { data: members } = await supabase
    .from('organization_members')
    .select('user_id, department_id, team_id')
    .eq('organization_id', organizationId)

  if (!members) return

  const memberMap = new Map(members.map((m: any) => [m.user_id, m]))

  // Org rank
  for (let i = 0; i < allScores.length; i++) {
    const userId = (allScores[i] as any).user_id
    const member = memberMap.get(userId) as any
    if (!member) continue

    // Dept rank
    const deptMembers = allScores.filter((s: any) => {
      const m = memberMap.get(s.user_id) as any
      return m?.department_id === member.department_id
    })
    const deptRank = deptMembers.findIndex((s: any) => s.user_id === userId) + 1

    // Team rank
    const teamMembers = allScores.filter((s: any) => {
      const m = memberMap.get(s.user_id) as any
      return m?.team_id === member.team_id
    })
    const teamRank = teamMembers.findIndex((s: any) => s.user_id === userId) + 1

    await supabase
      .from('member_scores')
      .update({
        org_rank: i + 1,
        dept_rank: deptRank,
        team_rank: teamRank,
      })
      .eq('organization_id', organizationId)
      .eq('user_id', userId)
  }
}
