// lib/ai/detect-email-threats.ts
// Two-tier email threat detection:
//   Tier 1 (free): Header analysis — SPF/DKIM/DMARC failures, reply-to mismatches, known scam patterns
//   Tier 2 (AI): Content analysis — only for emails that pass tier 1 screening or have suspicious content

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage, truncateForAI } from './token-usage'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── Types ────────────────────────────────────────────────────────────────

export interface EmailForThreatAnalysis {
  messageId: string
  fromEmail: string
  fromName: string
  subject: string
  bodyPreview: string
  bodyHtml?: string
  receivedAt: string
  toRecipients?: string
  ccRecipients?: string
  // The signed-in user's own mailbox address, used to catch self-spoofing even
  // when `toRecipients` is stored as display names rather than email addresses.
  accountEmail?: string
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
  // Fake e-signature / document-share phishing (DocuSign/Adobe Sign impersonation)
  /agreement\s+signature\s+required/i,
  /signature\s+required\s+today/i,
  /past\s+due\s+reminder/i,
  /has\s+sent\s+you\s+a\s+document/i,
  /shared\s+a\s+document\s+with\s+you/i,
  /review\s+(?:and|&(?:amp;)?)\s+sign\s+document/i,
  /e[-\s]?sign(ature)?\s+(required|requested|pending)/i,
  /required\s+your\s+signature\s+on\s+the\s+completed\s+document/i,
  /please\s+find\s+(?:and\s+complete|attached)\s+.{0,80}(agreement|document|contract|financial)/i,
  /action\s+required:.{0,120}(agreement|signature|document|contract|financial)/i,
]

// Long opaque tracking IDs appended to phishing subjects. Matches both
// "Ref~ID#: dc8e..." and the bare "ID:d4e1b9eca70cdf513ce2f196ab4d29df"
// variant. Legitimate reference IDs are typically short or use UUID dashes,
// so a run of 20+ contiguous hex characters is a strong phishing indicator.
const SUSPICIOUS_REF_ID_PATTERN = /(?:ref[~\s#:]*id[#:\s]*|\bid[:#\s]+)[a-f0-9]{20,}/i

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
  autoAlert: Tier1AutoAlert | null
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
    // Missing authentication is suspicious on its own — legitimate senders almost always publish SPF/DKIM/DMARC
    if (spfResult === 'none' && dkimResult === 'none' && dmarcResult === 'none') {
      signals.push({
        signal: 'no_auth_results',
        detail: 'Email has no SPF, DKIM, or DMARC authentication — legitimate senders publish at least one',
        weight: 'medium',
      })
    }
  }

  // ── Sender spoofing: From address matches the user's own mailbox ──
  // Real self-sent emails are rare and never ask you to sign/click/verify —
  // spoofers set the From to the victim's own address to bypass "trusted
  // contact" heuristics and evade naive filters.
  //
  // We check BOTH:
  //   (a) the user's signed-in mailbox address (most reliable — toRecipients
  //       is stored as display names by sync-outlook, so it doesn't match
  //       email-address comparisons), and
  //   (b) any to/cc recipient that happens to look like an email address
  //       (so non-Outlook paths and older cached rows still work).
  if (email.fromEmail) {
    const fromLower = email.fromEmail.toLowerCase().trim()
    const selfAddresses = new Set<string>()
    if (email.accountEmail) {
      selfAddresses.add(email.accountEmail.toLowerCase().trim())
    }
    for (const raw of [email.toRecipients, email.ccRecipients]) {
      if (!raw) continue
      for (const part of raw.split(/[;,]/)) {
        const cleaned = part.trim().toLowerCase()
        if (cleaned && cleaned.includes('@')) selfAddresses.add(cleaned)
      }
    }
    if (selfAddresses.has(fromLower)) {
      signals.push({
        signal: 'sender_spoofing_self',
        detail: `Email appears to come from your own address (${email.fromEmail}), but it isn't actually in your Sent folder — someone is impersonating you. Real self-sent emails don't ask you to sign documents, click links, or enter codes.`,
        weight: 'critical',
      })
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

  if (SUSPICIOUS_REF_ID_PATTERN.test(fullText)) {
    signals.push({
      signal: 'suspicious_ref_id',
      detail: `Subject contains a long opaque tracking ID (e.g. "Ref~ID#: ...") often used by phishing campaigns to look official`,
      weight: 'medium',
    })
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

  // ── Link analysis (when full HTML body is available) ──
  // Catches the "click this clearly-phishing link" tell the user called out:
  // raw-IP URLs, display-text-vs-href mismatches, and brand impersonation
  // where the email mentions DocuSign/Microsoft/etc. but links elsewhere.
  if (email.bodyHtml) {
    signals.push(...analyzeLinksInBody(email.bodyHtml, fullText))
  }

  // If no signals at all, skip tier 2 (email looks clean)
  const skipTier2 = signals.length === 0

  // Rule-based auto-alert for dead-certain combos — bypasses Tier 2 AI and
  // the 0.75 confidence threshold so obvious phishing always lands in the
  // dashboard even when Haiku gets cold feet.
  const autoAlert = computeTier1AutoAlert(signals)

  return { signals, spfResult, dkimResult, dmarcResult, replyToMismatch, senderMismatch, skipTier2, autoAlert }
}

// ── Link analysis ────────────────────────────────────────────────────────

const KNOWN_BRANDS: Record<string, string[]> = {
  docusign: ['docusign.com', 'docusign.net'],
  microsoft: ['microsoft.com', 'outlook.com', 'office.com', 'live.com', 'microsoftonline.com', 'sharepoint.com', 'office365.com'],
  google: ['google.com', 'gmail.com', 'googlemail.com'],
  paypal: ['paypal.com'],
  adobe: ['adobe.com', 'adobesign.com'],
  dropbox: ['dropbox.com'],
  amazon: ['amazon.com', 'amazon.co.uk'],
  apple: ['apple.com', 'icloud.com', 'me.com'],
  netflix: ['netflix.com'],
  chase: ['chase.com'],
  wellsfargo: ['wellsfargo.com'],
  bankofamerica: ['bankofamerica.com', 'bofa.com'],
}

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd',
  'buff.ly', 'adf.ly', 'bit.do', 'cutt.ly', 'rebrand.ly', 'short.link',
  'tiny.cc', 't.ly', 'shorturl.at',
])

function isOfficialDomain(hostname: string, legitDomains: string[]): boolean {
  const lower = hostname.toLowerCase()
  return legitDomains.some(d => lower === d || lower.endsWith('.' + d))
}

export function analyzeLinksInBody(bodyHtml: string, bodyContext: string): ThreatSignal[] {
  const signals: ThreatSignal[] = []
  if (!bodyHtml) return signals

  const ctx = bodyContext.toLowerCase()
  const links: { href: string; displayText: string; hostname: string }[] = []

  const anchorRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorRegex.exec(bodyHtml)) !== null) {
    const href = match[1].trim()
    if (!/^https?:\/\//i.test(href)) continue
    const displayText = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    try {
      const url = new URL(href)
      links.push({ href, displayText, hostname: url.hostname.toLowerCase() })
    } catch {
      // Malformed href, skip
    }
  }

  if (links.length === 0) return signals

  // Raw IP-address URLs are essentially always phishing
  const ipLink = links.find(l => /^\d{1,3}(\.\d{1,3}){3}$/.test(l.hostname))
  if (ipLink) {
    signals.push({
      signal: 'ip_based_url',
      detail: `Link goes to a raw IP address (${ipLink.hostname}) instead of a domain — legitimate senders never do this`,
      weight: 'critical',
    })
  }

  // URL shorteners hide the real destination
  const shortened = links.find(l => URL_SHORTENERS.has(l.hostname))
  if (shortened) {
    signals.push({
      signal: 'url_shortener',
      detail: `Link uses URL shortener "${shortened.hostname}" which hides the real destination`,
      weight: 'medium',
    })
  }

  // Brand impersonation: body mentions a well-known brand but links go off-brand
  for (const [brand, legitDomains] of Object.entries(KNOWN_BRANDS)) {
    if (!ctx.includes(brand)) continue
    const suspicious = links.find(l => {
      if (isOfficialDomain(l.hostname, legitDomains)) return false
      const lowerDisplay = l.displayText.toLowerCase()
      const lowerHost = l.hostname.toLowerCase()
      return lowerDisplay.includes(brand) || lowerHost.includes(brand)
    })
    if (suspicious) {
      signals.push({
        signal: 'brand_impersonation_link',
        detail: `Email references ${brand} but a link goes to "${suspicious.hostname}" — not an official ${brand} domain`,
        weight: 'critical',
      })
      break
    }
  }

  // Display-text-vs-href mismatch (classic phishing tactic).
  // Matches domains like "docusign.com" or "app.docusign.com" in display text
  // and compares against the actual href hostname.
  for (const link of links) {
    const displayMatches = link.displayText.match(
      /\b([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi
    )
    if (!displayMatches) continue
    for (const candidate of displayMatches) {
      const displayDomain = candidate.toLowerCase()
      // Skip things that aren't really domains (e.g. "readme.md" in copy text)
      if (/\.(md|txt|pdf|docx?|xlsx?|png|jpe?g|gif)$/i.test(displayDomain)) continue
      const actual = link.hostname
      if (displayDomain === actual) continue
      if (actual.endsWith('.' + displayDomain)) continue
      if (displayDomain.endsWith('.' + actual)) continue
      signals.push({
        signal: 'link_domain_mismatch',
        detail: `Link shows "${displayDomain}" in its text but actually goes to "${actual}"`,
        weight: 'critical',
      })
      return signals
    }
  }

  return signals
}

// ── Rule-based auto-alert ────────────────────────────────────────────────
// For combos so dead-certain we shouldn't depend on the AI returning
// >= 0.75 confidence. Returns a pre-built assessment ready to persist.

export interface Tier1AutoAlert {
  level: 'critical' | 'high'
  type: ThreatAssessment['threatType']
  explanation: string
  recommendedActions: string[]
  doNotActions: string[]
  confidence: number
}

function computeTier1AutoAlert(signals: ThreatSignal[]): Tier1AutoAlert | null {
  const names = new Set(signals.map(s => s.signal))

  const selfSpoof = names.has('sender_spoofing_self')
  const linkMismatch = names.has('link_domain_mismatch')
  const brandImpersonation = names.has('brand_impersonation_link')
  const ipUrl = names.has('ip_based_url')
  const dmarcFail = names.has('dmarc_fail')
  const credentialRequest = names.has('credential_request')
  const scamPattern = names.has('scam_pattern')
  const suspiciousRefId = names.has('suspicious_ref_id')

  const baseDoNot = [
    'Do not click any links in this email',
    'Do not open any attachments',
    'Do not reply with personal or financial information',
  ]
  const baseRecommended = [
    'Report the email as phishing in Outlook (right-click → Report)',
    'Delete the email after reporting',
    'If it references a real person or service, verify through a channel you already trust (a known phone number, in person, or a bookmarked site)',
  ]

  // 1. Self-spoof: From claims to be the user's own mailbox. Real self-sent
  //    emails never ask you to sign/click/enter codes.
  if (selfSpoof) {
    return {
      level: 'critical',
      type: 'spoofing',
      explanation:
        "This email claims to come from your own address, but you didn't actually send it — someone is impersonating you. This is a classic sender-spoofing attack used to trick you into clicking a link or signing a fake document.",
      doNotActions: baseDoNot,
      recommendedActions: baseRecommended,
      confidence: 0.97,
    }
  }

  // 2. Link where the displayed domain doesn't match the real destination.
  if (linkMismatch || brandImpersonation) {
    return {
      level: 'critical',
      type: 'phishing',
      explanation:
        "A link in this email doesn't go where it claims to. The displayed text and the actual URL point to different domains — a classic phishing tactic to disguise a malicious destination.",
      doNotActions: baseDoNot,
      recommendedActions: [
        'Report as phishing and delete',
        'If you expected the linked service, navigate to it directly via a browser bookmark — never through this email',
        ...baseRecommended.slice(2),
      ],
      confidence: 0.95,
    }
  }

  // 3. Raw IP address URL — legitimate businesses never send these.
  if (ipUrl) {
    return {
      level: 'critical',
      type: 'malware_link',
      explanation:
        'This email contains a link to a raw IP address instead of a real domain. Legitimate businesses never send links this way — it is almost certainly malicious.',
      doNotActions: baseDoNot,
      recommendedActions: baseRecommended,
      confidence: 0.95,
    }
  }

  // 4. DMARC fail + any phishing indicator = high-confidence spoof.
  if (dmarcFail && (credentialRequest || scamPattern || suspiciousRefId)) {
    return {
      level: 'critical',
      type: 'phishing',
      explanation:
        "This email failed DMARC authentication, meaning the sender's domain explicitly says it did not authorize this message. Combined with the phishing language we detected, this is almost certainly a spoofed phishing attempt.",
      doNotActions: baseDoNot,
      recommendedActions: baseRecommended,
      confidence: 0.92,
    }
  }

  return null
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
    `\nBody Preview:\n${truncateForAI(email.bodyPreview)}`,
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

// ── Tier 2 batch mode — analyzes up to 10 emails per API call ─────────────

const BATCH_THREAT_ANALYSIS_TOOL: Anthropic.Messages.Tool = {
  name: 'analyze_threats_batch',
  description: 'Analyze multiple numbered emails for phishing, scam, or social engineering threats.',
  input_schema: {
    type: 'object' as const,
    properties: {
      results: {
        type: 'object',
        description: 'Map of email number ("1", "2", ...) to threat assessment.',
        additionalProperties: {
          type: 'object',
          properties: {
            is_threat: { type: 'boolean' },
            threat_level: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
            threat_type: { type: 'string', enum: ['phishing', 'spoofing', 'bec', 'malware_link', 'payment_fraud', 'impersonation'] },
            confidence: { type: 'number' },
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
            },
            explanation: { type: 'string' },
            recommended_actions: { type: 'array', items: { type: 'string' } },
            do_not_actions: { type: 'array', items: { type: 'string' } },
          },
          required: ['is_threat', 'threat_level', 'threat_type', 'confidence', 'content_signals', 'explanation', 'recommended_actions', 'do_not_actions'],
        },
      },
    },
    required: ['results'],
  },
}

// Each email in a batch shares the 4096-token output budget. At 10 emails
// per batch the per-email budget (~410 tokens) was too tight — Haiku either
// truncated mid-assessment or returned low-confidence verdicts for
// complex phishing that the single-email path (tier2Analysis, 800 tokens)
// correctly flagged. Five emails per batch gives each email ~800 tokens of
// output headroom, matching the single-email path.
const BATCH_THREAT_CHUNK_SIZE = 5

// Emails with this many Tier 1 signals get routed to single-email analysis
// instead of the batched path — they're the ones most likely to be real
// threats and deserve the richer per-email token budget / attention.
const HIGH_SIGNAL_SINGLE_SHOT_THRESHOLD = 2

export interface EmailForBatchThreatAnalysis {
  email: EmailForThreatAnalysis
  tier1Signals: ThreatSignal[]
}

/**
 * Batched Tier-2 analysis. Accepts up to N emails per API call (chunked
 * internally). Returns a Map keyed by messageId.
 *
 * Routes high-signal emails (>= 2 Tier 1 signals) to single-email
 * tier2Analysis for the richer token budget and attention; batches the rest
 * for cost efficiency. Also retries single-shot when the batch silently
 * drops an email (truncated output, no tool_use block for that index).
 *
 * Use this for cron/scan paths where many emails need content analysis.
 * Single-email sync paths (e.g. diagnose route) should continue using
 * tier2Analysis directly for minimum latency.
 */
export async function tier2AnalysisBatch(
  inputs: EmailForBatchThreatAnalysis[]
): Promise<Map<string, ThreatAssessment>> {
  const results = new Map<string, ThreatAssessment>()
  if (inputs.length === 0) return results

  // Route high-signal emails to single-shot for reliable rich output.
  const highSignal: EmailForBatchThreatAnalysis[] = []
  const batchable: EmailForBatchThreatAnalysis[] = []
  for (const input of inputs) {
    if (input.tier1Signals.length >= HIGH_SIGNAL_SINGLE_SHOT_THRESHOLD) {
      highSignal.push(input)
    } else {
      batchable.push(input)
    }
  }

  for (const { email, tier1Signals } of highSignal) {
    const assessment = await tier2Analysis(email, tier1Signals)
    if (assessment) results.set(email.messageId, assessment)
  }

  for (let start = 0; start < batchable.length; start += BATCH_THREAT_CHUNK_SIZE) {
    const chunk = batchable.slice(start, start + BATCH_THREAT_CHUNK_SIZE)

    const numbered = chunk.map(({ email, tier1Signals }, i) => {
      const tier1Context = tier1Signals.length > 0
        ? `\nHeader/pattern signals:\n${tier1Signals.map(s => `- ${s.signal}: ${s.detail} (${s.weight})`).join('\n')}`
        : ''
      return [
        `[${i + 1}]`,
        `From: ${email.fromName} <${email.fromEmail}>`,
        email.toRecipients ? `To: ${email.toRecipients}` : '',
        `Subject: ${email.subject}`,
        `Date: ${email.receivedAt}`,
        email.hasAttachments ? 'Has Attachments: Yes' : '',
        `\nBody Preview:\n${truncateForAI(email.bodyPreview, 1500)}`,
        tier1Context,
      ].filter(Boolean).join('\n')
    }).join('\n\n---\n\n')

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any],
        tools: [BATCH_THREAT_ANALYSIS_TOOL],
        tool_choice: { type: 'tool', name: 'analyze_threats_batch' },
        messages: [{ role: 'user', content: `Analyze these ${chunk.length} emails:\n\n${numbered}` }],
      })

      recordTokenUsage(response.usage)

      const toolBlock = response.content.find(b => b.type === 'tool_use')
      if (!toolBlock || toolBlock.type !== 'tool_use') continue

      const batchResults = (toolBlock.input as { results?: Record<string, {
        is_threat: boolean
        threat_level: string
        threat_type: string
        confidence: number
        content_signals: ThreatSignal[]
        explanation: string
        recommended_actions: string[]
        do_not_actions: string[]
      }> }).results || {}

      const droppedByBatch: EmailForBatchThreatAnalysis[] = []
      chunk.forEach(({ email, tier1Signals }, i) => {
        const r = batchResults[String(i + 1)]
        if (!r) {
          // Batch output truncated or Haiku skipped this index. Retry
          // single-shot so we don't silently lose an alert.
          droppedByBatch.push({ email, tier1Signals })
          return
        }

        results.set(email.messageId, {
          isThreat: r.is_threat,
          threatLevel: r.threat_level as ThreatAssessment['threatLevel'],
          threatType: r.threat_type as ThreatAssessment['threatType'],
          confidence: r.confidence,
          signals: [...tier1Signals, ...(r.content_signals || [])],
          explanation: r.explanation,
          recommendedActions: r.recommended_actions || [],
          doNotActions: r.do_not_actions || [],
          replyToMismatch: tier1Signals.some(s => s.signal.toLowerCase().includes('reply-to')),
          senderMismatch: tier1Signals.some(s => s.signal.toLowerCase().includes('sender')),
        })
      })

      if (droppedByBatch.length > 0) {
        console.warn(
          `[detect-email-threats] Batch dropped ${droppedByBatch.length}/${chunk.length} emails; retrying single-shot`
        )
        for (const { email, tier1Signals } of droppedByBatch) {
          const assessment = await tier2Analysis(email, tier1Signals)
          if (assessment) results.set(email.messageId, assessment)
        }
      }
    } catch (error) {
      console.error('[detect-email-threats] Batch AI analysis failed:', (error as Error).message)
      // Fall back to single-shot so the whole chunk isn't lost on a single
      // transient API failure (network blip, rate-limit, 5xx).
      for (const { email, tier1Signals } of chunk) {
        const assessment = await tier2Analysis(email, tier1Signals)
        if (assessment) results.set(email.messageId, assessment)
      }
    }
  }

  return results
}
