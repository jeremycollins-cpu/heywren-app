// lib/ai/detect-completion.ts
// Lightweight AI classifier: checks if a message indicates a prior commitment was fulfilled.
// Uses the same tiered approach as detect-commitments.ts:
//   Tier 1 (free regex) -> Tier 2 (Haiku via tool_use for structured output)

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface CompletionMatch {
  commitmentId: string
  confidence: number
  evidence: string
}

// ============================================================
// TIER 1: Free regex pre-filter
// ============================================================

const COMPLETION_PATTERNS = [
  /\b(done|completed|finished|shipped|sent|submitted|resolved|fixed|merged|deployed|updated|shared|posted|filed|scheduled|booked)\b/i,
  /\bhere you go\b/i,
  /\bas discussed\b/i,
  /\bper your request\b/i,
  /\bas promised\b/i,
  /\bfollowing up with\b/i,
  /\b(attached|see attached|link below)\b/i,
  /\bhere'?s the\b/i,
  /\bjust (sent|pushed|merged|deployed|submitted|posted|shared|finished|completed)\b/i,
  /\bwent ahead and\b/i,
  /\btook care of\b/i,
  /\ball set\b/i,
  /\bwrapped up\b/i,
  /\bchecked off\b/i,
  /\bclosed out\b/i,
  /\bgo(od)? to go\b/i,
]

const NOISE_PHRASES = new Set([
  'thanks', 'thank you', 'ok', 'okay',
  'sounds good', 'got it', 'lgtm',
])

function likelyContainsCompletion(text: string): boolean {
  if (text.length < 10) return false

  const lower = text.toLowerCase()
  if (
    NOISE_PHRASES.has(lower) ||
    lower.startsWith('has joined the channel') ||
    lower.startsWith('set the channel')
  ) {
    return false
  }

  return COMPLETION_PATTERNS.some((pattern) => pattern.test(text))
}

// ============================================================
// Tool definition for structured completion matching
// ============================================================

const COMPLETION_MATCH_TOOL: Anthropic.Messages.Tool = {
  name: 'report_completion_matches',
  description: 'Report which commitments appear to have been completed based on the message.',
  input_schema: {
    type: 'object' as const,
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            commitmentId: {
              type: 'string',
              description: 'The exact id string from the commitment',
            },
            confidence: {
              type: 'number',
              description: '0.9-1.0: explicit confirmation. 0.7-0.89: strong implication. 0.5-0.69: ambiguous. Below 0.5: do not include.',
            },
            evidence: {
              type: 'string',
              description: 'Direct quote from the message suggesting completion, max 150 chars',
            },
          },
          required: ['commitmentId', 'confidence', 'evidence'],
        },
      },
    },
    required: ['matches'],
  },
}

// ============================================================
// TIER 2: Haiku completion matching via tool_use (~$0.0003)
// Guaranteed structured JSON output
// ============================================================

async function haiku_match(
  message: { text: string; author: string; source: 'slack' | 'email'; threadContext?: string },
  openCommitments: Array<{ id: string; title: string; description: string }>
): Promise<CompletionMatch[]> {
  const commitmentsListText = openCommitments
    .map((c, i) => `[${i + 1}] id="${c.id}" title="${c.title}" desc="${c.description}"`)
    .join('\n')

  const contextBlock = message.threadContext
    ? `\n\nThread context:\n${message.threadContext}`
    : ''

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: [{ type: 'text', text: `Match messages to completed commitments. Only match when there is real evidence the task was done, not just discussed. Evidence must be a direct quote from the message.`, cache_control: { type: 'ephemeral' } }],
      tools: [COMPLETION_MATCH_TOOL],
      tool_choice: { type: 'tool', name: 'report_completion_matches' },
      messages: [{
        role: 'user',
        content: `Message from ${message.author} (${message.source}):\n"${message.text}"${contextBlock}\n\nOpen commitments:\n${commitmentsListText}`,
      }],
    })

    const toolBlock = response.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const result = toolBlock.input as { matches: CompletionMatch[] }
      // Filter below 0.5 threshold (safety net)
      return (result.matches || []).filter((m) => m.confidence >= 0.5)
    }
  } catch (error) {
    console.error('Haiku completion matching failed:', (error as Error).message)
    return []
  }

  return []
}

// ============================================================
// MAIN EXPORT: 2-tier completion detection pipeline
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
    // TIER 2: Haiku completion matching via tool_use ($0.0003)
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
