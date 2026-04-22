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

  // Regression: Matt Curtis's own reply in a conversation thread was
  // showing as critical spoofing because From==accountEmail and the signal
  // didn't consider DMARC. If DMARC passed on his own domain, the email
  // really came from him and is legitimate.
  it('does NOT flag self-spoof when DMARC passes (email really is from the user)', () => {
    const email = makeEmail({
      fromEmail: 'matt.curtis@routeware.com',
      accountEmail: 'matt.curtis@routeware.com',
      toRecipients: 'Matt Curtis',
      subject: 'Re: Routeware UC details',
      bodyPreview: 'Hey John, I just spoke with Shawn...',
      headers: [{ name: 'Authentication-Results', value: 'spf=pass dkim=pass dmarc=pass' }],
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).not.toContain('sender_spoofing_self')
    expect(result.autoAlert).toBeNull()
  })

  it('still flags self-spoof when DMARC fails — that\'s a real spoof', () => {
    const email = makeEmail({
      fromEmail: 'jeremy.collins@routeware.com',
      accountEmail: 'jeremy.collins@routeware.com',
      headers: [{ name: 'Authentication-Results', value: 'spf=fail dkim=none dmarc=fail' }],
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('sender_spoofing_self')
  })

  it('still flags self-spoof when DMARC is missing — can\'t rule out a spoof', () => {
    // No Authentication-Results header at all (the Tier 1 call couldn't
    // load headers, or the mail server didn't emit them). Stay conservative.
    const email = makeEmail({
      fromEmail: 'jeremy.collins@routeware.com',
      accountEmail: 'jeremy.collins@routeware.com',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('sender_spoofing_self')
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

describe('tier1Analysis — accountEmail self-spoof detection', () => {
  // sync-outlook stores to_recipients as display NAMES, not email addresses,
  // so the old recipient-based check silently failed for most users. The fix
  // passes the signed-in mailbox address directly as accountEmail.
  it('flags self-spoof when accountEmail matches From but to_recipients is a display name', () => {
    const email = makeEmail({
      fromEmail: 'jeremy.collins@routeware.com',
      accountEmail: 'jeremy.collins@routeware.com',
      toRecipients: 'Jeremy Collins', // display name, not email — the real bug
      subject: 'Action Required: Please Sign',
      bodyPreview: 'Review and sign document',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('sender_spoofing_self')
  })

  it('auto-alerts at critical when self-spoof is detected', () => {
    const email = makeEmail({
      fromEmail: 'jeremy.collins@routeware.com',
      accountEmail: 'jeremy.collins@routeware.com',
      toRecipients: 'Jeremy Collins',
      subject: 'Note to self',
      bodyPreview: 'Please review attached',
    })
    const result = tier1Analysis(email)
    expect(result.autoAlert).not.toBeNull()
    expect(result.autoAlert?.level).toBe('critical')
    expect(result.autoAlert?.type).toBe('spoofing')
  })

  it('does not flag self-spoof when accountEmail differs from From', () => {
    const email = makeEmail({
      fromEmail: 'someone@elsewhere.com',
      accountEmail: 'jeremy.collins@routeware.com',
      toRecipients: 'Jeremy Collins',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).not.toContain('sender_spoofing_self')
  })
})

describe('tier1Analysis — link analysis', () => {
  it('flags a display-vs-href domain mismatch as high (no longer auto-critical alone)', () => {
    const email = makeEmail({
      subject: 'Sign this',
      bodyHtml: '<a href="https://evil-attacker.example.xyz/login">https://docusign.com</a>',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('link_domain_mismatch')
    // Alone, this is no longer enough to auto-alert — too noisy on newsletters
    expect(result.autoAlert).toBeNull()
  })

  it('auto-alerts critical when display/href mismatch combines with a scam pattern', () => {
    const email = makeEmail({
      subject: 'Agreement Signature Required Today',
      bodyHtml: '<a href="https://evil-attacker.example.xyz/login">https://docusign.com</a>',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('link_domain_mismatch')
    expect(result.autoAlert?.level).toBe('critical')
  })

  it('flags brand impersonation only when sender claims to be the brand', () => {
    // Sender claims to be DocuSign but is on a fake domain
    const impersonating = makeEmail({
      fromEmail: 'no-reply@docusign-secure-docs.ru',
      fromName: 'DocuSign',
      subject: 'Please sign',
      bodyPreview: 'Docusign has sent you a document',
      bodyHtml: '<a href="https://docusign-secure-docs.ru/review">Review Document</a>',
    })
    const impResult = tier1Analysis(impersonating)
    expect(impResult.signals.map(s => s.signal)).toContain('brand_impersonation_link')
  })

  it('does NOT flag brand impersonation when a legit newsletter only talks about a brand', () => {
    // Devessence sending a newsletter that mentions AI productivity tools —
    // sender doesn't claim to be any of the known brands. Previously this
    // false-positived; now it should stay clean.
    const email = makeEmail({
      fromEmail: 's.walker@devessence.com',
      fromName: 'Sarah Walker',
      subject: 'Real AI Productivity Gains',
      bodyPreview: 'See how Microsoft Copilot and Google Gemini compare in real-world workflows.',
      bodyHtml: '<a href="https://track.devessence.com/cta?id=42">Read the full comparison</a>',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).not.toContain('brand_impersonation_link')
  })

  it('flags raw IP URLs as critical', () => {
    const email = makeEmail({
      bodyHtml: '<a href="http://192.168.4.7/signin">Click here</a>',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('ip_based_url')
    expect(result.autoAlert?.level).toBe('critical')
  })

  it('flags URL shorteners with medium weight (no auto-alert alone)', () => {
    const email = makeEmail({
      bodyHtml: '<a href="https://bit.ly/abc123">click here</a>',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('url_shortener')
  })

  it('unwraps Microsoft Defender Safe Links before checking display/href mismatch', () => {
    // Real-world shape: Outlook rewrites https://pendo.io/blog/x to
    // https://gbr01.safelinks.protection.outlook.com/?url=<encoded>&data=...
    // Display text is the original "pendo.io". Without unwrapping, every
    // single email in a Defender-protected mailbox trips link_domain_mismatch.
    const encoded = encodeURIComponent('https://pendo.io/blog/whatever')
    const email = makeEmail({
      fromEmail: 'pendo@pendo.io',
      bodyHtml: `<a href="https://gbr01.safelinks.protection.outlook.com/?url=${encoded}&data=x">pendo.io</a>`,
    })
    const result = tier1Analysis(email)
    const names = result.signals.map(s => s.signal)
    expect(names).not.toContain('link_domain_mismatch')
  })

  it('unwraps Safe Links and still catches a real mismatch hiding behind the wrapper', () => {
    // Attacker hides an evil URL behind Safe Links; display text claims docusign.com
    const encoded = encodeURIComponent('https://evil-attacker.example.xyz/steal')
    const email = makeEmail({
      subject: 'Agreement Signature Required',
      bodyHtml: `<a href="https://gbr01.safelinks.protection.outlook.com/?url=${encoded}&data=x">https://docusign.com</a>`,
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('link_domain_mismatch')
  })

  it('does NOT flag a link that goes to an official brand domain', () => {
    const email = makeEmail({
      subject: 'DocuSign notification',
      bodyPreview: 'Docusign has sent you a document',
      bodyHtml: '<a href="https://app.docusign.com/documents/abc">Review Document</a>',
    })
    const result = tier1Analysis(email)
    const names = result.signals.map(s => s.signal)
    expect(names).not.toContain('brand_impersonation_link')
    expect(names).not.toContain('link_domain_mismatch')
  })

  it('does NOT flag marketing click-trackers that redirect via the sender\'s own domain', () => {
    // Real pattern — cold outreach from a financial firm. Display text shows
    // LinkedIn (their referenced social), but the href routes through their
    // own tracking subdomain for analytics before redirecting. Every legit
    // Marketo / HubSpot / Mailchimp / SendGrid email looks like this.
    const email = makeEmail({
      fromEmail: 'steve.lepatner@monarchgrovewealth.org',
      fromName: 'Steve LePatner',
      subject: 'Reconnecting From LinkedIn',
      bodyHtml: '<a href="https://email.monarchgrovewealth.org/click?id=abc">www.linkedin.com</a>',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).not.toContain('link_domain_mismatch')
  })

  it('still flags mismatch when the href host is NOT the sender\'s own domain', () => {
    // Control: make sure the click-tracker exemption doesn't accidentally
    // silence real phishing where the href goes to an attacker-controlled
    // third-party domain.
    const email = makeEmail({
      fromEmail: 'steve.lepatner@monarchgrovewealth.org',
      bodyHtml: '<a href="https://evil-attacker.xyz/steal">www.linkedin.com</a>',
    })
    const result = tier1Analysis(email)
    expect(result.signals.map(s => s.signal)).toContain('link_domain_mismatch')
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
