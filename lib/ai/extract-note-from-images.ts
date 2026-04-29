// lib/ai/extract-note-from-images.ts
// Claude vision pipeline for the Notes feature: takes one or more images
// (handwritten notes, slide photos, whiteboard captures) and returns a
// structured note (title, full transcription, summary, candidate todos and
// commitments).
//
// We use Sonnet for vision quality on messy handwriting. Prompt caching is
// applied to the system prompt so repeated extractions are cheaper.

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface ExtractedNote {
  title: string
  transcription: string
  summary: string
  perImage: Array<{ position: number; transcription: string }>
  candidateTodos: string[]
  candidateCommitments: string[]
}

export interface NoteImageInput {
  position: number
  mediaType: string  // e.g. 'image/jpeg' | 'image/png' | 'image/webp'
  base64: string     // raw base64 (no data: prefix)
}

const SYSTEM_PROMPT = `You convert photos of notes into structured, faithful digital notes.

Source images may be:
- Handwritten notes (notebook page, sticky note, post-it)
- Presentation slides photographed at a conference
- Whiteboard or flipchart captures
- Printed handouts annotated by hand

For each image you see, transcribe the text faithfully. Preserve the writer's words — do not paraphrase or "improve" them. If text is illegible, mark it with [illegible]. Preserve bullet structure and headings.

Then produce:
- A short, descriptive title (5-10 words) that captures the topic
- A combined transcription across all images, in reading order
- An executive summary (3-6 bullets) of the key points, decisions, and questions
- Candidate todos — concrete personal action items the note-taker wrote down for themselves ("I need to email Sarah", "buy domain", "review Q3 budget")
- Candidate commitments — promises the note-taker made to others, or that others made to them, with names where present ("Sarah will send the deck Friday")

Be conservative with todos and commitments — only extract items that are clearly action-oriented. Do not invent items not present in the notes.`

const TOOL = {
  name: 'record_note',
  description: 'Record the structured extraction of the note photos.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'Short descriptive title, 5-10 words.',
      },
      transcription: {
        type: 'string',
        description: 'Faithful transcription of all images concatenated in reading order.',
      },
      summary: {
        type: 'string',
        description: 'Executive summary as a markdown bulleted list of key points.',
      },
      per_image_transcriptions: {
        type: 'array',
        description: 'Per-image transcription so the user can map text back to the source photo.',
        items: {
          type: 'object',
          properties: {
            position: { type: 'integer' },
            transcription: { type: 'string' },
          },
          required: ['position', 'transcription'],
        },
      },
      candidate_todos: {
        type: 'array',
        description: 'Personal action items the note-taker wrote for themselves.',
        items: { type: 'string' },
      },
      candidate_commitments: {
        type: 'array',
        description: 'Promises made to or by the note-taker, with names where present.',
        items: { type: 'string' },
      },
    },
    required: [
      'title',
      'transcription',
      'summary',
      'per_image_transcriptions',
      'candidate_todos',
      'candidate_commitments',
    ],
  },
}

export async function extractNoteFromImages(
  images: NoteImageInput[],
): Promise<ExtractedNote | null> {
  if (images.length === 0) return null

  const sortedImages = [...images].sort((a, b) => a.position - b.position)

  const userContent: Anthropic.MessageParam['content'] = [
    {
      type: 'text',
      text: `Extract a structured note from the ${sortedImages.length} image${sortedImages.length === 1 ? '' : 's'} below. Images are in reading order (positions ${sortedImages.map(i => i.position).join(', ')}).`,
    },
    ...sortedImages.map(img => ({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        data: img.base64,
      },
    })),
  ]

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any,
      ],
      tools: [TOOL] as any,
      tool_choice: { type: 'tool', name: 'record_note' } as any,
      messages: [{ role: 'user', content: userContent }],
    })

    recordTokenUsage(response.usage)

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      console.error('[extract-note] no tool_use block in response')
      return null
    }

    const input = toolBlock.input as {
      title: string
      transcription: string
      summary: string
      per_image_transcriptions: Array<{ position: number; transcription: string }>
      candidate_todos: string[]
      candidate_commitments: string[]
    }

    return {
      title: (input.title || '').trim() || 'Untitled note',
      transcription: (input.transcription || '').trim(),
      summary: (input.summary || '').trim(),
      perImage: (input.per_image_transcriptions || []).map(p => ({
        position: p.position,
        transcription: (p.transcription || '').trim(),
      })),
      candidateTodos: (input.candidate_todos || [])
        .map(t => t.trim())
        .filter(Boolean),
      candidateCommitments: (input.candidate_commitments || [])
        .map(t => t.trim())
        .filter(Boolean),
    }
  } catch (err) {
    console.error('[extract-note] failed:', (err as Error).message)
    return null
  }
}
