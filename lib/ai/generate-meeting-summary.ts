// lib/ai/generate-meeting-summary.ts
// Generates a structured meeting summary from a transcript using Claude Haiku.
// Produces: summary, key topics, decisions, open questions, participant highlights.
// Cost: ~$0.012 per 30-min meeting transcript.

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// ── Tool definition ─────────────────────────────────────────────────────

const MEETING_SUMMARY_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_meeting_summary',
  description: 'Generate a structured summary of a meeting transcript.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description: 'A concise 3-5 sentence summary of what happened in the meeting.',
      },
      key_topics: {
        type: 'array',
        description: 'The main topics discussed, in order of discussion.',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic name or title' },
            detail: { type: 'string', description: '1-2 sentence summary of what was discussed' },
          },
          required: ['topic', 'detail'],
        },
      },
      decisions_made: {
        type: 'array',
        description: 'Specific decisions that were agreed upon during the meeting.',
        items: {
          type: 'object',
          properties: {
            decision: { type: 'string', description: 'What was decided' },
            context: { type: 'string', description: 'Brief context or reasoning' },
            owner: { type: 'string', description: 'Who owns this decision (if mentioned)' },
          },
          required: ['decision'],
        },
      },
      open_questions: {
        type: 'array',
        description: 'Unresolved questions or topics that need follow-up.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The unresolved question or issue' },
            context: { type: 'string', description: 'Why this matters or who raised it' },
          },
          required: ['question'],
        },
      },
      participant_highlights: {
        type: 'array',
        description: 'Notable contributions from specific participants.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Participant name' },
            contribution: { type: 'string', description: 'What they contributed or committed to' },
          },
          required: ['name', 'contribution'],
        },
      },
      meeting_sentiment: {
        type: 'string',
        enum: ['positive', 'neutral', 'tense', 'mixed'],
        description: 'Overall tone/sentiment of the meeting.',
      },
    },
    required: ['summary', 'key_topics', 'decisions_made', 'open_questions', 'participant_highlights', 'meeting_sentiment'],
  },
}

const SYSTEM_PROMPT = `You analyze meeting transcripts and generate structured summaries. Be thorough but concise.

Rules:
- Summary: 3-5 sentences capturing the meeting's purpose, key outcomes, and next steps
- Key topics: List every distinct topic discussed, in order. Include enough detail to jog memory
- Decisions: Only include explicit agreements, not suggestions or hypotheticals
- Open questions: Capture anything left unresolved that someone will need to follow up on
- Participant highlights: Focus on commitments, key insights, or ownership — not small talk
- If the transcript is short or informal, adapt — fewer sections is fine
- Do NOT invent information not present in the transcript
- Attribute statements to specific speakers when possible`

export interface MeetingSummary {
  summary: string
  keyTopics: Array<{ topic: string; detail: string }>
  decisionsMade: Array<{ decision: string; context?: string; owner?: string }>
  openQuestions: Array<{ question: string; context?: string }>
  participantHighlights: Array<{ name: string; contribution: string }>
  meetingSentiment: 'positive' | 'neutral' | 'tense' | 'mixed'
}

export async function generateMeetingSummary(
  meetingTitle: string,
  transcriptText: string,
  attendees?: string[]
): Promise<MeetingSummary | null> {
  if (!transcriptText || transcriptText.trim().length < 100) {
    return null
  }

  // Truncate very long transcripts to ~12,000 words (~16K tokens) to keep costs low
  const words = transcriptText.split(/\s+/)
  const truncated = words.length > 12000 ? words.slice(0, 12000).join(' ') + '\n\n[Transcript truncated]' : transcriptText

  const attendeeInfo = attendees?.length
    ? `\nAttendees: ${attendees.join(', ')}`
    : ''

  const userMessage = `Meeting: "${meetingTitle}"${attendeeInfo}

Transcript:
${truncated}`

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
      tools: [MEETING_SUMMARY_TOOL],
      tool_choice: { type: 'tool', name: 'generate_meeting_summary' },
      messages: [{ role: 'user', content: userMessage }],
    })

    recordTokenUsage(message.usage)

    const toolBlock = message.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const result = toolBlock.input as {
        summary: string
        key_topics: Array<{ topic: string; detail: string }>
        decisions_made: Array<{ decision: string; context?: string; owner?: string }>
        open_questions: Array<{ question: string; context?: string }>
        participant_highlights: Array<{ name: string; contribution: string }>
        meeting_sentiment: string
      }

      return {
        summary: result.summary || '',
        keyTopics: result.key_topics || [],
        decisionsMade: result.decisions_made || [],
        openQuestions: result.open_questions || [],
        participantHighlights: result.participant_highlights || [],
        meetingSentiment: (result.meeting_sentiment as MeetingSummary['meetingSentiment']) || 'neutral',
      }
    }
  } catch (error) {
    console.error('[generate-meeting-summary] AI call failed:', (error as Error).message)
  }

  return null
}
