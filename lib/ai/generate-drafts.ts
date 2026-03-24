import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    return jsonMatch[0]
  }
  return text.trim()
}

function daysSince(dateStr: string): number {
  const created = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
}

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
    ? `This commitment was tracked from ${commitment.source}.`
    : ''

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: `You write short, professional but casual follow-up messages for commitments that haven't been completed yet. The tone should sound like a real person checking in — friendly, not robotic or pushy.

Return ONLY valid JSON (no markdown, no code fences):
{
  "subject": "short email subject line",
  "body": "the follow-up message body"
}

Guidelines:
- Keep the subject line under 60 characters
- Keep the body under 150 words
- Reference the specific commitment naturally
- If it's been a while since the commitment was made, acknowledge the time gently
- Don't be passive-aggressive
- Don't use exclamation marks excessively
- Sign off casually (e.g., "Thanks," or "Cheers,") but do NOT include a sender name`,
    messages: [
      {
        role: 'user',
        content: `Write a follow-up message for this commitment:

Title: ${commitment.title}
${commitment.description ? 'Details: ' + commitment.description : ''}
Made: ${days} day(s) ago
Recipient first name: ${recipientName}
${sourceContext}`,
      },
    ],
  })

  const content = message.content[0]
  if (content.type === 'text') {
    const jsonStr = extractJSON(content.text)
    const parsed = JSON.parse(jsonStr)
    return {
      subject: parsed.subject || 'Following up',
      body: parsed.body || '',
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

  // For a single commitment, use the single function
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

  // Batch: send all commitments in one prompt
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
      system: `You write short, professional but casual follow-up messages for commitments that haven't been completed yet. The tone should sound like a real person checking in — friendly, not robotic or pushy.

You will receive multiple commitments numbered [1], [2], etc.

Return ONLY valid JSON (no markdown, no code fences):
{
  "results": {
    "1": { "subject": "short subject line", "body": "follow-up message" },
    "2": { "subject": "...", "body": "..." }
  }
}

Guidelines:
- Keep each subject line under 60 characters
- Keep each body under 150 words
- Reference the specific commitment naturally
- If it's been a while since the commitment was made, acknowledge the time gently
- Don't be passive-aggressive
- Don't use exclamation marks excessively
- Sign off casually (e.g., "Thanks," or "Cheers,") but do NOT include a sender name`,
      messages: [
        {
          role: 'user',
          content: `Write follow-up messages for these ${commitments.length} commitments:\n\n${numbered}`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type === 'text') {
      const jsonStr = extractJSON(content.text)
      const parsed = JSON.parse(jsonStr)
      const batchResults = parsed.results || {}

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
