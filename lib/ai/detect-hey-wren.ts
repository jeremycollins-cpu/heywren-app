// lib/ai/detect-hey-wren.ts
// Detects "Hey Wren" wake word triggers in meeting transcripts.
// Uses fuzzy matching on transcript text to find explicit commitment requests.
// When someone says "Hey Wren, remind me to..." or "Hey Wren, I need to...",
// we extract the surrounding context and treat it as a high-confidence commitment.

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface HeyWrenTrigger {
  position: number
  matchedPhrase: string
  surroundingContext: string
  speaker?: string
}

export interface HeyWrenCommitment {
  title: string
  description: string
  assignee?: string
  dueDate?: string
  priority: 'high' | 'medium' | 'low'
  confidence: number
  originalQuote: string
  triggeredBy: string
}

// Patterns to match "Hey Wren" and phonetic variants
const HEY_WREN_PATTERNS = [
  /hey\s+wren/gi,
  /hey,?\s+wren/gi,
  /hey\s+ren\b/gi,
  /hey,?\s+ren\b/gi,
  /a\s+wren\b/gi,
  /hay\s+wren/gi,
  /heywren/gi,
]

/**
 * Find all "Hey Wren" triggers in a transcript.
 */
export function findHeyWrenTriggers(
  transcriptText: string,
  segments?: Array<{ speaker?: string; text: string; start_s?: number; end_s?: number }>
): HeyWrenTrigger[] {
  const triggers: HeyWrenTrigger[] = []
  const seen = new Set<number>()

  for (const pattern of HEY_WREN_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(transcriptText)) !== null) {
      const position = match.index

      // Deduplicate overlapping matches
      let isDuplicate = false
      for (const seenPos of seen) {
        if (Math.abs(seenPos - position) < 20) {
          isDuplicate = true
          break
        }
      }
      if (isDuplicate) continue

      seen.add(position)

      const contextStart = Math.max(0, position - 50)
      const contextEnd = Math.min(transcriptText.length, position + match[0].length + 500)
      const surroundingContext = transcriptText.slice(contextStart, contextEnd).trim()

      // Identify speaker from segments
      let speaker: string | undefined
      if (segments) {
        let charCount = 0
        for (const seg of segments) {
          const segEnd = charCount + seg.text.length
          if (position >= charCount && position < segEnd) {
            speaker = seg.speaker
            break
          }
          charCount = segEnd + 1
        }
      }

      triggers.push({ position, matchedPhrase: match[0], surroundingContext, speaker })
    }
  }

  return triggers.sort((a, b) => a.position - b.position)
}

// ============================================================
// Tool definition for structured output
// ============================================================

const HEY_WREN_EXTRACTION_TOOL: Anthropic.Messages.Tool = {
  name: 'extract_hey_wren_commitments',
  description: 'Extract commitments from Hey Wren trigger contexts.',
  input_schema: {
    type: 'object' as const,
    properties: {
      results: {
        type: 'object',
        description: 'Map of trigger number (string) to extracted commitment, or empty object if unclear',
        additionalProperties: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Specific action item' },
            description: { type: 'string', description: 'Full context' },
            assignee: { type: 'string', description: 'Person name or null' },
            dueDate: { type: 'string', description: 'ISO date or null' },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            confidence: { type: 'number', description: 'Default 0.85+ for explicit triggers' },
            originalQuote: { type: 'string', description: 'Exact words after Hey Wren, max 200 chars' },
          },
          required: ['title', 'description', 'priority', 'confidence', 'originalQuote'],
        },
      },
    },
    required: ['results'],
  },
}

/**
 * Extract commitments from "Hey Wren" triggered contexts using tool_use.
 */
export async function extractHeyWrenCommitments(
  triggers: HeyWrenTrigger[]
): Promise<HeyWrenCommitment[]> {
  if (triggers.length === 0) return []

  const commitments: HeyWrenCommitment[] = []

  const numberedContexts = triggers
    .map((t, i) => `[${i + 1}] ${t.speaker ? `(${t.speaker}): ` : ''}${t.surroundingContext}`)
    .join('\n\n')

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: [{ type: 'text', text: `Extract commitments from "Hey Wren" meeting transcript triggers. These are EXPLICIT -- the speaker intentionally flagged them. Default confidence 0.85+.

- Extract the action from what comes AFTER "Hey Wren".
- "Hey Wren, remind me to send the report by Friday" -> title: "Send the report", dueDate: next Friday.
- "Hey Wren, [name] committed to X" -> assignee: [name].
- If context after "Hey Wren" is unclear/noise, omit that number from results.`, cache_control: { type: 'ephemeral' } }],
      tools: [HEY_WREN_EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_hey_wren_commitments' },
      messages: [
        {
          role: 'user',
          content: `Extract commitments from these "Hey Wren" triggers:\n\n${numberedContexts}`,
        },
      ],
    })

    const toolBlock = message.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const parsed = toolBlock.input as { results: Record<string, any> }
      const results = parsed.results || {}

      for (let i = 0; i < triggers.length; i++) {
        const key = String(i + 1)
        const result = results[key]
        if (result && result.title) {
          commitments.push({
            title: result.title,
            description: result.description || '',
            assignee: result.assignee || undefined,
            dueDate: result.dueDate || undefined,
            priority: result.priority || 'high',
            confidence: result.confidence || 0.9,
            originalQuote: result.originalQuote || triggers[i].surroundingContext.slice(0, 200),
            triggeredBy: triggers[i].matchedPhrase,
          })
        }
      }
    }
  } catch (error) {
    console.error('Hey Wren commitment extraction failed:', (error as Error).message)
  }

  return commitments
}
