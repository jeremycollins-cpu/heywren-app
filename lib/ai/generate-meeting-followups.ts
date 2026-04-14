import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'
import { runBatch, extractToolResult, type BatchRequest } from './batch-api'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ── Tool definition ─────────────────────────────────────────────────────

const MEETING_FOLLOWUP_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_meeting_followups',
  description: 'Generate follow-up email drafts after a meeting, one per commitment/action item.',
  input_schema: {
    type: 'object' as const,
    properties: {
      drafts: {
        type: 'array',
        description: 'One follow-up draft per commitment extracted from the meeting',
        items: {
          type: 'object',
          properties: {
            commitment_index: {
              type: 'number',
              description: 'Index of the commitment this draft is for (0-based)',
            },
            subject: {
              type: 'string',
              description: 'Email subject line, under 60 characters',
            },
            body: {
              type: 'string',
              description: 'Follow-up message body, under 200 words',
            },
            suggested_recipient: {
              type: 'string',
              description: 'Name of the person this should be sent to (from stakeholders/assignee)',
            },
          },
          required: ['commitment_index', 'subject', 'body'],
        },
      },
    },
    required: ['drafts'],
  },
}

const SYSTEM_PROMPT = `You generate concise follow-up emails after meetings. Each email confirms a specific action item or commitment that was discussed.

Rules:
- Subject: under 60 chars, reference the meeting naturally (e.g. "Following up from our sync")
- Body: under 200 words
- Open by referencing the meeting briefly (e.g. "After our call earlier..." or "Per our discussion...")
- State the specific commitment/action item clearly
- If there's a due date, mention it
- If there's an assignee/owner, address them by name
- Tone: professional but warm — like a thoughtful colleague, not a bot
- Close with an offer to help or a clear next step
- Sign off casually (e.g. "Best," or "Thanks,"), no sender name
- Do NOT combine multiple action items into one email — one draft per commitment`

export interface MeetingCommitment {
  title: string
  description?: string | null
  dueDate?: string | null
  assignee?: string | null
  urgency?: string
  commitmentType?: string
  originalQuote?: string
  stakeholders?: Array<{ name: string; role: string }>
}

export interface MeetingFollowUpDraft {
  commitmentIndex: number
  subject: string
  body: string
  suggestedRecipient?: string
}

export async function generateMeetingFollowUpDrafts(
  meetingTitle: string,
  commitments: MeetingCommitment[]
): Promise<MeetingFollowUpDraft[]> {
  if (commitments.length === 0) return []

  // Build the commitment list for the prompt
  const commitmentList = commitments
    .map((c, i) => {
      const lines = [
        `[${i + 1}] ${c.title}`,
        c.description ? `    Details: ${c.description}` : '',
        c.assignee ? `    Owner: ${c.assignee}` : '',
        c.dueDate ? `    Due: ${c.dueDate}` : '',
        c.urgency ? `    Urgency: ${c.urgency}` : '',
        c.originalQuote ? `    Context: "${c.originalQuote}"` : '',
        c.stakeholders?.length
          ? `    Stakeholders: ${c.stakeholders.map(s => `${s.name} (${s.role})`).join(', ')}`
          : '',
      ]
      return lines.filter(Boolean).join('\n')
    })
    .join('\n\n')

  const userMessage = `Meeting: "${meetingTitle}"

Action items and commitments from this meeting:

${commitmentList}

Generate a follow-up email draft for each action item. Each email should be self-contained and sent to the relevant person.`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
      tools: [MEETING_FOLLOWUP_TOOL],
      tool_choice: { type: 'tool', name: 'generate_meeting_followups' },
      messages: [{ role: 'user', content: userMessage }],
    })

    recordTokenUsage(message.usage)

    const toolBlock = message.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const result = toolBlock.input as { drafts: Array<{
        commitment_index: number
        subject: string
        body: string
        suggested_recipient?: string
      }> }

      return (result.drafts || []).map(d => ({
        commitmentIndex: d.commitment_index,
        subject: d.subject || 'Following up from our meeting',
        body: d.body || '',
        suggestedRecipient: d.suggested_recipient,
      }))
    }
  } catch (error) {
    console.error('[generate-meeting-followups] AI call failed:', (error as Error).message)
  }

  return []
}

/**
 * Generate meeting follow-up drafts via the Anthropic Batch API (50% cheaper).
 * Falls back to the synchronous path on failure.
 */
export async function generateMeetingFollowUpDraftsViaBatch(
  meetingTitle: string,
  commitments: MeetingCommitment[]
): Promise<MeetingFollowUpDraft[]> {
  if (commitments.length === 0) return []

  const commitmentList = commitments
    .map((c, i) => {
      const lines = [
        `[${i + 1}] ${c.title}`,
        c.description ? `    Details: ${c.description}` : '',
        c.assignee ? `    Owner: ${c.assignee}` : '',
        c.dueDate ? `    Due: ${c.dueDate}` : '',
        c.urgency ? `    Urgency: ${c.urgency}` : '',
        c.originalQuote ? `    Context: "${c.originalQuote}"` : '',
        c.stakeholders?.length
          ? `    Stakeholders: ${c.stakeholders.map(s => `${s.name} (${s.role})`).join(', ')}`
          : '',
      ]
      return lines.filter(Boolean).join('\n')
    })
    .join('\n\n')

  const userMessage = `Meeting: "${meetingTitle}"\n\nAction items and commitments from this meeting:\n\n${commitmentList}\n\nGenerate a follow-up email draft for each action item. Each email should be self-contained and sent to the relevant person.`

  try {
    const request: BatchRequest = {
      custom_id: 'meeting-followups',
      params: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] as any,
        tools: [MEETING_FOLLOWUP_TOOL as any],
        tool_choice: { type: 'tool', name: 'generate_meeting_followups' },
        messages: [{ role: 'user', content: userMessage }],
      },
    }

    const results = await runBatch([request])
    const item = results.get('meeting-followups')
    const parsed = extractToolResult<{ drafts: Array<{
      commitment_index: number
      subject: string
      body: string
      suggested_recipient?: string
    }> }>(item)

    if (parsed?.drafts) {
      return parsed.drafts.map(d => ({
        commitmentIndex: d.commitment_index,
        subject: d.subject || 'Following up from our meeting',
        body: d.body || '',
        suggestedRecipient: d.suggested_recipient,
      }))
    }
  } catch (error) {
    console.error('[generate-meeting-followups] Batch API failed, falling back to sync:', (error as Error).message)
    return generateMeetingFollowUpDrafts(meetingTitle, commitments)
  }

  return []
}
