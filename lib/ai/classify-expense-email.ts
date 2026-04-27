// lib/ai/classify-expense-email.ts
// Detects which inbox emails are receipts/invoices/order confirmations and
// extracts vendor + amount metadata. Mirrors the two-tier pattern used by
// classify-missed-email: a free regex pre-filter eliminates obvious non-
// receipts, then a batched Haiku call extracts structured fields.

import { truncateForAI } from './token-usage'
import { runBatch, extractToolResult, type BatchRequest } from './batch-api'

export interface ExpenseClassification {
  isReceipt: boolean
  vendor: string                 // Cleaned-up display name
  category: 'receipt' | 'invoice' | 'order_confirmation' | 'subscription' | 'other'
  amount: number | null          // Total charged
  currency: string | null        // ISO 4217 (USD, EUR, ...)
  receiptDate: string | null     // ISO date (YYYY-MM-DD) of the transaction if stated
  confidence: number             // 0-1
}

export interface ExpenseEmailInput {
  id: string
  fromEmail: string
  fromName: string
  subject: string
  bodyPreview: string
  receivedAt: string
}

// ── Tier 1: free pre-filter ────────────────────────────────────────────

// Sender + subject patterns that strongly suggest the email is a receipt.
// We err on the side of inclusion here — the AI tier will reject false
// positives. The goal is just to cut out obvious non-receipts (newsletters,
// personal emails, automated alerts that aren't transactional).

const RECEIPT_SENDER_PATTERNS: RegExp[] = [
  /receipts?@/i, /billing@/i, /invoices?@/i, /payments?@/i,
  /orders?@/i, /noreply@.*(stripe|square|paypal|venmo|shopify|amazon|aws|uber|lyft|doordash|grubhub|airbnb)/i,
  /no-reply@.*(stripe|square|paypal|venmo|shopify|amazon|aws|uber|lyft|doordash|grubhub|airbnb)/i,
]

// Vendors we know are transactional even when the from-address is generic
const KNOWN_VENDOR_DOMAINS = new Set([
  'stripe.com', 'paypal.com', 'venmo.com', 'square.com', 'squareup.com',
  'amazon.com', 'amazon.co.uk', 'amazon.ca', 'aws.amazon.com',
  'uber.com', 'uber.us', 'lyft.com', 'doordash.com', 'grubhub.com', 'ubereats.com',
  'airbnb.com', 'booking.com', 'expedia.com', 'hotels.com', 'kayak.com',
  'apple.com', 'google.com', 'github.com', 'shopify.com', 'etsy.com',
  'zoom.us', 'slack.com', 'notion.so', 'figma.com', 'linear.app', 'asana.com',
  'openai.com', 'anthropic.com', 'vercel.com', 'cloudflare.com',
  'lyft.com', 'instacart.com', 'walmart.com', 'target.com', 'bestbuy.com',
])

const RECEIPT_SUBJECT_PATTERNS: RegExp[] = [
  /\breceipt\b/i,
  /\binvoice\b/i,
  /\border (confirm|placed|received|#|number)/i,
  /\byour order\b/i,
  /\bpayment (received|confirm|successful|processed)/i,
  /\bthanks? for your (order|purchase|payment)/i,
  /\b(subscription|renewal) (confirm|received|active)/i,
  /\bshipping confirm/i,
  /\byour .* (subscription|membership) (was|has been) (renewed|charged)/i,
  /\b\$\d+/,                 // dollar amounts in subject
  /\b€\d+/,                  // euro amounts
  /\b£\d+/,                  // pound amounts
  /\bpaid\b.*\b\d+/i,
  /\b(charge|charged) (of|for)\b/i,
  /\bbilling (statement|summary|notice)\b/i,
  /\b(trip|ride) (with|complete|receipt)\b/i,    // Uber/Lyft
  /\bestimate\b.*\bservice\b/i,
]

const NEGATIVE_SUBJECT_PATTERNS: RegExp[] = [
  // Things that look transactional but usually aren't
  /\bestimat(e|ed) (delivery|arrival)\b/i,
  /\bout for delivery\b/i,
  /\b(track(ing)?|delivery) (your|update|status)\b/i,
  /\bunsubscribe\b/i,
  /\bnewsletter\b/i,
  /\bdigest\b/i,
  /\bweekly\b/i, /\bmonthly recap\b/i,
  /\bpassword reset\b/i,
  /\bverify your (email|account)\b/i,
  /\b(sign-?in|new login) (alert|from)/i,
  /\b(security|account) alert\b/i,
  /\binvitation\b/i, /\binvited you\b/i,
]

function emailDomain(email: string): string {
  const at = email.indexOf('@')
  return at >= 0 ? email.slice(at + 1).toLowerCase().trim() : ''
}

function looksLikeReceipt(input: ExpenseEmailInput): boolean {
  const subject = input.subject || ''
  const body = input.bodyPreview || ''
  const from = input.fromEmail || ''

  // Hard negatives in subject — bail out early
  if (NEGATIVE_SUBJECT_PATTERNS.some(p => p.test(subject))) {
    // Allow override if subject ALSO has a strong receipt phrase or dollar amount
    if (!/\$\d+|\b€\d+|\b£\d+|\breceipt\b|\binvoice\b|\bpaid\b/i.test(subject)) {
      return false
    }
  }

  if (RECEIPT_SENDER_PATTERNS.some(p => p.test(from))) return true
  if (RECEIPT_SUBJECT_PATTERNS.some(p => p.test(subject))) return true

  const domain = emailDomain(from)
  // Strip subdomains for vendor-domain match
  const rootDomain = domain.split('.').slice(-2).join('.')
  if (KNOWN_VENDOR_DOMAINS.has(domain) || KNOWN_VENDOR_DOMAINS.has(rootDomain)) {
    // Known vendor — but still require *some* transactional signal to reduce
    // false positives from marketing emails (e.g. Amazon promo emails).
    const combined = subject + ' ' + body
    if (/\$\d|\b€\d|\b£\d|\breceipt\b|\binvoice\b|\border\b|\bpaid\b|\btotal\b/i.test(combined)) {
      return true
    }
  }

  // Body-only signals: if the preview shows a total + currency, treat as candidate
  if (/\btotal\b.*\$\d/i.test(body) && /\b(paid|charged|receipt|order)\b/i.test(body)) {
    return true
  }

  return false
}

// ── Tier 2: AI extraction via Batch API ────────────────────────────────

const EXPENSE_TOOL = {
  name: 'classify_expense_emails',
  description: 'Classify a numbered batch of emails and extract receipt fields for each.',
  input_schema: {
    type: 'object',
    properties: {
      results: {
        type: 'object',
        description: 'Map from the email number ("1", "2", ...) to its classification.',
        additionalProperties: {
          type: 'object',
          properties: {
            isReceipt: {
              type: 'boolean',
              description: 'TRUE only if this email is a transactional receipt, invoice, order confirmation, or subscription billing notice. Marketing emails, shipping updates without amounts, password resets, and account alerts are NOT receipts.',
            },
            vendor: {
              type: 'string',
              description: 'Clean display name of the vendor (e.g. "Amazon", "Uber", "AWS"). Use the brand name, not the legal entity.',
            },
            category: {
              type: 'string',
              enum: ['receipt', 'invoice', 'order_confirmation', 'subscription', 'other'],
            },
            amount: {
              type: ['number', 'null'],
              description: 'The total amount charged as a number (no currency symbol). Null if not visible.',
            },
            currency: {
              type: ['string', 'null'],
              description: 'ISO 4217 code (USD, EUR, GBP, ...). Null if not visible.',
            },
            receiptDate: {
              type: ['string', 'null'],
              description: 'Transaction date as YYYY-MM-DD if stated in the email body. Null if absent.',
            },
            confidence: {
              type: 'number',
              description: '0 to 1. How confident you are this is a transactional receipt.',
            },
          },
          required: ['isReceipt', 'vendor', 'category', 'confidence'],
        },
      },
    },
    required: ['results'],
  },
}

const SYSTEM_PROMPT = `You classify a batch of emails to find receipts, invoices, and order confirmations for an expense-tracking feature.

A RECEIPT is an email that shows the user paid (or was charged) money for something:
- "Your receipt from Uber"
- "Invoice #1234 from Stripe"
- "Order confirmation - Amazon.com"
- "Your AWS bill for March"
- "Payment received - Stripe"

NOT receipts (return isReceipt: false):
- Shipping/delivery updates without payment info ("Your package is out for delivery")
- Marketing or promotional emails ("20% off your next order")
- Password resets, security alerts, login notifications
- Newsletters, digests, weekly summaries
- Calendar invites, meeting confirmations
- Personal emails between humans

Extract:
- vendor: clean brand name (e.g. "Uber" not "Uber Technologies, Inc.")
- amount: numeric total (e.g. 24.50, not "$24.50")
- currency: ISO code (USD, EUR, GBP)
- receiptDate: YYYY-MM-DD of the transaction if stated
- confidence: how sure you are this is a receipt (0-1)

Return one entry per numbered email. Be strict — false positives clutter the user's expense report.`

export async function classifyExpenseEmailBatch(
  emails: ExpenseEmailInput[]
): Promise<Map<string, ExpenseClassification>> {
  const results = new Map<string, ExpenseClassification>()
  if (emails.length === 0) return results

  // Tier 1 pre-filter
  const candidates = emails.filter(looksLikeReceipt)
  if (candidates.length === 0) return results

  // Send in chunks of 15 emails per batch request (same pattern as
  // classify-missed-email) so prompts stay manageable and one bad email
  // doesn't poison a huge batch.
  const CHUNK_SIZE = 15
  const requests: BatchRequest[] = []
  const chunks: ExpenseEmailInput[][] = []

  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE)
    chunks.push(chunk)

    const numbered = chunk
      .map((e, idx) => {
        return `[${idx + 1}]
From: ${e.fromName} <${e.fromEmail}>
Subject: ${e.subject}
Date: ${e.receivedAt}

${truncateForAI(e.bodyPreview)}`
      })
      .join('\n\n---\n\n')

    requests.push({
      custom_id: `expense-chunk-${i}`,
      params: {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system: [{
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        }],
        tools: [EXPENSE_TOOL as any],
        tool_choice: { type: 'tool', name: 'classify_expense_emails' },
        messages: [{
          role: 'user',
          content: `Classify these ${chunk.length} emails:\n\n${numbered}`,
        }],
      },
    })
  }

  let batchResults
  try {
    batchResults = await runBatch(requests)
  } catch (err) {
    console.error('[classify-expense-email] batch failed:', (err as Error).message)
    return results
  }

  requests.forEach((req, idx) => {
    const chunk = chunks[idx]
    const item = batchResults.get(req.custom_id)
    const parsed = extractToolResult<{ results: Record<string, ExpenseClassification> }>(item)
    if (!parsed?.results) return

    chunk.forEach((email, j) => {
      const classification = parsed.results[String(j + 1)]
      if (!classification) return
      if (!classification.isReceipt) return
      // Floor confidence at 0 if model hallucinated a negative or out-of-range value
      const conf = typeof classification.confidence === 'number'
        ? Math.max(0, Math.min(1, classification.confidence))
        : 0.7
      if (conf < 0.5) return
      results.set(email.id, { ...classification, confidence: conf })
    })
  })

  return results
}

// Helper: best-effort vendor domain — used by the scanner so all rows for the
// same vendor group together even if Claude returns slight name variations.
export function vendorDomainFromEmail(fromEmail: string): string {
  const domain = emailDomain(fromEmail)
  if (!domain) return 'unknown'
  // Roll noreply@billing.stripe.com → stripe.com
  const parts = domain.split('.')
  if (parts.length <= 2) return domain
  return parts.slice(-2).join('.')
}
