import Anthropic from '@anthropic-ai/sdk'
import { getActiveCommunityPatterns } from './validate-community-signal'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface DetectedCommitment {
  title: string
  description: string
  assignee?: string
  dueDate?: string
  priority: 'high' | 'medium' | 'low'
  confidence: number
  urgency?: 'low' | 'medium' | 'high' | 'critical'
  tone?: 'casual' | 'professional' | 'urgent' | 'demanding'
  commitmentType?: 'deliverable' | 'meeting' | 'follow_up' | 'decision' | 'review' | 'request'
  stakeholders?: Array<{ name: string; role: 'owner' | 'assignee' | 'stakeholder' }>
  originalQuote?: string
  channelOrThread?: string
}

// ============================================================
// TIER 1: Free keyword pre-filter
// Eliminates ~70-80% of messages before any API call
// ============================================================
const COMMITMENT_PATTERNS = [
  /\bi('ll|'ll| will)\b/i,
  /\bwe('ll|'ll| will)\b/i,
  /\bi('m going to|'m going to)\b/i,
  /\blet me\b/i,
  /\bpromise\b/i,
  /\bcommit\b/i,
  /\bguarantee\b/i,
  /\bcan you\b/i,
  /\bcould you\b/i,
  /\bwould you\b/i,
  /\bplease\s+(send|review|update|check|fix|look|get|do|prepare|share|create|write|schedule|set up|follow)/i,
  /\bneed to\b/i,
  /\bneed you to\b/i,
  /\bshould\b/i,
  /\bmust\b/i,
  /\baction item/i,
  /\btodo\b/i,
  /\bto-do\b/i,
  /\btask\b/i,
  /\bassign/i,
  /\bby (friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|tonight|end of|eod|eow|cob)\b/i,
  /\bdeadline\b/i,
  /\bdue (date|by|on)\b/i,
  /\basap\b/i,
  /\burgent/i,
  /\bpriority\b/i,
  /\bfollow[- ]?up\b/i,
  /\bcircle back\b/i,
  /\bget back to\b/i,
  /\bloop back\b/i,
  /\brevisit\b/i,
  /\bremind(er)?\b/i,
  /\bping me\b/i,
  /\bschedule\b/i,
  /\bset up a (call|meeting|sync)\b/i,
  /\bmeeting on\b/i,
  /\bmeeting (this|next)\b/i,
  /\bsend (it|this|that|you|over)\b/i,
  /\bshare (it|this|that|with)\b/i,
  /\bdeliver/i,
  /\bsubmit/i,
  /\bpush (it|this|the)\b/i,
  /\bupdate (the|this|you|on)\b/i,
  /\bwill (have|get|send|do|finish|complete|review|check|look)\b/i,
  /\bworking on\b/i,
  /\bon (my|it|this|the) radar\b/i,
  /\bnotes for\b/i,
  /\bagenda\b/i,
  /\baction (plan|required|needed)\b/i,
  /\bnext steps\b/i,
]

// Common non-commitment phrases (fast reject)
const NOISE_PHRASES = new Set([
  'thanks', 'thank you', 'sounds good', 'got it',
  'ok', 'okay', 'lgtm', 'approved',
])

/**
 * Tier 1: Check if a message likely contains a commitment
 * using fast regex patterns. This is free (no API call).
 */
function likelyContainsCommitment(text: string): boolean {
  if (text.length < 20) return false

  const lowerText = text.toLowerCase()
  if (
    NOISE_PHRASES.has(lowerText) ||
    lowerText.startsWith('has joined the channel') ||
    lowerText.startsWith('set the channel')
  ) {
    return false
  }

  return COMMITMENT_PATTERNS.some((pattern) => pattern.test(text))
}

// ============================================================
// Tool definitions for structured output
// ============================================================

const TRIAGE_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_message',
  description: 'Classify whether a message contains a commitment, promise, action item, task assignment, deadline, or follow-up.',
  input_schema: {
    type: 'object' as const,
    properties: {
      has_commitment: {
        type: 'boolean',
        description: 'true if the message contains a commitment, promise, action item, task, deadline, or follow-up',
      },
    },
    required: ['has_commitment'],
  },
}

const COMMITMENT_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const, description: 'WHO + WHAT. E.g. "Sarah to send Q3 budget report to finance team"' },
    description: { type: 'string' as const, description: 'Business context: what was promised, why, dependencies. 2-3 sentences.' },
    assignee: { type: 'string' as const, description: 'Person who owns the commitment' },
    dueDate: { type: 'string' as const, description: 'ISO date if mentioned' },
    priority: { type: 'string' as const, enum: ['high', 'medium', 'low'] },
    confidence: { type: 'number' as const, description: '0.0-1.0' },
    urgency: { type: 'string' as const, enum: ['low', 'medium', 'high', 'critical'] },
    tone: { type: 'string' as const, enum: ['casual', 'professional', 'urgent', 'demanding'] },
    commitmentType: { type: 'string' as const, enum: ['deliverable', 'meeting', 'follow_up', 'decision', 'review', 'request'] },
    stakeholders: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          role: { type: 'string' as const, enum: ['owner', 'assignee', 'stakeholder'] },
        },
        required: ['name', 'role'],
      },
    },
    originalQuote: { type: 'string' as const, description: 'Exact sentence(s) from message, max 200 chars' },
  },
  required: ['title', 'description', 'priority', 'confidence'],
}

const COMMITMENT_EXTRACTION_TOOL: Anthropic.Messages.Tool = {
  name: 'extract_commitments',
  description: 'Extract commitments from a message.',
  input_schema: {
    type: 'object' as const,
    properties: {
      commitments: {
        type: 'array',
        items: COMMITMENT_SCHEMA,
      },
    },
    required: ['commitments'],
  },
}

const BATCH_EXTRACTION_TOOL: Anthropic.Messages.Tool = {
  name: 'extract_batch_commitments',
  description: 'Extract commitments from multiple numbered messages.',
  input_schema: {
    type: 'object' as const,
    properties: {
      results: {
        type: 'object',
        description: 'Map of message number (string) to array of commitments',
        additionalProperties: {
          type: 'array',
          items: COMMITMENT_SCHEMA,
        },
      },
    },
    required: ['results'],
  },
}

// ============================================================
// Shared system prompt (cached across calls via ephemeral)
// ============================================================
const SYSTEM_PROMPT = `Extract commitments, promises, and action items from messages.

Rules:
- Title: WHO + WHAT, specific enough to understand alone. Bad: "Look into it". Good: "Mike to investigate payment timeout errors for Acme Corp".
- Description: business context, not a restatement of the title.
- originalQuote: verbatim excerpt, not paraphrased. Max 200 chars.
- stakeholders: everyone mentioned (committer, recipient, CC'd).
- Only items with confidence >= 0.5.
- Empty array if none found.`

// ============================================================
// TIER 2: Cheap Haiku triage (yes/no) via tool_use
// ~$0.0003 per call -- guaranteed structured boolean
// ============================================================
async function haiku_triage(text: string): Promise<boolean> {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      system: 'Does this message contain a commitment, promise, action item, task assignment, deadline, or follow-up? Use the classify_message tool.',
      tools: [TRIAGE_TOOL],
      tool_choice: { type: 'tool', name: 'classify_message' },
      messages: [{ role: 'user', content: text }],
    })

    const toolBlock = message.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      return (toolBlock.input as { has_commitment: boolean }).has_commitment === true
    }
  } catch (error) {
    console.error('Haiku triage failed:', (error as Error).message)
    return true // fail open
  }
  return false
}

// ============================================================
// TIER 3: Full Sonnet analysis via tool_use
// ~$0.003 per call, guaranteed structured JSON
// ============================================================
async function sonnet_analyze(text: string, communityPatterns?: string[]): Promise<DetectedCommitment[]> {
  const communityBlock = communityPatterns && communityPatterns.length > 0
    ? `\n\nCOMMUNITY PATTERNS:\n${communityPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : ''

  const systemText = SYSTEM_PROMPT + communityBlock

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: [{ type: 'text', text: systemText, cache_control: communityBlock ? undefined : { type: 'ephemeral' } }],
    tools: [COMMITMENT_EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: 'extract_commitments' },
    messages: [{ role: 'user', content: `Analyze for commitments:\n\n"${text}"` }],
  })

  const toolBlock = message.content.find((b) => b.type === 'tool_use')
  if (toolBlock && toolBlock.type === 'tool_use') {
    const result = toolBlock.input as { commitments: DetectedCommitment[] }
    return result.commitments || []
  }
  return []
}

// ============================================================
// Priority score calculation (0-100)
// ============================================================
export function calculatePriorityScore(commitment: DetectedCommitment): number {
  const priorityBase = { high: 75, medium: 50, low: 25 }
  const base = priorityBase[commitment.priority] || 50
  const confidenceBoost = (commitment.confidence - 0.5) * 30
  const hasDueDate = commitment.dueDate ? 10 : 0
  return Math.max(0, Math.min(100, Math.round(base + confidenceBoost + hasDueDate)))
}

// ============================================================
// MAIN EXPORT: 3-tier pipeline
// ============================================================

let _stats = { tier1_filtered: 0, tier2_filtered: 0, tier3_analyzed: 0, errors: 0 }

export function getDetectionStats() {
  const stats = { ..._stats }
  _stats = { tier1_filtered: 0, tier2_filtered: 0, tier3_analyzed: 0, errors: 0 }
  return stats
}

export async function detectCommitments(
  messageText: string
): Promise<DetectedCommitment[]> {
  // TIER 1: Free keyword pre-filter
  if (!likelyContainsCommitment(messageText)) {
    _stats.tier1_filtered++
    return []
  }

  try {
    // TIER 2: Haiku triage ($0.0003)
    const hasCommitment = await haiku_triage(messageText)
    if (!hasCommitment) {
      _stats.tier2_filtered++
      return []
    }

    // TIER 3: Sonnet full analysis ($0.003)
    _stats.tier3_analyzed++
    let communityPatterns: string[] = []
    try {
      communityPatterns = await getActiveCommunityPatterns('slack')
    } catch {
      // Non-fatal
    }
    const commitments = await sonnet_analyze(messageText, communityPatterns)

    if (commitments.length > 0) {
      console.log(
        'Found ' + commitments.length + ' commitments in: "' +
        messageText.substring(0, 60) + '..."'
      )
    }

    return commitments
  } catch (error) {
    _stats.errors++
    console.error('Commitment detection failed:', (error as Error).message)
    if ((error as Error).message?.includes('credit balance')) {
      console.error('ANTHROPIC API HAS NO CREDITS -- all detection will fail')
    }
    return []
  }
}

// ============================================================
// BATCH MODE: Process multiple messages in one Sonnet call
// ============================================================
export async function detectCommitmentsBatch(
  messages: Array<{ id: string; text: string }>
): Promise<Map<string, DetectedCommitment[]>> {
  const results = new Map<string, DetectedCommitment[]>()

  // Tier 1: pre-filter
  const candidates = messages.filter((m) => likelyContainsCommitment(m.text))
  _stats.tier1_filtered += messages.length - candidates.length

  // Initialize empty results for all
  messages.forEach((m) => results.set(m.id, []))

  if (candidates.length === 0) return results

  // Tier 2: Haiku triage -- parallel
  const triageResults = await Promise.all(
    candidates.map(async (msg) => {
      const hasCommitment = await haiku_triage(msg.text)
      return { msg, hasCommitment }
    })
  )

  const triaged = triageResults
    .filter((r) => r.hasCommitment)
    .map((r) => r.msg)
  _stats.tier2_filtered += candidates.length - triaged.length

  if (triaged.length === 0) return results

  // Tier 3: Batch Sonnet analysis via tool_use
  _stats.tier3_analyzed += triaged.length

  const numberedMessages = triaged
    .map((m, i) => `[${i + 1}] "${m.text}"`)
    .join('\n\n')

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: [{ type: 'text', text: `Extract commitments from batched numbered messages [1], [2], etc.

Rules:
- Title: WHO + WHAT, standalone.
- Description: business context.
- originalQuote: verbatim excerpt.
- stakeholders: anyone involved.
- Only confidence >= 0.5.
- Empty array if none.`, cache_control: { type: 'ephemeral' } }],
      tools: [BATCH_EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'extract_batch_commitments' },
      messages: [
        {
          role: 'user',
          content: `Analyze these ${triaged.length} messages for commitments:\n\n${numberedMessages}`,
        },
      ],
    })

    const toolBlock = message.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const batchResults = (toolBlock.input as { results: Record<string, DetectedCommitment[]> }).results || {}

      triaged.forEach((msg, i) => {
        const key = String(i + 1)
        const commitments = batchResults[key] || []
        if (commitments.length > 0) {
          results.set(msg.id, commitments)
          console.log(
            'Found ' + commitments.length + ' commitments in: "' +
            msg.text.substring(0, 60) + '..."'
          )
        }
      })
    }
  } catch (error) {
    _stats.errors++
    console.error('Batch commitment detection failed:', (error as Error).message)
  }

  return results
}
