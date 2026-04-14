import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

function daysSince(dateStr: string): number {
  const created = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
}

// ============================================================
// Tool definitions for structured output
// ============================================================

const SINGLE_DRAFT_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_draft',
  description: 'Generate a follow-up email draft for an overdue commitment.',
  input_schema: {
    type: 'object' as const,
    properties: {
      subject: {
        type: 'string',
        description: 'Email subject line, under 60 characters',
      },
      body: {
        type: 'string',
        description: 'Follow-up message body, under 150 words. Friendly, not robotic.',
      },
    },
    required: ['subject', 'body'],
  },
}

const BATCH_DRAFT_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_batch_drafts',
  description: 'Generate follow-up drafts for multiple commitments.',
  input_schema: {
    type: 'object' as const,
    properties: {
      results: {
        type: 'object',
        description: 'Map of commitment number (string) to draft',
        additionalProperties: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['subject', 'body'],
        },
      },
    },
    required: ['results'],
  },
}

const SYSTEM_PROMPT = `Write short, professional but casual follow-up messages for overdue commitments. Sound like a real person, not a bot.

Rules:
- Subject: under 60 chars
- Body: under 150 words
- Reference the commitment naturally
- Acknowledge elapsed time gently if significant
- No passive-aggression, no excessive exclamation marks
- Sign off casually (e.g. "Thanks," or "Cheers,"), no sender name`

export async function generateFollowUpDraft(commitment: {
  title: string
  description?: string
  source?: string
  created_at: string
  recipient_name?: string
}): Promise<{ subject: string; body: string }> {
  const days = daysSince(commitment.created_at)
  const recipientName = commitment.recipient_name || 'there'
  const sourceContext = commitment.source
    ? `Source: ${commitment.source}`
    : ''

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
    tools: [SINGLE_DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'generate_draft' },
    messages: [
      {
        role: 'user',
        content: `Title: ${commitment.title}\n${commitment.description ? 'Details: ' + commitment.description + '\n' : ''}Made: ${days} day(s) ago\nRecipient: ${recipientName}\n${sourceContext}`.trim(),
      },
    ],
  })

  recordTokenUsage(message.usage)

  const toolBlock = message.content.find((b) => b.type === 'tool_use')
  if (toolBlock && toolBlock.type === 'tool_use') {
    const result = toolBlock.input as { subject: string; body: string }
    return {
      subject: result.subject || 'Following up',
      body: result.body || '',
    }
  }

  return { subject: 'Following up', body: '' }
}

export async function generateFollowUpDraftsBatch(
  commitments: Array<{
    id: string
    title: string
    description?: string
    source?: string
    created_at: string
    recipient_name?: string
  }>
): Promise<Map<string, { subject: string; body: string }>> {
  const results = new Map<string, { subject: string; body: string }>()

  if (commitments.length === 0) return results

  // Single commitment: use the single function
  if (commitments.length === 1) {
    const c = commitments[0]
    try {
      const draft = await generateFollowUpDraft(c)
      results.set(c.id, draft)
    } catch (error) {
      console.error('Failed to generate draft for commitment ' + c.id + ':', (error as Error).message)
    }
    return results
  }

  // Batch: single prompt with tool_use
  const numbered = commitments
    .map((c, i) => {
      const days = daysSince(c.created_at)
      const lines = [
        `[${i + 1}] Title: ${c.title}`,
        c.description ? `    Details: ${c.description}` : '',
        `    Made: ${days} day(s) ago`,
        `    Recipient: ${c.recipient_name || 'there'}`,
        c.source ? `    Source: ${c.source}` : '',
      ]
      return lines.filter(Boolean).join('\n')
    })
    .join('\n\n')

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT + '\n\nYou will receive multiple commitments numbered [1], [2], etc. Generate a draft for each.', cache_control: { type: 'ephemeral' } } as any],
      tools: [BATCH_DRAFT_TOOL],
      tool_choice: { type: 'tool', name: 'generate_batch_drafts' },
      messages: [
        {
          role: 'user',
          content: `Write follow-up messages for these ${commitments.length} commitments:\n\n${numbered}`,
        },
      ],
    })

    recordTokenUsage(message.usage)

    const toolBlock = message.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const batchResults = (toolBlock.input as { results: Record<string, { subject: string; body: string }> }).results || {}

      commitments.forEach((c, i) => {
        const key = String(i + 1)
        const draft = batchResults[key]
        if (draft) {
          results.set(c.id, {
            subject: draft.subject || 'Following up',
            body: draft.body || '',
          })
        }
      })
    }
  } catch (error) {
    console.error('Batch draft generation failed:', (error as Error).message)
    // Fallback: try individually
    for (const c of commitments) {
      try {
        const draft = await generateFollowUpDraft(c)
        results.set(c.id, draft)
      } catch (err) {
        console.error('Failed to generate draft for commitment ' + c.id + ':', (err as Error).message)
      }
    }
  }

  return results
}
