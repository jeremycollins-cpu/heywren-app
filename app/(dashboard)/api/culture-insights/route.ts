import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const MANAGER_ROLES = ['org_admin', 'dept_manager', 'team_lead']

const TONE_THEMES = [
  'gratitude', 'urgency', 'frustration', 'collaboration',
  'confusion', 'celebration', 'concern', 'encouragement',
  'formality', 'casual',
] as const

interface SentimentRow {
  sentiment_score: number | null
  sentiment_label: string | null
  tone_themes: string[] | null
  user_id: string
  received_at?: string
  sent_at?: string
}

interface UserSentimentRow {
  user_id: string
  month_start: string
  avg_sentiment: number
  message_count: number
  top_themes: string[]
  positive_ratio: number
}

interface CultureSnapshotRow {
  month_start: string
  tone_index: number
  sample_count: number
  theme_counts: Record<string, number>
  positive_count: number
  neutral_count: number
  negative_count: number
  department_scores: Record<string, { tone: number; count: number }>
}

interface MemberInfo {
  user_id: string
  profiles: { display_name: string; avatar_url: string | null; job_title: string | null } | null
  department_id: string | null
}

/**
 * GET /api/culture-insights
 * Returns aggregated sentiment and culture tone data for the org.
 * Aggregated monthly — sentiment is a slow-moving, big-picture stat.
 * Privacy: only numeric scores, never message content.
 *
 * Query params:
 *   - months: number of months of history (default 6, max 12)
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
    const months = Math.min(12, Math.max(1, parseInt(searchParams.get('months') || '6', 10)))

    // Get caller's org membership
    const { data: callerMembership } = await admin
      .from('organization_members')
      .select('organization_id, department_id, role')
      .eq('user_id', callerId)
      .limit(1)
      .single()

    if (!callerMembership) {
      return NextResponse.json({ error: 'No organization' }, { status: 404 })
    }

    if (!MANAGER_ROLES.includes(callerMembership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const orgId = callerMembership.organization_id

    // Calculate date range — first of current month back N months
    const now = new Date()
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1))
    const rangeStartISO = rangeStart.toISOString()
    const rangeStartDate = rangeStart.toISOString().split('T')[0]

    // Get org members for mapping
    const { data: members } = await admin
      .from('organization_members')
      .select('user_id, profiles(display_name, avatar_url, job_title), department_id')
      .eq('organization_id', orgId) as { data: MemberInfo[] | null }

    const memberMap = new Map<string, { name: string; avatar: string | null; department: string | null }>()
    for (const m of members || []) {
      const profile = m.profiles as { display_name: string; avatar_url: string | null; job_title: string | null } | null
      memberMap.set(m.user_id, {
        name: profile?.display_name || 'Unknown',
        avatar: profile?.avatar_url || null,
        department: m.department_id,
      })
    }

    const memberIds = Array.from(memberMap.keys())

    // Parallel queries: pre-computed snapshots + live data for current month
    const [emailsResult, chatsResult, snapshotsResult, userSentimentResult] = await Promise.all([
      // Current month's live emails (not yet aggregated)
      admin
        .from('missed_emails')
        .select('sentiment_score, sentiment_label, tone_themes, user_id, received_at')
        .in('user_id', memberIds)
        .gte('received_at', currentMonthStart.toISOString())
        .not('sentiment_score', 'is', null)
        .order('received_at', { ascending: false })
        .limit(500),

      // Current month's live chats
      admin
        .from('missed_chats')
        .select('sentiment_score, sentiment_label, tone_themes, user_id, sent_at')
        .in('user_id', memberIds)
        .gte('sent_at', currentMonthStart.toISOString())
        .not('sentiment_score', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(500),

      // Pre-computed monthly snapshots
      admin
        .from('culture_snapshots')
        .select('*')
        .eq('organization_id', orgId)
        .gte('month_start', rangeStartDate)
        .order('month_start', { ascending: true }),

      // Per-user monthly sentiment
      admin
        .from('user_sentiment_scores')
        .select('*')
        .eq('organization_id', orgId)
        .gte('month_start', rangeStartDate)
        .order('month_start', { ascending: true }),
    ])

    // Check for errors on each parallel query and fall back to empty arrays
    if (emailsResult.error) console.error('culture-insights: emails query failed', emailsResult.error)
    if (chatsResult.error) console.error('culture-insights: chats query failed', chatsResult.error)
    if (snapshotsResult.error) console.error('culture-insights: snapshots query failed', snapshotsResult.error)
    if (userSentimentResult.error) console.error('culture-insights: userSentiment query failed', userSentimentResult.error)

    const liveEmails: SentimentRow[] = (emailsResult.data || []) as SentimentRow[]
    const liveChats: SentimentRow[] = (chatsResult.data || []) as SentimentRow[]
    const snapshots: CultureSnapshotRow[] = (snapshotsResult.data || []) as CultureSnapshotRow[]
    const userSentiments: UserSentimentRow[] = (userSentimentResult.data || []) as UserSentimentRow[]

    // Current month live stats (supplements the most recent snapshot)
    const liveMessages = [...liveEmails, ...liveChats]
    const liveStats = computeLiveStats(liveMessages)

    // Build monthly trend from snapshots + current month live
    const monthlyTrend = buildMonthlyTrend(snapshots, liveStats, liveMessages, currentMonthStart)

    // Top themes from current month live data
    const themeRanking = computeThemeRanking(liveMessages)

    // Individual sentiment from current month
    const individualScores = computeIndividualScores(liveMessages, memberMap, userSentiments)

    // Department heatmap
    const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
    const departmentHeatmap = latestSnapshot
      ? latestSnapshot.department_scores
      : computeDepartmentScores(liveMessages, memberMap)

    return NextResponse.json({
      // Current month state
      currentToneIndex: liveStats.avgSentiment,
      currentLabel: liveStats.avgSentiment > 0.2 ? 'positive' : liveStats.avgSentiment < -0.2 ? 'negative' : 'neutral',
      sampleCount: liveStats.totalCount,
      distribution: liveStats.distribution,
      currentMonth: currentMonthStart.toISOString().split('T')[0],

      // Top themes this month
      topThemes: themeRanking.slice(0, 6),

      // Monthly trend (past N months + current)
      monthlyTrend,

      // People insights
      individuals: individualScores,

      // Department heatmap
      departmentHeatmap,

      // Notable month-over-month shifts
      notableShifts: findNotableShifts(userSentiments, memberMap),
    }, {
      headers: { 'Cache-Control': 'private, max-age=300, stale-while-revalidate=60' },
    })
  } catch (err) {
    console.error('Culture insights GET error:', err)
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 })
  }
}

// ── Helper functions ──────────────────────────────────────────────────────

function computeLiveStats(messages: SentimentRow[]) {
  if (messages.length === 0) {
    return { avgSentiment: 0, totalCount: 0, distribution: { positive: 0, neutral: 0, negative: 0 } }
  }

  let sum = 0
  const distribution = { positive: 0, neutral: 0, negative: 0 }

  for (const msg of messages) {
    if (msg.sentiment_score != null) {
      sum += msg.sentiment_score
      if (msg.sentiment_label === 'positive') distribution.positive++
      else if (msg.sentiment_label === 'negative') distribution.negative++
      else distribution.neutral++
    }
  }

  return {
    avgSentiment: Math.round((sum / messages.length) * 100) / 100,
    totalCount: messages.length,
    distribution,
  }
}

function computeThemeRanking(messages: SentimentRow[]): Array<{ theme: string; count: number; percentage: number }> {
  const counts: Record<string, number> = {}
  let total = 0

  for (const msg of messages) {
    if (msg.tone_themes) {
      for (const theme of msg.tone_themes) {
        if (TONE_THEMES.includes(theme as typeof TONE_THEMES[number])) {
          counts[theme] = (counts[theme] || 0) + 1
          total++
        }
      }
    }
  }

  return Object.entries(counts)
    .map(([theme, count]) => ({
      theme,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)
}

function computeIndividualScores(
  messages: SentimentRow[],
  memberMap: Map<string, { name: string; avatar: string | null; department: string | null }>,
  userSentiments: UserSentimentRow[]
) {
  const userScores: Record<string, { scores: number[]; themes: string[] }> = {}
  for (const msg of messages) {
    if (msg.sentiment_score == null) continue
    if (!userScores[msg.user_id]) {
      userScores[msg.user_id] = { scores: [], themes: [] }
    }
    userScores[msg.user_id].scores.push(msg.sentiment_score)
    if (msg.tone_themes) {
      userScores[msg.user_id].themes.push(...msg.tone_themes)
    }
  }

  // Per-user monthly trend from pre-computed scores
  const userTrends: Record<string, Array<{ month: string; avg: number }>> = {}
  for (const row of userSentiments) {
    if (!userTrends[row.user_id]) userTrends[row.user_id] = []
    userTrends[row.user_id].push({ month: row.month_start, avg: row.avg_sentiment })
  }

  return Object.entries(userScores)
    .map(([userId, data]) => {
      const avg = data.scores.reduce((s: number, v: number) => s + v, 0) / data.scores.length
      const member = memberMap.get(userId)
      const themeCounts: Record<string, number> = {}
      for (const t of data.themes) {
        themeCounts[t] = (themeCounts[t] || 0) + 1
      }
      const topThemes = Object.entries(themeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t)

      return {
        userId,
        name: member?.name || 'Unknown',
        avatar: member?.avatar || null,
        avgSentiment: Math.round(avg * 100) / 100,
        messageCount: data.scores.length,
        label: avg > 0.2 ? 'positive' : avg < -0.2 ? 'negative' : 'neutral',
        topThemes,
        trend: userTrends[userId] || [],
      }
    })
    .sort((a, b) => Math.abs(b.avgSentiment) - Math.abs(a.avgSentiment))
}

function computeDepartmentScores(
  messages: SentimentRow[],
  memberMap: Map<string, { name: string; avatar: string | null; department: string | null }>
): Record<string, { tone: number; count: number }> {
  const deptData: Record<string, { sum: number; count: number }> = {}

  for (const msg of messages) {
    if (msg.sentiment_score == null) continue
    const member = memberMap.get(msg.user_id)
    const dept = member?.department || 'unassigned'
    if (!deptData[dept]) deptData[dept] = { sum: 0, count: 0 }
    deptData[dept].sum += msg.sentiment_score
    deptData[dept].count++
  }

  const result: Record<string, { tone: number; count: number }> = {}
  for (const [dept, data] of Object.entries(deptData)) {
    result[dept] = {
      tone: Math.round((data.sum / data.count) * 100) / 100,
      count: data.count,
    }
  }
  return result
}

function buildMonthlyTrend(
  snapshots: CultureSnapshotRow[],
  liveStats: { avgSentiment: number; totalCount: number; distribution: { positive: number; neutral: number; negative: number } },
  liveMessages: SentimentRow[],
  currentMonthStart: Date
) {
  const trend: Array<{
    month: string
    toneIndex: number
    sampleCount: number
    themes: Record<string, number>
    distribution: { positive: number; neutral: number; negative: number }
  }> = []

  // Add pre-computed past months
  for (const s of snapshots) {
    trend.push({
      month: s.month_start,
      toneIndex: s.tone_index,
      sampleCount: s.sample_count,
      themes: s.theme_counts,
      distribution: {
        positive: s.positive_count,
        neutral: s.neutral_count,
        negative: s.negative_count,
      },
    })
  }

  // Add current month from live data (if not already in snapshots)
  const currentMonthStr = currentMonthStart.toISOString().split('T')[0]
  const alreadyHasCurrent = snapshots.some((s: CultureSnapshotRow) => s.month_start === currentMonthStr)

  if (!alreadyHasCurrent && liveStats.totalCount > 0) {
    const themes: Record<string, number> = {}
    for (const msg of liveMessages) {
      if (msg.tone_themes) {
        for (const t of msg.tone_themes) {
          themes[t] = (themes[t] || 0) + 1
        }
      }
    }
    trend.push({
      month: currentMonthStr,
      toneIndex: liveStats.avgSentiment,
      sampleCount: liveStats.totalCount,
      themes,
      distribution: liveStats.distribution,
    })
  }

  return trend
}

function findNotableShifts(
  userSentiments: UserSentimentRow[],
  memberMap: Map<string, { name: string; avatar: string | null; department: string | null }>
) {
  const byUser: Record<string, UserSentimentRow[]> = {}
  for (const row of userSentiments) {
    if (!byUser[row.user_id]) byUser[row.user_id] = []
    byUser[row.user_id].push(row)
  }

  const shifts: Array<{
    userId: string
    name: string
    avatar: string | null
    previousAvg: number
    currentAvg: number
    delta: number
    direction: 'improving' | 'declining'
  }> = []

  for (const [userId, rows] of Object.entries(byUser)) {
    if (rows.length < 2) continue
    const sorted = rows.sort((a, b) => a.month_start.localeCompare(b.month_start))
    const current = sorted[sorted.length - 1]
    const previous = sorted[sorted.length - 2]
    const delta = current.avg_sentiment - previous.avg_sentiment

    // 0.3 shift month-over-month is significant
    if (Math.abs(delta) >= 0.3) {
      const member = memberMap.get(userId)
      shifts.push({
        userId,
        name: member?.name || 'Unknown',
        avatar: member?.avatar || null,
        previousAvg: previous.avg_sentiment,
        currentAvg: current.avg_sentiment,
        delta: Math.round(delta * 100) / 100,
        direction: delta > 0 ? 'improving' : 'declining',
      })
    }
  }

  return shifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5)
}

export const dynamic = 'force-dynamic'
