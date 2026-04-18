/**
 * Tests for tier1Analysis — the free header/pattern pre-filter.
 *
 * tier1Analysis is pure (no network calls), so we can assert on its output
 * directly. These tests lock in detection behavior for the real phishing
 * campaigns we've seen miss the dashboard.
 */

import { tier1Analysis, type EmailForThreatAnalysis } from '../detect-email-threats'

// Anthropic SDK is imported at the top of the module under test; mock it
// so the module loads without hitting the real client constructor.
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class MockAnthropic {
    messages = { create: jest.fn() }
  },
}))

jest.mock('../token-usage', () => ({
  recordTokenUsage: jest.fn(),
  truncateForAI: (s: string) => s,
}))

function makeEmail(overrides: Partial<EmailForThreatAnalysis> = {}): EmailForThreatAnalysis {
  return {
    messageId: 'msg-1',
    fromEmail: 'sender@example.com',
    fromName: 'Sender',
    subject: 'Hello',
    bodyPreview: '',
    receivedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('tier1Analysis — self-spoofing detection', () => {
  it('flags an email where From matches the recipient', () => {
    const email = makeEmail({
      fromEmail: 'jeremy.collins@routeware.com',
      toRecipients: 'jeremy.collins@routeware.com',
      subject: 'Hi',
      bodyPreview: 'Hi',
    })

    const result = tier1Analysis(email)

    expect(result.skipTier2).toBe(false)
    expect(result.signals.map(s => s.signal)).toContain('sender_spoofing_self')
  })

  it('is case-insensitive and tolerates whitespace in recipient list', () => {
    const email = makeEmail({
      fromEmail: 'JEREMY.COLLINS@routeware.com',
      toRecipients: '  jeremy.collins@routeware.com ; someone.else@elsewhere.com',
    })

    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('sender_spoofing_self')
  })

  it('also checks cc recipients', () => {
    const email = makeEmail({
      fromEmail: 'jeremy.collins@routeware.com',
      toRecipients: 'other@elsewhere.com',
      ccRecipients: 'jeremy.collins@routeware.com',
    })

    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('sender_spoofing_self')
  })

  it('does not flag when From is a different address', () => {
    const email = makeEmail({
      fromEmail: 'someone@elsewhere.com',
      toRecipients: 'jeremy.collins@routeware.com',
      subject: 'Hi',
      bodyPreview: 'Hi',
    })

    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).not.toContain('sender_spoofing_self')
  })
})

describe('tier1Analysis — e-signature / document-share phishing', () => {
  // The real missed campaign
  const phishSubject =
    'Past Due Reminder: Agreement Signature Required Today Ref~ID#: dc8e8098a0ea6afbdce28b0bb05ea952 3117838228'
  const phishBody = 'Hi Jeremy.collins routeware.com has sent you a document to review. View Document'

  it('flags the exact subject from the reported phish', () => {
    const email = makeEmail({ subject: phishSubject, bodyPreview: phishBody })
    const result = tier1Analysis(email)

    const signals = result.signals.map(s => s.signal)
    expect(signals).toContain('scam_pattern')
    expect(signals).toContain('suspicious_ref_id')
    expect(result.skipTier2).toBe(false)
  })

  it('catches "has sent you a document" document-share phishing', () => {
    const email = makeEmail({
      subject: 'Review your document',
      bodyPreview: 'Acme has sent you a document to review. View Document',
    })
    const result = tier1Analysis(email)

    expect(result.signals.map(s => s.signal)).toContain('scam_pattern')
  })

  it('catches "Past Due Reminder" phrasing', () => {
    const email = makeEmail({ subject: 'Past Due Reminder: payment needed' })
    expect(tier1Analysis(email).signals.map(s => s.signal)).toContain('scam_pattern')
  })

  it('catches "e-signature required"', () => {
    const email = makeEmail({ subject: 'E-signature required on contract' })
    expect(tier1Analysis(email).signals.map(s => s.signal)).toContain('scam_pattern')
  })

  it('catches long opaque hex ref IDs', () => {
    const email = makeEmail({
      subject: 'Invoice Ref~ID#: abcdef0123456789abcdef0123456789',
    })
    expect(tier1Analysis(email).signals.map(s => s.signal)).toContain('suspicious_ref_id')
  })

  it('does NOT flag legitimate reference IDs that are short or numeric', () => {
    const email = makeEmail({ subject: 'Invoice #12345' })
    expect(tier1Analysis(email).signals.map(s => s.signal)).not.toContain('suspicious_ref_id')
  })

  // Regression: the "ID:<32hex>" variant that landed without a "Ref" prefix
  // was bypassing suspicious_ref_id and skipping Tier 2 entirely.
  it('catches bare "ID:<hex>" tracking IDs without a Ref prefix', () => {
    const email = makeEmail({
      subject: 'Action Required: Please Find And Complete Q1 Financials ID:d4e1b9eca70cdf513ce2f196ab4d29df',
    })
    const signals = tier1Analysis(email).signals.map(s => s.signal)
    expect(signals).toContain('suspicious_ref_id')
    expect(tier1Analysis(email).skipTier2).toBe(false)
  })

  it('catches "Action Required" + financial/document/agreement combos', () => {
    const email = makeEmail({
      subject: 'Action Required: Please Find And Complete Routeware Attached Q1 Financials & Agreement Documentation',
    })
    expect(tier1Analysis(email).signals.map(s => s.signal)).toContain('scam_pattern')
  })

  it('catches "Required Your Signature On The Completed Document"', () => {
    const email = makeEmail({
      subject: 'Please sign',
      bodyPreview: 'Routeware Required Your Signature On The Completed Document. All parties have completed.',
    })
    expect(tier1Analysis(email).signals.map(s => s.signal)).toContain('scam_pattern')
  })

  it('catches "Review & Sign Document" even with ampersand', () => {
    const email = makeEmail({
      subject: 'Document ready',
      bodyPreview: 'REVIEW & SIGN DOCUMENT to complete the process.',
    })
    expect(tier1Analysis(email).signals.map(s => s.signal)).toContain('scam_pattern')
  })
})

describe('tier1Analysis — authentication header checks', () => {
  function authHeaders(spf: string, dkim: string, dmarc: string) {
    return [
      {
        name: 'Authentication-Results',
        value: `spf=${spf} dkim=${dkim} dmarc=${dmarc}`,
      },
    ]
  }

  it('flags SPF/DKIM/DMARC fails', () => {
    const email = makeEmail({ headers: authHeaders('fail', 'fail', 'fail') })
    const signals = tier1Analysis(email).signals.map(s => s.signal)
    expect(signals).toContain('spf_fail')
    expect(signals).toContain('dkim_fail')
    expect(signals).toContain('dmarc_fail')
  })

  it('flags emails with no authentication results at all', () => {
    const email = makeEmail({
      headers: [{ name: 'X-Something', value: 'whatever' }],
    })
    const signals = tier1Analysis(email).signals.map(s => s.signal)
    expect(signals).toContain('no_auth_results')
  })

  it('does NOT fire no_auth_results when any mechanism passes', () => {
    const email = makeEmail({ headers: authHeaders('pass', 'none', 'none') })
    const signals = tier1Analysis(email).signals.map(s => s.signal)
    expect(signals).not.toContain('no_auth_results')
  })

  it('does NOT fire header checks when headers are absent (cannot judge)', () => {
    const email = makeEmail({})
    const signals = tier1Analysis(email).signals.map(s => s.signal)
    expect(signals).not.toContain('no_auth_results')
  })
})

describe('tier1Analysis — clean emails', () => {
  it('produces zero signals for a normal 1:1 email and lets Tier 2 be skipped', () => {
    const email = makeEmail({
      fromEmail: 'colleague@routeware.com',
      toRecipients: 'jeremy.collins@routeware.com',
      subject: 'Lunch tomorrow?',
      bodyPreview: 'Want to grab lunch tomorrow around noon?',
      headers: [
        { name: 'Authentication-Results', value: 'spf=pass dkim=pass dmarc=pass' },
      ],
    })

    const result = tier1Analysis(email)
    expect(result.signals).toEqual([])
    expect(result.skipTier2).toBe(true)
  })
})
