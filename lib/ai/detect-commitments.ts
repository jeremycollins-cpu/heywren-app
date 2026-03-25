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
  // Enriched context fields (from enhanced Tier 3 extraction)
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
  // Promises and commitments
  /\bi('ll|'ll| will)\b/i,
  /\bwe('ll|'ll| will)\b/i,
  /\bi('m going to|'m going to)\b/i,
  /\blet me\b/i,
  /\bpromise\b/i,
  /\bcommit\b/i,
  /\bguarantee\b/i,

  // Action items and requests
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

  // Deadlines and timing
  /\bby (friday|monday|tuesday|wednesday|thursday|saturday|sunday|tomorrow|tonight|end of|eod|eow|cob)\b/i,
  /\bdeadline\b/i,
  /\bdue (date|by|on)\b/i,
  /\basap\b/i,
  /\burgent/i,
  /\bpriority\b/i,

  // Follow-ups
  /\bfollow[- ]?up\b/i,
  /\bcircle back\b/i,
  /\bget back to\b/i,
  /\bloop back\b/i,
  /\brevisit\b/i,
  /\bremind(er)?\b/i,
  /\bping me\b/i,

  // Meetings and scheduling
  /\bschedule\b/i,
  /\bset up a (call|meeting|sync)\b/i,
  /\bmeeting on\b/i,
  /\bmeeting (this|next)\b/i,

  // Delivery language
  /\bsend (it|this|that|you|over)\b/i,
  /\bshare (it|this|that|with)\b/i,
  /\bdeliver/i,
  /\bsubmit/i,
  /\bpush (it|this|the)\b/i,

  // Updates and status
  /\bupdate (the|this|you|on)\b/i,
  /\bwill (have|get|send|do|finish|complete|review|check|look)\b/i,
  /\bworking on\b/i,
  /\bon (my|it|this|the) radar\b/i,

  // Board/executive language
  /\bnotes for\b/i,
  /\bagenda\b/i,
  /\baction (plan|required|needed)\b/i,
  /\bnext steps\b/i,
]

/**
 * Tier 1: Check if a message likely contains a commitment
 * using fast regex patterns. This is free (no API call).
 */
function likelyContainsCommitment(text: string): boolean {
  // Skip very short messages
  if (text.length < 20) return false

  // Skip common non-commitment patterns
  const lowerText = text.toLowerCase()
  if (
    lowerText === 'thanks' ||
    lowerText === 'thank you' ||
    lowerText === 'sounds good' ||
    lowerText === 'got it' ||
    lowerText === 'ok' ||
    lowerText === 'okay' ||
    lowerText === 'lgtm' ||
    lowerText === 'approved' ||
    lowerText.startsWith('has joined the channel') ||
    lowerText.startsWith('set the channel')
  ) {
    return false
  }

  // Check against commitment patterns
  return COMMITMENT_PATTERNS.some((pattern) => pattern.test(text))
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
// TIER 2: Cheap Haiku triage (yes/no) — ~$0.0003 per call
// Only messages that pass Tier 1 get sent here
// ============================================================
async function haiku_triage(text: string): Promise<boolean> {
  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: 'Does this message contain a commitment, promise, action item, task assignment, deadline, or follow-up? Reply ONLY "yes" or "no".',
      messages: [{ role: 'user', content: text }],
    })

    const content = message.content[0]
    if (content.type === 'text') {
      return content.text.trim().toLowerCase().startsWith('yes')
    }
  } catch (error) {
    console.error('Haiku triage failed:', (error as Error).message)
    // On error, let it through to Sonnet (fail open)
    return true
  }
  return false
}

// ============================================================
// TIER 3: Full Sonnet analysis — only for confirmed commitments
// ~$0.003 per call, but only ~5-10% of messages reach here
// ============================================================
async function sonnet_analyze(text: string, communityPatterns?: string[]): Promise<DetectedCommitment[]> {
  const communityRulesBlock = communityPatterns && communityPatterns.length > 0
    ? `\n\nCOMMUNITY-LEARNED PATTERNS (apply these — from real user feedback):\n${communityPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : ''

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: `You detect commitments, promises, and action items in messages. Extract rich context to make each commitment actionable and understandable at a glance.

Return ONLY valid JSON (no markdown, no code fences):
{
  "commitments": [
    {
      "title": "concise but specific task title (include WHO and WHAT, e.g. 'Sarah to send Q3 budget report to finance team')",
      "description": "2-3 sentence description with full context: what exactly was promised, why it matters, and any conditions or dependencies mentioned",
      "assignee": "person name who owns the commitment (if mentioned)",
      "dueDate": "ISO date if mentioned, null otherwise",
      "priority": "high|medium|low",
      "confidence": 0.0-1.0,
      "urgency": "low|medium|high|critical — based on language cues (ASAP=critical, 'when you get a chance'=low, explicit deadlines=high)",
      "tone": "casual|professional|urgent|demanding — the tone of the original request/commitment",
      "commitmentType": "deliverable|meeting|follow_up|decision|review|request — what kind of commitment this is",
      "stakeholders": [{"name": "person name", "role": "owner|assignee|stakeholder"}],
      "originalQuote": "the exact sentence(s) from the message that contain the commitment — keep it short, max 200 chars"
    }
  ]
}

Guidelines:
- Title should be specific enough to understand without reading the full message. Bad: "Look into the issue". Good: "Mike to investigate payment gateway timeout errors reported by Acme Corp".
- Description should explain the business context, not just restate the title.
- originalQuote must be a direct excerpt from the source message, not a paraphrase.
- stakeholders should include anyone mentioned as involved (the person committing, the person they're committing to, anyone CC'd or referenced).
- If no commitments: {"commitments": []}
- Only include items with confidence >= 0.5.${communityRulesBlock}`,
    messages: [{ role: 'user', content: `Analyze for commitments:\n\n"${text}"` }],
  })

  const content = message.content[0]
  if (content.type === 'text') {
    const jsonStr = extractJSON(content.text)
    const parsed = JSON.parse(jsonStr)
    return parsed.commitments || []
  }
  return []
}

// ============================================================
// Priority score calculation (0-100)
// Combines priority level + confidence + time signals
// ============================================================
export function calculatePriorityScore(commitment: DetectedCommitment): number {
  const priorityBase = { high: 75, medium: 50, low: 25 }
  const base = priorityBase[commitment.priority] || 50
  const confidenceBoost = (commitment.confidence - 0.5) * 30 // -15 to +15
  const hasDueDate = commitment.dueDate ? 10 : 0
  return Math.max(0, Math.min(100, Math.round(base + confidenceBoost + hasDueDate)))
}

// ============================================================
// MAIN EXPORT: 3-tier pipeline
// Tier 1 (free) → Tier 2 (Haiku $0.0003) → Tier 3 (Sonnet $0.003)
// ============================================================

// Track stats for logging
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

    // TIER 3: Sonnet full analysis ($0.003) — with community-learned patterns
    _stats.tier3_analyzed++
    let communityPatterns: string[] = []
    try {
      communityPatterns = await getActiveCommunityPatterns('slack')
    } catch {
      // Non-fatal — proceed without community patterns
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
      console.error('ANTHROPIC API HAS NO CREDITS — all detection will fail')
    }
    return []
  }
}

// ============================================================
// BATCH MODE: Process multiple messages in one Sonnet call
// Even cheaper for backfill — groups up to 15 messages per call
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

  // Tier 2: Haiku triage each candidate
  const triaged: typeof candidates = []
  for (const msg of candidates) {
    const hasCommitment = await haiku_triage(msg.text)
    if (hasCommitment) {
      triaged.push(msg)
    } else {
      _stats.tier2_filtered++
    }
  }

  if (triaged.length === 0) return results

  // Tier 3: Batch Sonnet analysis
  _stats.tier3_analyzed += triaged.length

  // Build batch prompt
  const numberedMessages = triaged
    .map((m, i) => `[${i + 1}] "${m.text}"`)
    .join('\n\n')

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: `You detect commitments in batched messages. Each message is numbered [1], [2], etc. Extract rich context for each commitment.

Return ONLY valid JSON (no markdown, no code fences):
{
  "results": {
    "1": [{"title": "concise but specific (include WHO and WHAT)", "description": "2-3 sentences with full context", "assignee": "person name", "dueDate": null, "priority": "medium", "confidence": 0.8, "urgency": "low|medium|high|critical", "tone": "casual|professional|urgent|demanding", "commitmentType": "deliverable|meeting|follow_up|decision|review|request", "stakeholders": [{"name": "...", "role": "owner|assignee|stakeholder"}], "originalQuote": "exact excerpt from the message, max 200 chars"}],
    "2": [],
    "3": [...]
  }
}

Guidelines:
- Title should be specific enough to understand without the source message. Bad: "Look into the issue". Good: "Mike to investigate payment gateway timeout errors".
- Description should explain the business context.
- originalQuote must be a direct excerpt from the source, not a paraphrase.
- stakeholders: include anyone mentioned as involved.
Keys are the message numbers. Values are arrays of commitments found.
Only include commitments with confidence >= 0.5. Empty array if none found.`,
      messages: [
        {
          role: 'user',
          content: `Analyze these ${triaged.length} messages for commitments:\n\n${numberedMessages}`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type === 'text') {
      const jsonStr = extractJSON(content.text)
      const parsed = JSON.parse(jsonStr)
      const batchResults = parsed.results || {}

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
