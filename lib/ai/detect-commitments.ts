import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export interface DetectedCommitment {
  title: string
  description: string
  assignee?: string
  dueDate?: string
  priority: 'high' | 'medium' | 'low'
  confidence: number
}

/**
 * Extract JSON from a string that might be wrapped in markdown code fences.
 * Claude often returns ```json { ... } ``` instead of raw JSON.
 */
function extractJSON(text: string): string {
  // Remove markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }
  // Try to find a JSON object directly
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    return jsonMatch[0]
  }
  return text.trim()
}

export async function detectCommitments(
  messageText: string
): Promise<DetectedCommitment[]> {
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are an AI assistant that detects commitments, promises, and action items in messages.

For each message, identify any implicit or explicit commitments someone is making. Look for:
- Promises to do something ("I'll send that over", "Let me check on that")
- Deadlines mentioned ("by Friday", "end of week", "tomorrow")
- Action items ("Can you review this?", "Please update the doc")
- Follow-ups needed ("I'll get back to you", "Let me circle back")
- Requests with expected responses

Return ONLY a valid JSON object (no markdown, no code fences) with this structure:
{
  "commitments": [
    {
      "title": "short task title",
      "description": "detailed description of what was committed to",
      "assignee": "person name if mentioned",
      "dueDate": "ISO date if mentioned, null otherwise",
      "priority": "high|medium|low",
      "confidence": 0.0-1.0
    }
  ]
}

If there are no commitments, return: {"commitments": []}
Only include commitments with at least 0.5 confidence. Be thorough — many casual promises are real commitments.`,
      messages: [
        {
          role: 'user',
          content: `Analyze this message for commitments and action items:\n\n"${messageText}"`,
        },
      ],
    })

    const content = message.content[0]
    if (content.type === 'text') {
      const jsonStr = extractJSON(content.text)
      const parsed = JSON.parse(jsonStr)
      const commitments = parsed.commitments || []

      if (commitments.length > 0) {
        console.log('Found ' + commitments.length + ' commitments in message: "' + messageText.substring(0, 60) + '..."')
      }

      return commitments
    }
  } catch (error) {
    // Log the actual error so we can debug — don't swallow silently
    console.error('Commitment detection failed:', (error as Error).message)
    if ((error as Error).message?.includes('authentication') || (error as Error).message?.includes('api_key')) {
      console.error('ANTHROPIC_API_KEY may be invalid or expired!')
    }
  }

  return []
}
