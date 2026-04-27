/**
 * Unit tests for the pure helpers in scan-awaiting-replies.ts.
 *
 * The full Inngest scan function relies on Supabase + Graph + Slack, but the
 * classifier and reply-stripping helpers are pure and worth pinning down —
 * the false-positive class users report ("Thank you" replies showing up as
 * 'Waiting for response') turns entirely on these.
 */

// The module pulls in Inngest, Supabase, and Slack clients at import time.
// Stub them so the test file loads without env vars or network access.
jest.mock('inngest', () => ({
  Inngest: class MockInngest {
    createFunction(_config: unknown, _trigger: unknown, handler: unknown) {
      return handler
    }
  },
}))
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}))
jest.mock('@slack/web-api', () => ({
  WebClient: class {},
}))
jest.mock('@/lib/ai/detect-commitments', () => ({
  detectCommitmentsBatchViaBatchApi: jest.fn(),
}))
jest.mock('@/lib/ai/persist-usage', () => ({
  logAiUsage: jest.fn(),
}))

import {
  classifySentMessage,
  extractNewReplyContent,
  isThreadCloser,
} from '../scan-awaiting-replies'

describe('extractNewReplyContent', () => {
  it('strips Outlook-style quoted-original block at underscore divider', () => {
    // Real shape from Outlook bodyPreview: new content, then a long underscore
    // run, then the quoted From/Sent/To/Subject headers and the original body.
    const preview =
      'Thank you. ________________________________ ' +
      'From: Tim Sheynberg <tsheynberg@k1.com> Sent: Friday, April 24, 2026 12:09 PM ' +
      'To: Jeremy Collins <jeremy.collins@routeware.com> ' +
      'Subject: 83(b) Filing Confirmation - Jeremy Collins (MIU Award) Hi Jeremy'
    expect(extractNewReplyContent(preview)).toBe('Thank you.')
  })

  it('strips at "From: ... Sent:" headers when no divider is present', () => {
    const preview =
      'Got it, thanks. From: Sender Name <s@example.com> Sent: Apr 24 To: Me Subject: ...'
    expect(extractNewReplyContent(preview)).toBe('Got it, thanks.')
  })

  it('strips at Gmail-style "On <date>, X wrote:"', () => {
    const preview =
      "Sounds great. On Mon, Apr 24, 2026 at 12:09 PM, Tim <tim@example.com> wrote: > original"
    expect(extractNewReplyContent(preview)).toBe('Sounds great.')
  })

  it('strips at "----- Original Message -----"', () => {
    const preview = 'Confirmed. ----- Original Message ----- From: Someone'
    expect(extractNewReplyContent(preview)).toBe('Confirmed.')
  })

  it('strips at "Sent from my iPhone" mobile signature', () => {
    const preview = 'Will do. Sent from my iPhone'
    expect(extractNewReplyContent(preview)).toBe('Will do.')
  })

  it('returns the input unchanged when no quoted-original markers are found', () => {
    const preview = 'Hey can you review the attached doc and send feedback by EOD?'
    expect(extractNewReplyContent(preview)).toBe(preview)
  })

  it('returns empty string for empty / null-ish input', () => {
    expect(extractNewReplyContent('')).toBe('')
  })
})

describe('isThreadCloser', () => {
  it('flags pure "Thank you" / "Thanks" replies', () => {
    expect(isThreadCloser('Thank you.')).toBe(true)
    expect(isThreadCloser('thanks!')).toBe(true)
    expect(isThreadCloser('Thanks so much')).toBe(true)
    expect(isThreadCloser('thank you so much.')).toBe(true)
  })

  it('flags acknowledgments and approvals', () => {
    expect(isThreadCloser('Got it')).toBe(true)
    expect(isThreadCloser('Sounds good')).toBe(true)
    expect(isThreadCloser('LGTM')).toBe(true)
    expect(isThreadCloser('Confirmed.')).toBe(true)
    expect(isThreadCloser('Will do.')).toBe(true)
    expect(isThreadCloser('No problem!')).toBe(true)
  })

  it('flags compound closers like "Got it, thanks"', () => {
    expect(isThreadCloser('Got it, thanks')).toBe(true)
    expect(isThreadCloser('Great, thanks!')).toBe(true)
    expect(isThreadCloser('Ok thanks')).toBe(true)
    expect(isThreadCloser('Perfect — thank you')).toBe(true)
  })

  it('treats empty content as a closer (no new content typed)', () => {
    expect(isThreadCloser('')).toBe(true)
    expect(isThreadCloser('   ')).toBe(true)
  })

  it('does NOT flag substantive replies that ask a question', () => {
    expect(isThreadCloser('Thanks — can you also resend the attachment?')).toBe(false)
    expect(isThreadCloser('Got it. Quick question: when does this need to be filed?')).toBe(false)
  })

  it('does NOT flag substantive replies that contain a request', () => {
    expect(isThreadCloser('Thanks for the update. Please loop in Sarah when you reply.')).toBe(false)
  })

  it('does NOT flag long replies even if they start with a closer', () => {
    expect(isThreadCloser(
      'Thanks for sending this over. I reviewed the redlines this morning and have a few thoughts I want to walk through before we send it back to legal.'
    )).toBe(false)
  })
})

describe('classifySentMessage on extracted new content', () => {
  // The end-to-end fix: when we strip the quoted original FIRST, "Thank
  // you" replies whose quoted body contains keywords like "approve" or
  // "?" no longer get misclassified into the question/decision buckets.

  it('falls through to the default for short closers (which the caller skips before insert)', () => {
    const newContent = extractNewReplyContent('Thank you.')
    const result = classifySentMessage('Re: 83(b) Filing Confirmation', newContent, 2)
    // Default reason still applied — but the caller checks isThreadCloser
    // BEFORE classifying and skips the insert entirely. This test pins
    // that in a closer-only reply, no keyword bucket fires off the new
    // content alone (the previous behavior fired buckets off the quoted
    // original's "approve" / "?" / etc.).
    expect(result.category).toBe('follow_up')
    expect(result.waitReason).toBe('Waiting for response')
  })

  it('does NOT classify a closer as "Asked a question" when the quoted original contains a "?"', () => {
    // Pre-fix bug: bodyPreview = "Thank you. ___ From: Tim ... Subject:
    // What time works for you?" would match `text.includes('?')` and get
    // tagged as a question. After stripping, only "Thank you." is seen.
    const fullPreview =
      'Thank you. ________________________________ ' +
      'From: Tim <tim@k1.com> Sent: Apr 24 ' +
      'Subject: What time works for you? Hi Jeremy'
    const newContent = extractNewReplyContent(fullPreview)
    const result = classifySentMessage('Re: scheduling', newContent, 2)
    expect(result.category).not.toBe('question')
    expect(result.waitReason).not.toBe('Asked a question')
  })

  it('still classifies real questions when they ARE in the user\'s new content', () => {
    const newContent = extractNewReplyContent(
      'Thanks. Can you confirm the filing deadline before I send this out? ' +
        '________ From: someone'
    )
    const result = classifySentMessage('Re: filing', newContent, 1)
    expect(result.category).toBe('question')
    expect(result.waitReason).toBe('Asked a question')
  })
})
