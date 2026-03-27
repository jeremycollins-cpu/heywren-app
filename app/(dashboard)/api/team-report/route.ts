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
 * GET /api/team-report?format=json|html
 * Returns a team performance summary for the most recent completed week.
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
    const format = searchParams.get('format') || 'json'

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get caller's org membership
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization membership' }, { status: 404 })
    }

    const { organization_id } = callerMembership

    // Get the most recent completed week (previous week)
    const previousWeek = getPreviousWeekStart(getWeekStart())

    // Two weeks ago for delta calculation
    const twoWeeksAgo = new Date(previousWeek + 'T00:00:00Z')
    twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 7)
    const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0]

    // Calculate week end (Sunday)
    const weekStartDate = new Date(previousWeek + 'T00:00:00Z')
    const weekEndDate = new Date(weekStartDate)
    weekEndDate.setUTCDate(weekEndDate.getUTCDate() + 6)

    const [
      weeklyScoresRes,
      prevWeekScoresRes,
      memberScoresRes,
      memberAchievementsRes,
      challengesRes,
      achievementDefsRes,
      profilesRes,
      orgRes,
    ] = await Promise.all([
      // This week's scores
      admin.from('weekly_scores')
        .select('user_id, total_points, commitments_completed, commitments_overdue, response_rate, on_time_rate')
        .eq('organization_id', organization_id)
        .eq('week_start', previousWeek),

      // Previous week's scores (for delta)
      admin.from('weekly_scores')
        .select('user_id, total_points, commitments_completed, commitments_overdue, response_rate, on_time_rate')
        .eq('organization_id', organization_id)
        .eq('week_start', twoWeeksAgoStr),

      // Cumulative member scores for leaderboard
      admin.from('member_scores')
        .select('user_id, total_points, total_commitments_completed, current_streak, org_rank, prev_org_rank')
        .eq('organization_id', organization_id)
        .order('total_points', { ascending: false })
        .limit(5),

      // Achievements earned this week
      admin.from('member_achievements')
        .select('user_id, achievement_id, earned_at')
        .eq('organization_id', organization_id)
        .eq('week_earned', previousWeek),

      // Active challenges
      admin.from('team_challenges')
        .select('id, title, description, target_metric, target_value, current_value, starts_at, ends_at, status')
        .eq('organization_id', organization_id)
        .in('status', ['active', 'completed'])
        .order('starts_at', { ascending: false })
        .limit(5),

      // Achievement definitions
      admin.from('achievements')
        .select('id, name, description, tier, icon')
        .order('sort_order'),

      // Profiles for display names
      admin.from('organization_members')
        .select('user_id')
        .eq('organization_id', organization_id),

      // Org info
      admin.from('organizations')
        .select('id, name')
        .eq('id', organization_id)
        .single(),
    ])

    // Get display names
    const allUserIds = [...new Set((profilesRes.data || []).map((m: any) => m.user_id))]
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, display_name, email')
      .in('id', allUserIds)

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))
    const achievementDefMap = new Map((achievementDefsRes.data || []).map((a: any) => [a.id, a]))

    // Aggregate this week's numbers
    const weekScores = weeklyScoresRes.data || []
    const totalPoints = weekScores.reduce((sum: number, s: any) => sum + (s.total_points || 0), 0)
    const completions = weekScores.reduce((sum: number, s: any) => sum + (s.commitments_completed || 0), 0)
    const overdue = weekScores.reduce((sum: number, s: any) => sum + (s.commitments_overdue || 0), 0)
    const avgResponseRate = weekScores.length > 0
      ? Math.round(weekScores.reduce((sum: number, s: any) => sum + (s.response_rate || 0), 0) / weekScores.length)
      : 0
    const avgOnTimeRate = weekScores.length > 0
      ? Math.round(weekScores.reduce((sum: number, s: any) => sum + (s.on_time_rate || 0), 0) / weekScores.length)
      : 0

    // Health score
    const completionScore = Math.min(100, completions * 3)
    const overdueScore = Math.max(0, 100 - overdue * 10)
    const streakCount = (memberScoresRes.data || []).filter((m: any) => (m.current_streak || 0) >= 2).length
    const totalMembers = (memberScoresRes.data || []).length
    const streakScore = totalMembers > 0 ? Math.min(100, Math.round(streakCount / totalMembers * 100)) : 0

    const healthScore = Math.round(
      (completionScore * 0.3) +
      (avgResponseRate * 0.25) +
      (avgOnTimeRate * 0.2) +
      (overdueScore * 0.15) +
      (streakScore * 0.1)
    )

    // Previous week health for delta
    const prevScores = prevWeekScoresRes.data || []
    let healthScoreDelta: number | null = null
    if (prevScores.length > 0) {
      const prevCompletions = prevScores.reduce((sum: number, s: any) => sum + (s.commitments_completed || 0), 0)
      const prevOverdue = prevScores.reduce((sum: number, s: any) => sum + (s.commitments_overdue || 0), 0)
      const prevAvgResponse = Math.round(prevScores.reduce((sum: number, s: any) => sum + (s.response_rate || 0), 0) / prevScores.length)
      const prevAvgOnTime = Math.round(prevScores.reduce((sum: number, s: any) => sum + (s.on_time_rate || 0), 0) / prevScores.length)
      const prevHealth = Math.round(
        (Math.min(100, prevCompletions * 3) * 0.3) +
        (prevAvgResponse * 0.25) +
        (prevAvgOnTime * 0.2) +
        (Math.max(0, 100 - prevOverdue * 10) * 0.15) +
        (streakScore * 0.1)
      )
      healthScoreDelta = healthScore - prevHealth
    }

    // Top 5 leaderboard
    const leaderboard = (memberScoresRes.data || []).map((ms: any) => {
      const profile = profileMap.get(ms.user_id)
      return {
        name: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
        points: ms.total_points || 0,
        rank: ms.org_rank || 0,
        rankDelta: (ms.prev_org_rank || 0) - (ms.org_rank || 0),
        streak: ms.current_streak || 0,
      }
    })

    // Challenges with progress
    const challenges = (challengesRes.data || []).map((c: any) => ({
      title: c.title,
      description: c.description,
      progress: c.target_value > 0 ? Math.min(100, Math.round(c.current_value / c.target_value * 100)) : 0,
      current: c.current_value,
      target: c.target_value,
      status: c.status,
    }))

    // New achievements earned this week
    const newAchievements = (memberAchievementsRes.data || []).map((ea: any) => {
      const def = achievementDefMap.get(ea.achievement_id)
      const profile = profileMap.get(ea.user_id)
      return {
        memberName: profile?.display_name || profile?.email?.split('@')[0] || 'Unknown',
        achievementName: def?.name || 'Unknown',
        tier: def?.tier || 'bronze',
      }
    })

    const weekPeriod = `${weekStartDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

    const reportData = {
      organizationName: orgRes.data?.name || 'Organization',
      weekPeriod,
      healthScore,
      healthScoreDelta,
      totalPoints,
      completions,
      avgResponseRate,
      avgOnTimeRate,
      leaderboard,
      challenges,
      newAchievements,
    }

    if (format === 'html') {
      const html = renderHTML(reportData)
      return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return NextResponse.json(reportData)
  } catch (err) {
    console.error('Team report error:', err)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

// ── HTML renderer ────────────────────────────────────────────────────────────

interface ReportData {
  organizationName: string
  weekPeriod: string
  healthScore: number
  healthScoreDelta: number | null
  totalPoints: number
  completions: number
  avgResponseRate: number
  avgOnTimeRate: number
  leaderboard: Array<{ name: string; points: number; rank: number; rankDelta: number; streak: number }>
  challenges: Array<{ title: string; description: string; progress: number; current: number; target: number; status: string }>
  newAchievements: Array<{ memberName: string; achievementName: string; tier: string }>
}

function renderHTML(data: ReportData): string {
  const healthColor = data.healthScore >= 70 ? '#16a34a' : data.healthScore >= 40 ? '#d97706' : '#dc2626'
  const deltaStr = data.healthScoreDelta !== null
    ? ` <span style="font-size:14px;color:${data.healthScoreDelta >= 0 ? '#16a34a' : '#dc2626'}">${data.healthScoreDelta >= 0 ? '+' : ''}${data.healthScoreDelta}</span>`
    : ''

  const leaderboardRows = data.leaderboard.map((entry, i) => {
    const rankIcon = i === 0 ? '&#129351;' : i === 1 ? '&#129352;' : i === 2 ? '&#129353;' : `#${i + 1}`
    const deltaIcon = entry.rankDelta > 0 ? `<span style="color:#16a34a">&#9650; ${entry.rankDelta}</span>`
      : entry.rankDelta < 0 ? `<span style="color:#dc2626">&#9660; ${Math.abs(entry.rankDelta)}</span>`
      : '<span style="color:#9ca3af">-</span>'
    const streakBadge = entry.streak >= 2 ? `<span style="background:#fff7ed;color:#ea580c;padding:2px 6px;border-radius:10px;font-size:11px;margin-left:6px;">&#128293; ${entry.streak}w</span>` : ''

    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;font-size:18px;">${rankIcon}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-weight:500;">${escapeHtml(entry.name)}${streakBadge}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${deltaIcon}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;font-weight:700;">${entry.points.toLocaleString()}</td>
    </tr>`
  }).join('')

  const challengesList = data.challenges.length > 0
    ? data.challenges.map(c => {
        const barColor = c.status === 'completed' ? '#16a34a' : '#6366f1'
        return `<div style="margin-bottom:12px;padding:14px;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong>${escapeHtml(c.title)}</strong>
            <span style="font-size:13px;color:#6b7280;">${c.current} / ${c.target}</span>
          </div>
          <div style="background:#f3f4f6;border-radius:6px;height:8px;overflow:hidden;">
            <div style="background:${barColor};height:100%;width:${c.progress}%;border-radius:6px;"></div>
          </div>
        </div>`
      }).join('')
    : '<p style="color:#9ca3af;font-size:14px;">No active challenges this week.</p>'

  const achievementsList = data.newAchievements.length > 0
    ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">${data.newAchievements.map(a => {
        const tierColors: Record<string, string> = { bronze: '#ea580c', silver: '#6b7280', gold: '#ca8a04', platinum: '#4f46e5' }
        const color = tierColors[a.tier] || '#6b7280'
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:13px;background:${color}11;color:${color};border:1px solid ${color}33;">
          &#127942; ${escapeHtml(a.memberName)} earned <strong>${escapeHtml(a.achievementName)}</strong>
        </span>`
      }).join('')}</div>`
    : '<p style="color:#9ca3af;font-size:14px;">No new achievements this week.</p>'

  const generatedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Weekly Team Report - ${escapeHtml(data.organizationName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #111827; background: #f9fafb; padding: 32px; line-height: 1.5; }
    .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #4f46e5, #7c3aed); color: white; padding: 32px; }
    .header h1 { font-size: 24px; margin-bottom: 4px; }
    .header p { opacity: 0.85; font-size: 14px; }
    .content { padding: 32px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .stat-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    .section { margin-bottom: 28px; }
    .section-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #f3f4f6; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    .footer { text-align: center; padding: 20px 32px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; }
    @media print { body { padding: 0; background: white; } .container { box-shadow: none; } }
    @media (max-width: 640px) { .stats-grid { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escapeHtml(data.organizationName)} - Weekly Team Report</h1>
      <p>${escapeHtml(data.weekPeriod)}</p>
    </div>
    <div class="content">
      <!-- Stats Grid -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value" style="color:${healthColor}">${data.healthScore}${deltaStr}</div>
          <div class="stat-label">Health Score</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#4f46e5">${data.totalPoints.toLocaleString()}</div>
          <div class="stat-label">Points Earned</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#16a34a">${data.completions}</div>
          <div class="stat-label">Completions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:#0891b2">${data.avgResponseRate}%</div>
          <div class="stat-label">Response Rate</div>
        </div>
      </div>

      <!-- On-Time Rate -->
      <div class="section">
        <p style="font-size:14px;color:#6b7280;margin-bottom:24px;">On-time rate: <strong style="color:#111827;">${data.avgOnTimeRate}%</strong></p>
      </div>

      <!-- Leaderboard -->
      <div class="section">
        <h2 class="section-title">Top 5 Leaderboard</h2>
        ${data.leaderboard.length > 0 ? `<table>
          <thead>
            <tr>
              <th style="text-align:center;width:60px;">Rank</th>
              <th>Member</th>
              <th style="text-align:center;width:80px;">Change</th>
              <th style="text-align:right;width:100px;">Points</th>
            </tr>
          </thead>
          <tbody>${leaderboardRows}</tbody>
        </table>` : '<p style="color:#9ca3af;font-size:14px;">No leaderboard data yet.</p>'}
      </div>

      <!-- Challenges -->
      <div class="section">
        <h2 class="section-title">Active Challenges</h2>
        ${challengesList}
      </div>

      <!-- Achievements -->
      <div class="section">
        <h2 class="section-title">New Achievements This Week</h2>
        ${achievementsList}
      </div>
    </div>
    <div class="footer">
      Generated by HeyWren &middot; ${escapeHtml(generatedDate)}
    </div>
  </div>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
