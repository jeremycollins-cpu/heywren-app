// lib/ai/suggest-note-topic.ts
// Given a freshly-extracted note and the user's existing topic tree, picks
// the closest existing topic — or proposes a new one (with optional parent)
// when nothing fits well. The user always has the final say in the UI.

import Anthropic from '@anthropic-ai/sdk'
import { recordTokenUsage } from './token-usage'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface ExistingTopic {
  id: string
  name: string
  parent_id: string | null
}

export interface TopicSuggestion {
  // If we found a good existing match, this is the topic id. Otherwise null.
  existingTopicId: string | null
  // If we propose a new topic, this is the suggested name and optional parent id.
  newTopicName: string | null
  newTopicParentId: string | null
  // Short rationale shown to the user under the suggestion chip.
  reason: string
}

const SYSTEM_PROMPT = `You assign new notes to topics in a user's hierarchical topic tree.

You will be given:
- The note's title and summary
- The list of the user's existing topics (with ids, names, and parent ids)

Decide one of:
1. Match an existing topic — return its id. Prefer this when a topic clearly fits.
2. Propose a new topic — return a short name (1-3 words). Optionally nest it under an existing parent topic.

Be conservative about creating new topics. Only propose one when no existing topic fits well. Topic names should be short, evergreen, and reusable (e.g. "Q3 Planning", "Customer Calls", "Engineering"), not specific to one note ("Sarah's whiteboard from Tuesday").`

const TOOL = {
  name: 'assign_topic',
  description: 'Assign the note to a topic — either an existing one or a newly proposed one.',
  input_schema: {
    type: 'object' as const,
    properties: {
      decision: {
        type: 'string',
        enum: ['existing', 'new'],
        description: 'Whether to use an existing topic or propose a new one.',
      },
      existing_topic_id: {
        type: 'string',
        description: 'When decision=existing, the id of the matching topic.',
      },
      new_topic_name: {
        type: 'string',
        description: 'When decision=new, the proposed topic name (1-3 words).',
      },
      new_topic_parent_id: {
        type: 'string',
        description: 'When decision=new, optional id of an existing parent topic to nest under.',
      },
      reason: {
        type: 'string',
        description: 'One short sentence explaining the choice (shown to the user).',
      },
    },
    required: ['decision', 'reason'],
  },
}

export async function suggestNoteTopic(params: {
  noteTitle: string
  noteSummary: string
  existingTopics: ExistingTopic[]
}): Promise<TopicSuggestion | null> {
  const { noteTitle, noteSummary, existingTopics } = params

  const topicList = existingTopics.length === 0
    ? '(none — user has no topics yet)'
    : existingTopics.map(t => {
        const parent = t.parent_id
          ? ` (under: ${existingTopics.find(p => p.id === t.parent_id)?.name || 'unknown'})`
          : ''
        return `- id=${t.id} name="${t.name}"${parent}`
      }).join('\n')

  const userMessage = `Note title: ${noteTitle}

Note summary:
${noteSummary}

Existing topics:
${topicList}

Pick an existing topic id if one fits, or propose a new short topic name.`

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } } as any,
      ],
      tools: [TOOL] as any,
      tool_choice: { type: 'tool', name: 'assign_topic' } as any,
      messages: [{ role: 'user', content: userMessage }],
    })

    recordTokenUsage(response.usage)

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (!toolBlock || toolBlock.type !== 'tool_use') return null

    const input = toolBlock.input as {
      decision: 'existing' | 'new'
      existing_topic_id?: string
      new_topic_name?: string
      new_topic_parent_id?: string
      reason: string
    }

    if (input.decision === 'existing' && input.existing_topic_id) {
      // Validate id against the input list — defends against hallucination.
      const valid = existingTopics.some(t => t.id === input.existing_topic_id)
      if (!valid) return null
      return {
        existingTopicId: input.existing_topic_id,
        newTopicName: null,
        newTopicParentId: null,
        reason: input.reason || '',
      }
    }

    if (input.decision === 'new' && input.new_topic_name) {
      const parentValid = input.new_topic_parent_id
        ? existingTopics.some(t => t.id === input.new_topic_parent_id)
        : true
      return {
        existingTopicId: null,
        newTopicName: input.new_topic_name.trim(),
        newTopicParentId: parentValid ? (input.new_topic_parent_id || null) : null,
        reason: input.reason || '',
      }
    }

    return null
  } catch (err) {
    console.error('[suggest-note-topic] failed:', (err as Error).message)
    return null
  }
}
