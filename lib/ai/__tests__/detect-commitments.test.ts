/**
 * Tests for the AI commitment detection pipeline.
 *
 * The module uses a 3-tier approach:
 *   Tier 1: Free regex pre-filter (likelyContainsCommitment)
 *   Tier 2: Haiku triage (cheap yes/no via tool_use)
 *   Tier 3: Sonnet full analysis (extraction via tool_use)
 *
 * We test the exported functions and the internal logic by mocking the Anthropic SDK.
 */

import { calculatePriorityScore, getDetectionStats, detectCommitments, detectCommitmentsBatch } from '../detect-commitments'
import type { DetectedCommitment } from '../detect-commitments'

// ─── Mock Anthropic SDK ─────────────────────────────────────────────────────
// Jest hoists jest.mock above variable declarations.
// Variables named `mock*` are allowed by Jest's hoist transform.

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: class MockAnthropic {
      messages = { create: (...args: any[]) => mockCreate(...args) }
    },
  }
})

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a mock Haiku triage response (tool_use with classify_message).
 */
function makeHaikuResponse(hasCommitment: boolean) {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'classify_message',
        input: { has_commitment: hasCommitment },
      },
    ],
  }
}

/**
 * Build a mock Sonnet response (tool_use with extract_commitments).
 */
function makeSonnetResponse(commitments: DetectedCommitment[]) {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'extract_commitments',
        input: { commitments },
      },
    ],
  }
}

/**
 * Build a mock Sonnet batch response (tool_use with extract_batch_commitments).
 */
function makeBatchSonnetResponse(results: Record<string, DetectedCommitment[]>) {
  return {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_test',
        name: 'extract_batch_commitments',
        input: { results },
      },
    ],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('calculatePriorityScore', () => {
  it('returns a higher score for high-priority commitments', () => {
    const high: DetectedCommitment = {
      title: 'Ship feature',
      description: 'Ship the new feature by Friday',
      priority: 'high',
      confidence: 0.9,
    }
    const low: DetectedCommitment = {
      title: 'Clean up docs',
      description: 'Minor doc update',
      priority: 'low',
      confidence: 0.5,
    }
    expect(calculatePriorityScore(high)).toBeGreaterThan(calculatePriorityScore(low))
  })

  it('clamps the score between 0 and 100', () => {
    const extreme: DetectedCommitment = {
      title: 'test',
      description: 'test',
      priority: 'high',
      confidence: 1.0,
      dueDate: '2026-01-01',
    }
    const score = calculatePriorityScore(extreme)
    expect(score).toBeGreaterThanOrEqual(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('gives a boost for having a due date', () => {
    const withDue: DetectedCommitment = {
      title: 'Deploy',
      description: 'Deploy by EOD',
      priority: 'medium',
      confidence: 0.7,
      dueDate: '2026-04-01',
    }
    const withoutDue: DetectedCommitment = {
      title: 'Deploy',
      description: 'Deploy by EOD',
      priority: 'medium',
      confidence: 0.7,
    }
    expect(calculatePriorityScore(withDue)).toBeGreaterThan(
      calculatePriorityScore(withoutDue)
    )
  })

  it('returns lower score for low confidence', () => {
    const highConf: DetectedCommitment = {
      title: 'test',
      description: 'test',
      priority: 'medium',
      confidence: 0.95,
    }
    const lowConf: DetectedCommitment = {
      title: 'test',
      description: 'test',
      priority: 'medium',
      confidence: 0.5,
    }
    expect(calculatePriorityScore(highConf)).toBeGreaterThan(
      calculatePriorityScore(lowConf)
    )
  })

  it('handles edge case confidence of exactly 0.5', () => {
    const commitment: DetectedCommitment = {
      title: 'test',
      description: 'test',
      priority: 'medium',
      confidence: 0.5,
    }
    // base=50, confidenceBoost=0, dueDate=0 => 50
    expect(calculatePriorityScore(commitment)).toBe(50)
  })
})

describe('getDetectionStats', () => {
  it('returns stats and resets them after retrieval', () => {
    // First call to clear any state from previous tests
    getDetectionStats()

    const stats = getDetectionStats()
    expect(stats).toEqual({
      tier1_filtered: 0,
      tier2_filtered: 0,
      tier3_analyzed: 0,
      errors: 0,
    })
  })
})

describe('detectCommitments - Tier 1 filtering', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    getDetectionStats() // reset stats
  })

  it('returns empty array for very short messages (under 20 chars)', async () => {
    const result = await detectCommitments('hi there')
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns empty array for common non-commitment phrases', async () => {
    const nonCommitments = ['thanks', 'thank you', 'sounds good', 'got it', 'ok', 'okay', 'lgtm', 'approved']
    for (const msg of nonCommitments) {
      const result = await detectCommitments(msg)
      expect(result).toEqual([])
    }
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns empty array for channel join messages', async () => {
    const result = await detectCommitments('has joined the channel and is ready to go')
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns empty array for messages without commitment keywords', async () => {
    const result = await detectCommitments(
      'The weather is beautiful today and I enjoyed my lunch'
    )
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('passes messages with commitment keywords to Tier 2', async () => {
    mockCreate
      .mockResolvedValueOnce(makeHaikuResponse(false))

    const result = await detectCommitments(
      "I'll send you the report by Friday"
    )
    expect(result).toEqual([])
    // Should have called Haiku triage
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})

describe('detectCommitments - Tier 2 and Tier 3', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    getDetectionStats()
  })

  it('stops at Tier 2 when Haiku says no', async () => {
    mockCreate.mockResolvedValueOnce(makeHaikuResponse(false))

    const result = await detectCommitments(
      "I'll get back to you on the project timeline soon"
    )

    expect(result).toEqual([])
    expect(mockCreate).toHaveBeenCalledTimes(1) // Only Haiku, no Sonnet
  })

  it('proceeds to Tier 3 when Haiku says yes and returns commitments', async () => {
    const expectedCommitments: DetectedCommitment[] = [
      {
        title: 'Send report',
        description: 'Send the quarterly report by Friday',
        priority: 'high',
        confidence: 0.9,
        dueDate: '2026-03-28',
        assignee: undefined,
      },
    ]

    mockCreate
      .mockResolvedValueOnce(makeHaikuResponse(true))
      .mockResolvedValueOnce(makeSonnetResponse(expectedCommitments))

    const result = await detectCommitments(
      "I'll send you the quarterly report by Friday without fail"
    )

    expect(result).toEqual(expectedCommitments)
    expect(mockCreate).toHaveBeenCalledTimes(2) // Haiku + Sonnet
  })

  it('handles Sonnet returning empty commitments array', async () => {
    mockCreate
      .mockResolvedValueOnce(makeHaikuResponse(true))
      .mockResolvedValueOnce(makeSonnetResponse([]))

    const result = await detectCommitments(
      "I need to think about this more before committing"
    )

    expect(result).toEqual([])
  })

  it('returns empty array and increments errors on API failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'))

    const result = await detectCommitments(
      "I'll finish the deployment by end of day"
    )

    expect(result).toEqual([])
    const stats = getDetectionStats()
    expect(stats.errors).toBe(1)
  })

  it('handles Haiku failure gracefully (fail open)', async () => {
    // When Haiku throws, it should return true (fail open) and proceed to Sonnet
    mockCreate
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(makeSonnetResponse([]))

    const result = await detectCommitments(
      "I promise to review the PR by tomorrow"
    )

    expect(result).toEqual([])
    // Should have tried both Haiku and Sonnet
    expect(mockCreate).toHaveBeenCalledTimes(2)
  })

  it('handles Sonnet tool_use response correctly', async () => {
    const commitments: DetectedCommitment[] = [
      {
        title: 'Review PR',
        description: 'Review the pull request',
        priority: 'medium',
        confidence: 0.8,
      },
    ]

    mockCreate
      .mockResolvedValueOnce(makeHaikuResponse(true))
      .mockResolvedValueOnce(makeSonnetResponse(commitments))

    const result = await detectCommitments(
      "I will review the pull request by end of day"
    )

    expect(result).toEqual(commitments)
  })
})

describe('detectCommitmentsBatch', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    getDetectionStats()
  })

  it('filters out messages that do not pass Tier 1', async () => {
    const messages = [
      { id: '1', text: 'thanks' },
      { id: '2', text: 'ok' },
      { id: '3', text: 'The weather is nice today and I feel great' },
    ]

    const results = await detectCommitmentsBatch(messages)

    expect(results.size).toBe(3)
    expect(results.get('1')).toEqual([])
    expect(results.get('2')).toEqual([])
    expect(results.get('3')).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('processes qualifying messages through all tiers', async () => {
    const messages = [
      { id: 'a', text: "I'll send the report by Friday to the whole team" },
      { id: 'b', text: 'sounds good' },
      { id: 'c', text: "Please review the PR and let me know your thoughts" },
    ]

    // Haiku triage for message 'a' -> yes
    mockCreate.mockResolvedValueOnce(makeHaikuResponse(true))
    // Haiku triage for message 'c' -> yes
    mockCreate.mockResolvedValueOnce(makeHaikuResponse(true))
    // Sonnet batch analysis via tool_use
    mockCreate.mockResolvedValueOnce(makeBatchSonnetResponse({
      '1': [
        {
          title: 'Send report',
          description: 'Send report by Friday',
          priority: 'high',
          confidence: 0.9,
        },
      ],
      '2': [],
    }))

    const results = await detectCommitmentsBatch(messages)

    expect(results.get('a')).toHaveLength(1)
    expect(results.get('a')![0].title).toBe('Send report')
    expect(results.get('b')).toEqual([])
    expect(results.get('c')).toEqual([])
  })

  it('returns empty results when all candidates fail Haiku triage', async () => {
    const messages = [
      { id: '1', text: "I'll think about whether we need to schedule a meeting" },
    ]

    mockCreate.mockResolvedValueOnce(makeHaikuResponse(false))

    const results = await detectCommitmentsBatch(messages)
    expect(results.get('1')).toEqual([])
    // Only Haiku call, no Sonnet
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('handles Sonnet batch failure gracefully', async () => {
    const messages = [
      { id: '1', text: "I promise to deliver the project plan by next Monday" },
    ]

    mockCreate.mockResolvedValueOnce(makeHaikuResponse(true))
    mockCreate.mockRejectedValueOnce(new Error('API error'))

    const results = await detectCommitmentsBatch(messages)
    expect(results.get('1')).toEqual([])
  })
})
