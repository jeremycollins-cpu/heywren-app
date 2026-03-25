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
  /** Character index in the transcript where the trigger was found */
  position: number
  /** The matched trigger phrase */
  matchedPhrase: string
  /** The context surrounding the trigger (up to ~500 chars after) */
  surroundingContext: string
  /** Speaker name if available from transcript segments */
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
  triggeredBy: string // The "Hey Wren" phrase that triggered it
}

// Patterns to match "Hey Wren" and phonetic variants
// Transcription services may render this differently
const HEY_WREN_PATTERNS = [
  /hey\s+wren/gi,
  /hey,?\s+wren/gi,
  /hey\s+ren\b/gi,
  /hey,?\s+ren\b/gi,
  /a\s+wren\b/gi,        // Common mishearing
  /hay\s+wren/gi,        // Phonetic variant
  /hey\s+ren\b/gi,
  /heywren/gi,
]

/**
 * Find all "Hey Wren" triggers in a transcript.
 * Returns the trigger locations and surrounding context.
 */
export function findHeyWrenTriggers(
  transcriptText: string,
  segments?: Array<{ speaker?: string; text: string; start_s?: number; end_s?: number }>
): HeyWrenTrigger[] {
  const triggers: HeyWrenTrigger[] = []
  const seen = new Set<number>() // Deduplicate overlapping matches

  for (const pattern of HEY_WREN_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = pattern.exec(transcriptText)) !== null) {
      const position = match.index

      // Skip if we already found a trigger within 20 chars of this position
      let isDuplicate = false
      for (const seenPos of seen) {
        if (Math.abs(seenPos - position) < 20) {
          isDuplicate = true
          break
        }
      }
      if (isDuplicate) continue

      seen.add(position)

      // Extract context: the trigger phrase + up to 500 chars after
      const contextStart = Math.max(0, position - 50) // A bit before for context
      const contextEnd = Math.min(transcriptText.length, position + match[0].length + 500)
      const surroundingContext = transcriptText.slice(contextStart, contextEnd).trim()

      // Try to identify the speaker from segments
      let speaker: string | undefined
      if (segments) {
        // Find the segment that contains this position
        let charCount = 0
        for (const seg of segments) {
          const segEnd = charCount + seg.text.length
          if (position >= charCount && position < segEnd) {
            speaker = seg.speaker
            break
          }
          charCount = segEnd + 1 // +1 for space between segments
        }
      }

      triggers.push({
        position,
        matchedPhrase: match[0],
        surroundingContext,
        speaker,
      })
    }
  }

  // Sort by position
  return triggers.sort((a, b) => a.position - b.position)
}

/**
 * Extract commitments from "Hey Wren" triggered contexts.
 * Each trigger context is sent to the LLM for commitment extraction.
 * Uses Haiku for speed since the context is small and intent is explicit.
 */
export async function extractHeyWrenCommitments(
  triggers: HeyWrenTrigger[]
): Promise<HeyWrenCommitment[]> {
  if (triggers.length === 0) return []

  const commitments: HeyWrenCommitment[] = []

  // Process all triggers in a single batch call
  const numberedContexts = triggers
    .map((t, i) => `[${i + 1}] ${t.speaker ? `(${t.speaker}): ` : ''}${t.surroundingContext}`)
    .join('\n\n')

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: `You extract commitments, action items, and reminders from meeting transcript excerpts where someone said "Hey Wren" to explicitly flag something important.

The user said "Hey Wren" to intentionally mark a commitment, reminder, or action item. Treat these as HIGH confidence since they were explicitly flagged.

Return ONLY valid JSON (no markdown, no code fences):
{
  "results": {
    "1": {"title": "specific action item", "description": "full context", "assignee": "person name or null", "dueDate": "ISO date or null", "priority": "high|medium|low", "confidence": 0.9, "originalQuote": "exact words after Hey Wren, max 200 chars"},
    "2": {...}
  }
}

Guidelines:
- These are EXPLICIT triggers — the person intentionally said "Hey Wren" to mark this. Default confidence should be 0.85+.
- Extract the commitment/reminder/action from what comes AFTER "Hey Wren".
- If someone says "Hey Wren, remind me to send the report by Friday", title = "Send the report", dueDate = next Friday.
- If someone says "Hey Wren, [name] committed to X", the assignee is [name].
- If the context after "Hey Wren" is unclear or just noise, return an empty object for that number.`,
      messages: [
        {
          role: 'user',
          content: `Extract commitments from these "Hey Wren" triggers in a meeting transcript:\n\n${numberedContexts}`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type === 'text') {
      // Extract JSON from potential code fences
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
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
    }
  } catch (error) {
    console.error('Hey Wren commitment extraction failed:', (error as Error).message)
  }

  return commitments
}
