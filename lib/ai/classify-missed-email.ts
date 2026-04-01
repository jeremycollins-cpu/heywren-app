import Anthropic from '@anthropic-ai/sdk'
import { getActiveCommunityPatterns } from './validate-community-signal'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface MissedEmailClassification {
  needsResponse: boolean
  urgency: 'critical' | 'high' | 'medium' | 'low'
  reason: string
  questionSummary: string | null
  category: 'question' | 'request' | 'decision' | 'follow_up' | 'introduction'
  confidence: number
  expectedResponseTime?: 'same_day' | 'next_day' | 'this_week' | 'no_rush' | null
  isVip?: boolean
}

export interface UserEmailPreferences {
  vipContacts: Array<{ name?: string; email?: string; domain?: string }>
  blockedSenders: Array<{ email?: string; domain?: string }>
  enabledCategories: string[]
  minUrgency: string
  feedbackBlockedDomains: Set<string>
  feedbackBlockedEmails: Set<string>
}

// ============================================================
// TIER 1: Free pre-filter -- eliminate obvious noise
// ============================================================

const AUTOMATED_SENDER_PATTERNS = [
  /noreply@/i, /no-reply@/i, /donotreply@/i, /do-not-reply@/i,
  /notifications?@/i, /alerts?@/i, /mailer-daemon@/i, /postmaster@/i,
  /bounce@/i, /support@.*\.com$/i, /info@.*\.com$/i, /hello@.*\.com$/i,
  /news@/i, /newsletter@/i, /updates?@/i, /marketing@/i,
  /promo(tions)?@/i, /sales@/i, /billing@/i, /invoice@/i,
  /receipts?@/i, /order@/i, /shipping@/i, /feedback@/i,
  /survey@/i, /digest@/i, /automated@/i, /system@/i,
  /admin@/i, /webmaster@/i,
]

const AUTOMATED_SUBJECT_PATTERNS = [
  /\bunsubscribe\b/i, /\bnewsletter\b/i, /\bdigest\b/i,
  /\b(weekly|daily|monthly) (update|summary|recap|report)\b/i,
  /\bnotification\b/i, /\balert:/i,
  /\b(order|shipping|tracking) (confirm|update|number)/i,
  /\breceipt for\b/i, /\binvoice #/i,
  /\bpassword reset\b/i, /\bverify your (email|account)\b/i,
  /\bwelcome to\b/i,
  /\bthanks for (signing up|subscribing|registering|your (order|purchase))\b/i,
  /\byour (account|subscription|trial|order|payment)\b/i,
  /\b(new|recent) (sign-?in|login)\b/i, /\bsecurity (alert|notice)\b/i,
  /\bout of office\b/i, /\bautomatic reply\b/i, /\bautoreply\b/i, /\bOOO\b/,
  /\bPR #\d+/i, /\b\[JIRA\]/i, /\b\[GitHub\]/i,
  /\bbuild (passed|failed|broken)\b/i, /\bpipeline (passed|failed)\b/i,
  /\bCI\/CD\b/i, /\bdeployment (succeeded|failed)\b/i,
  /\b(limited time|exclusive|special) offer\b/i, /\b\d+% off\b/i,
  /\bfree (trial|demo|consultation)\b/i, /\bdon't miss\b/i,
  /\blast chance\b/i, /\bact now\b/i, /\bebook\b/i,
  /\bwebinar\b/i, /\bwhitepaper\b/i,
]

const QUESTION_PATTERNS = [
  /\?\s*$/m,
  /\bcan you\b/i, /\bcould you\b/i, /\bwould you\b/i,
  /\bwhat (do you|are your|is your)\b/i, /\bwhat('s| is) (the|your)\b/i,
  /\bhow (do you|should we|would you|can we)\b/i,
  /\bdo you (have|know|think|want|need|prefer)\b/i,
  /\bare you (able|available|free|okay|interested)\b/i,
  /\bwhen (can you|will you|are you|should we|do you)\b/i,
  /\bwhere (should|do|can|is)\b/i,
  /\bthoughts on\b/i, /\bwhat do you think\b/i,
  /\byour (thoughts|opinion|feedback|input|take)\b/i,
  /\blet me know\b/i, /\bget back to me\b/i,
  /\bplease (confirm|advise|review|respond|reply|send|share|update|let me know)\b/i,
  /\bwaiting (for|on) your\b/i, /\bany update\b/i,
  /\bneed your (approval|sign-?off|input|feedback|response|decision)\b/i,
  /\bpending your\b/i, /\bfollowing up\b/i, /\bjust checking in\b/i,
  /\bcircling back\b/i, /\bwanted to check\b/i, /\bwanted to follow up\b/i,
  /\bI would like to schedule\b/i,
  /\bI('d| would) like to (set up|arrange|book|plan)\b/i,
  /\bI('d| would) appreciate your\b/i,
  /\bconvenient time\b/i, /\bwhen (works|is good) for you\b/i,
  /\bare (they|the .+) (meeting|aligned|up to)\b/i,
  /\bmeeting your expectations\b/i, /\byour feedback\b/i,
  /\bschedule a (quick |brief )?(call|meeting|chat|sync)\b/i,
]

export interface EmailInput {
  fromEmail: string
  fromName: string
  subject: string
  bodyPreview: string
  receivedAt: string
  recipientEmail?: string  // The user's email — helps detect when they're directly addressed
  recipientName?: string   // The user's name — helps detect @mentions
  isCcOnly?: boolean       // True if user is only on CC, not TO — deprioritize unless @mentioned
}

// ============================================================
// User preference checks
// ============================================================

function extractDomain(email: string): string {
  return (email.split('@')[1] || '').toLowerCase()
}

function isVipSender(email: EmailInput, prefs?: UserEmailPreferences): boolean {
  if (!prefs) return false
  const senderEmail = email.fromEmail.toLowerCase()
  const senderDomain = extractDomain(email.fromEmail)

  return prefs.vipContacts.some(vip => {
    if (vip.email && senderEmail === vip.email.toLowerCase()) return true
    if (vip.domain && senderDomain === vip.domain.toLowerCase()) return true
    return false
  })
}

function isBlockedSender(email: EmailInput, prefs?: UserEmailPreferences): boolean {
  if (!prefs) return false
  const senderEmail = email.fromEmail.toLowerCase()
  const senderDomain = extractDomain(email.fromEmail)

  const explicitlyBlocked = prefs.blockedSenders.some(blocked => {
    if (blocked.email && senderEmail === blocked.email.toLowerCase()) return true
    if (blocked.domain && senderDomain === blocked.domain.toLowerCase()) return true
    return false
  })
  if (explicitlyBlocked) return true

  if (prefs.feedbackBlockedDomains.has(senderDomain)) return true
  if (prefs.feedbackBlockedEmails.has(senderEmail)) return true

  return false
}

function meetsUrgencyThreshold(urgency: string, minUrgency: string): boolean {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return (order[urgency] ?? 3) <= (order[minUrgency] ?? 3)
}

function isLikelyAutomated(email: EmailInput): boolean {
  if (AUTOMATED_SENDER_PATTERNS.some(p => p.test(email.fromEmail))) return true
  if (AUTOMATED_SUBJECT_PATTERNS.some(p => p.test(email.subject))) return true
  if (email.bodyPreview.length < 30 && !email.bodyPreview.includes('?')) return true
  return false
}

function likelyNeedsResponse(email: EmailInput): boolean {
  // CC-only emails don't need a response unless the user is @mentioned
  if (email.isCcOnly) {
    if (email.recipientName && email.recipientName.length > 2) {
      const nameLower = email.recipientName.toLowerCase()
      const bodyLower = email.bodyPreview.toLowerCase()
      if (bodyLower.includes(`@${nameLower}`) || bodyLower.includes(nameLower)) return true
    }
    return false
  }
  const text = email.subject + ' ' + email.bodyPreview
  if (QUESTION_PATTERNS.some(p => p.test(text))) return true
  // If the user is @mentioned by name in the body, it likely needs their response
  if (email.recipientName && email.recipientName.length > 2) {
    const nameLower = email.recipientName.toLowerCase()
    const bodyLower = email.bodyPreview.toLowerCase()
    if (bodyLower.includes(`@${nameLower}`) || bodyLower.includes(nameLower)) return true
  }
  return false
}

// ============================================================
// Tool definitions for structured output
// ============================================================

const TRIAGE_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_email',
  description: 'Classify whether an email needs a personal response.',
  input_schema: {
    type: 'object' as const,
    properties: {
      needs_response: {
        type: 'boolean',
        description: 'true if email contains a direct question/request/action directed at recipient',
      },
    },
    required: ['needs_response'],
  },
}

const EMAIL_ANALYSIS_TOOL: Anthropic.Messages.Tool = {
  name: 'analyze_email',
  description: 'Analyze an email for response needs, urgency, and classification.',
  input_schema: {
    type: 'object' as const,
    properties: {
      needsResponse: { type: 'boolean' },
      urgency: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
      reason: { type: 'string', description: 'Brief explanation' },
      questionSummary: { type: 'string', description: 'The specific question/request, or null' },
      category: { type: 'string', enum: ['question', 'request', 'decision', 'follow_up', 'introduction'] },
      confidence: { type: 'number' },
      expectedResponseTime: { type: 'string', enum: ['same_day', 'next_day', 'this_week', 'no_rush'] },
    },
    required: ['needsResponse', 'urgency', 'reason', 'questionSummary', 'category', 'confidence'],
  },
}

const BATCH_EMAIL_TOOL: Anthropic.Messages.Tool = {
  name: 'analyze_emails_batch',
  description: 'Analyze multiple emails for response needs.',
  input_schema: {
    type: 'object' as const,
    properties: {
      results: {
        type: 'object',
        description: 'Map of email number to analysis',
        additionalProperties: {
          type: 'object',
          properties: {
            needsResponse: { type: 'boolean' },
            urgency: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            reason: { type: 'string' },
            questionSummary: { type: 'string' },
            category: { type: 'string', enum: ['question', 'request', 'decision', 'follow_up', 'introduction'] },
            confidence: { type: 'number' },
            expectedResponseTime: { type: 'string', enum: ['same_day', 'next_day', 'this_week', 'no_rush'] },
          },
          required: ['needsResponse', 'urgency', 'reason', 'category', 'confidence'],
        },
      },
    },
    required: ['results'],
  },
}

// ============================================================
// Shared system prompt for Sonnet analysis (cached)
// ============================================================

const SONNET_SYSTEM_PROMPT = `Analyze emails for response needs.

Urgency:
- critical: Boss/client/stakeholder time-sensitive question; blocking work; today/tomorrow meeting
- high: Clear question expecting prompt reply; feedback requests; scheduling "this week"; vendor follow-ups; someone waiting
- medium: Reasonable request, answer within days
- low: Nice-to-respond; introductions; optional

IMPLICIT SIGNALS (upgrade even without deadline words):
- Recipient is @mentioned by name in a group email -> critical/high (directly addressed)
- Meeting scheduling -> high+ (need reply to book)
- "Let me know" / "convenient time" -> high (waiting)
- Vendor follow-ups -> high (business relationship)
- Feedback requests on their work -> high (may be blocked)
- Follow-ups referencing prior conversation -> high (delayed = rude)
- Multiple questions -> boost urgency
- "This week" / "earliest convenience" -> high
- Direct personalized emails -> medium minimum
- Multi-recipient email but question is directed at the Recipient specifically -> high+

expectedResponseTime: meeting/feedback/vendor -> same_day/next_day; "this week" -> this_week; open-ended -> no_rush

needsResponse=false for: sales/marketing, automated notifications, newsletters, transactional, mass-sent, calendar invites (no question), FYI-only`

// ============================================================
// TIER 2: Haiku triage via tool_use (~$0.0003)
// ============================================================
async function haikuTriage(email: EmailInput): Promise<boolean> {
  try {
    const recipientCtx = email.recipientName || email.recipientEmail
      ? `\nRecipient (you are classifying for): ${email.recipientName || ''} ${email.recipientEmail ? `<${email.recipientEmail}>` : ''}`.trim()
      : ''
    const emailText = `From: ${email.fromName} <${email.fromEmail}>\nSubject: ${email.subject}${recipientCtx}\n\n${email.bodyPreview}`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      system: 'Does this email contain a direct question, request, or action item directed at the recipient awaiting a response? If the recipient is specifically @mentioned or addressed by name, answer true. Ignore sales, automated, newsletters, mass emails.',
      tools: [TRIAGE_TOOL],
      tool_choice: { type: 'tool', name: 'classify_email' },
      messages: [{ role: 'user', content: emailText }],
    })

    const toolBlock = message.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      return (toolBlock.input as { needs_response: boolean }).needs_response === true
    }
  } catch (error) {
    console.error('Missed email Haiku triage failed:', (error as Error).message)
    return true // fail open
  }
  return false
}

// ============================================================
// TIER 3: Sonnet deep analysis via tool_use
// ============================================================
async function sonnetAnalyze(email: EmailInput, communityPatterns?: string[]): Promise<MissedEmailClassification> {
  const daysSince = Math.floor(
    (Date.now() - new Date(email.receivedAt).getTime()) / (1000 * 60 * 60 * 24)
  )

  const recipientCtx = email.recipientName || email.recipientEmail
    ? `\nRecipient: ${email.recipientName || ''} ${email.recipientEmail ? `<${email.recipientEmail}>` : ''}`.trim()
    : ''
  const emailText = `From: ${email.fromName} <${email.fromEmail}>\nSubject: ${email.subject}\nDate: ${email.receivedAt} (${daysSince}d ago)${recipientCtx}\n\n${email.bodyPreview}`

  const communityBlock = communityPatterns && communityPatterns.length > 0
    ? `\n\nCOMMUNITY PATTERNS:\n${communityPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : ''

  const systemText = SONNET_SYSTEM_PROMPT + communityBlock

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: [{ type: 'text', text: systemText, cache_control: communityBlock ? undefined : { type: 'ephemeral' } } as any],
    tools: [EMAIL_ANALYSIS_TOOL],
    tool_choice: { type: 'tool', name: 'analyze_email' },
    messages: [{ role: 'user', content: emailText }],
  })

  const toolBlock = message.content.find((b) => b.type === 'tool_use')
  if (toolBlock && toolBlock.type === 'tool_use') {
    return toolBlock.input as MissedEmailClassification
  }

  return {
    needsResponse: false,
    urgency: 'low',
    reason: 'Could not analyze',
    questionSummary: null,
    category: 'question',
    confidence: 0,
  }
}

// ============================================================
// Urgency escalation for overdue emails
// ============================================================

const RESPONSE_TIME_HOURS: Record<string, number> = {
  same_day: 8,
  next_day: 24,
  this_week: 96,
  no_rush: 168,
}

function escalateForAge(result: MissedEmailClassification, receivedAt: string): void {
  if (!result.needsResponse || !result.expectedResponseTime) return

  const expectedHours = RESPONSE_TIME_HOURS[result.expectedResponseTime]
  if (!expectedHours) return

  const hoursSinceReceived = (Date.now() - new Date(receivedAt).getTime()) / (1000 * 60 * 60)
  if (hoursSinceReceived <= expectedHours) return

  const escalation: Record<string, 'critical' | 'high' | 'medium'> = {
    low: 'medium',
    medium: 'high',
    high: 'critical',
  }

  if (result.urgency !== 'critical') {
    const escalatedUrgency = escalation[result.urgency]
    if (escalatedUrgency) {
      result.reason = `${result.reason} (overdue -- expected response within ${result.expectedResponseTime.replace('_', ' ')})`
      result.urgency = escalatedUrgency
    }
  }
}

// ============================================================
// Stats tracking
// ============================================================
let _stats = {
  total_scanned: 0,
  tier1_automated: 0,
  tier1_no_question: 0,
  tier2_filtered: 0,
  tier3_analyzed: 0,
  needs_response: 0,
  errors: 0,
}

export function getClassificationStats() {
  const stats = { ..._stats }
  _stats = { total_scanned: 0, tier1_automated: 0, tier1_no_question: 0, tier2_filtered: 0, tier3_analyzed: 0, needs_response: 0, errors: 0 }
  return stats
}

// ============================================================
// MAIN EXPORT: 3-tier pipeline
// ============================================================
export async function classifyMissedEmail(
  email: EmailInput,
  prefs?: UserEmailPreferences
): Promise<MissedEmailClassification | null> {
  _stats.total_scanned++

  if (isBlockedSender(email, prefs)) {
    _stats.tier1_automated++
    return null
  }

  const vip = isVipSender(email, prefs)

  if (!vip) {
    if (isLikelyAutomated(email)) {
      _stats.tier1_automated++
      return null
    }

    if (!likelyNeedsResponse(email)) {
      _stats.tier1_no_question++
      return null
    }
  }

  try {
    if (!vip) {
      const needsResponse = await haikuTriage(email)
      if (!needsResponse) {
        _stats.tier2_filtered++
        return null
      }
    }

    _stats.tier3_analyzed++
    let communityPatterns: string[] = []
    try {
      communityPatterns = await getActiveCommunityPatterns('email')
    } catch {
      // Non-fatal
    }
    const result = await sonnetAnalyze(email, communityPatterns)

    escalateForAge(result, email.receivedAt)

    const confidenceThreshold = vip ? 0.3 : 0.6
    if (result.needsResponse && result.confidence >= confidenceThreshold) {
      if (vip && result.urgency !== 'critical') {
        const boost: Record<string, 'critical' | 'high' | 'medium'> = {
          high: 'critical',
          medium: 'high',
          low: 'medium',
        }
        result.urgency = boost[result.urgency] || result.urgency
      }

      if (prefs && !meetsUrgencyThreshold(result.urgency, prefs.minUrgency)) {
        return null
      }

      if (prefs && !prefs.enabledCategories.includes(result.category)) {
        return null
      }

      _stats.needs_response++
      result.isVip = vip
      return result
    }

    if (vip && likelyNeedsResponse(email)) {
      _stats.needs_response++
      return {
        needsResponse: true,
        urgency: 'medium',
        reason: 'VIP contact -- surfaced by default',
        questionSummary: null,
        category: 'question',
        confidence: 0.5,
        isVip: true,
      }
    }

    return null
  } catch (error) {
    _stats.errors++
    console.error('Email classification failed:', (error as Error).message)
    return null
  }
}

// ============================================================
// BATCH MODE
// ============================================================
export async function classifyMissedEmailBatch(
  emails: Array<{ id: string } & EmailInput>,
  prefs?: UserEmailPreferences
): Promise<Map<string, MissedEmailClassification>> {
  const results = new Map<string, MissedEmailClassification>()

  // Tier 0 + 1: Pre-filter
  const candidates: Array<{ id: string; vip: boolean } & EmailInput> = []
  for (const email of emails) {
    _stats.total_scanned++

    if (isBlockedSender(email, prefs)) {
      _stats.tier1_automated++
      continue
    }

    const vip = isVipSender(email, prefs)

    if (!vip) {
      if (isLikelyAutomated(email)) {
        _stats.tier1_automated++
        continue
      }

      if (!likelyNeedsResponse(email)) {
        _stats.tier1_no_question++
        continue
      }
    }

    candidates.push({ ...email, vip })
  }

  if (candidates.length === 0) return results

  // Tier 2: Haiku triage via tool_use (VIPs skip)
  const triaged: typeof candidates = []
  for (const email of candidates) {
    if (email.vip) {
      triaged.push(email)
      continue
    }
    const needs = await haikuTriage(email)
    if (needs) {
      triaged.push(email)
    } else {
      _stats.tier2_filtered++
    }
  }

  if (triaged.length === 0) return results

  // Tier 3: Batch Sonnet analysis via tool_use
  _stats.tier3_analyzed += triaged.length

  let communityPatterns: string[] = []
  try {
    communityPatterns = await getActiveCommunityPatterns('email')
  } catch {
    // Non-fatal
  }
  const communityBlock = communityPatterns.length > 0
    ? `\n\nCOMMUNITY PATTERNS:\n${communityPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
    : ''

  const numberedEmails = triaged
    .map((email, i) => {
      const daysSince = Math.floor(
        (Date.now() - new Date(email.receivedAt).getTime()) / (1000 * 60 * 60 * 24)
      )
      const recipientCtx = email.recipientName || email.recipientEmail
        ? `\nRecipient: ${email.recipientName || ''} ${email.recipientEmail ? `<${email.recipientEmail}>` : ''}`.trim()
        : ''
      return `[${i + 1}]\nFrom: ${email.fromName} <${email.fromEmail}>\nSubject: ${email.subject}\nDate: ${email.receivedAt} (${daysSince}d ago)${recipientCtx}\n\n${email.bodyPreview}`
    })
    .join('\n\n---\n\n')

  try {
    const systemText = SONNET_SYSTEM_PROMPT + communityBlock

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: [{ type: 'text', text: `Analyze batched emails numbered [1], [2], etc.\n\n${systemText}`, cache_control: communityBlock ? undefined : { type: 'ephemeral' } } as any],
      tools: [BATCH_EMAIL_TOOL],
      tool_choice: { type: 'tool', name: 'analyze_emails_batch' },
      messages: [
        {
          role: 'user',
          content: `Analyze these ${triaged.length} emails:\n\n${numberedEmails}`,
        },
      ],
    })

    const toolBlock = message.content.find((b) => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const batchResults = (toolBlock.input as { results: Record<string, MissedEmailClassification> }).results || {}

      triaged.forEach((email, i) => {
        const key = String(i + 1)
        const classification = batchResults[key]
        if (!classification) return

        escalateForAge(classification, email.receivedAt)

        const confidenceThreshold = email.vip ? 0.3 : 0.6
        if (classification.needsResponse && (classification.confidence || 0) >= confidenceThreshold) {
          if (email.vip && classification.urgency !== 'critical') {
            const boost: Record<string, string> = { high: 'critical', medium: 'high', low: 'medium' }
            classification.urgency = (boost[classification.urgency] || classification.urgency) as any
          }

          if (prefs && !meetsUrgencyThreshold(classification.urgency, prefs.minUrgency)) return
          if (prefs && !prefs.enabledCategories.includes(classification.category)) return

          classification.isVip = email.vip
          _stats.needs_response++
          results.set(email.id, classification)
        } else if (email.vip && likelyNeedsResponse(email)) {
          _stats.needs_response++
          results.set(email.id, {
            needsResponse: true,
            urgency: 'medium',
            reason: 'VIP contact -- surfaced by default',
            questionSummary: null,
            category: 'question',
            confidence: 0.5,
            isVip: true,
          })
        }
      })
    }
  } catch (error) {
    _stats.errors++
    console.error('Batch email classification failed:', (error as Error).message)
  }

  return results
}
