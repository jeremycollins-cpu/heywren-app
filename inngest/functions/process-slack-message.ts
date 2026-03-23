import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments } from '@/lib/ai/detect-commitments'

// Admin client for background functions — no cookies/auth context available
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const processSlackMessage = inngest.createFunction(
  { id: 'process-slack-message' },
  { event: 'slack/message.received' },
  async ({ event }) => {
    const supabase = getAdminClient()

    const slackTeamId = event.data.team_id
    const slackUserId = event.data.user_id

    // Look up the HeyWren team UUID from the Slack team ID
    // The integrations table stores slack_team_id in config
    const { data: integration, error: intErr } = await supabase
      .from('integrations')
      .select('team_id')
      .eq('provider', 'slack')
      .filter('config->>slack_team_id', 'eq', slackTeamId)
      .single()

    if (intErr || !integration) {
      console.error(
        'Could not find HeyWren team for Slack team:',
        slackTeamId,
        intErr
      )
      return { success: false, error: 'No matching team found for Slack workspace' }
    }

    const teamId = integration.team_id

    // Store the Slack message
    const { data: messageData, error: messageError } = await supabase
      .from('slack_messages')
      .insert({
        team_id: teamId,
        channel_id: event.data.channel_id,
        user_id: slackUserId,
        message_text: event.data.text,
        message_ts: event.data.ts,
        thread_ts: event.data.thread_ts || null,
        processed: false,
      })
      .select()
      .single()

    if (messageError) {
      console.error('Failed to store Slack message:', messageError)
      return { success: false, error: messageError.message }
    }

    // Skip empty messages
    if (!event.data.text || event.data.text.trim().length === 0) {
      await supabase
        .from('slack_messages')
        .update({ processed: true, commitments_found: 0 })
        .eq('id', messageData.id)

      return { success: true, commitments: [] }
    }

    // Detect commitments using Claude
    let commitments
    try {
      commitments = await detectCommitments(event.data.text)
    } catch (aiErr) {
      console.error('AI commitment detection failed:', aiErr)
      await supabase
        .from('slack_messages')
        .update({ processed: true, commitments_found: 0 })
        .eq('id', messageData.id)

      return { success: false, error: 'AI detection failed' }
    }

    if (!commitments || commitments.length === 0) {
      await supabase
        .from('slack_messages')
        .update({ processed: true, commitments_found: 0 })
        .eq('id', messageData.id)

      return { success: true, commitments: [] }
    }

    // Create commitment records
    // Note: creator_id is left null because Slack user IDs don't map to auth.users UUIDs
    // In future, you can build a mapping table (slack_user_id -> supabase_user_id)
    const insertResults = await Promise.all(
      commitments.map((commitment) =>
        supabase
          .from('commitments')
          .insert({
            team_id: teamId,
            creator_id: null,
            title: commitment.title,
            description: commitment.description,
            status: 'pending',
            priority_score: commitment.confidence,
            source: 'slack',
            source_message_id: messageData.id,
            due_date: commitment.dueDate || null,
          })
          .select()
      )
    )

    // Log any insert errors
    insertResults.forEach((result, i) => {
      if (result.error) {
        console.error('Failed to insert commitment ' + i + ':', result.error)
      }
    })

    const successCount = insertResults.filter((r) => !r.error).length

    await supabase
      .from('slack_messages')
      .update({ processed: true, commitments_found: successCount })
      .eq('id', messageData.id)

    return { success: true, commitments: successCount }
  }
)
