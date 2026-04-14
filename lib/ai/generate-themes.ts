import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface SourceEvidence {
  type: 'email' | 'meeting' | 'chat' | 'commitment'
  title: string
  date: string
  participant: string
  relevance: string
}

export interface WorkTheme {
  title: string
  summary: string
  impact: string
  sources: { emails: number; meetings: number; chats: number; commitments: number }
  sentiment: 'momentum' | 'steady' | 'needs_attention'
  keyPeople: string[]
  highlights: string[]
  sourceEvidence: SourceEvidence[]
}

export interface ThemesResult {
  themes: WorkTheme[]
  headline: string
  periodLabel: string
  generatedAt: string
}

interface DataSummary {
  commitments: Array<{
    title: string
    status: string
    source: string | null
    created_at: string
    metadata?: any
  }>
  recentEmails: Array<{
    subject: string
    from_name: string
    to_recipients: string
    received_at: string
  }>
  calendarEvents: Array<{
    subject: string
    organizer_email: string
    start_time: string
    attendees_count: number
  }>
  slackMessages: Array<{
    channel_name: string
    message_preview: string
    created_at: string
  }>
  userName: string
}

const themesTool = {
  name: 'generate_themes' as const,
  description: 'Generate executive summary themes from work activity data',
  input_schema: {
    type: 'object' as const,
    properties: {
      headline: {
        type: 'string' as const,
        description: 'A punchy 5-10 word headline summarizing the recent work activity. Should feel like a newsletter subject line. Example: "Closing deals and building momentum across 3 accounts"',
      },
      themes: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            title: {
              type: 'string' as const,
              description: 'Short theme title, 3-6 words. Action-oriented. Example: "Enterprise Pipeline Acceleration"',
            },
            summary: {
              type: 'string' as const,
              description: '2-3 sentences describing what happened in this theme area. Use specific names, numbers, and outcomes. Written in second person ("You...").',
            },
            impact: {
              type: 'string' as const,
              description: 'One sentence describing the business impact or why this matters. Be specific.',
            },
            sentiment: {
              type: 'string' as const,
              enum: ['momentum', 'steady', 'needs_attention'],
              description: 'momentum = strong progress, steady = on track, needs_attention = potential risk',
            },
            keyPeople: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'Names of key people involved in this theme (max 4)',
            },
            highlights: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: '2-3 specific accomplishments or actions as bullet points. Start each with a past-tense verb.',
            },
            sourceBreakdown: {
              type: 'object' as const,
              properties: {
                emails: { type: 'number' as const },
                meetings: { type: 'number' as const },
                chats: { type: 'number' as const },
                commitments: { type: 'number' as const },
              },
              required: ['emails', 'meetings', 'chats', 'commitments'],
            },
            sourceEvidence: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  type: {
                    type: 'string' as const,
                    enum: ['email', 'meeting', 'chat', 'commitment'],
                    description: 'The type of data source',
                  },
                  title: {
                    type: 'string' as const,
                    description: 'The email subject, meeting name, chat message preview, or commitment title that was used',
                  },
                  date: {
                    type: 'string' as const,
                    description: 'The date of this data point (ISO 8601 or human-readable)',
                  },
                  participant: {
                    type: 'string' as const,
                    description: 'The key person involved (sender, organizer, or assignee)',
                  },
                  relevance: {
                    type: 'string' as const,
                    description: 'A brief explanation of how this data point contributed to the theme (1 sentence)',
                  },
                },
                required: ['type', 'title', 'date', 'participant', 'relevance'],
              },
              description: 'The specific data points (emails, meetings, chats, commitments) that informed this theme. Include ALL items that contributed — this is shown to users for transparency.',
            },
          },
          required: ['title', 'summary', 'impact', 'sentiment', 'keyPeople', 'highlights', 'sourceBreakdown'],
        },
        description: 'Array of 3-5 work themes, ordered by importance/impact',
      },
    },
    required: ['headline', 'themes'],
  },
}

export async function generateThemes(data: DataSummary): Promise<ThemesResult> {
  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
  const periodLabel = `${thirtyDaysAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  // Build context from data — keep slices tight to control token cost
  const commitmentSummary = data.commitments.slice(0, 60).map(c =>
    `- [${c.status}] ${c.title} (${c.source || 'unknown'}, ${new Date(c.created_at).toLocaleDateString()})`
  ).join('\n')

  const emailSummary = data.recentEmails.slice(0, 50).map(e =>
    `- "${e.subject}" from ${e.from_name} (${new Date(e.received_at).toLocaleDateString()})`
  ).join('\n')

  const calendarSummary = data.calendarEvents.slice(0, 40).map(e =>
    `- "${e.subject}" organized by ${e.organizer_email} with ${e.attendees_count} attendees (${new Date(e.start_time).toLocaleDateString()})`
  ).join('\n')

  const slackSummary = data.slackMessages.slice(0, 40).map(m =>
    `- #${m.channel_name}: "${m.message_preview}" (${new Date(m.created_at).toLocaleDateString()})`
  ).join('\n')

  const systemPrompt = `You are an executive briefing analyst for ${data.userName}. Your job is to analyze their work activity across email, calendar, Slack, and tracked commitments over the last 30 days to identify the major THEMES of their work.

Think of yourself as a chief of staff preparing a rolling executive summary. The output should:
- Make the person feel accomplished and in control
- Be specific with names, numbers, and outcomes (never vague)
- Group related activities into coherent narratives
- Highlight progress, wins, and momentum
- Be honest about areas needing attention but frame constructively
- Be something they'd proudly screenshot to their boss

Rules:
- Generate 3-5 themes maximum
- Look across the full 30-day window to identify patterns — don't just focus on the most recent days
- Each theme should span multiple data sources when possible
- Use the person's actual contacts, meeting names, and project names
- Never fabricate data — only reference what's in the provided activity
- Write in second person ("You drove..." not "The user drove...")
- Highlights should start with past-tense action verbs (Delivered, Closed, Aligned, Escalated, etc.)
- If data is sparse, produce fewer themes rather than weak ones
- For sourceEvidence: list EVERY specific email, meeting, chat, or commitment that informed the theme. Users see this for transparency, so be thorough and accurate. Only reference items from the provided data — never invent evidence.`

  const userMessage = `Analyze ${data.userName}'s work activity for the period ${periodLabel} and identify the major themes.

## Tracked Commitments (${data.commitments.length} total)
${commitmentSummary || 'No commitments tracked yet.'}

## Recent Emails (${data.recentEmails.length} total)
${emailSummary || 'No recent emails.'}

## Calendar Events (${data.calendarEvents.length} total)
${calendarSummary || 'No calendar events.'}

## Slack Activity (${data.slackMessages.length} messages)
${slackSummary || 'No Slack messages.'}

Generate the executive theme summary.`

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } } as any],
    tools: [themesTool],
    tool_choice: { type: 'tool', name: 'generate_themes' },
    messages: [{ role: 'user', content: userMessage }],
  })

  recordTokenUsage(response.usage)

  // Extract tool use result
  const toolBlock = response.content.find(b => b.type === 'tool_use')
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('No themes generated')
  }

  const result = toolBlock.input as { headline: string; themes: any[] }

  return {
    headline: result.headline,
    themes: result.themes.map(t => ({
      title: t.title,
      summary: t.summary,
      impact: t.impact,
      sources: t.sourceBreakdown || { emails: 0, meetings: 0, chats: 0, commitments: 0 },
      sentiment: t.sentiment,
      keyPeople: t.keyPeople || [],
      highlights: t.highlights || [],
      sourceEvidence: (t.sourceEvidence || []).map((e: any) => ({
        type: e.type,
        title: e.title,
        date: e.date,
        participant: e.participant,
        relevance: e.relevance,
      })),
    })),
    periodLabel,
    generatedAt: now.toISOString(),
  }
}
