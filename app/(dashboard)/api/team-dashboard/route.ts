import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getWeekStart, getPreviousWeekStart } from '@/lib/team/calculate-scores'

interface LeaderboardMember {
  userId: string
  displayName: string
  avatarUrl: string | null
  jobTitle: string | null
  role: string
  totalPoints: number
  totalCompleted: number
  totalOnTime: number
  totalMissedResolved: number
  weeksActive: number
  currentStreak: number
  longestStreak: number
  rank: number
  prevRank: number
  rankDelta: number
  achievementCount: number
}

interface WeeklyScoreRow {
  user_id: string
  week_start: string
  total_points: number | null
  commitments_completed: number | null
  commitments_overdue: number | null
  response_rate: number | null
  on_time_rate: number | null
  points_earned: number | null
  bonus_points: number | null
  commitments_created: number | null
  missed_emails_resolved: number | null
  missed_chats_resolved: number | null
  meetings_attended: number | null
  on_time_completions: number | null
  avg_days_to_close: number | null
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/team-dashboard
 * Returns people-centric dashboard data: leaderboard, spotlights, themes, trends.
 * All data is numeric only — no content/text from commitments, emails, etc.
 *
 * Query params:
 *   - weeks: number of weeks of trend data (default 8)
 *   - scope: 'org' | 'department' | 'team' (default based on caller role)
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
    const weeksParam = parseInt(searchParams.get('weeks') || '8', 10)
    const scopeParam = searchParams.get('scope')

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get caller's org membership
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

    // Determine effective scope
    const effectiveScope = scopeParam || (
      role === 'org_admin' ? 'org'
      : role === 'dept_manager' ? 'department'
      : 'team'
    )

    // ── Build scope filter ────────────────────────────────────────────────
    const scopeFilter = (query: any) => {
      query = query.eq('organization_id', organization_id)
      if (effectiveScope === 'department' || (role === 'dept_manager' && effectiveScope !== 'org')) {
        query = query.eq('department_id', department_id)
      } else if (effectiveScope === 'team' || role === 'team_lead' || role === 'member') {
        query = query.eq('team_id', team_id)
      }
      return query
    }

    // ── Fetch data in parallel ────────────────────────────────────────────
    const currentWeek = getWeekStart()
    const previousWeek = getPreviousWeekStart(currentWeek)
    const weeksAgo = new Date(currentWeek)
    weeksAgo.setUTCDate(weeksAgo.getUTCDate() - (weeksParam * 7))
    const weeksAgoStr = weeksAgo.toISOString().split('T')[0]

    const [
      weeklyScoresRes,
      memberScoresRes,
      achievementsRes,
      memberAchievementsRes,
      challengesRes,
      profilesRes,
      orgRes,
    ] = await Promise.all([
      // Weekly scores for trends (last N weeks)
      scopeFilter(
        admin.from('weekly_scores')
          .select('user_id, week_start, total_points, commitments_completed, commitments_overdue, response_rate, on_time_rate, points_earned, bonus_points, commitments_created, missed_emails_resolved, missed_chats_resolved, meetings_attended, on_time_completions, avg_days_to_close')
          .gte('week_start', weeksAgoStr)
      ).order('week_start', { ascending: true }),

      // Cumulative member scores for leaderboard
      admin.from('member_scores')
        .select('user_id, total_points, total_commitments_completed, total_on_time, total_missed_resolved, total_weeks_active, current_streak, longest_streak, org_rank, dept_rank, team_rank, prev_org_rank, prev_dept_rank, prev_team_rank')
        .eq('organization_id', organization_id)
        .order('total_points', { ascending: false }),

      // All achievement definitions
      admin.from('achievements')
        .select('id, slug, name, description, category, tier, icon, threshold, points_reward, sort_order')
        .order('sort_order'),

      // Earned achievements
      admin.from('member_achievements')
        .select('user_id, achievement_id, earned_at, week_earned')
        .eq('organization_id', organization_id),

      // Active challenges
      admin.from('team_challenges')
        .select('id, scope_type, scope_id, title, description, target_metric, target_value, current_value, starts_at, ends_at, status')
        .eq('organization_id', organization_id)
        .in('status', ['active', 'completed'])
        .order('starts_at', { ascending: false })
        .limit(10),

      // Profiles for display names
      admin.from('organization_members')
        .select('user_id, department_id, team_id, role')
        .eq('organization_id', organization_id),

      // Org info
      admin.from('organizations')
        .select('id, name')
        .eq('id', organization_id)
        .single(),
    ])

    // Get display names for all members
    const allUserIds = [...new Set((profilesRes.data || []).map((m: any) => m.user_id))]
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, display_name, email, avatar_url, job_title')
      .in('id', allUserIds)

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))
    const memberOrgMap = new Map((profilesRes.data || []).map((m: any) => [m.user_id, m]))

    // ── Build leaderboard ─────────────────────────────────────────────────
    const leaderboard: LeaderboardMember[] = (memberScoresRes.data || [])
      .filter((ms: any) => {
        const member = memberOrgMap.get(ms.user_id)
        if (!member) return false
        if (effectiveScope === 'department') return member.department_id === department_id
        if (effectiveScope === 'team') return member.team_id === team_id
        return true
      })
      .map((ms: any) => {
        const profile = profileMap.get(ms.user_id)
        const member = memberOrgMap.get(ms.user_id)
        const rankField = effectiveScope === 'org' ? 'org_rank'
          : effectiveScope === 'department' ? 'dept_rank'
          : 'team_rank'
        const prevRankField = effectiveScope === 'org' ? 'prev_org_rank'
          : effectiveScope === 'department' ? 'prev_dept_rank'
          : 'prev_team_rank'

        // Count achievements for this member
        const memberAchievementCount = (memberAchievementsRes.data || [])
          .filter((ea: any) => ea.user_id === ms.user_id).length

        return {
          userId: ms.user_id,
          displayName: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
          avatarUrl: profile?.avatar_url || null,
          jobTitle: profile?.job_title || null,
          role: member?.role || 'member',
          totalPoints: ms.total_points || 0,
          totalCompleted: ms.total_commitments_completed || 0,
          totalOnTime: ms.total_on_time || 0,
          totalMissedResolved: ms.total_missed_resolved || 0,
          weeksActive: ms.total_weeks_active || 0,
          currentStreak: ms.current_streak || 0,
          longestStreak: ms.longest_streak || 0,
          rank: ms[rankField] || 0,
          prevRank: ms[prevRankField] || 0,
          rankDelta: (ms[prevRankField] || 0) - (ms[rankField] || 0), // positive = moved up
          achievementCount: memberAchievementCount,
        }
      })

    // ── Build weekly trends ───────────────────────────────────────────────
    const weeklyData = weeklyScoresRes.data || []
    const weekMap = new Map<string, {
      weekStart: string
      totalPoints: number
      completions: number
      overdue: number
      avgResponseRate: number
      avgOnTimeRate: number
      memberCount: number
      totalMissedResolved: number
      meetingsAttended: number
    }>()

    for (const ws of weeklyData) {
      const existing = weekMap.get(ws.week_start) || {
        weekStart: ws.week_start,
        totalPoints: 0,
        completions: 0,
        overdue: 0,
        avgResponseRate: 0,
        avgOnTimeRate: 0,
        memberCount: 0,
        totalMissedResolved: 0,
        meetingsAttended: 0,
      }
      existing.totalPoints += ws.total_points || 0
      existing.completions += ws.commitments_completed || 0
      existing.overdue += ws.commitments_overdue || 0
      existing.avgResponseRate += ws.response_rate || 0
      existing.avgOnTimeRate += ws.on_time_rate || 0
      existing.memberCount += 1
      existing.totalMissedResolved += (ws.missed_emails_resolved || 0) + (ws.missed_chats_resolved || 0)
      existing.meetingsAttended += ws.meetings_attended || 0
      weekMap.set(ws.week_start, existing)
    }

    const trends = Array.from(weekMap.values())
      .map(w => ({
        ...w,
        avgResponseRate: w.memberCount > 0 ? Math.round(w.avgResponseRate / w.memberCount) : 0,
        avgOnTimeRate: w.memberCount > 0 ? Math.round(w.avgOnTimeRate / w.memberCount) : 0,
      }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))

    // ── Build per-user weekly points for spotlights ─────────────────────
    const typedWeeklyData = weeklyData as WeeklyScoreRow[]
    const currentWeekScores = typedWeeklyData.filter((ws: WeeklyScoreRow) => ws.week_start === currentWeek)
    const prevWeekScores = typedWeeklyData.filter((ws: WeeklyScoreRow) => ws.week_start === previousWeek)
    const prevWeekPointsMap = new Map<string, number>(prevWeekScores.map((ws: WeeklyScoreRow) => [ws.user_id, ws.total_points || 0]))

    // ── Spotlights: auto-generated highlights ─────────────────────────
    const spotlights: Array<{ type: string; label: string; userId: string; displayName: string; avatarUrl: string | null; value: string; detail: string }> = []

    // Top Performer — highest points this week
    if (currentWeekScores.length > 0) {
      const topThisWeek = currentWeekScores.reduce((best: WeeklyScoreRow, ws: WeeklyScoreRow) =>
        (ws.total_points || 0) > (best.total_points || 0) ? ws : best
      )
      if ((topThisWeek.total_points || 0) > 0) {
        const profile = profileMap.get(topThisWeek.user_id)
        spotlights.push({
          type: 'top_performer',
          label: 'Top Performer',
          userId: topThisWeek.user_id,
          displayName: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
          avatarUrl: profile?.avatar_url || null,
          value: `${topThisWeek.total_points} pts`,
          detail: 'Most points this week',
        })
      }
    }

    // Longest Active Streak
    const streakLeader = leaderboard.reduce(
      (best: LeaderboardMember | null, m: LeaderboardMember) => m.currentStreak > (best?.currentStreak || 0) ? m : best,
      null as LeaderboardMember | null
    )
    if (streakLeader && streakLeader.currentStreak >= 2) {
      spotlights.push({
        type: 'streak_leader',
        label: 'On Fire',
        userId: streakLeader.userId,
        displayName: streakLeader.displayName,
        avatarUrl: streakLeader.avatarUrl,
        value: `${streakLeader.currentStreak}w streak`,
        detail: 'Longest active streak',
      })
    }

    // Most Improved — biggest week-over-week points increase
    if (currentWeekScores.length > 0 && prevWeekScores.length > 0) {
      let bestImprovement = 0
      let mostImprovedUser: WeeklyScoreRow | null = null
      for (const ws of currentWeekScores) {
        const prevPoints: number = prevWeekPointsMap.get(ws.user_id) || 0
        const improvement = (ws.total_points || 0) - prevPoints
        if (improvement > bestImprovement) {
          bestImprovement = improvement
          mostImprovedUser = ws
        }
      }
      if (mostImprovedUser && bestImprovement > 0) {
        const profile = profileMap.get(mostImprovedUser.user_id)
        spotlights.push({
          type: 'most_improved',
          label: 'Most Improved',
          userId: mostImprovedUser.user_id,
          displayName: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
          avatarUrl: profile?.avatar_url || null,
          value: `+${bestImprovement} pts`,
          detail: 'Biggest jump from last week',
        })
      }
    }

    // Most Responsive — highest response rate this week (with meaningful activity)
    const responsiveScores = currentWeekScores.filter((ws: WeeklyScoreRow) =>
      (ws.missed_emails_resolved || 0) + (ws.missed_chats_resolved || 0) > 0 && (ws.response_rate || 0) > 0
    )
    if (responsiveScores.length > 0) {
      const mostResponsive = responsiveScores.reduce((best: WeeklyScoreRow, ws: WeeklyScoreRow) =>
        (ws.response_rate || 0) > (best.response_rate || 0) ? ws : best
      )
      const profile = profileMap.get(mostResponsive.user_id)
      spotlights.push({
        type: 'most_responsive',
        label: 'Most Responsive',
        userId: mostResponsive.user_id,
        displayName: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
        avatarUrl: profile?.avatar_url || null,
        value: `${mostResponsive.response_rate}%`,
        detail: 'Highest response rate this week',
      })
    }

    // ── Themes: auto-generated company-wide observations ──────────────
    const themes: Array<{ icon: string; text: string; sentiment: 'positive' | 'neutral' | 'negative' }> = []

    const totalMembers = allUserIds.length
    const activeThisWeek = currentWeekScores.length
    const activeStreakMembers = leaderboard.filter((m: LeaderboardMember) => m.currentStreak >= 2).length

    // Participation rate
    if (totalMembers > 0) {
      const participationPct = Math.round((activeThisWeek / totalMembers) * 100)
      if (participationPct >= 80) {
        themes.push({ icon: 'users', text: `${participationPct}% of the team was active this week — strong engagement`, sentiment: 'positive' })
      } else if (participationPct >= 50) {
        themes.push({ icon: 'users', text: `${participationPct}% of the team was active this week`, sentiment: 'neutral' })
      } else if (activeThisWeek > 0) {
        themes.push({ icon: 'users', text: `Only ${participationPct}% of the team was active this week`, sentiment: 'negative' })
      }
    }

    // Streak momentum
    if (activeStreakMembers > 0) {
      if (activeStreakMembers >= 3) {
        themes.push({ icon: 'flame', text: `${activeStreakMembers} members on 2+ week streaks — great consistency`, sentiment: 'positive' })
      } else {
        themes.push({ icon: 'flame', text: `${activeStreakMembers} member${activeStreakMembers !== 1 ? 's' : ''} on an active streak`, sentiment: 'neutral' })
      }
    }

    // Response rate trend
    if (trends.length >= 2) {
      const currentAvgResponse = trends[trends.length - 1].avgResponseRate
      const prevAvgResponse = trends[trends.length - 2].avgResponseRate
      const responseDelta = currentAvgResponse - prevAvgResponse
      if (responseDelta > 5) {
        themes.push({ icon: 'mail-check', text: `Response rate up ${responseDelta}% from last week to ${currentAvgResponse}%`, sentiment: 'positive' })
      } else if (responseDelta < -5) {
        themes.push({ icon: 'mail-check', text: `Response rate down ${Math.abs(responseDelta)}% from last week to ${currentAvgResponse}%`, sentiment: 'negative' })
      } else if (currentAvgResponse >= 90) {
        themes.push({ icon: 'mail-check', text: `Team maintaining ${currentAvgResponse}% response rate`, sentiment: 'positive' })
      }
    }

    // On-time completion trend
    if (trends.length >= 2) {
      const currentOnTime = trends[trends.length - 1].avgOnTimeRate
      const prevOnTime = trends[trends.length - 2].avgOnTimeRate
      const onTimeDelta = currentOnTime - prevOnTime
      if (onTimeDelta > 5) {
        themes.push({ icon: 'clock', text: `On-time rate improved ${onTimeDelta}% — team hitting deadlines`, sentiment: 'positive' })
      } else if (onTimeDelta < -5) {
        themes.push({ icon: 'clock', text: `On-time rate dropped ${Math.abs(onTimeDelta)}% from last week`, sentiment: 'negative' })
      }
    }

    // Overdue trend
    if (trends.length >= 1) {
      const currentOverdue = trends[trends.length - 1].overdue
      if (currentOverdue === 0 && (trends[trends.length - 1]?.completions || 0) > 0) {
        themes.push({ icon: 'check-circle', text: 'Zero overdue items this week — clean slate', sentiment: 'positive' })
      } else if (currentOverdue > 5) {
        themes.push({ icon: 'alert-triangle', text: `${currentOverdue} items went overdue this week — may need attention`, sentiment: 'negative' })
      }
    }

    // Points momentum
    if (trends.length >= 2) {
      const currentPts = trends[trends.length - 1].totalPoints
      const prevPts = trends[trends.length - 2].totalPoints
      if (prevPts > 0) {
        const ptsDelta = Math.round(((currentPts - prevPts) / prevPts) * 100)
        if (ptsDelta > 20) {
          themes.push({ icon: 'trending-up', text: `Team output up ${ptsDelta}% week over week — building momentum`, sentiment: 'positive' })
        } else if (ptsDelta < -20) {
          themes.push({ icon: 'trending-down', text: `Team output down ${Math.abs(ptsDelta)}% from last week`, sentiment: 'negative' })
        }
      }
    }

    // Recent achievements across team
    const recentAchievements = (memberAchievementsRes.data || [])
      .filter((ea: any) => ea.week_earned === currentWeek || ea.week_earned === previousWeek)
    if (recentAchievements.length > 0) {
      const uniqueEarners = new Set(recentAchievements.map((ea: any) => ea.user_id)).size
      themes.push({
        icon: 'award',
        text: `${recentAchievements.length} achievement${recentAchievements.length !== 1 ? 's' : ''} unlocked by ${uniqueEarners} member${uniqueEarners !== 1 ? 's' : ''} recently`,
        sentiment: 'positive',
      })
    }

    // ── Achievements display ──────────────────────────────────────────────
    const achievementDefs = achievementsRes.data || []
    const earnedMap = new Map<string, Set<string>>()
    for (const ea of memberAchievementsRes.data || []) {
      if (!earnedMap.has(ea.achievement_id)) earnedMap.set(ea.achievement_id, new Set())
      earnedMap.get(ea.achievement_id)!.add(ea.user_id)
    }

    const achievements = achievementDefs.map((a: any) => ({
      ...a,
      earnedBy: earnedMap.get(a.id)?.size || 0,
      earnedByMe: earnedMap.get(a.id)?.has(userId) || false,
    }))

    const myAchievements = (memberAchievementsRes.data || [])
      .filter((ea: any) => ea.user_id === userId)
      .map((ea: any) => {
        const def = achievementDefs.find((a: any) => a.id === ea.achievement_id)
        return {
          ...ea,
          name: def?.name,
          description: def?.description,
          tier: def?.tier,
          icon: def?.icon,
          category: def?.category,
        }
      })
      .sort((a: any, b: any) => new Date(b.earned_at).getTime() - new Date(a.earned_at).getTime())

    // ── Challenges ────────────────────────────────────────────────────────
    const challenges = (challengesRes.data || []).map((c: any) => ({
      ...c,
      progress: c.target_value > 0 ? Math.min(100, Math.round(c.current_value / c.target_value * 100)) : 0,
    }))

    // ── Scoping: use organization_id for queries (covers all teams in org)
    // Fall back to team_id list for tables without organization_id
    const teamIds = [...new Set((profilesRes.data || []).map((m: any) => m.team_id).filter(Boolean))]

    // ── Company pulse stats ───────────────────────────────────────────────
    const pulse = {
      totalMembers,
      activeThisWeek,
      activeStreaks: activeStreakMembers,
      totalPointsThisWeek: trends.length > 0 ? trends[trends.length - 1].totalPoints : 0,
      completionsThisWeek: trends.length > 0 ? trends[trends.length - 1].completions : 0,
      avgResponseRate: trends.length > 0 ? trends[trends.length - 1].avgResponseRate : 0,
      avgOnTimeRate: trends.length > 0 ? trends[trends.length - 1].avgOnTimeRate : 0,
    }

    // ── Team Health Score (0-100 composite) ──────────────────────────────
    // Use the most recent trend that has actual data (non-zero metrics).
    // If weekly_scores hasn't run yet for the current week, fall back to
    // computing health from live commitment data.
    const currentTrend = trends.length > 0 ? trends[trends.length - 1] : null
    const prevTrend = trends.length > 1 ? trends[trends.length - 2] : null

    // Also fetch live overdue count as a fallback/supplement
    const { count: liveOverdueCount } = organization_id
      ? await admin
          .from('commitments')
          .select('*', { count: 'exact', head: true })
          .eq('organization_id', organization_id)
          .eq('status', 'overdue')
          .is('deleted_at', null)
      : { count: 0 }

    // Compute health score — use trend data if available, supplement with live data
    function computeHealthScore(
      onTimeRate: number, responseRate: number, overdueCount: number,
      members: number, activeCount: number, streakCount: number, completions: number
    ): { score: number; components: Record<string, number> } {
      if (members === 0) return { score: 0, components: {} }
      const onTimeS = Math.min(100, onTimeRate) * 0.25
      const responseS = Math.min(100, responseRate) * 0.20
      const overdueRatio = overdueCount / members
      const overdueS = Math.max(0, 100 - (overdueRatio * 200)) * 0.20
      const participationS = Math.min(100, Math.round((activeCount / members) * 100)) * 0.15
      const streakS = Math.min(100, Math.round((streakCount / members) * 100)) * 0.10
      const velocityS = Math.min(100, completions > 0 ? Math.round((completions / members) * 50) : 0) * 0.10
      return {
        score: Math.round(onTimeS + responseS + overdueS + participationS + streakS + velocityS),
        components: {
          onTime: Math.round(onTimeRate),
          responseRate: Math.round(responseRate),
          overdueRatio: Math.round(overdueRatio * 100),
          participation: Math.round((activeCount / members) * 100),
          streaks: Math.round((streakCount / members) * 100),
          velocity: completions,
        },
      }
    }

    let healthScore = 0
    let healthComponents: Record<string, number> = {}

    if (currentTrend && totalMembers > 0) {
      // Use trend data but supplement overdue with live count if trend shows 0
      const overdueForScore = currentTrend.overdue > 0 ? currentTrend.overdue : (liveOverdueCount || 0)
      const result = computeHealthScore(
        currentTrend.avgOnTimeRate, currentTrend.avgResponseRate, overdueForScore,
        totalMembers, activeThisWeek, activeStreakMembers, currentTrend.completions
      )
      healthScore = result.score
      healthComponents = result.components
    } else if (totalMembers > 0) {
      // No trend data — compute from live data only
      const result = computeHealthScore(
        0, 0, liveOverdueCount || 0,
        totalMembers, activeThisWeek, activeStreakMembers, 0
      )
      healthScore = result.score
      healthComponents = result.components
    }

    // Previous week health score for trend
    let prevHealthScore: number | null = null
    if (prevTrend && totalMembers > 0) {
      const prevActiveCount = (weeklyScoresRes.data || []).filter((s: WeeklyScoreRow) => s.week_start === previousWeek).map((s: WeeklyScoreRow) => s.user_id)
      const prevActiveUnique = new Set(prevActiveCount).size
      const prevResult = computeHealthScore(
        prevTrend.avgOnTimeRate, prevTrend.avgResponseRate, prevTrend.overdue,
        totalMembers, prevActiveUnique, activeStreakMembers, prevTrend.completions
      )
      prevHealthScore = prevResult.score
    }

    const teamHealth = {
      score: healthScore,
      prevScore: prevHealthScore,
      delta: prevHealthScore !== null ? healthScore - prevHealthScore : null,
      level: healthScore >= 75 ? 'healthy' as const : healthScore >= 50 ? 'moderate' as const : 'at_risk' as const,
      components: healthComponents,
    }

    // ── Workload Balance ─────────────────────────────────────────────────
    // Fetch open commitments per person — scoped by organization_id
    const { data: openCommitmentsData } = organization_id
      ? await admin
          .from('commitments')
          .select('assignee_id, status')
          .eq('organization_id', organization_id)
          .in('status', ['open', 'pending', 'in_progress', 'overdue'])
          .is('deleted_at', null)
          .not('assignee_id', 'is', null)
      : { data: [] }

    const workloadMap = new Map<string, { open: number; overdue: number }>()
    for (const c of openCommitmentsData || []) {
      if (!c.assignee_id) continue
      const entry = workloadMap.get(c.assignee_id) || { open: 0, overdue: 0 }
      entry.open++
      if (c.status === 'overdue') entry.overdue++
      workloadMap.set(c.assignee_id, entry)
    }

    // Calculate team average for thresholds
    const workloadValues = [...workloadMap.values()].map(w => w.open)
    const avgWorkload = workloadValues.length > 0 ? workloadValues.reduce((a, b) => a + b, 0) / workloadValues.length : 0

    const workloadBalance = allUserIds
      .map(uid => {
        const profile = profileMap.get(uid)
        const load = workloadMap.get(uid) || { open: 0, overdue: 0 }
        // Only flag if there's meaningful load — minimum thresholds prevent
        // false positives when the team average is very low (e.g. avg = 1)
        const overloadThreshold = Math.max(8, avgWorkload * 2)
        const heavyThreshold = Math.max(5, avgWorkload * 1.5)
        const level = load.open > overloadThreshold ? 'overloaded' as const
          : load.open > heavyThreshold ? 'heavy' as const
          : 'healthy' as const
        return {
          userId: uid,
          displayName: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
          avatarUrl: profile?.avatar_url || null,
          openItems: load.open,
          overdueItems: load.overdue,
          level,
        }
      })
      .sort((a, b) => b.openItems - a.openItems)

    return NextResponse.json({
      organization: orgRes.data,
      callerRole: role,
      scope: effectiveScope,
      pulse,
      teamHealth,
      workloadBalance,
      leaderboard,
      spotlights,
      themes,
      trends,
      achievements,
      myAchievements,
      challenges,
      currentWeek,
    })
  } catch (err) {
    console.error('Team dashboard error:', err)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
