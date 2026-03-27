import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface CoachingInsight {
  id: string
  category: 'responsiveness' | 'tone' | 'follow_through' | 'relationship' | 'workload' | 'communication_style'
  categoryLabel: string
  priority: 'critical' | 'high' | 'medium' | 'growth'
  title: string
  description: string
  evidence?: string
  evidenceAttribution?: string
  action: string
  metric?: { label: string; value: string; trend?: 'up' | 'down' | 'stable' }
  researchBasis?: string
}

export interface UserCommunicationProfile {
  avgResponseTimeHours: number
  responseTimeByUrgency: Record<string, number>
  dominantTone: string
  toneDistribution: Record<string, number>
  topStakeholders: Array<{ name: string; interactions: number; openCommitments: number }>
  completionRate: number
  avgCompletionDays: number
  commitmentVolume: { weekly: number; trend: 'increasing' | 'decreasing' | 'stable' }
  commonCommitmentTypes: Record<string, number>
  missedEmailRate: number
  peakActivityHours: number[]
}

export function buildCommunicationProfile(
  commitments: any[],
  missedEmails: any[]
): UserCommunicationProfile {
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  const recent = commitments.filter(
    c => new Date(c.created_at).getTime() >= thirtyDaysAgo
  )
  const recentMissed = missedEmails.filter(
    m => new Date(m.received_at || m.created_at).getTime() >= thirtyDaysAgo
  )

  const completed = recent.filter(c => c.status === 'completed')
  const completionRate = recent.length > 0
    ? Math.round((completed.length / recent.length) * 100)
    : 0

  const completionDays = completed
    .filter((c: any) => c.completed_at)
    .map((c: any) => {
      const created = new Date(c.created_at).getTime()
      const done = new Date(c.completed_at).getTime()
      return (done - created) / (1000 * 60 * 60 * 24)
    })
  const avgCompletionDays = completionDays.length > 0
    ? Math.round((completionDays.reduce((a: number, b: number) => a + b, 0) / completionDays.length) * 10) / 10
    : 0

  const avgResponseTimeHours = completionDays.length > 0
    ? Math.round((completionDays.reduce((a: number, b: number) => a + b, 0) / completionDays.length) * 24 * 10) / 10
    : 0

  const responseTimeByUrgency: Record<string, number> = {}
  const urgencyGroups: Record<string, number[]> = {}
  for (const c of completed) {
    if (!c.completed_at) continue
    const urgency = c.metadata?.urgency || 'medium'
    const hours = (new Date(c.completed_at).getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60)
    if (!urgencyGroups[urgency]) urgencyGroups[urgency] = []
    urgencyGroups[urgency].push(hours)
  }
  for (const [urgency, hours] of Object.entries(urgencyGroups)) {
    responseTimeByUrgency[urgency] = Math.round(
      (hours.reduce((a, b) => a + b, 0) / hours.length) * 10
    ) / 10
  }

  const toneDistribution: Record<string, number> = {}
  for (const c of recent) {
    const tone = c.metadata?.tone || 'professional'
    toneDistribution[tone] = (toneDistribution[tone] || 0) + 1
  }
  const dominantTone = Object.entries(toneDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'professional'

  const stakeholderMap: Record<string, { interactions: number; openCommitments: number }> = {}
  for (const c of recent) {
    const stakeholders = c.metadata?.stakeholders || []
    for (const s of stakeholders) {
      if (!s.name) continue
      if (!stakeholderMap[s.name]) stakeholderMap[s.name] = { interactions: 0, openCommitments: 0 }
      stakeholderMap[s.name].interactions++
      if (c.status === 'open' || c.status === 'in_progress') {
        stakeholderMap[s.name].openCommitments++
      }
    }
  }
  const topStakeholders = Object.entries(stakeholderMap)
    .sort((a, b) => b[1].interactions - a[1].interactions)
    .slice(0, 10)
    .map(([name, data]) => ({ name, ...data }))

  const thisWeek = recent.filter(c => new Date(c.created_at).getTime() >= sevenDaysAgo)
  const prevWeek = recent.filter(c => {
    const t = new Date(c.created_at).getTime()
    return t >= sevenDaysAgo - 7 * 24 * 60 * 60 * 1000 && t < sevenDaysAgo
  })
  const weeklyCount = thisWeek.length
  let trend: 'increasing' | 'decreasing' | 'stable' = 'stable'
  if (prevWeek.length > 0) {
    const diff = (weeklyCount - prevWeek.length) / prevWeek.length
    if (diff > 0.2) trend = 'increasing'
    else if (diff < -0.2) trend = 'decreasing'
  }

  const commonCommitmentTypes: Record<string, number> = {}
  for (const c of recent) {
    const type = c.metadata?.commitmentType || 'general'
    commonCommitmentTypes[type] = (commonCommitmentTypes[type] || 0) + 1
  }

  const totalEmails = recentMissed.length + recent.filter((c: any) => c.source === 'email' || c.source === 'outlook').length
  const missedEmailRate = totalEmails > 0
    ? Math.round((recentMissed.length / totalEmails) * 100)
    : 0

  const hourCounts: Record<number, number> = {}
  for (const c of recent) {
    const hour = new Date(c.created_at).getHours()
    hourCounts[hour] = (hourCounts[hour] || 0) + 1
  }
  const peakActivityHours = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => parseInt(h))

  return {
    avgResponseTimeHours,
    responseTimeByUrgency,
    dominantTone,
    toneDistribution,
    topStakeholders,
    completionRate,
    avgCompletionDays,
    commitmentVolume: { weekly: weeklyCount, trend },
    commonCommitmentTypes,
    missedEmailRate,
    peakActivityHours,
  }
}

// ============================================================
// Tool definition for structured coaching output
// ============================================================

const COACHING_INSIGHTS_TOOL: Anthropic.Messages.Tool = {
  name: 'report_coaching_insights',
  description: 'Report personalized coaching insights based on communication data.',
  input_schema: {
    type: 'object' as const,
    properties: {
      insights: {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique kebab-case id' },
            category: { type: 'string', enum: ['responsiveness', 'tone', 'follow_through', 'relationship', 'workload', 'communication_style'] },
            categoryLabel: { type: 'string', description: 'Sharp label e.g. "CRITICAL PATTERN", "EBITDA RISK", "DELEGATION GAP"' },
            priority: { type: 'string', enum: ['critical', 'high', 'medium', 'growth'] },
            title: { type: 'string', description: 'Provocative, specific observation' },
            description: { type: 'string', description: '2-4 sentences with specific names, numbers, situations' },
            evidence: { type: 'string', description: 'Direct quote from their messages with attribution' },
            evidenceAttribution: { type: 'string', description: 'Who they said it to and when' },
            action: { type: 'string', description: 'Bold, specific recommendation implementable THIS WEEK' },
            metric: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
                trend: { type: 'string', enum: ['up', 'down', 'stable'] },
              },
              required: ['label', 'value'],
            },
            researchBasis: { type: 'string', description: 'Brief research citation' },
          },
          required: ['id', 'category', 'categoryLabel', 'priority', 'title', 'description', 'action'],
        },
      },
    },
    required: ['insights'],
  },
}

export async function generateCoachingInsights(
  profile: UserCommunicationProfile,
  userProfile: { jobTitle?: string; teamSize?: string; company?: string },
  recentCommitments: any[],
  recentMissedEmails: any[]
): Promise<CoachingInsight[]> {
  const open = recentCommitments.filter(c => c.status === 'open' || c.status === 'in_progress')
  const overdue = recentCommitments.filter(c => c.status === 'overdue')
  const completed = recentCommitments.filter(c => c.status === 'completed')

  const sourceBreakdown: Record<string, number> = {}
  for (const c of recentCommitments) {
    const src = c.source || 'unknown'
    sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1
  }

  const overdueBySource: Record<string, { total: number; overdue: number }> = {}
  for (const c of recentCommitments) {
    const src = c.source || 'unknown'
    if (!overdueBySource[src]) overdueBySource[src] = { total: 0, overdue: 0 }
    overdueBySource[src].total++
    if (c.status === 'overdue' || (c.status === 'open' && daysSince(c.created_at) > 7)) {
      overdueBySource[src].overdue++
    }
  }

  const recentQuotes = recentCommitments
    .filter((c: any) => c.metadata?.originalQuote)
    .slice(0, 15)
    .map((c: any) => ({
      title: c.title,
      quote: c.metadata.originalQuote,
      source: c.source || 'unknown',
      stakeholders: (c.metadata.stakeholders || []).map((s: any) => s.name).join(', '),
      daysOld: daysSince(c.created_at),
      status: c.status,
    }))

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: [{ type: 'text', text: `You are an expert executive communication coach ($500/hr strategic advisor). Analyze real communication data and deliver insights that are blunt, specific, and evidence-grounded.

BE BRUTALLY SPECIFIC: reference actual names, numbers, quotes. Never say "some items" -- say "3 open commitments with Sarah Chen, 2 stalled 9+ days."
USE THEIR WORDS: quote their messages directly with attribution.
THINK STRATEGICALLY: frame as business risk, executive leverage, organizational impact -- not just "overdue items."
PROVOCATIVE TITLES: sharp observations, not category labels. Good: "You're solving $50/hr problems with $5,000/hr time." Bad: "Consider delegating."
CATEGORY LABELS: sharp and specific -- "CRITICAL PATTERN", "EBITDA RISK", "DELEGATION GAP", not generic.
ACTIONS: specific, bold, implementable THIS WEEK.

Priority: critical = active business risk | high = leverage opportunity | medium = habits | growth = wins to systematize.`, cache_control: { type: 'ephemeral' } }],
    tools: [COACHING_INSIGHTS_TOOL],
    tool_choice: { type: 'tool', name: 'report_coaching_insights' },
    messages: [{
      role: 'user',
      content: `USER: ${userProfile.jobTitle || 'Not specified'} | Team: ${userProfile.teamSize || '?'} | ${userProfile.company || ''}

METRICS (30d): ${recentCommitments.length} total, ${open.length} open, ${completed.length} completed, ${overdue.length} overdue, ${profile.completionRate}% rate, ${profile.avgCompletionDays}d avg
Weekly: ${profile.commitmentVolume.weekly} new (${profile.commitmentVolume.trend}), Response: ${profile.avgResponseTimeHours}h avg
Urgency response: ${JSON.stringify(profile.responseTimeByUrgency)}
Tone: ${profile.dominantTone} (${JSON.stringify(profile.toneDistribution)})
Sources: ${Object.entries(sourceBreakdown).map(([s, c]) => `${s}:${c}`).join(', ')}
Overdue by source: ${Object.entries(overdueBySource).map(([s, d]) => `${s}:${d.overdue}/${d.total}`).join(', ')}
Stakeholders: ${profile.topStakeholders.length > 0 ? profile.topStakeholders.map(s => `${s.name}(${s.interactions}i,${s.openCommitments}open)`).join(', ') : 'none'}
Types: ${Object.entries(profile.commonCommitmentTypes).map(([t, c]) => `${t}:${c}`).join(', ')}
Missed emails: ${profile.missedEmailRate}% rate, ${recentMissedEmails.length} total${recentMissedEmails.length > 0 ? ` from: ${recentMissedEmails.slice(0, 5).map((m: any) => m.from_name || m.from_email || '?').join(', ')}` : ''}
Peak hours: ${profile.peakActivityHours.map(h => `${h}:00`).join(', ') || 'n/a'}

QUOTES (use as evidence):
${recentQuotes.length > 0 ? recentQuotes.map((q: any) => `- [${q.source}] "${q.quote}" (${q.stakeholders ? 'w/' + q.stakeholders : ''}, ${q.daysOld}d, ${q.status})`).join('\n') : '(none)'}

Generate 3-5 strategic coaching insights.`,
    }],
  })

  const toolBlock = message.content.find((b) => b.type === 'tool_use')
  if (toolBlock && toolBlock.type === 'tool_use') {
    const result = toolBlock.input as { insights: CoachingInsight[] }
    return result.insights || []
  }

  return []
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}
