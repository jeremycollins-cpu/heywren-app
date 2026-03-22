import { inngest } from '../client'
import { createClient } from '@/lib/supabase/server'
import { detectCommitments } from '@/lib/ai/detect-commitments'

export const processSlackMessage = inngest.createFunction(
  { id: 'process-slack-message' },
  { event: 'slack/message.received' },
  async ({ event }) => {
    const supabase = await createClient()

    // Store the message
    const { data: messageData, error: messageError } = await supabase
      .from('slack_messages')
      .insert({
        team_id: event.data.team_id,
        channel_id: event.data.channel_id,
        user_id: event.data.user_id,
        message_text: event.data.text,
        message_ts: event.data.ts,
        thread_ts: event.data.thread_ts,
        processed: false,
      })
      .select()
      .single()

    if (messageError) {
      console.error('Failed to store message:', messageError)
      return { success: false, error: messageError }
    }

    // Detect commitments using Claude
    const commitments = await detectCommitments(event.data.text)

    if (commitments.length === 0) {
      await supabase
        .from('slack_messages')
        .update({ processed: true, commitments_found: 0 })
        .eq('id', messageData.id)

      return { success: true, commitments: [] }
    }

    // Create commitment records
    const commitmentRecords = await Promise.all(
      commitments.map((commitment) =>
        supabase.from('commitments').insert({
          team_id: event.data.team_id,
          creator_id: event.data.user_id,
          title: commitment.title,
          description: commitment.description,
          status: 'pending',
          priority_score: commitment.confidence,
          source: 'slack',
          source_message_id: messageData.id,
          due_date: commitment.dueDate,
        })
      )
    )

    await supabase
      .from('slack_messages')
      .update({ processed: true, commitments_found: commitments.length })
      .eq('id', messageData.id)

    return { success: true, commitments: commitments.length }
  }
)
