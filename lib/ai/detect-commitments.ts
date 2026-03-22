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

export async function detectCommitments(
  messageText: string
): Promise<DetectedCommitment[]> {
  const message = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    system: `You are an AI assistant that detects commitments and tasks in Slack messages. 
    
    For each message, identify any implicit or explicit commitments someone is making.
    Return a JSON array of detected commitments with the following structure:
    {
      "commitments": [
        {
          "title": "short task title",
          "description": "detailed description",
          "assignee": "person name if mentioned",
          "dueDate": "date if mentioned",
          "priority": "high|medium|low",
          "confidence": 0.0-1.0
        }
      ]
    }
    
    Only return actual commitments with at least 0.6 confidence. Be conservative.`,
    messages: [
      {
        role: 'user',
        content: `Analyze this Slack message for commitments:\n\n"${messageText}"`,
      },
    ],
  })

  try {
    const content = message.content[0]
    if (content.type === 'text') {
      const parsed = JSON.parse(content.text)
      return parsed.commitments || []
    }
  } catch (error) {
    console.error('Failed to parse Claude response:', error)
  }

  return []
}
