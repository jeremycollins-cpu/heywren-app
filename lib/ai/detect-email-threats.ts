// lib/ai/detect-email-threats.ts
// Two-tier email threat detection:
//   Tier 1 (free): Header analysis — SPF/DKIM/DMARC failures, reply-to mismatches, known scam patterns
//   Tier 2 (AI): Content analysis — only for emails that pass tier 1 screening or have suspicious content

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Types ────────────────────────────────────────────────────────────────

export interface EmailForThreatAnalysis {
  messageId: string
  fromEmail: string
  fromName: string
  subject: string
  bodyPreview: string
  receivedAt: string
  toRecipients?: string
  ccRecipients?: string
  // Header data (fetched separately from Graph API)
  headers?: Array<{ name: string; value: string }>
  replyTo?: string
  sender?: string
  hasAttachments?: boolean
}

export interface ThreatSignal {
  signal: string
  detail: string
  weight: 'critical' | 'high' | 'medium' | 'low'
}

export interface ThreatAssessment {
  isThreat: boolean
  threatLevel: 'critical' | 'high' | 'medium' | 'low'
  threatType: 'phishing' | 'spoofing' | 'bec' | 'malware_link' | 'payment_fraud' | 'impersonation'
  confidence: number
  signals: ThreatSignal[]
  explanation: string
  recommendedActions: string[]
  doNotActions: string[]
  spfResult?: string
  dkimResult?: string
  dmarcResult?: string
  replyToMismatch: boolean
  senderMismatch: boolean
}

// ── Tier 1: Header & Pattern Analysis (free, no API call) ────────────────

const KNOWN_SCAM_PATTERNS = [
  /urgent.*action.*required/i,
  /verify.*your.*account/i,
  /suspended.*account/i,
  /click.*here.*immediately/i,
  /your.*password.*expired/i,
  /confirm.*your.*identity/i,
  /unusual.*sign.?in.*activity/i,
  /wire.*transfer/i,
  /update.*payment.*method/i,
  /won.*lottery|prize.*claim/i,
  /bitcoin.*investment/i,
  /inherit.*million/i,
]

const PRESSURE_PATTERNS = [
  /act\s+(now|immediately|fast|quickly)/i,
  /within\s+\d+\s+hours?/i,
  /deadline.*today/i,
  /failure\s+to\s+(respond|act|verify)/i,
  /account\s+will\s+be\s+(closed|suspended|terminated)/i,
  /legal\s+action/i,
]

const CREDENTIAL_REQUEST_PATTERNS = [
  /enter.*password/i,
  /verify.*credentials/i,
  /sign.*in.*to.*confirm/i,
  /update.*your.*(ssn|social|bank|card|account)/i,
  /send.*gift.*card/i,
]

function extractHeaderValue(headers: Array<{ name: string; value: string }>, headerName: string): string | null {
  const h = headers.find(h => h.name.toLowerCase() === headerName.toLowerCase())
  return h?.value || null
}

function parseAuthResult(headerValue: string | null, mechanism: string): string {
  if (!headerValue) return 'none'
  const regex = new RegExp(`${mechanism}=([a-z]+)`, 'i')
  const match = headerValue.match(regex)
  return match ? match[1].toLowerCase() : 'none'
}

export function tier1Analysis(email: EmailForThreatAnalysis): {
  signals: ThreatSignal[]
  spfResult: string
  dkimResult: string
  dmarcResult: string
  replyToMismatch: boolean
  senderMismatch: boolean
  skipTier2: boolean
} {
  const signals: ThreatSignal[] = []
  let spfResult = 'none'
  let dkimResult = 'none'
  let dmarcResult = 'none'
  let replyToMismatch = false
  let senderMismatch = false

  // ── Header checks ──
  if (email.headers && email.headers.length > 0) {
    const authResults = extractHeaderValue(email.headers, 'Authentication-Results')
    spfResult = parseAuthResult(authResults, 'spf')
    dkimResult = parseAuthResult(authResults, 'dkim')
    dmarcResult = parseAuthResult(authResults, 'dmarc')

    if (spfResult === 'fail') {
      signals.push({ signal: 'spf_fail', detail: 'SPF authentication failed — sender may not be authorized to send from this domain', weight: 'high' })
    }
    if (dkimResult === 'fail') {
      signals.push({ signal: 'dkim_fail', detail: 'DKIM signature failed — email may have been altered in transit', weight: 'high' })
    }
    if (dmarcResult === 'fail') {
      signals.push({ signal: 'dmarc_fail', detail: 'DMARC policy failed — domain owner does not authorize this sender', weight: 'critical' })
    }
  }

  // ── Reply-to mismatch ──
  if (email.replyTo && email.fromEmail) {
    const replyToDomain = email.replyTo.split('@')[1]?.toLowerCase()
    const fromDomain = email.fromEmail.split('@')[1]?.toLowerCase()
    if (replyToDomain && fromDomain && replyToDomain !== fromDomain) {
      replyToMismatch = true
      signals.push({
        signal: 'reply_to_mismatch',
        detail: `Reply-to address (${email.replyTo}) goes to a different domain than the sender (${email.fromEmail})`,
        weight: 'high',
      })
    }
  }

  // ── Sender vs From mismatch ──
  if (email.sender && email.fromEmail) {
    const senderLower = email.sender.toLowerCase()
    const fromLower = email.fromEmail.toLowerCase()
    if (senderLower !== fromLower) {
      const senderDomain = senderLower.split('@')[1]
      const fromDomain = fromLower.split('@')[1]
      if (senderDomain !== fromDomain) {
        senderMismatch = true
        signals.push({
          signal: 'sender_mismatch',
          detail: `Technical sender (${email.sender}) differs from displayed sender (${email.fromEmail})`,
          weight: 'high',
        })
      }
    }
  }

  // ── Content pattern checks ──
  const fullText = `${email.subject} ${email.bodyPreview}`

  for (const pattern of KNOWN_SCAM_PATTERNS) {
    if (pattern.test(fullText)) {
      signals.push({ signal: 'scam_pattern', detail: `Matches known scam pattern: "${fullText.match(pattern)?.[0]}"`, weight: 'high' })
      break // One match is enough
    }
  }

  let pressureCount = 0
  for (const pattern of PRESSURE_PATTERNS) {
    if (pattern.test(fullText)) pressureCount++
  }
  if (pressureCount >= 2) {
    signals.push({ signal: 'pressure_language', detail: `Contains ${pressureCount} pressure/urgency phrases designed to rush your decision`, weight: 'medium' })
  }

  for (const pattern of CREDENTIAL_REQUEST_PATTERNS) {
    if (pattern.test(fullText)) {
      signals.push({ signal: 'credential_request', detail: `Appears to request sensitive information: "${fullText.match(pattern)?.[0]}"`, weight: 'critical' })
      break
    }
  }

  // If no signals at all, skip tier 2 (email looks clean)
  const skipTier2 = signals.length === 0

  return { signals, spfResult, dkimResult, dmarcResult, replyToMismatch, senderMismatch, skipTier2 }
}

// ── Tier 2: AI Content Analysis ──────────────────────────────────────────

const THREAT_ANALYSIS_TOOL: Anthropic.Messages.Tool = {
  name: 'analyze_threat',
  description: 'Analyze an email for phishing, scam, or social engineering threats.',
  input_schema: {
    type: 'object' as const,
    properties: {
      is_threat: {
        type: 'boolean',
        description: 'Whether this email is likely a threat. Only true if confidence >= 0.75.',
      },
      threat_level: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Severity if is_threat is true. critical = imminent risk, high = likely scam, medium = suspicious, low = slightly unusual.',
      },
      threat_type: {
        type: 'string',
        enum: ['phishing', 'spoofing', 'bec', 'malware_link', 'payment_fraud', 'impersonation'],
      },
      confidence: {
        type: 'number',
        description: 'Confidence 0.0-1.0 that this is a genuine threat. Be conservative — false positives destroy trust.',
      },
      content_signals: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            signal: { type: 'string' },
            detail: { type: 'string' },
            weight: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          },
          required: ['signal', 'detail', 'weight'],
        },
        description: 'Content-based threat signals found in the email.',
      },
      explanation: {
        type: 'string',
        description: 'Clear, non-technical explanation for the user. 2-3 sentences. Explain WHY this is suspicious in plain English.',
      },
      recommended_actions: {
        type: 'array',
        items: { type: 'string' },
        description: 'What the user SHOULD do. Clear, specific steps.',
      },
      do_not_actions: {
        type: 'array',
        items: { type: 'string' },
        description: 'What the user should NOT do. Critical safety warnings.',
      },
    },
    required: ['is_threat', 'threat_level', 'threat_type', 'confidence', 'content_signals', 'explanation', 'recommended_actions', 'do_not_actions'],
  },
}

const SYSTEM_PROMPT = `You are an email security analyst. Analyze emails for phishing, scam, spoofing, and social engineering threats.

CRITICAL RULES:
- Be CONSERVATIVE. False positives destroy user trust. Only flag emails as threats when you are genuinely confident (>= 0.75).
- Legitimate marketing emails, newsletters, and automated notifications are NOT threats, even if they have urgent language.
- Emails from known services (Google, Microsoft, Slack, etc.) with standard notification language are NOT threats.
- Business emails with normal requests from colleagues are NOT threats, even if they mention payments or deadlines.

WHAT IS A THREAT:
- Credential phishing: fake login pages, "verify your account" from spoofed senders
- Payment fraud: fake invoices, "urgent wire transfer" from spoofed executives
- Impersonation: pretending to be a known contact but from a different email address
- Malware: suspicious attachment requests, "download this file" from unknown senders
- Business Email Compromise: fake CEO/CFO requests for money or sensitive data

EXPLANATION GUIDELINES:
- Write for a non-technical person. No jargon.
- Be specific: "This email claims to be from your bank but was sent from a different domain" not "Sender authentication failed"
- Reference actual content from the email to show what's suspicious
- Include what legitimate version of this email would look like

RECOMMENDED ACTIONS should be specific:
- "Delete this email without clicking any links"
- "Contact [person/company] directly using a phone number you already have"
- "Forward to your IT security team at [their typical address]"
- "Report as phishing in Outlook (right-click → Report)"

DO NOT ACTIONS should be clear warnings:
- "Do not click any links in this email"
- "Do not open any attachments"
- "Do not reply with personal information"
- "Do not call any phone numbers listed in this email"`

export async function tier2Analysis(
  email: EmailForThreatAnalysis,
  tier1Signals: ThreatSignal[]
): Promise<ThreatAssessment | null> {
  const tier1Context = tier1Signals.length > 0
    ? `\n\nHEADER SIGNALS ALREADY DETECTED:\n${tier1Signals.map(s => `- ${s.signal}: ${s.detail} (${s.weight})`).join('\n')}`
    : ''

  const emailText = [
    `From: ${email.fromName} <${email.fromEmail}>`,
    email.toRecipients ? `To: ${email.toRecipients}` : '',
    `Subject: ${email.subject}`,
    `Date: ${email.receivedAt}`,
    email.hasAttachments ? 'Has Attachments: Yes' : '',
    `\nBody Preview:\n${email.bodyPreview}`,
    tier1Context,
  ].filter(Boolean).join('\n')

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
      tools: [THREAT_ANALYSIS_TOOL],
      tool_choice: { type: 'tool', name: 'analyze_threat' },
      messages: [{ role: 'user', content: emailText }],
    })

    recordTokenUsage(response.usage)

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') return null

    const result = toolBlock.input as {
      is_threat: boolean
      threat_level: string
      threat_type: string
      confidence: number
      content_signals: ThreatSignal[]
      explanation: string
      recommended_actions: string[]
      do_not_actions: string[]
    }

    // Combine tier 1 and tier 2 signals
    const allSignals = [...tier1Signals, ...(result.content_signals || [])]

    return {
      isThreat: result.is_threat,
      threatLevel: result.threat_level as ThreatAssessment['threatLevel'],
      threatType: result.threat_type as ThreatAssessment['threatType'],
      confidence: result.confidence,
      signals: allSignals,
      explanation: result.explanation,
      recommendedActions: result.recommended_actions || [],
      doNotActions: result.do_not_actions || [],
      replyToMismatch: tier1Signals.some(s => s.signal.toLowerCase().includes('reply-to')),
      senderMismatch: tier1Signals.some(s => s.signal.toLowerCase().includes('sender')),
    }
  } catch (error) {
    console.error('[detect-email-threats] AI analysis failed:', (error as Error).message)
    return null
  }
}
