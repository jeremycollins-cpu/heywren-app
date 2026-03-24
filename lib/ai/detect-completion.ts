// lib/ai/detect-completion.ts
// Lightweight AI classifier: checks if a message indicates a prior commitment was fulfilled.
// Uses the same tiered approach as detect-commitments.ts:
//   Tier 1 (free regex) -> Tier 2 (Haiku ~$0.0003)

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface CompletionMatch {
  commitmentId: string
  confidence: number
  evidence: string // The phrase/quote that suggests completion
}

// ============================================================
// TIER 1: Free regex pre-filter
// Checks for completion signal words before making any API call
// ============================================================

const COMPLETION_PATTERNS = [
  // Past-tense completion verbs
  /\b(done|completed|finished|shipped|sent|submitted|resolved|fixed|merged|deployed|updated|shared|posted|filed|scheduled|booked)\b/i,

  // Delivery language
  /\bhere you go\b/i,
  /\bas discussed\b/i,
  /\bper your request\b/i,
  /\bas promised\b/i,
  /\bfollowing up with\b/i,

  // Attachment / link signals
  /\b(attached|see attached|link below)\b/i,
  /\bhere'?s the\b/i,

  // Other completion indicators
  /\bjust (sent|pushed|merged|deployed|submitted|posted|shared|finished|completed)\b/i,
  /\bwent ahead and\b/i,
  /\btook care of\b/i,
  /\ball set\b/i,
  /\bwrapped up\b/i,
  /\bchecked off\b/i,
  /\bclosed out\b/i,
  /\bgo(od)? to go\b/i,
]

/**
 * Tier 1: Check if a message likely indicates something was completed.
 * Free — no API call.
 */
function likelyContainsCompletion(text: string): boolean {
  if (text.length < 10) return false

  const lower = text.toLowerCase()
  // Skip common non-completion noise
  if (
    lower === 'thanks' ||
    lower === 'thank you' ||
    lower === 'ok' ||
    lower === 'okay' ||
    lower === 'sounds good' ||
    lower === 'got it' ||
    lower === 'lgtm' ||
    lower.startsWith('has joined the channel') ||
    lower.startsWith('set the channel')
  ) {
    return false
  }

  return COMPLETION_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Extract JSON from a string that might be wrapped in markdown code fences.
 */
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

// ============================================================
// TIER 2: Haiku completion matching (~$0.0003)
// Given the message + open commitments, determines which ones
// appear to have been fulfilled.
// ============================================================

async function haiku_match(
  message: { text: string; author: string; source: 'slack' | 'email'; threadContext?: string },
  openCommitments: Array<{ id: string; title: string; description: string }>
): Promise<CompletionMatch[]> {
  const commitmentsListText = openCommitments
    .map((c, i) => `[${i + 1}] id="${c.id}" title="${c.title}" description="${c.description}"`)
    .join('\n')

  const contextBlock = message.threadContext
    ? `\n\nThread context:\n${message.threadContext}`
    : ''

  const prompt = `Message from ${message.author} (via ${message.source}):
"${message.text}"${contextBlock}

Open commitments:
${commitmentsListText}

Does this message indicate that any of these commitments have been completed or fulfilled? Consider the message content, the author, and whether the action described matches a commitment.

Return ONLY valid JSON (no markdown, no code fences):
{
  "matches": [
    {
      "commitmentId": "the exact id string from the commitment",
      "confidence": 0.0-1.0,
      "evidence": "the exact phrase from the message that suggests completion (max 150 chars)"
    }
  ]
}

Guidelines:
- Only match if the message genuinely indicates the commitment's task was done, not just discussed.
- confidence 0.9-1.0: explicit confirmation ("I sent the report", "deployed the fix")
- confidence 0.7-0.89: strong implication ("here's the updated deck", "PR merged")
- confidence 0.5-0.69: possible but ambiguous ("took care of it", "all set")
- Below 0.5: don't include.
- If no matches: {"matches": []}
- evidence must be a direct quote from the message.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'You determine whether a message indicates that previously tracked commitments have been completed. Be precise — only match when there is real evidence of completion. Return only valid JSON.',
      messages: [{ role: 'user', content: prompt }],
    })

    const content = response.content[0]
    if (content.type === 'text') {
      const jsonStr = extractJSON(content.text)
      const parsed = JSON.parse(jsonStr)
      const matches: CompletionMatch[] = parsed.matches || []
      // Filter out any below 0.5 threshold (safety net)
      return matches.filter((m) => m.confidence >= 0.5)
    }
  } catch (error) {
    console.error('Haiku completion matching failed:', (error as Error).message)
    return []
  }

  return []
}

// ============================================================
// MAIN EXPORT: 2-tier completion detection pipeline
// Tier 1 (free regex) -> Tier 2 (Haiku ~$0.0003)
// ============================================================

export async function detectCompletions(
  message: { text: string; author: string; authorEmail?: string; source: 'slack' | 'email'; threadContext?: string },
  openCommitments: Array<{ id: string; title: string; description: string; assigneeEmail?: string }>
): Promise<CompletionMatch[]> {
  // TIER 1: Free keyword pre-filter
  if (!likelyContainsCompletion(message.text)) {
    return []
  }

  // No open commitments to match against
  if (openCommitments.length === 0) {
    return []
  }

  try {
    // TIER 2: Haiku completion matching ($0.0003)
    const matches = await haiku_match(message, openCommitments)

    if (matches.length > 0) {
      console.log(
        `Completion detection: found ${matches.length} match(es) in: "${message.text.substring(0, 60)}..."`
      )
    }

    return matches
  } catch (error) {
    console.error('Completion detection failed:', (error as Error).message)
    return []
  }
}
