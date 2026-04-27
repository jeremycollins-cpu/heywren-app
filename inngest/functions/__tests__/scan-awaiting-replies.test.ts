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

describe('isThreadCloser — praise / kudos (Slack channel chatter)', () => {
  // The "Great job, @Tony Maciej and team!" false positive class. Praise
  // messages with @mentions, channel announcements, and shoutouts close
  // out a thread; nothing's waiting on anyone.

  it('flags praise with Slack raw mentions and "and team" filler', () => {
    expect(isThreadCloser('Great job, <@U12345> and team!')).toBe(true)
  })

  it('flags praise with a resolved @Name mention', () => {
    expect(isThreadCloser('Great job, @Tony Maciej and team!')).toBe(true)
  })

  it('flags common kudos phrases', () => {
    expect(isThreadCloser('Nice work everyone!')).toBe(true)
    expect(isThreadCloser('Well done, team.')).toBe(true)
    expect(isThreadCloser('Kudos to <@U999>!')).toBe(true)
    expect(isThreadCloser('Way to go!')).toBe(true)
    expect(isThreadCloser('Crushed it 🔥')).toBe(true)
    expect(isThreadCloser('Nailed it!')).toBe(true)
    expect(isThreadCloser('Bravo!')).toBe(true)
    expect(isThreadCloser('Huge props to the design team')).toBe(true)
    expect(isThreadCloser('Looks awesome 🎉')).toBe(true)
    expect(isThreadCloser('This is amazing work')).toBe(true)
    expect(isThreadCloser("That's incredible")).toBe(true)
    expect(isThreadCloser('Love it!')).toBe(true)
    expect(isThreadCloser('Congrats @Sarah!')).toBe(true)
    expect(isThreadCloser('Solid work team')).toBe(true)
  })

  it('does NOT flag praise with a real follow-up ask', () => {
    expect(isThreadCloser('Great job team! Quick question — when does the rollout start?')).toBe(false)
    expect(isThreadCloser('Nice work, but can you also redo the Q3 chart?')).toBe(false)
    expect(isThreadCloser('Looks great — please add Sarah to the next review.')).toBe(false)
  })
})

describe('isThreadCloser — reactions & emoji', () => {
  it('flags emoji-only messages as reactions', () => {
    expect(isThreadCloser('🎉🎉🎉')).toBe(true)
    expect(isThreadCloser('🔥')).toBe(true)
    expect(isThreadCloser('👍')).toBe(true)
    expect(isThreadCloser(':+1:')).toBe(true)
    expect(isThreadCloser(':thumbsup: :fire:')).toBe(true)
  })

  it('flags messages that reduce to nothing after stripping mentions + emoji', () => {
    expect(isThreadCloser('<@U12345> 🎉')).toBe(true)
    expect(isThreadCloser('@Tony :+1:')).toBe(true)
  })
})

describe('isThreadCloser — sign-offs & greetings', () => {
  it('flags end-of-day / weekend wishes', () => {
    expect(isThreadCloser('Have a good weekend!')).toBe(true)
    expect(isThreadCloser('Have a great weekend everyone')).toBe(true)
    expect(isThreadCloser('Enjoy your weekend!')).toBe(true)
    expect(isThreadCloser('Enjoy the rest of your day')).toBe(true)
    expect(isThreadCloser('Have a good one')).toBe(true)
    expect(isThreadCloser('Safe travels!')).toBe(true)
    expect(isThreadCloser('Happy Friday!')).toBe(true)
  })

  it('flags greetings and farewells', () => {
    expect(isThreadCloser('Good morning everyone')).toBe(true)
    expect(isThreadCloser('Good night!')).toBe(true)
    expect(isThreadCloser('See you Monday')).toBe(true)
    expect(isThreadCloser('See you tomorrow!')).toBe(true)
    expect(isThreadCloser('ttyl')).toBe(true)
    expect(isThreadCloser('Talk to you soon')).toBe(true)
    expect(isThreadCloser('Bye!')).toBe(true)
  })

  it('does NOT flag a greeting that carries a real ask', () => {
    expect(isThreadCloser('Good morning! Can you send the deck before standup?')).toBe(false)
    expect(isThreadCloser('Have a good weekend — please review the PR Monday.')).toBe(false)
  })
})

describe('isThreadCloser — actionable-ask guardrail', () => {
  // We always lean toward keeping the item visible if there's any sign of
  // a real follow-up ask. Better one stale entry than one missed request.

  it('returns false when text contains a question mark', () => {
    expect(isThreadCloser('Thanks?')).toBe(false)
    expect(isThreadCloser('Sounds good — thoughts?')).toBe(false)
  })

  it('returns false on imperative requests', () => {
    expect(isThreadCloser('Thanks. Please send the report.')).toBe(false)
    expect(isThreadCloser('Got it. Need this by EOD.')).toBe(false)
    expect(isThreadCloser('Cool. Let me know when ready.')).toBe(false)
  })

  it('returns false when text mentions blocking work', () => {
    expect(isThreadCloser('Thanks — this is blocking the launch.')).toBe(false)
  })

  it('returns false on "any thoughts/chance/update" hedges', () => {
    expect(isThreadCloser('Hey — any thoughts on the doc?')).toBe(false)
    expect(isThreadCloser('Quick one: any update?')).toBe(false)
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
