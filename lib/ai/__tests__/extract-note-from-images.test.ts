/**
 * Tests for the Notes vision extraction pipeline.
 *
 * The module wraps Claude vision with a forced tool call (record_note) so the
 * response shape is always structured. We mock the SDK and check that:
 *   - empty inputs return null
 *   - happy-path returns the extraction
 *   - SDK errors are caught and return null
 *   - missing tool_use block returns null
 */

import { extractNoteFromImages } from '../extract-note-from-images'

const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: class MockAnthropic {
      messages = { create: (...args: any[]) => mockCreate(...args) }
    },
  }
})

function makeToolUseResponse(input: any) {
  return {
    content: [{ type: 'tool_use', id: 'toolu_test', name: 'record_note', input }],
    usage: { input_tokens: 100, output_tokens: 50 },
  }
}

beforeEach(() => {
  mockCreate.mockReset()
})

describe('extractNoteFromImages', () => {
  it('returns null when no images supplied', async () => {
    const result = await extractNoteFromImages([])
    expect(result).toBeNull()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns the structured extraction on happy path', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse({
      title: 'Acme account planning',
      transcription: 'Discussed Q3 priorities. Sarah will send deck Friday.',
      summary: '- Q3 priorities reviewed\n- Sarah owns the deck',
      per_image_transcriptions: [
        { position: 0, transcription: 'page 1 text' },
        { position: 1, transcription: 'page 2 text' },
      ],
      candidate_todos: ['Review Q3 deck'],
      candidate_commitments: ['Sarah will send the deck Friday'],
    }))

    const result = await extractNoteFromImages([
      { position: 0, mediaType: 'image/jpeg', base64: 'AAAA' },
      { position: 1, mediaType: 'image/jpeg', base64: 'BBBB' },
    ])

    expect(result).not.toBeNull()
    expect(result!.title).toBe('Acme account planning')
    expect(result!.transcription).toContain('Q3 priorities')
    expect(result!.candidateTodos).toEqual(['Review Q3 deck'])
    expect(result!.candidateCommitments).toEqual(['Sarah will send the deck Friday'])
    expect(result!.perImage).toHaveLength(2)
  })

  it('falls back to "Untitled note" when title missing', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse({
      title: '',
      transcription: 'some text',
      summary: 'a summary',
      per_image_transcriptions: [],
      candidate_todos: [],
      candidate_commitments: [],
    }))

    const result = await extractNoteFromImages([
      { position: 0, mediaType: 'image/png', base64: 'AAA' },
    ])
    expect(result!.title).toBe('Untitled note')
  })

  it('returns null when SDK throws', async () => {
    mockCreate.mockRejectedValue(new Error('api blew up'))
    const result = await extractNoteFromImages([
      { position: 0, mediaType: 'image/jpeg', base64: 'AA' },
    ])
    expect(result).toBeNull()
  })

  it('returns null when response has no tool_use block', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'sorry, no tool use' }],
      usage: { input_tokens: 10, output_tokens: 10 },
    })
    const result = await extractNoteFromImages([
      { position: 0, mediaType: 'image/jpeg', base64: 'AA' },
    ])
    expect(result).toBeNull()
  })

  it('sorts images by position before sending to the SDK', async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse({
      title: 't', transcription: 'x', summary: 's',
      per_image_transcriptions: [], candidate_todos: [], candidate_commitments: [],
    }))

    await extractNoteFromImages([
      { position: 2, mediaType: 'image/jpeg', base64: 'C' },
      { position: 0, mediaType: 'image/jpeg', base64: 'A' },
      { position: 1, mediaType: 'image/jpeg', base64: 'B' },
    ])

    const sent = mockCreate.mock.calls[0][0]
    const userMessage = sent.messages[0].content
    // First block is the text instruction; the rest are images in position order.
    const imageBlocks = userMessage.filter((b: any) => b.type === 'image')
    expect(imageBlocks.map((b: any) => b.source.data)).toEqual(['A', 'B', 'C'])
  })
})
