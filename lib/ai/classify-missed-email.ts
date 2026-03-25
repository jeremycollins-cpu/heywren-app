import Anthropic from '@anthropic-ai/sdk'

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

// User preferences that influence classification
export interface UserEmailPreferences {
  vipContacts: Array<{ name?: string; email?: string; domain?: string }>
  blockedSenders: Array<{ email?: string; domain?: string }>
  enabledCategories: string[]
  minUrgency: string
  // Past feedback: domains/emails frequently marked invalid
  feedbackBlockedDomains: Set<string>
  feedbackBlockedEmails: Set<string>
}

// ============================================================
// TIER 1: Free pre-filter — eliminate obvious noise
// Catches ~80% of sales, automated, and no-reply emails
// ============================================================

const AUTOMATED_SENDER_PATTERNS = [
  /noreply@/i,
  /no-reply@/i,
  /donotreply@/i,
  /do-not-reply@/i,
  /notifications?@/i,
  /alerts?@/i,
  /mailer-daemon@/i,
  /postmaster@/i,
  /bounce@/i,
  /support@.*\.com$/i,
  /info@.*\.com$/i,
  /hello@.*\.com$/i,
  /news@/i,
  /newsletter@/i,
  /updates?@/i,
  /marketing@/i,
  /promo(tions)?@/i,
  /sales@/i,
  /billing@/i,
  /invoice@/i,
  /receipts?@/i,
  /order@/i,
  /shipping@/i,
  /feedback@/i,
  /survey@/i,
  /digest@/i,
  /automated@/i,
  /system@/i,
  /admin@/i,
  /webmaster@/i,
]

const AUTOMATED_SUBJECT_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bnewsletter\b/i,
  /\bdigest\b/i,
  /\bweekly (update|summary|recap|report)\b/i,
  /\bdaily (update|summary|recap|report)\b/i,
  /\bmonthly (update|summary|recap|report)\b/i,
  /\bnotification\b/i,
  /\balert:/i,
  /\b(order|shipping|tracking) (confirm|update|number)/i,
  /\breceipt for\b/i,
  /\binvoice #/i,
  /\bpassword reset\b/i,
  /\bverify your (email|account)\b/i,
  /\bwelcome to\b/i,
  /\bthanks for (signing up|subscribing|registering|your (order|purchase))\b/i,
  /\byour (account|subscription|trial|order|payment)\b/i,
  /\b(new|recent) (sign-?in|login)\b/i,
  /\bsecurity (alert|notice)\b/i,
  /\bout of office\b/i,
  /\bautomatic reply\b/i,
  /\bautoreply\b/i,
  /\bOOO\b/,
  /\bPR #\d+/i,
  /\b\[JIRA\]/i,
  /\b\[GitHub\]/i,
  /\bbuild (passed|failed|broken)\b/i,
  /\bpipeline (passed|failed)\b/i,
  /\bCI\/CD\b/i,
  /\bdeployment (succeeded|failed)\b/i,
  /\b(limited time|exclusive|special) offer\b/i,
  /\b\d+% off\b/i,
  /\bfree (trial|demo|consultation)\b/i,
  /\bdon't miss\b/i,
  /\blast chance\b/i,
  /\bact now\b/i,
  /\bebook\b/i,
  /\bwebinar\b/i,
  /\bwhitepaper\b/i,
]

// Patterns that suggest someone is asking the user something directly
const QUESTION_PATTERNS = [
  /\?\s*$/m,                       // ends with question mark
  /\bcan you\b/i,
  /\bcould you\b/i,
  /\bwould you\b/i,
  /\bwhat (do you|are your|is your)\b/i,
  /\bwhat('s| is) (the|your)\b/i,
  /\bhow (do you|should we|would you|can we)\b/i,
  /\bdo you (have|know|think|want|need|prefer)\b/i,
  /\bare you (able|available|free|okay|interested)\b/i,
  /\bwhen (can you|will you|are you|should we|do you)\b/i,
  /\bwhere (should|do|can|is)\b/i,
  /\bthoughts on\b/i,
  /\bwhat do you think\b/i,
  /\byour (thoughts|opinion|feedback|input|take)\b/i,
  /\blet me know\b/i,
  /\bget back to me\b/i,
  /\bplease (confirm|advise|review|respond|reply|send|share|update|let me know)\b/i,
  /\bwaiting (for|on) your\b/i,
  /\bany update\b/i,
  /\bneed your (approval|sign-?off|input|feedback|response|decision)\b/i,
  /\bpending your\b/i,
  /\bfollowing up\b/i,
  /\bjust checking in\b/i,
  /\bcircling back\b/i,
  /\bwanted to check\b/i,
  /\bwanted to follow up\b/i,
  /\bI would like to schedule\b/i,
  /\bI('d| would) like to (set up|arrange|book|plan)\b/i,
  /\bI('d| would) appreciate your\b/i,
  /\bconvenient time\b/i,
  /\bwhen (works|is good) for you\b/i,
  /\bare (they|the .+) (meeting|aligned|up to)\b/i,
  /\bmeeting your expectations\b/i,
  /\byour feedback\b/i,
  /\bschedule a (quick |brief )?(call|meeting|chat|sync)\b/i,
]

export interface EmailInput {
  fromEmail: string
  fromName: string
  subject: string
  bodyPreview: string
  receivedAt: string
}

// ============================================================
// User preference checks — VIP / blocked / feedback
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

  // Check explicit blocks
  const explicitlyBlocked = prefs.blockedSenders.some(blocked => {
    if (blocked.email && senderEmail === blocked.email.toLowerCase()) return true
    if (blocked.domain && senderDomain === blocked.domain.toLowerCase()) return true
    return false
  })
  if (explicitlyBlocked) return true

  // Check feedback-derived blocks (3+ invalid marks on a domain)
  if (prefs.feedbackBlockedDomains.has(senderDomain)) return true
  if (prefs.feedbackBlockedEmails.has(senderEmail)) return true

  return false
}

function meetsUrgencyThreshold(urgency: string, minUrgency: string): boolean {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  return (order[urgency] ?? 3) <= (order[minUrgency] ?? 3)
}

/**
 * Tier 1: Fast, free check — is this clearly automated/sales noise?
 */
function isLikelyAutomated(email: EmailInput): boolean {
  // Check sender patterns
  if (AUTOMATED_SENDER_PATTERNS.some(p => p.test(email.fromEmail))) {
    return true
  }

  // Check subject patterns
  if (AUTOMATED_SUBJECT_PATTERNS.some(p => p.test(email.subject))) {
    return true
  }

  // Very short body with no question marks = probably automated
  if (email.bodyPreview.length < 30 && !email.bodyPreview.includes('?')) {
    return true
  }

  return false
}

/**
 * Tier 1b: Does this email likely contain a question or request?
 */
function likelyNeedsResponse(email: EmailInput): boolean {
  const text = email.subject + ' ' + email.bodyPreview
  return QUESTION_PATTERNS.some(p => p.test(text))
}

// ============================================================
// TIER 2: Haiku triage — binary classification (~$0.0003/call)
// ============================================================
async function haikuTriage(email: EmailInput): Promise<boolean> {
  try {
    const emailText = [
      `From: ${email.fromName} <${email.fromEmail}>`,
      `Subject: ${email.subject}`,
      `Date: ${email.receivedAt}`,
      '',
      email.bodyPreview,
    ].join('\n')

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      system: `You classify emails. Does this email contain a direct question, request, or action item specifically directed at the recipient that is waiting for a response? Ignore sales pitches, automated notifications, newsletters, marketing emails, and mass-sent emails. Reply ONLY "yes" or "no".`,
      messages: [{ role: 'user', content: emailText }],
    })

    const content = message.content[0]
    if (content.type === 'text') {
      return content.text.trim().toLowerCase().startsWith('yes')
    }
  } catch (error) {
    console.error('Missed email Haiku triage failed:', (error as Error).message)
    return true // fail open
  }
  return false
}

// ============================================================
// TIER 3: Sonnet deep analysis — extract question & urgency
// ============================================================
async function sonnetAnalyze(email: EmailInput): Promise<MissedEmailClassification> {
  const daysSince = Math.floor(
    (Date.now() - new Date(email.receivedAt).getTime()) / (1000 * 60 * 60 * 24)
  )

  const emailText = [
    `From: ${email.fromName} <${email.fromEmail}>`,
    `Subject: ${email.subject}`,
    `Date: ${email.receivedAt} (${daysSince} days ago)`,
    '',
    email.bodyPreview,
  ].join('\n')

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: `You analyze emails to determine if they need a response from the recipient.

Return ONLY valid JSON (no markdown, no code fences):
{
  "needsResponse": true/false,
  "urgency": "critical|high|medium|low",
  "reason": "Brief explanation of why this needs attention",
  "questionSummary": "The specific question or request being asked, or null",
  "category": "question|request|decision|follow_up|introduction",
  "confidence": 0.0-1.0,
  "expectedResponseTime": "same_day|next_day|this_week|no_rush|null"
}

Urgency guidelines:
- critical: Direct question from a boss, client, or stakeholder about something time-sensitive; blocking someone's work; meeting request for today/tomorrow
- high: Clear question or request expecting a prompt reply; someone asking for your feedback/input; scheduling requests for "this week"; vendor/service-provider follow-ups checking on deliverables or satisfaction; someone explicitly waiting for a reply
- medium: Reasonable request or question that should be answered within a few days
- low: Nice-to-respond but not critical; introductions; optional requests

IMPLICIT URGENCY SIGNALS (upgrade urgency even without explicit deadline words):
- Meeting/call scheduling requests → at least "high" (they need your reply to book time)
- "Please let me know" / "let me know when" / "a convenient time" → at least "high" (they are waiting)
- Vendor/service-provider follow-ups (checking on work quality, deliverables, satisfaction) → at least "high" (business relationship requires responsiveness)
- Someone asking for your feedback on their work → at least "high" (they may be blocked)
- Follow-up emails referencing prior conversations or work → at least "high" (shows ongoing relationship, delayed reply is rude)
- Multiple questions in one email → boost urgency (more effort = more expectation of reply)
- "This week" / "when you have a moment" / "at your earliest convenience" → "high" (polite but expects prompt reply)
- Direct, personalized emails from real people (not templates) → at minimum "medium"

RESPONSE TIME ESTIMATION:
- Meeting scheduling, feedback requests, vendor follow-ups → "same_day" or "next_day"
- "This week" language → "this_week"
- Open-ended / "when you get a chance" → "no_rush"
- If the email has been sitting for longer than its expected response time, that makes it MORE urgent, not less

ALWAYS mark as needsResponse: false for:
- Sales/marketing/cold outreach emails
- Automated notifications (CI/CD, JIRA, GitHub, etc.)
- Newsletters, digests, promotional content
- Transactional emails (receipts, confirmations, shipping)
- Emails where the sender is clearly not expecting a personal reply
- Mass-sent emails / mailing lists
- Calendar invites with no question
- Simple FYI/informational emails with no ask`,
    messages: [{ role: 'user', content: `Analyze this email:\n\n${emailText}` }],
  })

  const content = message.content[0]
  if (content.type === 'text') {
    const jsonStr = extractJSON(content.text)
    return JSON.parse(jsonStr)
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

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) return fenceMatch[1].trim()
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) return jsonMatch[0]
  return text.trim()
}

// ============================================================
// Urgency escalation — boost urgency when response is overdue
// ============================================================

const RESPONSE_TIME_HOURS: Record<string, number> = {
  same_day: 8,
  next_day: 24,
  this_week: 96,  // ~4 business days
  no_rush: 168,   // 7 days
}

function escalateForAge(result: MissedEmailClassification, receivedAt: string): void {
  if (!result.needsResponse || !result.expectedResponseTime) return

  const expectedHours = RESPONSE_TIME_HOURS[result.expectedResponseTime]
  if (!expectedHours) return

  const hoursSinceReceived = (Date.now() - new Date(receivedAt).getTime()) / (1000 * 60 * 60)
  if (hoursSinceReceived <= expectedHours) return

  // Email has been waiting longer than expected — escalate urgency one level
  const escalation: Record<string, 'critical' | 'high' | 'medium'> = {
    low: 'medium',
    medium: 'high',
    high: 'critical',
  }

  if (result.urgency !== 'critical') {
    const escalatedUrgency = escalation[result.urgency]
    if (escalatedUrgency) {
      result.reason = `${result.reason} (overdue — expected response within ${result.expectedResponseTime.replace('_', ' ')})`
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

  // TIER 0: User preference overrides
  // Blocked senders are always filtered out
  if (isBlockedSender(email, prefs)) {
    _stats.tier1_automated++
    return null
  }

  // VIP senders skip automated/question filters — go straight to AI analysis
  const vip = isVipSender(email, prefs)

  if (!vip) {
    // TIER 1a: Is this clearly automated/sales?
    if (isLikelyAutomated(email)) {
      _stats.tier1_automated++
      return null
    }

    // TIER 1b: Does it even look like it needs a response?
    if (!likelyNeedsResponse(email)) {
      _stats.tier1_no_question++
      return null
    }
  }

  try {
    if (!vip) {
      // TIER 2: Haiku yes/no triage (skip for VIPs)
      const needsResponse = await haikuTriage(email)
      if (!needsResponse) {
        _stats.tier2_filtered++
        return null
      }
    }

    // TIER 3: Sonnet full analysis
    _stats.tier3_analyzed++
    const result = await sonnetAnalyze(email)

    // Escalate urgency if email has been waiting longer than expected response time
    escalateForAge(result, email.receivedAt)

    // VIPs always pass through if Sonnet says it needs response (lower threshold)
    const confidenceThreshold = vip ? 0.3 : 0.6
    if (result.needsResponse && result.confidence >= confidenceThreshold) {
      // Boost VIP urgency
      if (vip && result.urgency !== 'critical') {
        const boost: Record<string, 'critical' | 'high' | 'medium'> = {
          high: 'critical',
          medium: 'high',
          low: 'medium',
        }
        result.urgency = boost[result.urgency] || result.urgency
      }

      // Check urgency threshold
      if (prefs && !meetsUrgencyThreshold(result.urgency, prefs.minUrgency)) {
        return null
      }

      // Check category is enabled
      if (prefs && !prefs.enabledCategories.includes(result.category)) {
        return null
      }

      _stats.needs_response++
      result.isVip = vip
      return result
    }

    // Even if Sonnet says no, VIPs with any question-like content get surfaced
    if (vip && likelyNeedsResponse(email)) {
      _stats.needs_response++
      return {
        needsResponse: true,
        urgency: 'medium',
        reason: 'VIP contact — surfaced by default',
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
// BATCH MODE: Classify multiple emails efficiently
// Groups Tier 3 analysis into a single Sonnet call
// ============================================================
export async function classifyMissedEmailBatch(
  emails: Array<{ id: string } & EmailInput>,
  prefs?: UserEmailPreferences
): Promise<Map<string, MissedEmailClassification>> {
  const results = new Map<string, MissedEmailClassification>()

  // Tier 0 + 1: Pre-filter with user preferences
  const candidates: Array<{ id: string; vip: boolean } & EmailInput> = []
  for (const email of emails) {
    _stats.total_scanned++

    // Blocked senders always filtered
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

  // Tier 2: Haiku triage each candidate (VIPs skip this)
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

  // Tier 3: Batch Sonnet analysis
  _stats.tier3_analyzed += triaged.length

  const numberedEmails = triaged
    .map((email, i) => {
      const daysSince = Math.floor(
        (Date.now() - new Date(email.receivedAt).getTime()) / (1000 * 60 * 60 * 24)
      )
      return [
        `[${i + 1}]`,
        `From: ${email.fromName} <${email.fromEmail}>`,
        `Subject: ${email.subject}`,
        `Date: ${email.receivedAt} (${daysSince} days ago)`,
        '',
        email.bodyPreview,
      ].join('\n')
    })
    .join('\n\n---\n\n')

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You analyze batches of emails to determine which ones need a response from the recipient.

Each email is numbered [1], [2], etc.

Return ONLY valid JSON (no markdown, no code fences):
{
  "results": {
    "1": {"needsResponse": true, "urgency": "high", "reason": "...", "questionSummary": "...", "category": "question", "confidence": 0.9, "expectedResponseTime": "same_day"},
    "2": {"needsResponse": false, "urgency": "low", "reason": "Sales email", "questionSummary": null, "category": "question", "confidence": 0.95, "expectedResponseTime": null}
  }
}

Urgency guidelines:
- critical: Direct question from boss/client/stakeholder; blocking someone's work; time-sensitive decision; meeting request for today/tomorrow
- high: Clear question or request expecting a prompt reply; someone asking for your feedback/input; scheduling requests for "this week"; vendor/service-provider follow-ups checking on deliverables or satisfaction; someone explicitly waiting for a reply
- medium: Reasonable request that should be answered within a few days
- low: Nice-to-respond but not critical; introductions; optional requests

IMPLICIT URGENCY SIGNALS (upgrade urgency even without explicit deadline words):
- Meeting/call scheduling requests → at least "high" (they need your reply to book time)
- "Please let me know" / "let me know when" / "a convenient time" → at least "high" (they are waiting)
- Vendor/service-provider follow-ups → at least "high" (business relationship requires responsiveness)
- Someone asking for your feedback on their work → at least "high" (they may be blocked)
- Follow-up emails referencing prior conversations → at least "high" (delayed reply is rude)
- Multiple questions in one email → boost urgency
- "This week" / "at your earliest convenience" → "high" (polite but expects prompt reply)
- Direct, personalized emails from real people → at minimum "medium"

expectedResponseTime: "same_day" | "next_day" | "this_week" | "no_rush" | null

ALWAYS mark needsResponse: false for:
- Sales/marketing/cold outreach
- Automated notifications (CI/CD, JIRA, GitHub, etc.)
- Newsletters, digests, promotional content
- Transactional emails (receipts, confirmations)
- Mass-sent emails / mailing lists
- Simple FYI/informational with no ask`,
      messages: [
        {
          role: 'user',
          content: `Analyze these ${triaged.length} emails:\n\n${numberedEmails}`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type === 'text') {
      const jsonStr = extractJSON(content.text)
      const parsed = JSON.parse(jsonStr)
      const batchResults = parsed.results || {}

      triaged.forEach((email, i) => {
        const key = String(i + 1)
        const classification = batchResults[key]
        if (!classification) return

        // Escalate urgency if email has been waiting longer than expected
        escalateForAge(classification, email.receivedAt)

        const confidenceThreshold = email.vip ? 0.3 : 0.6
        if (classification.needsResponse && (classification.confidence || 0) >= confidenceThreshold) {
          // Boost VIP urgency
          if (email.vip && classification.urgency !== 'critical') {
            const boost: Record<string, string> = { high: 'critical', medium: 'high', low: 'medium' }
            classification.urgency = boost[classification.urgency] || classification.urgency
          }

          // Check preference filters
          if (prefs && !meetsUrgencyThreshold(classification.urgency, prefs.minUrgency)) return
          if (prefs && !prefs.enabledCategories.includes(classification.category)) return

          classification.isVip = email.vip
          _stats.needs_response++
          results.set(email.id, classification)
        } else if (email.vip && likelyNeedsResponse(email)) {
          // VIPs with questions always surface
          _stats.needs_response++
          results.set(email.id, {
            needsResponse: true,
            urgency: 'medium',
            reason: 'VIP contact — surfaced by default',
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
