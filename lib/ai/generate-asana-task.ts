// lib/ai/generate-asana-task.ts
// Claude-powered helper: turn a HeyWren commitment into a clean Asana task
// (concise actionable name + structured notes + suggested due date).

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const ASANA_TASK_TOOL: Anthropic.Messages.Tool = {
  name: 'compose_asana_task',
  description:
    'Compose an actionable Asana task from a HeyWren commitment. Optimize for clarity in a task list.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description:
          'Task name. Imperative voice ("Reply to X about Y", "Send the proposal"), under 90 characters, no trailing punctuation.',
      },
      notes: {
        type: 'string',
        description:
          'Task notes (plain text). Include: (1) one-sentence what + why, (2) the original quote/context if helpful, (3) a HeyWren back-reference URL on the last line. Under 800 characters.',
      },
      suggested_due_on: {
        type: 'string',
        description:
          'YYYY-MM-DD date suggestion based on urgency and any due_date hint. Empty string if no clear suggestion.',
      },
    },
    required: ['name', 'notes', 'suggested_due_on'],
  },
}

const SYSTEM_PROMPT = `You convert tracked work commitments into Asana tasks.

Rules:
- Task name: imperative voice, action-first, under 90 chars. Example: "Send Q4 forecast to Priya" not "Q4 forecast (sent by Priya in Slack)".
- Task notes: plain text, no markdown headers. Two short paragraphs max. Always end with the back-reference URL on its own line if provided.
- Suggested due date: YYYY-MM-DD. If urgency=critical → tomorrow. If high → 2 days. If medium → 5 days. If low or unspecified → 7 days. If a real due_date exists, use it directly.
- Never invent facts not present in the commitment.
- Never include sensitive data verbatim (emails, phone numbers, secrets) in the task name — only in notes if already in the commitment description.`

export interface CommitmentForAsana {
  title: string
  description?: string
  source?: string
  due_date?: string
  original_quote?: string
  urgency?: string
  commitment_type?: string
  stakeholders?: Array<{ name: string; role?: string }>
  back_reference_url?: string
}

export interface AsanaTaskDraft {
  name: string
  notes: string
  suggested_due_on: string  // empty string if none
}

export async function composeAsanaTask(c: CommitmentForAsana): Promise<AsanaTaskDraft> {
  const today = new Date().toISOString().slice(0, 10)
  const lines: string[] = [
    `Today: ${today}`,
    `Commitment title: ${c.title}`,
  ]
  if (c.description) lines.push(`Description: ${c.description}`)
  if (c.original_quote) lines.push(`Original message: "${c.original_quote}"`)
  if (c.due_date) lines.push(`Existing due date: ${c.due_date}`)
  if (c.urgency) lines.push(`Urgency: ${c.urgency}`)
  if (c.commitment_type) lines.push(`Type: ${c.commitment_type}`)
  if (c.source) lines.push(`Source: ${c.source}`)
  if (c.stakeholders?.length) {
    lines.push(`Stakeholders: ${c.stakeholders.map((s) => s.name).join(', ')}`)
  }
  if (c.back_reference_url) lines.push(`HeyWren URL: ${c.back_reference_url}`)

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any,
    ],
    tools: [ASANA_TASK_TOOL],
    tool_choice: { type: 'tool', name: 'compose_asana_task' },
    messages: [{ role: 'user', content: lines.join('\n') }],
  })

  recordTokenUsage(message.usage)

  const toolUse = message.content.find((b: any) => b.type === 'tool_use') as
    | { input: AsanaTaskDraft }
    | undefined

  if (!toolUse?.input?.name) {
    // Fallback: minimal deterministic compose.
    return {
      name: c.title.slice(0, 90),
      notes: [c.description, c.original_quote, c.back_reference_url].filter(Boolean).join('\n\n'),
      suggested_due_on: c.due_date?.slice(0, 10) || '',
    }
  }

  return {
    name: toolUse.input.name.slice(0, 90),
    notes: toolUse.input.notes.slice(0, 1500),
    suggested_due_on: toolUse.input.suggested_due_on || '',
  }
}
