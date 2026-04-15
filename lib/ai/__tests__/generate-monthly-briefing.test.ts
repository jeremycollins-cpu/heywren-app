/**
 * Tests for the monthly-briefing synthesis tool-use wrapper. We mock the
 * Anthropic SDK so the test runs without network/keys and assert on the
 * parsed shape.
 */

import { generateMonthlyBriefing } from '../generate-monthly-briefing'
import type { AggregatedDataSnapshot } from '@/lib/monthly-briefing/types'

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: class MockAnthropic {
    messages = { create: (...args: any[]) => mockCreate(...args) }
  },
}))

jest.mock('../token-usage', () => ({
  recordTokenUsage: jest.fn(),
}))

function snap(): AggregatedDataSnapshot {
  return {
    period: { start: '2026-03-01T00:00:00Z', end: '2026-03-31T23:59:59Z', label: 'March 2026' },
    user: { display_name: 'Jane CEO', job_title: 'CEO', company: 'Acme', email: 'jane@acme.test' },
    commitments: {
      total_created: 10, total_completed: 6, total_overdue: 2, completion_rate_pct: 60,
      top_by_priority: [{ title: 'Close Acme renewal', status: 'completed', source: 'email', priority_score: 90, due_date: null }],
      overdue_samples: [], completed_samples: [],
    },
    calendar: { total_meetings: 18, total_meeting_hours: 22.5, top_attendees: [], recurring_themes: [] },
    meetings_with_transcripts: [],
    emails: { missed_total: 4, missed_urgent: 1, awaiting_replies_total: 3, categories: {}, top_correspondents: [] },
    chats: { missed_total: 2, missed_urgent: 0, channels_active: [] },
    uploaded_context: [],
    user_notes: null,
  }
}

describe('generateMonthlyBriefing', () => {
  beforeEach(() => { mockCreate.mockReset() })

  it('parses a tool-use response into a typed briefing', async () => {
    mockCreate.mockResolvedValueOnce({
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [{
        type: 'tool_use',
        name: 'compose_monthly_briefing',
        input: {
          title: 'March 2026 — Stabilizing the Foundation',
          subtitle: 'Execution is catching up with ambition.',
          sections: [
            {
              section_type: 'highlights',
              title: 'Highlights',
              summary: 'Renewal closed; velocity improving.',
              bullets: [
                { heading: 'Acme renewal closed', detail: 'Multi-year deal signed.', severity: 'positive' },
              ],
            },
            {
              section_type: 'risks',
              title: 'Risks',
              summary: 'Hiring is lagging.',
              bullets: [
                { heading: 'India lead hire overdue', detail: '30 days past target.', severity: 'watch' },
              ],
            },
          ],
        },
      }],
    })

    const result = await generateMonthlyBriefing(snap())
    expect(result).not.toBeNull()
    expect(result!.title).toContain('March 2026')
    expect(result!.sections).toHaveLength(2)
    expect(result!.sections[0].section_type).toBe('highlights')
    expect(result!.sections[1].bullets[0].severity).toBe('watch')
  })

  it('returns null when the AI returns no tool_use block', async () => {
    mockCreate.mockResolvedValueOnce({
      usage: { input_tokens: 50, output_tokens: 10 },
      content: [{ type: 'text', text: 'I could not generate one.' }],
    })
    const result = await generateMonthlyBriefing(snap())
    expect(result).toBeNull()
  })

  it('returns null on SDK errors', async () => {
    mockCreate.mockRejectedValueOnce(new Error('boom'))
    const result = await generateMonthlyBriefing(snap())
    expect(result).toBeNull()
  })

  it('sends cache_control: ephemeral on the system prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'tool_use', name: 'compose_monthly_briefing', input: { title: 't', subtitle: 's', sections: [] } }],
    })
    await generateMonthlyBriefing(snap())
    const call = mockCreate.mock.calls[0][0]
    expect(call.system).toBeDefined()
    expect(Array.isArray(call.system)).toBe(true)
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(call.tool_choice).toEqual({ type: 'tool', name: 'compose_monthly_briefing' })
  })
})
