// lib/ai/refine-briefing-section.ts
// Powers the "chat-to-refine" pane on a monthly briefing. The user types a
// natural-language instruction (e.g. "make Risks more candid", "drop the
// pipeline bullet, add one about UK attainment") and the AI returns either
// an updated section, a new section, or a chat-only reply.

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'
import type {
  AggregatedDataSnapshot,
  BriefingBullet,
  BriefingMessage,
  BriefingSection,
  SynthesizedSection,
} from '../monthly-briefing/types'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const REFINE_TOOL: Anthropic.Messages.Tool = {
  name: 'respond_to_user',
  description: 'Respond to the user, optionally producing an updated or new section.',
  input_schema: {
    type: 'object' as const,
    properties: {
      reply: {
        type: 'string',
        description: '1-3 sentence response to the user explaining what you did or asking a clarifying question.',
      },
      action: {
        type: 'string',
        enum: ['none', 'update_section', 'add_section', 'delete_section'],
        description: "What to do alongside the reply. Use 'none' for chat-only responses.",
      },
      section: {
        type: 'object',
        description: 'Required when action is update_section or add_section. The full new section payload.',
        properties: {
          section_type: { type: 'string' },
          title: { type: 'string' },
          summary: { type: 'string' },
          bullets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                heading: { type: 'string' },
                detail: { type: 'string' },
                severity: { type: 'string', enum: ['info', 'positive', 'watch', 'critical'] },
                evidence: { type: 'string' },
                source: { type: 'string' },
              },
              required: ['heading', 'detail'],
            },
          },
        },
        required: ['section_type', 'title', 'summary', 'bullets'],
      },
      target_section_id: {
        type: 'string',
        description: 'Required when action is update_section or delete_section — the id of the section being modified.',
      },
    },
    required: ['reply', 'action'],
  },
}

const SYSTEM_PROMPT = `You are HeyWren acting as a personal business consultant inside the user's monthly briefing.

The user is iterating on their briefing. Each turn they may ask you to:
- rewrite a section in a different tone or angle
- add a new section
- drop a section
- explain or defend a particular bullet
- suggest what to add or what's missing

Be direct and useful. When the user asks for an edit, JUST DO IT — don't ask permission. When the user asks a question, answer it without modifying anything.

Hard rules:
- Never invent numbers, names, or quotes that aren't in the supplied context.
- When you update a section, return the FULL new section (not a diff).
- When the user's request is ambiguous, make a sensible default and explain what you did in one sentence.
- Keep the same severity/source attribution discipline as the original briefing.`

interface RefineParams {
  snapshot: AggregatedDataSnapshot
  sections: BriefingSection[]
  history: BriefingMessage[]
  userMessage: string
  targetSection?: BriefingSection | null
}

export interface RefineResult {
  reply: string
  action: 'none' | 'update_section' | 'add_section' | 'delete_section'
  section?: SynthesizedSection
  targetSectionId?: string
}

export async function refineBriefingSection(params: RefineParams): Promise<RefineResult | null> {
  const { snapshot, sections, history, userMessage, targetSection } = params

  const userContent = buildUserContent({ snapshot, sections, history, userMessage, targetSection })

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
      tools: [REFINE_TOOL],
      tool_choice: { type: 'tool', name: 'respond_to_user' },
      messages: [{ role: 'user', content: userContent }],
    })

    recordTokenUsage(response.usage)

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') return null

    const result = toolBlock.input as {
      reply: string
      action: RefineResult['action']
      section?: { section_type: string; title: string; summary: string; bullets: BriefingBullet[] }
      target_section_id?: string
    }

    return {
      reply: result.reply || '',
      action: result.action || 'none',
      section: result.section
        ? {
            section_type: result.section.section_type,
            title: result.section.title,
            summary: result.section.summary,
            bullets: Array.isArray(result.section.bullets) ? result.section.bullets : [],
          }
        : undefined,
      targetSectionId: result.target_section_id,
    }
  } catch (err) {
    console.error('[refine-briefing-section] AI call failed:', (err as Error).message)
    return null
  }
}

function buildUserContent(params: RefineParams): string {
  const { snapshot, sections, history, userMessage, targetSection } = params
  const lines: string[] = []
  lines.push(`# Monthly briefing — ${snapshot.period.label}`)
  lines.push('')
  lines.push('## Current sections')
  for (const s of sections) {
    lines.push(`### [${s.id}] ${s.title} (${s.section_type})`)
    if (s.summary) lines.push(s.summary)
    for (const b of s.bullets || []) {
      const sev = b.severity ? `[${b.severity}] ` : ''
      lines.push(`- ${sev}${b.heading}: ${b.detail}${b.evidence ? ` (${b.evidence})` : ''}`)
    }
    lines.push('')
  }

  if (targetSection) {
    lines.push(`## Focus`)
    lines.push(`The user is looking at section "${targetSection.title}" (id=${targetSection.id}). Default to updating that one.`)
    lines.push('')
  }

  lines.push('## Underlying data snapshot (compressed)')
  lines.push('```json')
  lines.push(JSON.stringify(compressSnapshot(snapshot), null, 2))
  lines.push('```')
  lines.push('')

  if (history.length) {
    lines.push('## Recent chat history')
    for (const m of history.slice(-8)) {
      lines.push(`${m.role === 'user' ? 'User' : 'Wren'}: ${m.content}`)
    }
    lines.push('')
  }

  lines.push('## Latest user message')
  lines.push(userMessage)
  lines.push('')
  lines.push('Respond using the respond_to_user tool.')

  return lines.join('\n')
}

/** Trim the snapshot to the fields useful for refinement chat. */
function compressSnapshot(s: AggregatedDataSnapshot): unknown {
  return {
    period: s.period,
    user: s.user,
    commitments: {
      created: s.commitments.total_created,
      completed: s.commitments.total_completed,
      overdue: s.commitments.total_overdue,
      completion_rate_pct: s.commitments.completion_rate_pct,
      top: s.commitments.top_by_priority.slice(0, 5),
    },
    calendar: {
      meetings: s.calendar.total_meetings,
      hours: s.calendar.total_meeting_hours,
      themes: s.calendar.recurring_themes.slice(0, 6),
      top_attendees: s.calendar.top_attendees.slice(0, 6),
    },
    emails: s.emails,
    chats: s.chats,
    uploaded_context: s.uploaded_context.map(u => ({ file: u.file_name, kind: u.file_kind, summary: u.summary.slice(0, 600) })),
    user_notes: s.user_notes,
  }
}
