import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { computePrMetrics, type GithubEventRow } from '@/lib/github/pr-metrics'

/**
 * GET /api/dev-activity
 * Returns GitHub developer activity stats and AI usage cross-reference.
 * Query params:
 *   - days: number of days to look back (default 30)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30', 10)

    const since = new Date()
    since.setDate(since.getDate() - days)
    const sinceIso = since.toISOString()

    // Fetch GitHub events
    const { data: events, error } = await supabase
      .from('github_events')
      .select('*')
      .eq('user_id', user.id)
      .gte('event_at', sinceIso)
      .order('event_at', { ascending: false })
      .limit(1000)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const allEvents = events || []

    // ── Summary stats ──
    const commits = allEvents.filter(e => e.event_type === 'commit')
    const prsOpened = allEvents.filter(e => e.event_type === 'pr_opened')
    const prsMerged = allEvents.filter(e => e.event_type === 'pr_merged')
    const prsReviewed = allEvents.filter(e => e.event_type === 'pr_reviewed')

    // ── Daily breakdown ──
    const dailyMap = new Map<string, { commits: number; prs_opened: number; prs_merged: number; reviews: number }>()
    for (const e of allEvents) {
      const day = new Date(e.event_at).toISOString().split('T')[0]
      const existing = dailyMap.get(day) || { commits: 0, prs_opened: 0, prs_merged: 0, reviews: 0 }
      if (e.event_type === 'commit') existing.commits++
      else if (e.event_type === 'pr_opened') existing.prs_opened++
      else if (e.event_type === 'pr_merged') existing.prs_merged++
      else if (e.event_type === 'pr_reviewed') existing.reviews++
      dailyMap.set(day, existing)
    }

    // Fill missing days
    const dailyActivity: Array<{ date: string; commits: number; prs_opened: number; prs_merged: number; reviews: number }> = []
    const cursor = new Date(since)
    const today = new Date()
    while (cursor <= today) {
      const dayStr = cursor.toISOString().split('T')[0]
      const data = dailyMap.get(dayStr) || { commits: 0, prs_opened: 0, prs_merged: 0, reviews: 0 }
      dailyActivity.push({ date: dayStr, ...data })
      cursor.setDate(cursor.getDate() + 1)
    }

    // ── Repo breakdown ──
    const repoMap = new Map<string, { commits: number; prs: number; reviews: number }>()
    for (const e of allEvents) {
      const repo = e.repo_name || 'unknown'
      const existing = repoMap.get(repo) || { commits: 0, prs: 0, reviews: 0 }
      if (e.event_type === 'commit') existing.commits++
      else if (e.event_type === 'pr_opened' || e.event_type === 'pr_merged') existing.prs++
      else if (e.event_type === 'pr_reviewed') existing.reviews++
      repoMap.set(repo, existing)
    }
    const byRepo = Array.from(repoMap.entries())
      .map(([repo, data]) => ({ repo, ...data, total: data.commits + data.prs + data.reviews }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    // ── AI usage cross-reference ──
    // Fetch AI sessions for the same period to correlate
    const { data: aiSessions } = await supabase
      .from('ai_sessions')
      .select('started_at, duration_seconds, messages_count, tool_calls_count')
      .eq('user_id', user.id)
      .gte('started_at', sinceIso)

    const aiData = aiSessions || []
    const totalAiSessions = aiData.length
    const totalAiMinutes = Math.round(aiData.reduce((sum, s) => sum + (s.duration_seconds || 0), 0) / 60)

    // Daily AI usage for correlation chart
    const aiDailyMap = new Map<string, { sessions: number; minutes: number }>()
    for (const s of aiData) {
      const day = new Date(s.started_at).toISOString().split('T')[0]
      const existing = aiDailyMap.get(day) || { sessions: 0, minutes: 0 }
      existing.sessions++
      existing.minutes += Math.round((s.duration_seconds || 0) / 60)
      aiDailyMap.set(day, existing)
    }

    // Merge AI data into daily activity
    const dailyWithAi = dailyActivity.map(d => ({
      ...d,
      ai_sessions: aiDailyMap.get(d.date)?.sessions || 0,
      ai_minutes: aiDailyMap.get(d.date)?.minutes || 0,
    }))

    // ── Recent events ──
    const recentEvents = allEvents.slice(0, 50)

    // ── PR cycle time + stale PR nudges + AI share ──
    // We already fetched aiSessions above for the correlation chart — reuse
    // them here to power the session-overlap signal in computeAiShare.
    const aiSessionWindows = (aiData || []).map(s => ({
      started_at: s.started_at as string,
      duration_seconds: (s.duration_seconds as number) ?? null,
    }))
    const prMetrics = computePrMetrics(allEvents as unknown as GithubEventRow[], {
      aiSessions: aiSessionWindows,
    })

    return NextResponse.json({
      summary: {
        totalCommits: commits.length,
        totalPrsOpened: prsOpened.length,
        totalPrsMerged: prsMerged.length,
        totalPrsReviewed: prsReviewed.length,
        totalAiSessions,
        totalAiMinutes,
        days,
      },
      dailyActivity: dailyWithAi,
      byRepo,
      recentEvents,
      prMetrics,
    })
  } catch (err: any) {
    console.error('[dev-activity] GET error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
