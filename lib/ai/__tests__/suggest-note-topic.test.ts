/**
 * Tests for the topic suggestion module.
 *
 * The module asks Haiku to either pick an existing topic id or propose a new
 * topic name. We validate id matches against the supplied topic list to defend
 * against hallucination, so the tests cover that case.
 */

import { suggestNoteTopic } from '../suggest-note-topic'

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: class MockAnthropic {
      messages = { create: (...args: any[]) => mockCreate(...args) }
    },
  }
})

function makeToolResponse(input: any) {
  return {
    content: [{ type: 'tool_use', id: 'toolu_t', name: 'assign_topic', input }],
    usage: { input_tokens: 50, output_tokens: 20 },
  }
}

beforeEach(() => mockCreate.mockReset())

const TOPICS = [
  { id: 't-1', name: 'Q3 Planning', parent_id: null },
  { id: 't-2', name: 'Customer Calls', parent_id: null },
]

describe('suggestNoteTopic', () => {
  it('returns the matched existing topic id when valid', async () => {
    mockCreate.mockResolvedValue(makeToolResponse({
      decision: 'existing',
      existing_topic_id: 't-1',
      reason: 'Note covers Q3 priorities.',
    }))

    const result = await suggestNoteTopic({
      noteTitle: 'Q3 priorities meeting',
      noteSummary: 'Reviewed Q3 OKRs and roadmap',
      existingTopics: TOPICS,
    })
    expect(result?.existingTopicId).toBe('t-1')
    expect(result?.newTopicName).toBeNull()
  })

  it('rejects a hallucinated existing topic id', async () => {
    mockCreate.mockResolvedValue(makeToolResponse({
      decision: 'existing',
      existing_topic_id: 'totally-made-up-id',
      reason: 'fake',
    }))

    const result = await suggestNoteTopic({
      noteTitle: 'x', noteSummary: 'x', existingTopics: TOPICS,
    })
    expect(result).toBeNull()
  })

  it('returns a proposed new topic when no existing topic fits', async () => {
    mockCreate.mockResolvedValue(makeToolResponse({
      decision: 'new',
      new_topic_name: 'Hiring',
      reason: 'No existing topic about hiring.',
    }))

    const result = await suggestNoteTopic({
      noteTitle: 'Interview debrief',
      noteSummary: 'Debriefed candidate Alex; strong hire',
      existingTopics: TOPICS,
    })
    expect(result?.newTopicName).toBe('Hiring')
    expect(result?.newTopicParentId).toBeNull()
  })

  it('drops invalid parent ids when proposing a new topic', async () => {
    mockCreate.mockResolvedValue(makeToolResponse({
      decision: 'new',
      new_topic_name: 'Acme',
      new_topic_parent_id: 'nope',
      reason: 'invalid parent',
    }))

    const result = await suggestNoteTopic({
      noteTitle: 'x', noteSummary: 'x', existingTopics: TOPICS,
    })
    expect(result?.newTopicName).toBe('Acme')
    expect(result?.newTopicParentId).toBeNull()
  })

  it('handles empty topic tree by always proposing new', async () => {
    mockCreate.mockResolvedValue(makeToolResponse({
      decision: 'new',
      new_topic_name: 'Personal',
      reason: 'no topics yet',
    }))

    const result = await suggestNoteTopic({
      noteTitle: 'x', noteSummary: 'x', existingTopics: [],
    })
    expect(result?.newTopicName).toBe('Personal')
  })

  it('returns null on SDK error', async () => {
    mockCreate.mockRejectedValue(new Error('boom'))
    const result = await suggestNoteTopic({
      noteTitle: 'x', noteSummary: 'x', existingTopics: TOPICS,
    })
    expect(result).toBeNull()
  })
})
