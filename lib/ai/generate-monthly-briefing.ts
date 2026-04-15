// lib/ai/generate-monthly-briefing.ts
// The "reduce" half of the monthly-briefing pipeline.
//
// Takes a fully-aggregated data snapshot (signals from emails, chats,
// calendar, meetings, commitments + summarised uploaded context) and
// produces the structured CEO-style briefing: title, subtitle, and a
// list of sections (Highlights, Risks, Priorities, Projects, ...).
//
// Strategy:
//   • Single Claude call with tool-use to enforce schema.
//   • System prompt is cached (ephemeral) so iterative regenerations are cheap.
//   • Bullets carry optional severity + evidence so the UI can render them
//     with color coding and source attribution.

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'
import type {
  AggregatedDataSnapshot,
  SynthesizedBriefing,
  SynthesizedSection,
} from '../monthly-briefing/types'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const BRIEFING_TOOL: Anthropic.Messages.Tool = {
  name: 'compose_monthly_briefing',
  description: "Compose the user's monthly executive briefing.",
  input_schema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Briefing title, e.g. "March 2026 Briefing" or "March 2026 — Stabilizing the Foundation".',
      },
      subtitle: {
        type: 'string',
        description: 'A one-sentence headline that captures the dominant theme of the month. Concrete, not generic.',
      },
      sections: {
        type: 'array',
        description: 'The structured sections that make up the briefing. Always include at least: highlights, risks, priorities. Add additional sections (projects, lowlights, custom) when the data warrants it.',
        items: {
          type: 'object',
          properties: {
            section_type: {
              type: 'string',
              enum: ['highlights', 'risks', 'priorities', 'projects', 'context', 'lowlights', 'custom'],
              description: 'Canonical section type.',
            },
            title: {
              type: 'string',
              description: 'Display title, e.g. "Highlights", "Risks", "UK Attainment". For section_type=custom this MUST be specific (not "Other").',
            },
            summary: {
              type: 'string',
              description: '1-3 sentence overview of the section. Specific and concrete.',
            },
            bullets: {
              type: 'array',
              description: '3-7 bullet points. Each bullet is a single insight, risk, or priority.',
              items: {
                type: 'object',
                properties: {
                  heading: { type: 'string', description: 'Short bolded label, 2-6 words.' },
                  detail: { type: 'string', description: '1-2 sentence elaboration grounded in the evidence.' },
                  severity: {
                    type: 'string',
                    enum: ['info', 'positive', 'watch', 'critical'],
                    description: 'Severity for color coding. Use sparingly — most bullets should be info or positive.',
                  },
                  evidence: {
                    type: 'string',
                    description: "Optional concrete proof — a metric, quote, or source name. Don't invent numbers.",
                  },
                  source: {
                    type: 'string',
                    description: "Optional source tag, e.g. 'upload:Q1_deck.pdf', 'meeting:Board prep', 'email:Acme renewal'.",
                  },
                },
                required: ['heading', 'detail'],
              },
            },
          },
          required: ['section_type', 'title', 'summary', 'bullets'],
        },
      },
    },
    required: ['title', 'subtitle', 'sections'],
  },
}

const SYSTEM_PROMPT = `You are HeyWren acting as a personal business consultant. You produce the user's monthly briefing — the single document they will use to think clearly about their month and present "state of the business" to others.

Tone: confident, specific, and candid. Write the way an experienced operator would brief a CEO — opinions are welcome when grounded in the data. Avoid corporate filler and generic platitudes.

Section guidance:
- Highlights: real wins. Lead with the strongest. Include numbers when present.
- Risks: name the risk, the consequence if unaddressed, and (if visible in the data) the trigger to watch.
- Priorities: forward-looking — what the user should be focused on next month, ranked.
- Projects: only if the data clearly identifies discrete projects/initiatives.
- Lowlights: optional. Use only when there are clear setbacks worth surfacing.
- Custom sections: introduce one when a theme deserves its own block (e.g. "UK Attainment", "AI Productivity") — name it specifically, not "Other".

Hard rules:
- Ground every bullet in the supplied data. Do NOT invent numbers, projects, names, or quotes.
- If the data is thin in some area, say so explicitly rather than padding.
- Prefer named entities (people, customers, products) over abstractions.
- When uploaded context conflicts with the activity signals, trust the uploaded context (it's user-curated) and call out the divergence.
- Quote uploaded materials directly when they capture stance or tone.
- The user's job title and company shape what "highlights" mean — calibrate accordingly.`

export interface SynthesisOptions {
  /** When the user is iterating on a single section, restrict the AI to that section. */
  focusSection?: { type: string; title: string; instruction: string }
}

/**
 * Synthesize a complete monthly briefing from the aggregated data snapshot.
 * Returns null on failure; caller should mark the briefing as failed.
 */
export async function generateMonthlyBriefing(
  snapshot: AggregatedDataSnapshot,
  options: SynthesisOptions = {},
): Promise<SynthesizedBriefing | null> {
  const userMessage = buildUserMessage(snapshot, options)

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
      tools: [BRIEFING_TOOL],
      tool_choice: { type: 'tool', name: 'compose_monthly_briefing' },
      messages: [{ role: 'user', content: userMessage }],
    })

    recordTokenUsage(response.usage)

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') return null

    const result = toolBlock.input as {
      title: string
      subtitle: string
      sections: SynthesizedSection[]
    }

    return {
      title: result.title || `${snapshot.period.label} Briefing`,
      subtitle: result.subtitle || '',
      sections: (result.sections || []).map(s => ({
        section_type: s.section_type || 'custom',
        title: s.title || 'Section',
        summary: s.summary || '',
        bullets: Array.isArray(s.bullets) ? s.bullets : [],
      })),
    }
  } catch (err) {
    console.error('[generate-monthly-briefing] AI call failed:', (err as Error).message)
    return null
  }
}

function buildUserMessage(snapshot: AggregatedDataSnapshot, options: SynthesisOptions): string {
  const parts: string[] = []
  parts.push(`# Monthly Briefing — ${snapshot.period.label}`)
  parts.push('')
  parts.push(`User: ${snapshot.user.display_name || snapshot.user.email}${snapshot.user.job_title ? ` (${snapshot.user.job_title}` : ''}${snapshot.user.company ? `, ${snapshot.user.company})` : snapshot.user.job_title ? ')' : ''}`)
  parts.push(`Period: ${snapshot.period.start} → ${snapshot.period.end}`)
  parts.push('')

  parts.push('## Commitments signal')
  parts.push(`- Created: ${snapshot.commitments.total_created}`)
  parts.push(`- Completed: ${snapshot.commitments.total_completed} (${snapshot.commitments.completion_rate_pct}% completion rate)`)
  parts.push(`- Overdue: ${snapshot.commitments.total_overdue}`)
  if (snapshot.commitments.top_by_priority.length) {
    parts.push('Top by priority:')
    for (const c of snapshot.commitments.top_by_priority) {
      parts.push(`  • [${c.status}] ${c.title} (${c.source}, due ${c.due_date || 'none'})`)
    }
  }
  if (snapshot.commitments.overdue_samples.length) {
    parts.push('Overdue samples:')
    for (const o of snapshot.commitments.overdue_samples) {
      parts.push(`  • ${o.title} — ${o.days_overdue}d overdue`)
    }
  }

  parts.push('')
  parts.push('## Calendar signal')
  parts.push(`- Meetings: ${snapshot.calendar.total_meetings} (${snapshot.calendar.total_meeting_hours}h total)`)
  if (snapshot.calendar.top_attendees.length) {
    parts.push(`- Top recurring attendees: ${snapshot.calendar.top_attendees.map(a => `${a.name} (${a.meetings})`).join(', ')}`)
  }
  if (snapshot.calendar.recurring_themes.length) {
    parts.push(`- Recurring meeting themes: ${snapshot.calendar.recurring_themes.join(', ')}`)
  }

  if (snapshot.meetings_with_transcripts.length) {
    parts.push('')
    parts.push('## Meeting summaries (AI-generated)')
    for (const m of snapshot.meetings_with_transcripts) {
      parts.push(`### ${m.title}${m.start_time ? ` — ${m.start_time.slice(0, 10)}` : ''}`)
      if (m.summary) parts.push(m.summary)
      if (m.decisions.length) parts.push(`Decisions: ${m.decisions.join('; ')}`)
      if (m.open_questions.length) parts.push(`Open questions: ${m.open_questions.join('; ')}`)
      parts.push(`Sentiment: ${m.sentiment}`)
    }
  }

  parts.push('')
  parts.push('## Email signal')
  parts.push(`- Missed emails: ${snapshot.emails.missed_total} (${snapshot.emails.missed_urgent} urgent)`)
  parts.push(`- Awaiting replies: ${snapshot.emails.awaiting_replies_total}`)
  if (Object.keys(snapshot.emails.categories).length) {
    parts.push(`- Categories: ${Object.entries(snapshot.emails.categories).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  }
  if (snapshot.emails.top_correspondents.length) {
    parts.push(`- Top correspondents: ${snapshot.emails.top_correspondents.map(c => `${c.name} (${c.count})`).join(', ')}`)
  }

  parts.push('')
  parts.push('## Chat signal')
  parts.push(`- Missed chats: ${snapshot.chats.missed_total} (${snapshot.chats.missed_urgent} urgent)`)
  if (snapshot.chats.channels_active.length) {
    parts.push(`- Active channels: ${snapshot.chats.channels_active.join(', ')}`)
  }

  if (snapshot.uploaded_context.length) {
    parts.push('')
    parts.push('## User-uploaded context (HIGH-FIDELITY)')
    parts.push("These are documents the user uploaded — treat them as authoritative.")
    for (const c of snapshot.uploaded_context) {
      parts.push(`### ${c.file_name} (${c.file_kind})`)
      parts.push(c.summary)
    }
  }

  if (snapshot.user_notes) {
    parts.push('')
    parts.push('## User notes')
    parts.push(snapshot.user_notes)
  }

  parts.push('')
  if (options.focusSection) {
    parts.push(`## Task`)
    parts.push(`Regenerate ONLY the "${options.focusSection.title}" (${options.focusSection.type}) section, applying this user instruction:`)
    parts.push(`> ${options.focusSection.instruction}`)
    parts.push('')
    parts.push('Return the full briefing structure but only the focused section needs to change; preserve the rest as best you can — only that section will be saved.')
  } else {
    parts.push('## Task')
    parts.push('Compose the full monthly briefing now using the compose_monthly_briefing tool.')
  }

  return parts.join('\n')
}
