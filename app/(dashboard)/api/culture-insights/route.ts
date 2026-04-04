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

// Valid tone themes for filtering
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
  week_start: string
  avg_sentiment: number
  message_count: number
  top_themes: string[]
  positive_ratio: number
}

interface CultureSnapshotRow {
  week_start: string
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
 * Privacy: only numeric scores, never message content.
 *
 * Query params:
 *   - weeks: number of weeks of history (default 8)
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
    const weeks = Math.min(52, Math.max(1, parseInt(searchParams.get('weeks') || '8', 10)))

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

    // Only managers can see org-wide culture data
    if (!MANAGER_ROLES.includes(callerMembership.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const orgId = callerMembership.organization_id

    // Calculate date range
    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() + 1) // Monday
    weekStart.setUTCHours(0, 0, 0, 0)

    const rangeStart = new Date(weekStart)
    rangeStart.setUTCDate(rangeStart.getUTCDate() - (weeks * 7))
    const rangeStartISO = rangeStart.toISOString()

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

    // Parallel queries for live sentiment data
    const memberIds = Array.from(memberMap.keys())

    const [emailsResult, chatsResult, snapshotsResult, userSentimentResult] = await Promise.all([
      // Recent emails with sentiment
      admin
        .from('missed_emails')
        .select('sentiment_score, sentiment_label, tone_themes, user_id, received_at')
        .in('user_id', memberIds)
        .gte('received_at', rangeStartISO)
        .not('sentiment_score', 'is', null)
        .order('received_at', { ascending: false })
        .limit(500),

      // Recent chats with sentiment
      admin
        .from('missed_chats')
        .select('sentiment_score, sentiment_label, tone_themes, user_id, sent_at')
        .in('user_id', memberIds)
        .gte('sent_at', rangeStartISO)
        .not('sentiment_score', 'is', null)
        .order('sent_at', { ascending: false })
        .limit(500),

      // Pre-computed weekly snapshots
      admin
        .from('culture_snapshots')
        .select('*')
        .eq('organization_id', orgId)
        .gte('week_start', rangeStart.toISOString().split('T')[0])
        .order('week_start', { ascending: true }),

      // Per-user sentiment trends
      admin
        .from('user_sentiment_scores')
        .select('*')
        .eq('organization_id', orgId)
        .gte('week_start', rangeStart.toISOString().split('T')[0])
        .order('week_start', { ascending: true }),
    ])

    const emails: SentimentRow[] = (emailsResult.data || []) as SentimentRow[]
    const chats: SentimentRow[] = (chatsResult.data || []) as SentimentRow[]
    const snapshots: CultureSnapshotRow[] = (snapshotsResult.data || []) as CultureSnapshotRow[]
    const userSentiments: UserSentimentRow[] = (userSentimentResult.data || []) as UserSentimentRow[]

    // Compute live tone index from recent messages (supplements snapshots)
    const allMessages = [...emails, ...chats]
    const liveStats = computeLiveStats(allMessages)

    // Build weekly trend from snapshots (or live data if no snapshots yet)
    const weeklyTrend = snapshots.length > 0
      ? snapshots.map((s: CultureSnapshotRow) => ({
          week: s.week_start,
          toneIndex: s.tone_index,
          sampleCount: s.sample_count,
          themes: s.theme_counts,
          distribution: {
            positive: s.positive_count,
            neutral: s.neutral_count,
            negative: s.negative_count,
          },
        }))
      : buildWeeklyTrendFromLive(allMessages, weeks, weekStart)

    // Top themes across all time
    const themeRanking = computeThemeRanking(allMessages)

    // Individual sentiment highlights
    const individualScores = computeIndividualScores(allMessages, memberMap, userSentiments)

    // Department heatmap (if snapshots have dept data, otherwise compute live)
    const departmentHeatmap = snapshots.length > 0 && snapshots[snapshots.length - 1]
      ? snapshots[snapshots.length - 1].department_scores
      : computeDepartmentScores(allMessages, memberMap)

    return NextResponse.json({
      // Current state
      currentToneIndex: liveStats.avgSentiment,
      currentLabel: liveStats.avgSentiment > 0.2 ? 'positive' : liveStats.avgSentiment < -0.2 ? 'negative' : 'neutral',
      sampleCount: liveStats.totalCount,
      distribution: liveStats.distribution,

      // Top themes this period
      topThemes: themeRanking.slice(0, 6),

      // Weekly trend
      weeklyTrend,

      // People insights (sorted by sentiment, extremes first)
      individuals: individualScores,

      // Department heatmap
      departmentHeatmap,

      // Notable shifts (people whose sentiment changed significantly)
      notableShifts: findNotableShifts(userSentiments, memberMap),
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
  // Group by user
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

  // Build per-user weekly trend from user_sentiment_scores
  const userTrends: Record<string, Array<{ week: string; avg: number }>> = {}
  for (const row of userSentiments) {
    if (!userTrends[row.user_id]) userTrends[row.user_id] = []
    userTrends[row.user_id].push({ week: row.week_start, avg: row.avg_sentiment })
  }

  return Object.entries(userScores)
    .map(([userId, data]) => {
      const avg = data.scores.reduce((s: number, v: number) => s + v, 0) / data.scores.length
      const member = memberMap.get(userId)
      // Top themes for this person
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

function buildWeeklyTrendFromLive(
  messages: SentimentRow[],
  weeks: number,
  currentWeekStart: Date
) {
  const trend: Array<{
    week: string
    toneIndex: number
    sampleCount: number
    themes: Record<string, number>
    distribution: { positive: number; neutral: number; negative: number }
  }> = []

  for (let w = weeks - 1; w >= 0; w--) {
    const wStart = new Date(currentWeekStart)
    wStart.setUTCDate(wStart.getUTCDate() - (w * 7))
    const wEnd = new Date(wStart)
    wEnd.setUTCDate(wEnd.getUTCDate() + 7)

    const weekMsgs = messages.filter((m: SentimentRow) => {
      const d = new Date(m.received_at || m.sent_at || '')
      return d >= wStart && d < wEnd
    })

    const stats = computeLiveStats(weekMsgs)
    const themes: Record<string, number> = {}
    for (const msg of weekMsgs) {
      if (msg.tone_themes) {
        for (const t of msg.tone_themes) {
          themes[t] = (themes[t] || 0) + 1
        }
      }
    }

    trend.push({
      week: wStart.toISOString().split('T')[0],
      toneIndex: stats.avgSentiment,
      sampleCount: stats.totalCount,
      themes,
      distribution: stats.distribution,
    })
  }

  return trend
}

function findNotableShifts(
  userSentiments: UserSentimentRow[],
  memberMap: Map<string, { name: string; avatar: string | null; department: string | null }>
) {
  // Find users whose sentiment shifted significantly week-over-week
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
    const sorted = rows.sort((a, b) => a.week_start.localeCompare(b.week_start))
    const current = sorted[sorted.length - 1]
    const previous = sorted[sorted.length - 2]
    const delta = current.avg_sentiment - previous.avg_sentiment

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
