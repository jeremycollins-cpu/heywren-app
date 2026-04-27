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
  // A real self-spoofing attack FAILS DMARC — attackers can't pass DMARC on
  // a domain they don't control. When the user's own email software sends
  // on their behalf, DMARC aligns and passes.
  //
  // So: only fire this signal when From looks like the user's mailbox AND
  // DMARC didn't explicitly pass. If DMARC passed, the message really came
  // from the user's own domain and is legitimate self-sent mail (typically
  // a reply in a conversation thread that ended up in the user's scanned
  // cache via some sync path), not a spoof.
  //
  // We check BOTH (a) the user's signed-in mailbox address and (b) any
  // to/cc recipient that happens to be an email address, so self-spoof
  // catches both the common Graph-account case and the older to-recipients
  // case where recipients were cached as addresses.
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
    // dmarcResult is populated by the header-checks block above. An explicit
    // 'pass' value means the sending domain's own DMARC policy authorized
    // this message. Anything else (fail, softfail, none, missing) keeps the
    // signal in play because we can't rule out a spoof.
    if (selfAddresses.has(fromLower) && dmarcResult !== 'pass') {
      signals.push({
        signal: 'sender_spoofing_self',
        detail: `Email appears to come from your own address (${email.fromEmail}), but DMARC didn't confirm it was actually sent by your domain — someone may be impersonating you. Real self-sent emails pass DMARC.`,
        weight: 'critical',
      })
    }
  }

  // ── Reply-to mismatch ──
  // Skip when the two domains are both part of the same corporate family
  // (e.g. Optum/UnitedHealthcare, LinkedIn/Microsoft) — that's legitimate
  // parent-company infrastructure, not a phishing redirect.
  if (email.replyTo && email.fromEmail) {
    const replyToDomain = email.replyTo.split('@')[1]?.toLowerCase()
    const fromDomain = email.fromEmail.split('@')[1]?.toLowerCase()
    if (
      replyToDomain &&
      fromDomain &&
      replyToDomain !== fromDomain &&
      !areSameCorporateFamily(replyToDomain, fromDomain)
    ) {
      replyToMismatch = true
      signals.push({
        signal: 'reply_to_mismatch',
        detail: `Reply-to address (${email.replyTo}) goes to a different domain than the sender (${email.fromEmail})`,
        weight: 'high',
      })
    }
  }

  // ── Sender vs From mismatch ──
  // Same corporate-family exemption applies: a sending-infrastructure domain
  // within the same corporate family (e.g. mail.microsoft.com vs outlook.com)
  // is legitimate.
  if (email.sender && email.fromEmail) {
    const senderLower = email.sender.toLowerCase()
    const fromLower = email.fromEmail.toLowerCase()
    if (senderLower !== fromLower) {
      const senderDomain = senderLower.split('@')[1]
      const fromDomain = fromLower.split('@')[1]
      if (
        senderDomain &&
        fromDomain &&
        senderDomain !== fromDomain &&
        !areSameCorporateFamily(senderDomain, fromDomain)
      ) {
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
    signals.push(...analyzeLinksInBody({
      bodyHtml: email.bodyHtml,
      bodyContext: fullText,
      fromEmail: email.fromEmail,
      fromName: email.fromName,
    }))
  }

  // If no signals at all, skip tier 2 (email looks clean)
  const skipTier2 = signals.length === 0

  // Rule-based auto-alert for dead-certain combos — bypasses Tier 2 AI and
  // the 0.75 confidence threshold so obvious phishing always lands in the
  // dashboard even when Haiku gets cold feet.
  const autoAlert = computeTier1AutoAlert(signals)

  return { signals, spfResult, dkimResult, dmarcResult, replyToMismatch, senderMismatch, skipTier2, autoAlert }
}

// ── Corporate families ───────────────────────────────────────────────────
// Groups of domains that belong to the same parent company. A mismatch
// between two domains in the same group (e.g. Optum replying via UHC, or
// a LinkedIn link inside a Microsoft email) is legitimate corporate
// infrastructure, not a phishing tell. Suppresses reply_to_mismatch,
// sender_mismatch, and link_domain_mismatch in those cases.
//
// Keep this list conservative — only include well-known parent/subsidiary
// and major-acquisition relationships. Don't add a pair unless you're sure
// it's really the same corporate owner.
const CORPORATE_FAMILIES: Record<string, string[]> = {
  unitedhealth: [
    // Optum is owned by UnitedHealth Group. UHC is also UHG. Optum Bank and
    // OptumRx are Optum divisions.
    'optum.com', 'optumbank.com', 'optumrx.com', 'optumhealth.com',
    'optuminsight.com', 'optumcare.com',
    'uhc.com', 'uhg.com', 'unitedhealthcare.com', 'unitedhealthgroup.com',
  ],
  microsoft: [
    'microsoft.com', 'outlook.com', 'office.com', 'office365.com',
    'live.com', 'hotmail.com', 'microsoftonline.com', 'sharepoint.com',
    'msn.com', 'xbox.com',
    'linkedin.com', 'licdn.com',               // LinkedIn — Microsoft
    'github.com', 'githubusercontent.com',     // GitHub — Microsoft
    'skype.com',                                // Skype — Microsoft
  ],
  google: [
    'google.com', 'gmail.com', 'googlemail.com', 'googleusercontent.com',
    'youtube.com', 'youtu.be',
    'android.com', 'chrome.com',
    'nest.com', 'fitbit.com',
  ],
  meta: [
    'facebook.com', 'fb.com', 'fbcdn.net',
    'instagram.com', 'cdninstagram.com',
    'whatsapp.com', 'wa.me',
    'meta.com',
  ],
  amazon: [
    'amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de',
    'aws.amazon.com', 'amazonaws.com',
    'audible.com',
    'twitch.tv',
    'wholefoodsmarket.com',
    'ring.com',
  ],
  apple: [
    'apple.com', 'icloud.com', 'me.com', 'mac.com',
    'beats.co', 'beatsbydre.com',
  ],
  salesforce: [
    'salesforce.com', 'force.com', 'salesforceliveagent.com',
    'slack.com', 'slackhq.com', 'slack-edge.com',     // Slack — Salesforce
    'tableau.com',                                      // Tableau — Salesforce
    'mulesoft.com',                                     // MuleSoft — Salesforce
    'pardot.com',                                       // Pardot/Marketing Cloud — Salesforce
  ],
  adobe: [
    'adobe.com', 'adobesign.com', 'adobelogin.com',
    'marketo.com', 'mktoweb.com', 'marketo.net',       // Marketo — Adobe
  ],
  alphabet: [
    // Alphabet holding includes Google (covered separately) plus Waymo, etc.
    'waymo.com', 'deepmind.com', 'verily.com',
  ],
  paypal: [
    'paypal.com', 'paypalobjects.com',
    'venmo.com',                                        // Venmo — PayPal
    'braintreepayments.com',                            // Braintree — PayPal
  ],
  stripe: [
    'stripe.com', 'stripe.network',
  ],
}

/** Return the corporate-family identifier for a hostname, or null if unknown. */
function getCorporateFamily(hostname: string): string | null {
  const h = hostname.toLowerCase()
  for (const [family, domains] of Object.entries(CORPORATE_FAMILIES)) {
    for (const d of domains) {
      if (h === d || h.endsWith('.' + d)) return family
    }
  }
  return null
}

/** True when both hostnames belong to the same corporate family. */
function areSameCorporateFamily(a: string, b: string): boolean {
  const familyA = getCorporateFamily(a)
  if (!familyA) return false
  return familyA === getCorporateFamily(b)
}

// ── Registrable-domain (eTLD+1) helpers ──────────────────────────────────
//
// Sized for the false-positive class where a marketing/notification email is
// sent from one subdomain (e.g. team.wrike.com) but its click-tracking link
// uses a sibling subdomain (e.g. engage.wrike.com). Both share the same
// registrable domain (wrike.com), so the link should NOT count as a
// cross-domain redirect. A literal suffix check on the from-address domain
// can't see that, so we extract eTLD+1 on both sides and compare.
//
// We don't ship the full Public Suffix List — keep this small and obvious.
// The set covers the multi-label public suffixes you actually see in
// corporate mail (mostly 2-letter ccTLD pairings). When the second-to-last
// label is in this set, the registrable domain is the last THREE labels;
// otherwise it's the last TWO.
const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'ltd.uk', 'plc.uk',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'co.kr', 'or.kr', 'ne.kr', 'go.kr',
  'com.mx', 'gob.mx', 'org.mx',
  'co.za', 'org.za', 'ac.za', 'gov.za',
  'com.sg', 'edu.sg', 'gov.sg',
  'com.hk', 'org.hk', 'gov.hk',
])

/** Return the registrable domain (eTLD+1) for a hostname. */
function getRegistrableDomain(hostname: string): string {
  const h = hostname.toLowerCase().replace(/^\.+|\.+$/g, '')
  const parts = h.split('.').filter(Boolean)
  if (parts.length <= 2) return parts.join('.')
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.')
  }
  return lastTwo
}

/** True when both hostnames share the same registrable domain. */
function areSameRegistrableDomain(a: string, b: string): boolean {
  if (!a || !b) return false
  const ra = getRegistrableDomain(a)
  const rb = getRegistrableDomain(b)
  return !!ra && ra === rb
}

// Final-label allowlist for treating a substring inside link display text as
// "really a domain". Without this gate, the display-vs-href heuristic
// false-positives any time anchor text contains a dotted name like
// "jeremy.collins" — the regex matches it because `.collins` is ≥ 2 letters,
// but `.collins` isn't a public TLD. Username-style anchor text shouldn't
// drive a phishing alert.
//
// Covers the gTLDs and ccTLDs that actually show up in legitimate corporate
// mail. Anything not on this list is rejected before we compare domains.
const KNOWN_TLDS = new Set([
  // Generic / legacy gTLDs
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'arpa',
  // Common new gTLDs
  'io', 'ai', 'co', 'app', 'dev', 'tech', 'cloud', 'online', 'site', 'web',
  'info', 'biz', 'name', 'pro', 'mobi', 'xyz', 'me', 'tv', 'cc', 'fm',
  'email', 'shop', 'store', 'blog', 'news', 'media', 'design', 'agency',
  'company', 'inc', 'llc', 'global', 'world', 'group', 'team', 'works',
  'software', 'systems', 'network', 'digital', 'studio', 'today', 'live',
  'link', 'page', 'click', 'one', 'zone',
  // Common 2-letter ccTLDs (not exhaustive — covers what we see in inbound mail)
  'us', 'uk', 'ca', 'au', 'nz', 'de', 'fr', 'es', 'it', 'nl', 'be', 'ch',
  'at', 'se', 'no', 'dk', 'fi', 'is', 'ie', 'pt', 'gr', 'pl', 'cz', 'sk',
  'hu', 'ro', 'bg', 'hr', 'si', 'lt', 'lv', 'ee', 'lu', 'mt', 'cy',
  'jp', 'cn', 'kr', 'hk', 'tw', 'sg', 'in', 'id', 'my', 'th', 'vn', 'ph',
  'ru', 'ua', 'tr', 'il', 'sa', 'ae', 'eg', 'za', 'ng', 'ke',
  'br', 'mx', 'ar', 'cl', 'co', 'pe', 've',
  'eu', 'asia', 'ly',
])

function hasKnownTld(domainLike: string): boolean {
  const lastDot = domainLike.lastIndexOf('.')
  if (lastDot < 0) return false
  const tld = domainLike.slice(lastDot + 1).toLowerCase()
  return KNOWN_TLDS.has(tld)
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

// Email-security-gateway link rewriters. Corporate mail providers (Microsoft
// Defender, Proofpoint, Mimecast, Barracuda, Google) replace every <a href>
// in incoming mail with a scanning-proxy URL that encodes the original.
//
// Without unwrapping these, the display-vs-href mismatch check flags every
// legitimate email as phishing because the display text is the original
// domain ("pendo.io") while the href is always the gateway host
// (*.safelinks.protection.outlook.com). This is the #1 source of false
// positives once Defender/Safe Links is enabled.
interface LinkWrapper {
  hostPattern: RegExp
  extract: (url: URL) => string | null
}

const LINK_WRAPPERS: LinkWrapper[] = [
  {
    // Microsoft Defender Safe Links — the rewriter every Outlook 365 tenant has on by default
    hostPattern: /(^|\.)safelinks\.protection\.outlook\.com$/i,
    extract: (url) => {
      const target = url.searchParams.get('url')
      if (!target) return null
      try { return decodeURIComponent(target) } catch { return null }
    },
  },
  {
    // Proofpoint URL Defense v2: /v2/url?u=ENCODED
    hostPattern: /(^|\.)urldefense\.proofpoint\.com$/i,
    extract: (url) => {
      const target = url.searchParams.get('u')
      if (!target) return null
      try {
        return decodeURIComponent(target.replace(/_/g, '/').replace(/-/g, '%'))
      } catch { return null }
    },
  },
  {
    // Proofpoint URL Defense v3: urldefense.com/v3/__ORIGINAL__;TOKEN!...
    hostPattern: /(^|\.)urldefense\.com$/i,
    extract: (url) => {
      const m = url.pathname.match(/\/v3\/__(.+?)__;/)
      return m ? m[1] : null
    },
  },
  {
    // Google URL redirector
    hostPattern: /^(www\.)?google\.com$/i,
    extract: (url) => {
      if (url.pathname !== '/url') return null
      const target = url.searchParams.get('q') || url.searchParams.get('url')
      if (!target) return null
      try { return decodeURIComponent(target) } catch { return null }
    },
  },
  {
    // Barracuda LinkProtect
    hostPattern: /(^|\.)linkprotect\.cudasvc\.com$/i,
    extract: (url) => {
      const target = url.searchParams.get('a')
      if (!target) return null
      try { return decodeURIComponent(target) } catch { return null }
    },
  },
  {
    // Mimecast — the /s/TOKEN scheme doesn't embed the original URL, so we
    // can't unwrap it. Match the host so callers can at least identify it
    // and suppress mismatch checks; extract returns null to signal that.
    hostPattern: /(^|\.)protect-[a-z]+\.mimecast\.com$/i,
    extract: () => null,
  },
]

/** Return the real destination URL after stripping any recognized gateway wrapper. */
function unwrapProtectedUrl(href: string): { original: string; wrapperDetected: boolean; wrapperUnextractable: boolean } {
  try {
    const url = new URL(href)
    for (const wrapper of LINK_WRAPPERS) {
      if (wrapper.hostPattern.test(url.hostname)) {
        const target = wrapper.extract(url)
        if (target) return { original: target, wrapperDetected: true, wrapperUnextractable: false }
        // Recognized wrapper but can't get the original (Mimecast, malformed) —
        // the hostname comparison against display text will be meaningless.
        return { original: href, wrapperDetected: true, wrapperUnextractable: true }
      }
    }
  } catch {
    // Malformed URL — let caller decide
  }
  return { original: href, wrapperDetected: false, wrapperUnextractable: false }
}

interface LinkAnalysisContext {
  bodyHtml: string
  bodyContext: string
  fromEmail: string
  fromName: string
}

export function analyzeLinksInBody(
  bodyHtmlOrCtx: string | LinkAnalysisContext,
  bodyContext?: string
): ThreatSignal[] {
  // Backward-compat: accept the old (bodyHtml, bodyContext) call shape.
  const ctx: LinkAnalysisContext = typeof bodyHtmlOrCtx === 'string'
    ? { bodyHtml: bodyHtmlOrCtx, bodyContext: bodyContext || '', fromEmail: '', fromName: '' }
    : bodyHtmlOrCtx

  const signals: ThreatSignal[] = []
  if (!ctx.bodyHtml) return signals

  const textContext = ctx.bodyContext.toLowerCase()
  const links: { href: string; displayText: string; hostname: string; wrapperUnextractable: boolean }[] = []

  const anchorRegex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = anchorRegex.exec(ctx.bodyHtml)) !== null) {
    const rawHref = match[1].trim()
    if (!/^https?:\/\//i.test(rawHref)) continue
    const displayText = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    const { original, wrapperUnextractable } = unwrapProtectedUrl(rawHref)
    try {
      const url = new URL(original)
      links.push({
        href: rawHref,
        displayText,
        hostname: url.hostname.toLowerCase(),
        wrapperUnextractable,
      })
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

  // Brand impersonation: only fire when the SENDER claims to be the brand
  // (via from_email domain or from_name) but isn't on an official domain.
  // A legitimate newsletter talking ABOUT Microsoft Copilot isn't impersonation
  // unless the sender's identity claims to be Microsoft.
  const fromDomain = ctx.fromEmail.split('@')[1]?.toLowerCase() || ''
  const fromNameLower = ctx.fromName.toLowerCase()
  for (const [brand, legitDomains] of Object.entries(KNOWN_BRANDS)) {
    if (!textContext.includes(brand)) continue
    const senderClaimsBrand =
      (fromDomain && fromDomain.includes(brand)) ||
      fromNameLower.includes(brand)
    if (!senderClaimsBrand) continue
    if (fromDomain && isOfficialDomain(fromDomain, legitDomains)) continue
    const suspicious = links.find(l => {
      if (l.wrapperUnextractable) return false
      if (isOfficialDomain(l.hostname, legitDomains)) return false
      const lowerDisplay = l.displayText.toLowerCase()
      const lowerHost = l.hostname.toLowerCase()
      return lowerDisplay.includes(brand) || lowerHost.includes(brand)
    })
    if (suspicious) {
      signals.push({
        signal: 'brand_impersonation_link',
        detail: `Email claims to be from ${brand} (sender: ${ctx.fromEmail}) but a link goes to "${suspicious.hostname}" — not an official ${brand} domain`,
        weight: 'critical',
      })
      break
    }
  }

  // Display-text-vs-href mismatch (classic phishing tactic). Downgraded from
  // 'critical' to 'high' and no longer auto-alerts on its own — it still
  // false-positives on newsletters whose unsubscribe link display happens to
  // contain a domain from the sender's email signature. Requires the AI
  // Tier 2 pass or a companion signal to escalate.
  for (const link of links) {
    if (link.wrapperUnextractable) continue
    const displayMatches = link.displayText.match(
      /\b([a-z][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi
    )
    if (!displayMatches) continue
    for (const candidate of displayMatches) {
      const displayDomain = candidate.toLowerCase()
      if (/\.(md|txt|pdf|docx?|xlsx?|png|jpe?g|gif|html?)$/i.test(displayDomain)) continue
      // Reject candidates whose final label isn't a recognized TLD. Anchor
      // text routinely contains usernames like "jeremy.collins" or
      // "first.last" which the regex above happily extracts because the
      // trailing label has ≥ 2 letters. Without this gate, every email
      // addressed to a user with a dotted username trips link_domain_mismatch.
      if (!hasKnownTld(displayDomain)) continue
      const actual = link.hostname
      if (displayDomain === actual) continue
      if (actual.endsWith('.' + displayDomain)) continue
      if (displayDomain.endsWith('.' + actual)) continue
      // Skip when the "display domain" sits on the same registrable domain
      // as the actual href — e.g. anchor text "wrike.com" linking to
      // "engage.wrike.com" is the same site, not a redirect.
      if (areSameRegistrableDomain(displayDomain, actual)) continue
      // Also skip when the "display domain" is just the sender's own domain
      // appearing in their signature line at the bottom of every email.
      // Use a literal suffix match here (not registrable-domain): a brand
      // sub-domain showing up as anchor text while the href points
      // elsewhere is exactly the impersonation pattern we want to catch.
      if (fromDomain && (displayDomain === fromDomain || displayDomain.endsWith('.' + fromDomain))) continue
      // Skip when the actual href goes to the sender's OWN registrable
      // domain. This is how marketing-email click tracking works — every
      // legit Marketo / HubSpot / Mailchimp / SendGrid / Wrike notification
      // routes clicks through a tracking subdomain (engage.wrike.com,
      // email.acme.com, etc.) before redirecting to the real destination.
      // The display text shows the target ("linkedin.com" or a username
      // string), the href points to a tracker subdomain that shares the
      // sender's registrable domain. A literal suffix check on fromDomain
      // misses sibling subdomains (team.wrike.com vs. engage.wrike.com),
      // which is why we compare eTLD+1 here.
      if (fromDomain && areSameRegistrableDomain(actual, fromDomain)) continue
      // Skip when both domains belong to the same corporate family —
      // e.g. optumbank.com display text linking to data.information.optum.com
      // is legitimate since Optum Bank and Optum are the same parent (UHG).
      if (areSameCorporateFamily(displayDomain, actual)) continue
      signals.push({
        signal: 'link_domain_mismatch',
        detail: `Link shows "${displayDomain}" in its text but actually goes to "${actual}"`,
        weight: 'high',
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

  // 2. Brand impersonation — sender CLAIMS to be a known brand but links
  //    go elsewhere. Auto-alerts on its own because the sender-identity
  //    tightening in analyzeLinksInBody makes this rule strict enough.
  if (brandImpersonation) {
    return {
      level: 'critical',
      type: 'phishing',
      explanation:
        "This email claims to be from a well-known brand but its link goes to a domain that isn't theirs — a classic phishing tactic to disguise a malicious destination.",
      doNotActions: baseDoNot,
      recommendedActions: [
        'Report as phishing and delete',
        'If you expected the linked service, navigate to it directly via a browser bookmark — never through this email',
        ...baseRecommended.slice(2),
      ],
      confidence: 0.95,
    }
  }

  // 3. Link-domain-mismatch no longer auto-alerts alone — it's too noisy on
  //    marketing emails where unsubscribe-link display text contains a domain
  //    from the sender's signature. It still fires as a Tier 1 signal and
  //    feeds into the Tier 2 AI verdict; only auto-escalate when it's
  //    combined with another real phishing indicator.
  if (linkMismatch && (scamPattern || credentialRequest || suspiciousRefId || dmarcFail)) {
    return {
      level: 'critical',
      type: 'phishing',
      explanation:
        "A link in this email doesn't go where it claims to, and the email contains additional phishing indicators — a classic tactic to disguise a malicious destination.",
      doNotActions: baseDoNot,
      recommendedActions: [
        'Report as phishing and delete',
        'If you expected the linked service, navigate to it directly via a browser bookmark — never through this email',
        ...baseRecommended.slice(2),
      ],
      confidence: 0.92,
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

// The prompt is deliberately sized above Haiku 4.5's 4096-token cache floor
// so the system + tool prefix is eligible for prompt caching. The tradeoff
// is worth it: first call pays the ~1.25x cache-write premium, every
// subsequent call in the 5-minute window pays ~0.1x read cost for the prefix.
// A scan that makes 25+ API calls in 4 minutes sees the cached prefix ~24
// times — a major net saving versus sending a short prompt uncached every
// call. Detailed examples also measurably improve Haiku accuracy.
const SYSTEM_PROMPT = `You are an email security analyst. Your job is to analyze emails that have already tripped a free pre-filter and decide whether each is a real phishing, scam, spoofing, impersonation, or social-engineering threat.

You receive emails that a rule-based Tier 1 has already flagged with at least one signal. Most suspicious emails never reach you — so emails you see are already selected. But plenty of benign marketing, service notifications, and legitimate business emails trip the pre-filter too. Your job is to separate real threats from noisy-but-legitimate mail.

# CORE RULES

1. Be CONSERVATIVE. False positives destroy user trust. Only return is_threat=true when your confidence is >= 0.75.
2. When Tier 1 has flagged one of the rule-based certainties listed below, trust it and return a high-confidence threat verdict. Those signals are deterministic — do not second-guess them.
3. For everything else, weigh the signals in context and err on the side of NOT flagging when the email is plausibly legitimate.
4. Your explanation must be concrete and reference actual content from the email — not jargon.

# TIER 1 SIGNAL GLOSSARY

You will see zero or more of these under "HEADER SIGNALS ALREADY DETECTED". Use them to ground your analysis — don't repeat them as content signals, add new observations from the email body.

Authentication signals:
- dmarc_fail (critical): The sender's own domain's DMARC policy rejected this message. Near-certain spoof.
- dkim_fail / spf_fail (high): Email authentication mechanism failed. Very suspicious but occasionally fires on misconfigured-but-legit senders.
- no_auth_results (medium): No SPF/DKIM/DMARC at all. Legit senders almost always publish at least one.

Sender signals:
- sender_spoofing_self (critical): The From address is the RECIPIENT'S OWN mailbox, but the recipient didn't actually send the email. Real self-sent emails never ask you to sign or click anything. This alone is sufficient for a critical verdict.
- reply_to_mismatch (high): Replies would go to a different domain than the sender's — classic phishing redirect.
- sender_mismatch (high): Technical sender and displayed sender don't agree.

Content signals:
- scam_pattern (high): Subject or body matches a known scam phrase (e.g. "verify your account", "agreement signature required").
- suspicious_ref_id (medium): Subject contains a long opaque hex ID (16+ characters) — phishing campaigns use these to look official.
- pressure_language (medium): Multiple urgency phrases ("act now", "within 24 hours", "failure to respond").
- credential_request (critical): Email appears to request sensitive info (password, SSN, bank details, gift cards).

Link signals (extracted from full HTML body):
- link_domain_mismatch (critical): A link's display text shows one domain but the href goes somewhere else. Textbook phishing.
- brand_impersonation_link (critical): Body mentions a known brand (DocuSign, Microsoft, PayPal, etc.) but the link goes to an off-brand domain.
- ip_based_url (critical): A link goes to a raw IP address instead of a domain name. Essentially always malicious.
- url_shortener (medium): Link uses bit.ly / tinyurl / etc. to hide the real destination.

# RULE-BASED CERTAINTIES

If ANY of these are present in Tier 1 signals, return is_threat=true with confidence >= 0.90 and threat_level=critical:
- sender_spoofing_self (any other signal present, or alone)
- link_domain_mismatch
- brand_impersonation_link
- ip_based_url
- dmarc_fail combined with ANY of {scam_pattern, credential_request, suspicious_ref_id, pressure_language}

These are deterministic markers — legitimate email simply does not produce them.

# WHAT IS A THREAT

- Credential phishing: fake login pages, "verify your account" from spoofed senders, requests to re-enter passwords or MFA codes
- Payment fraud: fake invoices, "urgent wire transfer" from spoofed executives, ACH change requests out of the blue
- Business Email Compromise: CEO/CFO impersonation asking for gift cards, money, or sensitive data
- Impersonation: pretending to be a known contact but from a different / look-alike email address
- Malware / malicious links: suspicious attachment requests, "download this file" from unknown senders, links to fake document portals
- Sextortion and extortion: threats to release info unless paid in crypto

# WHAT IS NOT A THREAT

Even with Tier 1 signals, these are typically legitimate:
- Well-formed marketing emails and newsletters, even with urgent language ("Last day for 20% off")
- Automated service notifications from known providers: Slack, Microsoft, Google, GitHub, Zoom, AWS, Stripe, Salesforce — from their real domains
- Calendar invites and meeting updates
- Order confirmations, shipping updates, and receipts
- Internal company emails with normal deadlines or payment mentions ("invoice attached for approval")
- Real DocuSign / Adobe Sign emails from docusign.com, docusign.net, adobesign.com
- Real LinkedIn, Indeed, Glassdoor notifications
- IT department security awareness emails ABOUT phishing (they talk about phishing but aren't phishing themselves)

If the Tier 1 signal is weak (e.g. only pressure_language, or only suspicious_ref_id from a recognizable transactional sender), the email is probably legitimate — return is_threat=false and confidence low.

# EXPLANATION GUIDELINES

- Write 2-3 sentences for a non-technical reader.
- Be specific: "This email claims to come from DocuSign but links to a domain that isn't DocuSign's" — NOT "sender authentication failed".
- Name the exact tactic: spoofed From, fake document portal, credential harvest, payment redirect.
- Contrast: what would a legitimate version of this email look like, and how does this one differ?

# RECOMMENDED ACTIONS (what the user SHOULD do)

Be concrete and useful:
- "Report as phishing in Outlook (right-click the email → Report → Phishing)"
- "Delete the email after reporting"
- "If you need to verify the document, go to docusign.com directly in your browser and sign in — never through this email"
- "Contact the sender through a phone number you already have, not a number listed in the email"
- "Notify your IT security team if your company has one"

# DO NOT ACTIONS (clear safety warnings)

- "Do not click any links in this email"
- "Do not open any attachments"
- "Do not reply with personal information, passwords, or account details"
- "Do not call any phone numbers listed in this email"
- "Do not scan any QR codes in the email"
- "Do not sign any documents linked from this email"

# WORKED EXAMPLES

## Example 1 — CRITICAL: self-spoofing DocuSign phishing

INPUT:
From: Jeremy Collins <jeremy.collins@acme.com>
To: jeremy.collins@acme.com
Subject: Action Required: Please Find And Complete Q1 Financials & Agreement Documentation ID:d4e1b9eca70cdf513ce2f196ab4d29df
Body: Routeware Required Your Signature On The Completed Document. All parties have completed Complete with Docusign: Q1 NDA.pdf. Click Access Documents and enter the security code.

HEADER SIGNALS ALREADY DETECTED:
- dmarc_fail (critical)
- sender_spoofing_self (critical)
- scam_pattern (high)
- suspicious_ref_id (medium)

CORRECT ASSESSMENT:
- is_threat: true
- threat_level: critical
- threat_type: spoofing
- confidence: 0.97
- content_signals: social engineering ("safe senders list" language, fake document-share framing)
- explanation: "This email is forged to look like it came from your own address, but your domain's security settings confirm you didn't send it — an attacker is impersonating you to make a fake DocuSign request look trustworthy. The opaque 32-character ID in the subject and the 'Action Required' urgency are designed to rush you into clicking the link. Real self-sent emails never ask you to sign documents."
- do_not_actions: [Do not click any links..., Do not open any attachments..., Do not enter the security code..., Do not sign any documents from this email]
- recommended_actions: [Report as phishing in Outlook..., Delete after reporting, If you need to sign a real Routeware document, go to docusign.com directly in your browser]

## Example 2 — NOT A THREAT: real DocuSign notification

INPUT:
From: DocuSign NA3 System <dse_NA3@docusign.net>
To: alice@company.com
Subject: Please DocuSign: NDA_v3.pdf
Body: John Smith sent you a new DocuSign document to review and sign. REVIEW DOCUMENT. (link goes to na3.docusign.net/Signing/...)

HEADER SIGNALS ALREADY DETECTED:
- scam_pattern (high): Matches "review and sign document"

CORRECT ASSESSMENT:
- is_threat: false
- threat_level: low
- threat_type: phishing
- confidence: 0.15
- explanation: "This looks like a legitimate DocuSign notification. The sender is an official DocuSign domain (docusign.net), the signing link goes to an official DocuSign subdomain, and there are no authentication failures or off-brand redirects. The 'review and sign document' phrase tripped the pre-filter but this is standard DocuSign language."
- recommended_actions: [If you weren't expecting a document from John Smith, contact him through a channel you already trust before signing]
- do_not_actions: [] (empty — this is not a threat)

## Example 3 — CRITICAL: brand-impersonation phishing

INPUT:
From: "Microsoft Account Team" <security-alert@ms-verify-account.co>
To: bob@company.com
Subject: Unusual sign-in activity detected on your account
Body: We noticed unusual sign-in activity. To keep your account safe, verify your identity now. (link display: "verify.microsoft.com", actual href: "http://ms-verify-account.co/login?id=...")

HEADER SIGNALS ALREADY DETECTED:
- spf_fail (high)
- scam_pattern (high): Matches "unusual sign-in activity"
- link_domain_mismatch (critical): shows "verify.microsoft.com" but goes to "ms-verify-account.co"
- brand_impersonation_link (critical): mentions Microsoft, links to non-Microsoft domain

CORRECT ASSESSMENT:
- is_threat: true
- threat_level: critical
- threat_type: phishing
- confidence: 0.98
- explanation: "This email is pretending to be Microsoft but it's not — the sender's domain is 'ms-verify-account.co', not microsoft.com, and the 'verify' button displays a Microsoft URL while actually linking to the fake domain. This is a credential-harvesting attack. If you click and enter your password, the attackers will capture it."
- do_not_actions: [Do not click any links, Do not enter your Microsoft password anywhere from this email]
- recommended_actions: [Report as phishing and delete, Go to account.microsoft.com directly in your browser to check for any real security alerts]

## Example 4 — NOT A THREAT: legit marketing email with urgency

INPUT:
From: Stripe <hello@stripe.com>
To: alice@company.com
Subject: Action required: Update your tax information by March 31
Body: To continue receiving payouts, please update your tax forms before March 31. Review now.

HEADER SIGNALS ALREADY DETECTED:
- scam_pattern (high): Matches "Action Required" / "update payment method" style
- pressure_language (medium): "Action required", "before March 31"

CORRECT ASSESSMENT:
- is_threat: false
- threat_level: low
- threat_type: phishing
- confidence: 0.20
- explanation: "This appears to be a legitimate Stripe compliance notification. The sender domain is stripe.com (verified), there are no authentication failures, and the request to update tax forms is a standard annual Stripe workflow. The urgent tone tripped the pre-filter but is appropriate for a regulatory deadline."
- recommended_actions: [If you have a Stripe account and want to verify, go to dashboard.stripe.com directly (don't use the email link) to check for the tax form request]

## Example 5 — HIGH: CEO wire-fraud BEC

INPUT:
From: "Sarah Chen, CEO" <sarah.chen.ceo@gmail.com>
To: finance@company.com
Subject: Urgent: wire transfer needed today
Body: Hi, I'm in a meeting and need you to wire $45,000 to a vendor immediately. Can you handle this ASAP? I'll send the wire details next. Do not call — I'm in back-to-back meetings.

HEADER SIGNALS ALREADY DETECTED:
- sender_mismatch (high): Displayed "Sarah Chen, CEO" doesn't match acme.com
- scam_pattern (high): Matches "wire transfer"
- pressure_language (medium): "urgent", "immediately", "ASAP", "back-to-back"

CORRECT ASSESSMENT:
- is_threat: true
- threat_level: high
- threat_type: bec
- confidence: 0.88
- explanation: "This is a classic Business Email Compromise attempt. The sender claims to be your CEO but is emailing from a personal gmail.com account — real CEOs use their company email for wire-transfer instructions. The urgency and 'don't call me' instructions are designed to prevent you from verifying through a trusted channel."
- do_not_actions: [Do not initiate the wire, Do not respond with any banking details, Do not send anything without verifying in person or by phone]
- recommended_actions: [Contact Sarah through a phone number you already have (not one listed in this email) to verify, Loop in your finance lead and IT security team, Report as phishing once verified]

---

When in doubt between two threat levels, pick the lower one. When in doubt between threat and not-threat, pick not-threat unless a rule-based certainty applies.`

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
        `\nBody Preview:\n${truncateForAI(email.bodyPreview, 1000)}`,
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
