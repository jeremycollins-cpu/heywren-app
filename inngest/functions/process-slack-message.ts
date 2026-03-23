// inngest/functions/process-slack-message.ts
// Handles passively monitored Slack messages (NOT @HeyWren mentions — see process-slack-mention.ts)
// Stores messages, runs AI detection, creates commitment records.
// FIXED: correct column names, enum values, and creator_id lookup

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments } from '@/lib/ai/detect-commitments'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const processSlackMessage = inngest.createFunction(
  {
    id: 'process-slack-message',
    retries: 2,
    concurrency: { limit: 10 },
  },
  { event: 'slack/message.received' },
  async ({ event, step }) => {
    const supabase = getAdminClient()

    const slackTeamId = event.data.team_id
    const slackUserId = event.data.user_id

    // ── Look up the HeyWren team UUID from the Slack team ID ──
    const integration = await step.run('lookup-team', async () => {
      const { data, error } = await supabase
        .from('integrations')
        .select('team_id, config')
        .eq('provider', 'slack')
        .filter('config->>slack_team_id', 'eq', slackTeamId)
        .single()

      if (error || !data) {
        console.error('No HeyWren team for Slack team:', slackTeamId, error)
        return null
      }
      return data
    })

    if (!integration) {
      return { success: false, error: 'No matching team found' }
    }

    const teamId = integration.team_id

    // ── Store the Slack message ──
    const messageData = await step.run('store-message', async () => {
      const { data, error } = await supabase
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
        .select('id')
        .single()

      if (error) {
        console.error('Failed to store Slack message:', error)
        return null
      }
      return data
    })

    if (!messageData) {
      return { success: false, error: 'Failed to store message' }
    }

    // ── Skip empty/short messages ──
    if (!event.data.text || event.data.text.trim().length < 15) {
      await step.run('mark-skipped', async () => {
        await supabase
          .from('slack_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', messageData.id)
      })
      return { success: true, commitments: 0, reason: 'Message too short' }
    }

    // ── Detect commitments using AI ──
    const commitments = await step.run('detect-commitments', async () => {
      try {
        return (await detectCommitments(event.data.text)) || []
      } catch (err) {
        console.error('AI commitment detection failed:', err)
        return []
      }
    })

    if (commitments.length === 0) {
      await step.run('mark-no-commitments', async () => {
        await supabase
          .from('slack_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', messageData.id)
      })
      return { success: true, commitments: 0 }
    }

    // ── Find a creator_id (required: NOT NULL in schema) ──
    const creatorId = await step.run('resolve-creator', async () => {
      // Try: person who connected the Slack integration
      const connectedBy = integration.config?.connected_by
      if (connectedBy) return connectedBy

      // Try: team owner
      const { data: team } = await supabase
        .from('teams')
        .select('owner_id')
        .eq('id', teamId)
        .single()
      if (team?.owner_id) return team.owner_id

      // Try: any team member
      const { data: member } = await supabase
        .from('team_members')
        .select('user_id')
        .eq('team_id', teamId)
        .limit(1)
        .single()
      return member?.user_id || null
    })

    if (!creatorId) {
      console.error('No creator_id available for team:', teamId)
      await step.run('mark-failed', async () => {
        await supabase
          .from('slack_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', messageData.id)
      })
      return { success: false, error: 'No creator_id available' }
    }

    // ── Create commitment records (with CORRECT columns and enums) ──
    const insertResults = await step.run('insert-commitments', async () => {
      return Promise.all(
        commitments.map(async (commitment) => {
          const { data, error } = await supabase
            .from('commitments')
            .insert({
              team_id: teamId,
              creator_id: creatorId,          // NOT NULL — resolved above
              title: commitment.title,
              description: commitment.description || null,
              status: 'open',                 // NOT 'pending' — correct enum
              source: 'slack',                // commitment_source enum
              source_ref: messageData.id,     // NOT 'source_message_id'
            })
            .select('id')
            .single()

          if (error) {
            console.error('Failed to insert commitment:', JSON.stringify({
              error: error.message,
              code: error.code,
              title: commitment.title,
            }))
            return null
          }
          return data
        })
      )
    })

    const successCount = insertResults.filter(Boolean).length

    // ── Mark message as processed ──
    await step.run('mark-processed', async () => {
      await supabase
        .from('slack_messages')
        .update({ processed: true, commitments_found: successCount })
        .eq('id', messageData.id)
    })

    return { success: true, commitments: successCount }
  }
)
