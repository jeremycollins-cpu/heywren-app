/**
 * Tests for the missed email classification pipeline.
 *
 * The module uses a 3-tier approach:
 *   Tier 1: Free regex pre-filter (isLikelyAutomated + likelyNeedsResponse)
 *   Tier 2: Haiku triage (cheap yes/no via tool_use)
 *   Tier 3: Sonnet/Haiku full analysis (extraction via tool_use)
 *
 * These tests verify that the Tier 1 pre-filter correctly identifies emails
 * that need a response, particularly meeting scheduling and availability proposals.
 */

import { classifyMissedEmail, getClassificationStats } from '../classify-missed-email'
import type { EmailInput } from '../classify-missed-email'

// ─── Mock Anthropic SDK ─────────────────────────────────────────────────────

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: class MockAnthropic {
      messages = { create: (...args: any[]) => mockCreate(...args) }
    },
  }
})

jest.mock('../validate-community-signal', () => ({
  getActiveCommunityPatterns: jest.fn().mockResolvedValue([]),
}))

jest.mock('../token-usage', () => ({
  recordTokenUsage: jest.fn(),
  truncateForAI: (text: string) => text,
}))

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a mock Haiku triage response (Tier 2). */
function makeTriageResponse(needsResponse: boolean) {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'classify_email',
        input: { needs_response: needsResponse },
      },
    ],
    usage: { input_tokens: 100, output_tokens: 20 },
  }
}

/** Build a mock Sonnet analysis response (Tier 3). */
function makeAnalysisResponse(overrides: Record<string, any> = {}) {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'analyze_email',
        input: {
          needsResponse: true,
          urgency: 'high',
          reason: 'Meeting scheduling request',
          questionSummary: 'Proposing meeting times',
          category: 'request',
          confidence: 0.9,
          expectedResponseTime: 'same_day',
          sentimentScore: 0.3,
          sentimentLabel: 'positive',
          toneThemes: ['collaboration'],
          ...overrides,
        },
      },
    ],
    usage: { input_tokens: 200, output_tokens: 100 },
  }
}

function makeEmail(overrides: Partial<EmailInput> = {}): EmailInput {
  return {
    fromEmail: 'dan.franck@samsara.com',
    fromName: 'Dan Franck',
    subject: 'Re: Meeting',
    bodyPreview: '',
    receivedAt: new Date().toISOString(),
    recipientEmail: 'jeremy@company.com',
    recipientName: 'Jeremy Collins',
    isCcOnly: false,
    toRecipients: 'jeremy@company.com',
    ccRecipients: '',
    ...overrides,
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreate.mockReset()
  getClassificationStats() // reset stats
})

describe('Tier 1 pre-filter: meeting scheduling and availability proposals', () => {
  // These tests verify that scheduling emails pass Tier 1 and reach the AI.
  // If the email reaches Tier 2 (Haiku triage), mockCreate will be called.
  // If it's filtered at Tier 1, mockCreate is never called and result is null.

  it('should detect "Would any of the following work?" as needing response', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      bodyPreview:
        "I'm at NAFA on Monday, but happy to chat on Tuesday. Would any of the following work? • 11am ET • 1-2pm ET • 4-6pm ET",
    })

    const result = await classifyMissedEmail(email)

    // The email should have reached the AI (Tier 2+), not been filtered at Tier 1
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('should detect "happy to chat" as needing response', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      bodyPreview: "I'm happy to chat whenever you have a free moment next week.",
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('should detect "available to meet" as needing response', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      bodyPreview: "I'm available to meet on Thursday if that works for your schedule.",
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('should detect inline question marks (not at end-of-line)', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      bodyPreview:
        'Can we push the deadline? The team is behind on the deliverables and we need more time.',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('should detect "Would these times work" as needing response', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      bodyPreview: 'Would these times work for a quick sync? Tuesday 2pm or Wednesday 10am.',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('should detect "free to call" as needing response', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      bodyPreview: "Are you free to call tomorrow afternoon? I'd like to discuss the proposal.",
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })
})

describe('Tier 1 pre-filter: automated email detection', () => {
  it('should filter out newsletter/noreply emails', async () => {
    const email = makeEmail({
      fromEmail: 'noreply@marketing.com',
      subject: 'Weekly Newsletter',
      bodyPreview: 'Check out our latest products and deals!',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should filter out emails with no question or action', async () => {
    const email = makeEmail({
      bodyPreview: 'Thanks for the update. Looks good.',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})

describe('Tier 1 pre-filter: cold outreach / sales detection', () => {
  it('should filter out emails with tracking tags in sender address', async () => {
    const email = makeEmail({
      fromEmail: 'isabella+c@lydoniaplan.com',
      fromName: 'Isabella Calcagno',
      subject: 'Pair of Air Jordans?',
      bodyPreview: "Isabella is proposing a discussion about Lydonia's custom AI agents that can self-fund deployments.",
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should filter out B2B sales pitches', async () => {
    const email = makeEmail({
      fromEmail: 'reid@meridiensports.com',
      fromName: 'Reid Mobley',
      subject: 'Re: Routeware - Motorsports B2B Opportunity 2026',
      bodyPreview: 'Reid is requesting to schedule a call to discuss the Routeware B2B motorsports opportunity.',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should filter out PR/media pitches', async () => {
    const email = makeEmail({
      fromEmail: 'amanda@ciobusinessviews.com',
      fromName: 'Amanda Williams',
      subject: 'Jeremy Collins share your thoughts to feature you in CEO special edition',
      bodyPreview: 'Amanda is following up on a previous proposal to feature Jeremy in a CEO special edition.',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should filter out recruiting/staffing cold outreach', async () => {
    const email = makeEmail({
      fromEmail: 'lincoln@sendbetteremployees.com',
      fromName: 'Lincoln',
      subject: "Re: We can steal your competitor's best salesperson",
      bodyPreview: "Lincoln is checking if Jeremy has any open roles that Wealthy Recruiting can help fill, as they're wrapping up their search.",
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should filter out staffing company body patterns', async () => {
    const email = makeEmail({
      fromEmail: 'justin@hawksemp.com',
      fromName: 'Justin DeSalvo',
      subject: 'question for Jeremy',
      bodyPreview: 'Justin is reaching out as a specialized personnel staffing company to discuss possible workforce needs.',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should NOT filter legitimate vendor emails', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      fromEmail: 'Cage.Cowan@rubicon.com',
      fromName: 'Cage Cowan',
      subject: 'Re: Rodina | Routeware | Rubicon',
      bodyPreview: 'Here is the 12-month customer service data. Do any of these numbers need adjustments?',
    })

    const result = await classifyMissedEmail(email)
    // Should reach AI, not be filtered at Tier 1
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  // Generalized pattern tests — these are NOT from the original examples.
  // They verify the patterns are predictive, not just matching known spam.

  it('should filter unseen SaaS pitch with flattery opener', async () => {
    const email = makeEmail({
      fromEmail: 'mike@salessoftware.io',
      fromName: 'Mike Chen',
      subject: 'Re: Streamlining your fleet ops',
      bodyPreview: 'I noticed your company on LinkedIn and thought you might be interested in our platform.',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should filter unseen demo request with time ask', async () => {
    const email = makeEmail({
      fromEmail: 'sarah@techvendor.com',
      fromName: 'Sarah Park',
      subject: 'Worth 15 min?',
      bodyPreview: 'Would love to show you how we help companies like yours reduce costs. Can I grab 20 minutes of your time?',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should filter unseen executive recruiter outreach', async () => {
    const email = makeEmail({
      fromEmail: 'james@elitesearch.com',
      fromName: 'James Rivera',
      subject: 'Confidential search - VP Operations',
      bodyPreview: 'Your background is a great fit for an exciting role. We have passive candidates but need a leader.',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('should filter unseen social-proof sales pitch', async () => {
    const email = makeEmail({
      fromEmail: 'dave@platformx.com',
      fromName: 'Dave Walsh',
      subject: 'Re: Quick intro',
      bodyPreview: "We've helped Waste Management achieve 30% cost savings. Can we book a quick 15-min call?",
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  // Signal scoring: a single soft signal (e.g., calendly link) should NOT
  // filter the email — real contacts share calendar links too. Only filter
  // when multiple signals accumulate.

  it('should NOT filter legitimate email with a calendly link (single soft signal)', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      fromEmail: 'dan.franck@samsara.com',
      fromName: 'Dan Franck',
      subject: 'Re: Meeting',
      bodyPreview: "Here's my calendly link — pick any time that works to review the contract.",
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('should NOT filter legitimate email asking for 15 minutes', async () => {
    mockCreate
      .mockResolvedValueOnce(makeTriageResponse(true))
      .mockResolvedValueOnce(makeAnalysisResponse())

    const email = makeEmail({
      fromEmail: 'Cage.Cowan@rubicon.com',
      fromName: 'Cage Cowan',
      subject: 'Re: Quarterly review',
      bodyPreview: 'Do you have 15 minutes to walk through the Q3 fleet numbers before the board meeting?',
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).toHaveBeenCalled()
    expect(result).not.toBeNull()
  })

  it('should filter cold outreach that combines multiple soft signals', async () => {
    const email = makeEmail({
      fromEmail: 'stranger@unknownco.com',
      fromName: 'Alex Johnson',
      subject: 'Re: Fleet optimization',
      bodyPreview: "I'd love to show you a demo. Here's my calendly link to grab a quick 15-min call.",
    })

    const result = await classifyMissedEmail(email)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})
