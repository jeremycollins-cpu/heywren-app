import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'
import { runBatch, extractToolResult, type BatchRequest } from './batch-api'

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

const SYSTEM_PROMPT = `Write a follow-up message for an overdue commitment. The message should sound like it was written by the sender — match their communication style.

Rules:
- Subject: under 60 chars, specific to the commitment (not generic "Following up")
- Body: under 150 words
- Reference the specific commitment naturally, not vaguely
- Match the tone of the original conversation (formal→formal, casual→casual)
- If the original was casual ("hey, can you..."), keep it casual
- If the original was formal ("Per our discussion..."), stay professional
- Use the sender's first name in the sign-off if provided
- Acknowledge elapsed time gently if significant (>3 days)
- If there's an original quote, reference the specific topic — don't just say "checking in"
- For inbound commitments (someone promised something to the sender): politely check on progress
- For outbound commitments (sender promised something): provide an update or ask what's needed to close it
- No passive-aggression, no excessive exclamation marks, no "just wanted to bump this"
- If urgency is high/critical, convey appropriate importance without being aggressive`

export async function generateFollowUpDraft(commitment: {
  title: string
  description?: string
  source?: string
  created_at: string
  recipient_name?: string
  sender_name?: string
  original_quote?: string
  tone?: string
  urgency?: string
  direction?: string
  commitment_type?: string
  stakeholders?: Array<{ name: string; role?: string }>
}): Promise<{ subject: string; body: string }> {
  const days = daysSince(commitment.created_at)
  const recipientName = commitment.recipient_name || 'there'

  const lines: string[] = [
    `Commitment: ${commitment.title}`,
  ]
  if (commitment.description) lines.push(`Details: ${commitment.description}`)
  if (commitment.original_quote) lines.push(`Original message: "${commitment.original_quote}"`)
  lines.push(`Days since commitment: ${days}`)
  lines.push(`Recipient: ${recipientName}`)
  if (commitment.sender_name) lines.push(`Sender (you are writing as): ${commitment.sender_name}`)
  if (commitment.direction) lines.push(`Direction: ${commitment.direction === 'inbound' ? 'They committed to you' : 'You committed to them'}`)
  if (commitment.tone) lines.push(`Original tone: ${commitment.tone}`)
  if (commitment.urgency) lines.push(`Urgency: ${commitment.urgency}`)
  if (commitment.commitment_type) lines.push(`Type: ${commitment.commitment_type}`)
  if (commitment.source) lines.push(`Source: ${commitment.source}`)
  if (commitment.stakeholders && commitment.stakeholders.length > 0) {
    lines.push(`Other stakeholders: ${commitment.stakeholders.map(s => s.name).join(', ')}`)
  }

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
    tools: [SINGLE_DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'generate_draft' },
    messages: [
      {
        role: 'user',
        content: lines.join('\n'),
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

// ============================================================
// Batch API variant — 50% cheaper, for non-latency-sensitive paths
// Sends each commitment group as a separate request in a single
// Anthropic Batch, processed asynchronously.
// ============================================================

/**
 * Generate follow-up drafts for all commitments using the Anthropic
 * Message Batches API (50% cost reduction). Each chunk of up to
 * `chunkSize` commitments becomes one batch sub-request.
 *
 * Use this from cron/background jobs (e.g. Inngest daily draft generation).
 * Falls back to the synchronous path on batch API failure.
 */
export async function generateFollowUpDraftsViaBatch(
  commitments: Array<{
    id: string
    title: string
    description?: string
    source?: string
    created_at: string
    recipient_name?: string
  }>,
  chunkSize: number = 10
): Promise<Map<string, { subject: string; body: string }>> {
  const results = new Map<string, { subject: string; body: string }>()
  if (commitments.length === 0) return results

  // Build batch requests — one per chunk
  const batchRequests: BatchRequest[] = []
  const chunkMap: Array<typeof commitments> = [] // index aligns with batchRequests

  for (let i = 0; i < commitments.length; i += chunkSize) {
    const chunk = commitments.slice(i, i + chunkSize)
    chunkMap.push(chunk)

    if (chunk.length === 1) {
      const c = chunk[0]
      const days = daysSince(c.created_at)
      batchRequests.push({
        custom_id: `draft-${i}`,
        params: {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] as any,
          tools: [SINGLE_DRAFT_TOOL as any],
          tool_choice: { type: 'tool', name: 'generate_draft' },
          messages: [{
            role: 'user',
            content: `Title: ${c.title}\n${c.description ? 'Details: ' + c.description + '\n' : ''}Made: ${days} day(s) ago\nRecipient: ${c.recipient_name || 'there'}${c.source ? '\nSource: ' + c.source : ''}`.trim(),
          }],
        },
      })
    } else {
      const numbered = chunk
        .map((c, j) => {
          const days = daysSince(c.created_at)
          const lines = [
            `[${j + 1}] Title: ${c.title}`,
            c.description ? `    Details: ${c.description}` : '',
            `    Made: ${days} day(s) ago`,
            `    Recipient: ${c.recipient_name || 'there'}`,
            c.source ? `    Source: ${c.source}` : '',
          ]
          return lines.filter(Boolean).join('\n')
        })
        .join('\n\n')

      batchRequests.push({
        custom_id: `draft-${i}`,
        params: {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: [{ type: 'text', text: SYSTEM_PROMPT + '\n\nYou will receive multiple commitments numbered [1], [2], etc. Generate a draft for each.', cache_control: { type: 'ephemeral' } }] as any,
          tools: [BATCH_DRAFT_TOOL as any],
          tool_choice: { type: 'tool', name: 'generate_batch_drafts' },
          messages: [{
            role: 'user',
            content: `Write follow-up messages for these ${chunk.length} commitments:\n\n${numbered}`,
          }],
        },
      })
    }
  }

  try {
    const batchResults = await runBatch(batchRequests)

    batchRequests.forEach((req, idx) => {
      const item = batchResults.get(req.custom_id)
      const chunk = chunkMap[idx]

      if (chunk.length === 1) {
        const draft = extractToolResult<{ subject: string; body: string }>(item)
        if (draft) {
          results.set(chunk[0].id, {
            subject: draft.subject || 'Following up',
            body: draft.body || '',
          })
        }
      } else {
        const parsed = extractToolResult<{ results: Record<string, { subject: string; body: string }> }>(item)
        if (parsed?.results) {
          chunk.forEach((c, j) => {
            const draft = parsed.results[String(j + 1)]
            if (draft) {
              results.set(c.id, {
                subject: draft.subject || 'Following up',
                body: draft.body || '',
              })
            }
          })
        }
      }
    })

    console.log(`[batch-api] Generated ${results.size}/${commitments.length} drafts via Batch API`)
  } catch (error) {
    console.error('[batch-api] Batch draft generation failed, falling back to sync:', (error as Error).message)
    // Fallback to synchronous batch processing
    return generateFollowUpDraftsBatch(commitments)
  }

  return results
}
