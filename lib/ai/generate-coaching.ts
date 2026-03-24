import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface CoachingInsight {
  id: string
  category: 'responsiveness' | 'tone' | 'follow_through' | 'relationship' | 'workload' | 'communication_style'
  priority: 'critical' | 'high' | 'medium' | 'growth'
  title: string
  description: string
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

  const systemPrompt = `You are an expert executive communication coach with deep knowledge of organizational psychology, communication science, and leadership research. Your role is to analyze a professional's communication patterns and provide highly personalized, research-backed coaching insights.

You are NOT a generic productivity app. You provide the kind of nuanced, specific coaching that a $500/hour executive coach would give — but grounded in data.

CRITICAL INSTRUCTIONS:
1. Be SPECIFIC. Reference actual numbers, names, and patterns from the data. Never say "some items" when you can say "3 open commitments with Sarah Chen."
2. Tailor to role. A CEO needs coaching on delegation and executive presence. An IC needs coaching on visibility and stakeholder management. A manager needs coaching on team dynamics and follow-through.
3. Reference research. Cite specific findings (e.g., "Harvard Business Review research shows managers who respond within 4 hours build 2x the trust with reports" or "McKinsey found that clear follow-through on commitments increases team velocity by 25%").
4. Consider workload context. If someone has 40+ open commitments, coach on delegation and prioritization, NOT on "doing more." If someone has very few, coach on expanding their tracking.
5. Identify patterns, not just problems. Look for trends across sources, stakeholders, and time periods.
6. Include GROWTH insights when things are going well. Not every insight should be a problem. Celebrate wins and suggest stretch goals.
7. Be direct and actionable. Each action should be something they can do TODAY or THIS WEEK.

Generate exactly 3-5 insights. Each insight must be a JSON object with:
- id: a unique kebab-case string
- category: one of "responsiveness", "tone", "follow_through", "relationship", "workload", "communication_style"
- priority: one of "critical", "high", "medium", "growth"
- title: concise, specific title (not generic)
- description: 2-3 sentences that reference specific data points. Be conversational but professional.
- action: one specific, actionable recommendation they can implement immediately
- metric: (optional) { "label": string, "value": string, "trend": "up" | "down" | "stable" }
- researchBasis: (optional) a brief citation or reference to communication research or best practice

Priority guidelines:
- critical: Patterns that are actively damaging trust or relationships (e.g., consistently missing follow-ups with key stakeholders, response times >48hrs on urgent items)
- high: Significant improvement opportunities (e.g., low completion rate, imbalanced source coverage)
- medium: Worth addressing but not urgent (e.g., tone patterns, volume management)
- growth: Things going well that can be stretched further, or new habits to build

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

Generate 3-5 personalized coaching insights based on this data.`

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
