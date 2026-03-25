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

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  const jsonMatch = text.match(/\[[\s\S]*\]/)
  if (jsonMatch) return jsonMatch[0]
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) return objMatch[0]
  return text.trim()
}

export function buildCommunicationProfile(
  commitments: any[],
  missedEmails: any[]
): UserCommunicationProfile {
  const now = Date.now()
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  // Filter to last 30 days
  const recent = commitments.filter(
    c => new Date(c.created_at).getTime() >= thirtyDaysAgo
  )
  const recentMissed = missedEmails.filter(
    m => new Date(m.received_at || m.created_at).getTime() >= thirtyDaysAgo
  )

  // Completion rate
  const completed = recent.filter(c => c.status === 'completed')
  const completionRate = recent.length > 0
    ? Math.round((completed.length / recent.length) * 100)
    : 0

  // Avg completion days (from created_at to completed_at)
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

  // Avg response time (using completion time as proxy)
  const avgResponseTimeHours = completionDays.length > 0
    ? Math.round((completionDays.reduce((a: number, b: number) => a + b, 0) / completionDays.length) * 24 * 10) / 10
    : 0

  // Response time by urgency
  const responseTimeByUrgency: Record<string, number> = {}
  const urgencyGroups: Record<string, number[]> = {}
  for (const c of completed) {
    if (!c.completed_at) continue
    const urgency = c.metadata?.urgency || 'medium'
    const days = (new Date(c.completed_at).getTime() - new Date(c.created_at).getTime()) / (1000 * 60 * 60)
    if (!urgencyGroups[urgency]) urgencyGroups[urgency] = []
    urgencyGroups[urgency].push(days)
  }
  for (const [urgency, hours] of Object.entries(urgencyGroups)) {
    responseTimeByUrgency[urgency] = Math.round(
      (hours.reduce((a, b) => a + b, 0) / hours.length) * 10
    ) / 10
  }

  // Tone distribution
  const toneDistribution: Record<string, number> = {}
  for (const c of recent) {
    const tone = c.metadata?.tone || 'professional'
    toneDistribution[tone] = (toneDistribution[tone] || 0) + 1
  }
  const dominantTone = Object.entries(toneDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || 'professional'

  // Top stakeholders
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

  // Commitment volume (weekly trend)
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

  // Common commitment types
  const commonCommitmentTypes: Record<string, number> = {}
  for (const c of recent) {
    const type = c.metadata?.commitmentType || 'general'
    commonCommitmentTypes[type] = (commonCommitmentTypes[type] || 0) + 1
  }

  // Missed email rate
  const totalEmails = recentMissed.length + recent.filter((c: any) => c.source === 'email' || c.source === 'outlook').length
  const missedEmailRate = totalEmails > 0
    ? Math.round((recentMissed.length / totalEmails) * 100)
    : 0

  // Peak activity hours
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

export async function generateCoachingInsights(
  profile: UserCommunicationProfile,
  userProfile: { jobTitle?: string; teamSize?: string; company?: string },
  recentCommitments: any[],
  recentMissedEmails: any[]
): Promise<CoachingInsight[]> {
  const open = recentCommitments.filter(c => c.status === 'open' || c.status === 'in_progress')
  const overdue = recentCommitments.filter(c => c.status === 'overdue')
  const completed = recentCommitments.filter(c => c.status === 'completed')

  // Build source breakdown
  const sourceBreakdown: Record<string, number> = {}
  for (const c of recentCommitments) {
    const src = c.source || 'unknown'
    sourceBreakdown[src] = (sourceBreakdown[src] || 0) + 1
  }

  // Source-specific overdue rates
  const overdueBySource: Record<string, { total: number; overdue: number }> = {}
  for (const c of recentCommitments) {
    const src = c.source || 'unknown'
    if (!overdueBySource[src]) overdueBySource[src] = { total: 0, overdue: 0 }
    overdueBySource[src].total++
    if (c.status === 'overdue' || (c.status === 'open' && daysSince(c.created_at) > 7)) {
      overdueBySource[src].overdue++
    }
  }

  // Build a list of recent commitment quotes to give the AI evidence material
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

  const systemPrompt = `You are an expert executive communication coach — the kind of strategic advisor that PE-backed CEOs, VPs, and directors hire at $500/hour. You analyze real communication data and deliver insights that are blunt, specific, and grounded in evidence.

You are NOT a generic productivity tool. Your insights should feel like they come from someone who has read every email and Slack message this week and can see the patterns the user can't.

CRITICAL INSTRUCTIONS:
1. BE BRUTALLY SPECIFIC. Reference actual names, numbers, quotes, and patterns from the data. Never say "some items" — say "3 open commitments with Sarah Chen, 2 of which have stalled for 9+ days."
2. USE THEIR OWN WORDS. When you have original quotes from their messages, use them as evidence. Quote them directly and attribute them (e.g., '"we need to actually show them results" — to Tim + Robert, today').
3. THINK LIKE A STRATEGIC ADVISOR. Frame insights in terms of business risk, executive leverage, and organizational impact — not just "you have overdue items." Think: revenue risk, credibility risk, delegation failure, PE confidence, team velocity.
4. CREATE PROVOCATIVE TITLES. The title should be a sharp observation, not a category label. Good: "You're solving $50/hour problems with $5,000/hour time." Bad: "Consider delegating more."
5. CATEGORY LABELS should be sharp and specific to the insight, not generic. Examples: "CRITICAL PATTERN", "EBITDA RISK", "DELEGATION GAP", "TRUST SIGNAL", "STRATEGIC WIN", "VELOCITY BLOCKER", "RELATIONSHIP RISK".
6. PROVIDE EVIDENCE. For each insight, include a direct quote or specific data point from their recent communications that proves your point.
7. ACTIONS should be specific, bold, and implementable THIS WEEK. Not "consider delegating" but "Ask Scott or Mark: 'Is this something you can own end-to-end?' for every operational thread this week."

Generate exactly 3-5 insights. Each insight must be a JSON object with:
- id: a unique kebab-case string
- category: one of "responsiveness", "tone", "follow_through", "relationship", "workload", "communication_style"
- categoryLabel: a sharp, specific label for this insight (e.g., "CRITICAL PATTERN", "EBITDA RISK", "DELEGATION GAP") — NOT the generic category name
- priority: one of "critical", "high", "medium", "growth"
- title: a provocative, specific observation (not generic advice)
- description: 2-4 sentences that paint a clear picture of the pattern, referencing specific names, numbers, and situations. Write like a strategic advisor briefing an executive.
- evidence: (required if quotes available) a direct quote from their recent messages that supports this insight, with attribution (e.g., '"we can't risk stalling the private hauler strategy again" — to Sharath + engineering, Mar 19')
- evidenceAttribution: (optional) who they said it to and when (e.g., "to Scott Clark + Mark Wise, today")
- action: a bold, specific recommendation they can implement THIS WEEK. Frame it as a system/process change, not just a one-off task.
- metric: (optional) { "label": string, "value": string, "trend": "up" | "down" | "stable" }
- researchBasis: (optional) a brief research citation that adds authority

Priority guidelines:
- critical: Patterns creating active business risk — revenue, credibility, PE confidence, team trust
- high: Significant leverage opportunities — delegation, strategic time allocation, stakeholder management
- medium: Worth addressing — tone patterns, communication habits, volume management
- growth: Wins to celebrate and expand — good patterns to systematize

Return ONLY a valid JSON array of insight objects. No markdown, no code fences, no explanation.`

  const userMessage = `Analyze this professional's communication patterns and generate personalized coaching insights.

USER PROFILE:
- Role/Title: ${userProfile.jobTitle || 'Not specified'}
- Team Size: ${userProfile.teamSize || 'Not specified'}
- Company: ${userProfile.company || 'Not specified'}

COMMUNICATION METRICS (Last 30 Days):
- Total commitments tracked: ${recentCommitments.length}
- Open/In-progress: ${open.length}
- Completed: ${completed.length}
- Overdue: ${overdue.length}
- Completion rate: ${profile.completionRate}%
- Avg days to complete: ${profile.avgCompletionDays}
- Avg response time: ${profile.avgResponseTimeHours} hours
- Response time by urgency: ${JSON.stringify(profile.responseTimeByUrgency)}
- This week's new commitments: ${profile.commitmentVolume.weekly}
- Weekly trend: ${profile.commitmentVolume.trend}

TONE ANALYSIS:
- Dominant tone: ${profile.dominantTone}
- Distribution: ${JSON.stringify(profile.toneDistribution)}

SOURCE BREAKDOWN:
${Object.entries(sourceBreakdown).map(([src, count]) => `- ${src}: ${count} commitments`).join('\n')}

OVERDUE RATES BY SOURCE:
${Object.entries(overdueBySource).map(([src, data]) => `- ${src}: ${data.overdue}/${data.total} overdue (${Math.round((data.overdue / data.total) * 100)}%)`).join('\n')}

TOP STAKEHOLDERS:
${profile.topStakeholders.length > 0
    ? profile.topStakeholders.map(s => `- ${s.name}: ${s.interactions} interactions, ${s.openCommitments} open commitments`).join('\n')
    : '- No stakeholder data available yet'}

COMMITMENT TYPES:
${Object.entries(profile.commonCommitmentTypes).map(([type, count]) => `- ${type}: ${count}`).join('\n')}

MISSED EMAILS:
- Missed email rate: ${profile.missedEmailRate}%
- Total missed emails (30 days): ${recentMissedEmails.length}
${recentMissedEmails.length > 0 ? `- Recent missed senders: ${recentMissedEmails.slice(0, 5).map((m: any) => m.from_name || m.from_email || 'unknown').join(', ')}` : ''}

ACTIVITY PATTERNS:
- Peak activity hours: ${profile.peakActivityHours.length > 0 ? profile.peakActivityHours.map(h => `${h}:00`).join(', ') : 'Not enough data'}

RECENT COMMITMENT QUOTES (use these as evidence — quote them directly):
${recentQuotes.length > 0
    ? recentQuotes.map((q: any) => `- [${q.source}] "${q.quote}" (${q.stakeholders ? 'with ' + q.stakeholders : 'no stakeholders'}, ${q.daysOld}d ago, status: ${q.status})`).join('\n')
    : '- No quotes available yet'}

Generate 3-5 personalized strategic coaching insights based on this data. Use the quotes as evidence in your insights.`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const content = message.content[0]
  if (content.type === 'text') {
    const jsonStr = extractJSON(content.text)
    const parsed = JSON.parse(jsonStr)
    const insights: CoachingInsight[] = Array.isArray(parsed) ? parsed : parsed.insights || []
    return insights
  }

  return []
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}
