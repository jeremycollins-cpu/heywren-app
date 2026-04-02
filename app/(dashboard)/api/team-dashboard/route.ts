import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { getWeekStart, getPreviousWeekStart } from '@/lib/team/calculate-scores'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * GET /api/team-dashboard
 * Returns gamification data: leaderboard, trends, achievements, streaks, challenges.
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
          .select('user_id, week_start, total_points, commitments_completed, commitments_overdue, response_rate, on_time_rate, points_earned, bonus_points')
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
    const leaderboard = (memberScoresRes.data || [])
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

        return {
          userId: ms.user_id,
          displayName: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
          avatarUrl: profile?.avatar_url || null,
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
      }
      existing.totalPoints += ws.total_points || 0
      existing.completions += ws.commitments_completed || 0
      existing.overdue += ws.commitments_overdue || 0
      existing.avgResponseRate += ws.response_rate || 0
      existing.avgOnTimeRate += ws.on_time_rate || 0
      existing.memberCount += 1
      weekMap.set(ws.week_start, existing)
    }

    const trends = Array.from(weekMap.values())
      .map(w => ({
        ...w,
        avgResponseRate: w.memberCount > 0 ? Math.round(w.avgResponseRate / w.memberCount) : 0,
        avgOnTimeRate: w.memberCount > 0 ? Math.round(w.avgOnTimeRate / w.memberCount) : 0,
      }))
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart))

    // ── Build achievements display ────────────────────────────────────────
    const achievementDefs = achievementsRes.data || []
    const earnedMap = new Map<string, Set<string>>() // achievementId -> Set<userId>
    for (const ea of memberAchievementsRes.data || []) {
      if (!earnedMap.has(ea.achievement_id)) earnedMap.set(ea.achievement_id, new Set())
      earnedMap.get(ea.achievement_id)!.add(ea.user_id)
    }

    const achievements = achievementDefs.map((a: any) => ({
      ...a,
      earnedBy: earnedMap.get(a.id)?.size || 0,
      earnedByMe: earnedMap.get(a.id)?.has(userId) || false,
    }))

    // My recent achievements
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

    // ── Team health score ─────────────────────────────────────────────────
    const latestWeek = trends[trends.length - 1]
    const prevWeek = trends.length >= 2 ? trends[trends.length - 2] : null

    const completionScore = latestWeek ? Math.min(100, latestWeek.completions * 3) : 0
    const responseScore = latestWeek?.avgResponseRate || 0
    const onTimeScore = latestWeek?.avgOnTimeRate || 0
    const overdueScore = latestWeek ? Math.max(0, 100 - latestWeek.overdue * 10) : 100
    const streakScore = leaderboard.length > 0
      ? Math.min(100, Math.round(leaderboard.filter(m => m.currentStreak >= 2).length / leaderboard.length * 100))
      : 0

    const healthScore = Math.round(
      (completionScore * 0.3) +
      (responseScore * 0.25) +
      (onTimeScore * 0.2) +
      (overdueScore * 0.15) +
      (streakScore * 0.1)
    )

    const prevHealthScore = prevWeek ? Math.round(
      (Math.min(100, prevWeek.completions * 3) * 0.3) +
      ((prevWeek.avgResponseRate || 0) * 0.25) +
      ((prevWeek.avgOnTimeRate || 0) * 0.2) +
      (Math.max(0, 100 - prevWeek.overdue * 10) * 0.15) +
      (streakScore * 0.1)
    ) : null

    return NextResponse.json({
      organization: orgRes.data,
      callerRole: role,
      scope: effectiveScope,
      leaderboard,
      trends,
      achievements,
      myAchievements,
      challenges,
      healthScore,
      healthScoreDelta: prevHealthScore !== null ? healthScore - prevHealthScore : null,
      currentWeek: currentWeek,
    })
  } catch (err) {
    console.error('Team dashboard error:', err)
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
