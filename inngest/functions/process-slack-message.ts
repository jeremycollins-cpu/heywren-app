// inngest/functions/process-slack-message.ts
// Handles passively monitored Slack messages (NOT @HeyWren mentions — see process-slack-mention.ts)
// Stores messages, runs AI detection, creates commitment records.
// FIXED: correct column names, enum values, and creator_id lookup

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments, calculatePriorityScore, type UserContext } from '@/lib/ai/detect-commitments'
import { detectCompletions } from '@/lib/ai/detect-completion'
import { scoreRelevance, RELEVANCE_THRESHOLD } from '@/lib/slack/relevance'

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
    concurrency: { limit: 5 },
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
        .select('team_id, config, access_token')
        .eq('provider', 'slack')
        .filter('config->>slack_team_id', 'eq', slackTeamId)
        .limit(1)
        .maybeSingle()

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

    // ── Touch integration updated_at so sync health doesn't show as stale ──
    await step.run('touch-integration', async () => {
      await supabase
        .from('integrations')
        .update({ updated_at: new Date().toISOString() })
        .eq('team_id', teamId)
        .eq('provider', 'slack')
    })

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

    // ── Find a creator_id (required: NOT NULL in schema) ──
    // First try to resolve the actual Slack message author to a HeyWren user
    const creatorId = await step.run('resolve-creator', async () => {
      // Try: match the Slack user ID to a HeyWren profile
      if (slackUserId) {
        const { data: authorProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('slack_user_id', slackUserId)
          .limit(1)
          .single()
        if (authorProfile?.id) return authorProfile.id
      }

      // Fallback: person who connected the Slack integration
      const connectedBy = integration.config?.connected_by
      if (connectedBy) return connectedBy

      // Fallback: team owner
      const { data: team } = await supabase
        .from('teams')
        .select('owner_id')
        .eq('id', teamId)
        .single()
      if (team?.owner_id) return team.owner_id

      // Fallback: any team member
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

    // ── Resolve user identity for AI context ──
    const userContext = await step.run('resolve-user-context', async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, slack_user_id')
        .eq('id', creatorId)
        .single()

      if (!profile?.display_name) return null
      return {
        userName: profile.display_name,
        slackUserId: profile.slack_user_id || null,
      } as UserContext
    })

    // ── Detect commitments using AI (with user context for filtering) ──
    const commitments = await step.run('detect-commitments', async () => {
      try {
        return (await detectCommitments(event.data.text, userContext || undefined)) || []
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

    // ── Score relevance to the user ──
    // Prevents noisy commitments from large channels where the user isn't involved
    const relevance = await step.run('score-relevance', async () => {
      const targetSlackId = userContext?.slackUserId || null

      // Get channel member count from Slack API
      let channelMemberCount: number | undefined
      const botToken = integration.access_token
      if (botToken) {
        try {
          const res = await fetch(`https://slack.com/api/conversations.info?channel=${event.data.channel_id}`, {
            headers: { 'Authorization': `Bearer ${botToken}` },
          })
          const info = await res.json()
          if (info.ok && info.channel?.num_members != null) {
            channelMemberCount = info.channel.num_members
          }
        } catch {
          // Non-fatal — score without channel size data
        }
      }

      return scoreRelevance({
        messageAuthorSlackId: slackUserId,
        channelId: event.data.channel_id,
        messageText: event.data.text,
        targetUserSlackId: targetSlackId,
        channelMemberCount,
        isThread: !!event.data.thread_ts,
      })
    })

    // Gate: skip commitment creation for low-relevance messages
    if (relevance.score < RELEVANCE_THRESHOLD) {
      await step.run('mark-low-relevance', async () => {
        await supabase
          .from('slack_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', messageData.id)
      })
      return {
        success: true,
        commitments: 0,
        reason: `Below relevance threshold (${relevance.score.toFixed(2)}): ${relevance.reason}`,
      }
    }

    // ── Build Slack permalink for deep linking ──
    // Format: https://slack.com/archives/{channel_id}/p{ts_without_dot}
    const channelId = event.data.channel_id
    const messageTs = event.data.ts
    const slackPermalink = channelId && messageTs
      ? `https://slack.com/archives/${channelId}/p${messageTs.replace('.', '')}`
      : null

    // ── Separate outbound (user's commitments) from inbound (promises TO user) ──
    const outboundCommitments = commitments.filter(c => c.direction !== 'inbound')
    const inboundCommitments = commitments.filter(c => c.direction === 'inbound')

    // ── Create commitment records for OUTBOUND (things user committed to) ──
    const insertResults = await step.run('insert-commitments', async () => {
      return Promise.all(
        outboundCommitments.map(async (commitment) => {
          const metadata: Record<string, unknown> = {}
          if (commitment.urgency) metadata.urgency = commitment.urgency
          if (commitment.tone) metadata.tone = commitment.tone
          if (commitment.commitmentType) metadata.commitmentType = commitment.commitmentType
          if (commitment.stakeholders?.length) metadata.stakeholders = commitment.stakeholders
          if (commitment.originalQuote) metadata.originalQuote = commitment.originalQuote
          metadata.relevanceScore = relevance.score
          metadata.relevanceReason = relevance.reason

          const { data, error } = await supabase
            .from('commitments')
            .insert({
              team_id: teamId,
              creator_id: creatorId,          // NOT NULL — resolved above
              title: commitment.title,
              description: commitment.description || null,
              status: 'open',                 // NOT 'pending' — correct enum
              priority_score: calculatePriorityScore(commitment),
              source: 'slack',                // commitment_source enum
              source_ref: messageData.id,     // NOT 'source_message_id'
              source_url: slackPermalink,
              category: commitment.commitmentType || null,
              metadata,
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

    // ── Route INBOUND commitments to Waiting Room ──
    // These are promises others made TO the user (e.g. "I will report back")
    const waitingRoomResults = await step.run('insert-waiting-room', async () => {
      if (inboundCommitments.length === 0) return { inserted: 0 }

      let inserted = 0
      for (const commitment of inboundCommitments) {
        const daysSince = 0 // Just received
        const text = commitment.originalQuote || commitment.title
        const hasQuestion = /\?|can you|could you|would you|please/i.test(text)

        const { error } = await supabase
          .from('awaiting_replies')
          .upsert({
            team_id: teamId,
            user_id: creatorId,
            source: 'slack',
            source_message_id: event.data.ts,
            conversation_id: event.data.thread_ts || event.data.ts,
            permalink: slackPermalink,
            channel_id: event.data.channel_id,
            to_recipients: commitment.promiserName || 'Unknown',
            to_name: commitment.promiserName || 'Someone in channel',
            subject: commitment.title,
            body_preview: (commitment.originalQuote || commitment.description || '').slice(0, 500),
            sent_at: new Date().toISOString(),
            urgency: commitment.urgency === 'critical' ? 'critical' : commitment.urgency === 'high' ? 'high' : 'medium',
            category: hasQuestion ? 'question' : 'follow_up',
            wait_reason: commitment.promiserName
              ? `${commitment.promiserName} promised: ${commitment.title}`
              : `Someone promised: ${commitment.title}`,
            days_waiting: daysSince,
            status: 'waiting',
          }, { onConflict: 'team_id,source_message_id' })

        if (error) {
          console.error('Failed to insert waiting room item:', error.message)
        } else {
          inserted++
        }
      }
      return { inserted }
    })

    const successCount = insertResults.filter(Boolean).length

    // ── Mark message as processed ──
    await step.run('mark-processed', async () => {
      await supabase
        .from('slack_messages')
        .update({ processed: true, commitments_found: successCount })
        .eq('id', messageData.id)
    })

    // ── Detect completions of existing commitments ──
    const completionResult = await step.run('detect-completions', async () => {
      try {
        // Fetch open commitments for this team
        const { data: openCommitments } = await supabase
          .from('commitments')
          .select('id, title, description')
          .eq('team_id', teamId)
          .in('status', ['open', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(50)

        if (!openCommitments || openCommitments.length === 0) {
          return { matches: 0 }
        }

        const matches = await detectCompletions(
          {
            text: event.data.text,
            author: slackUserId,
            source: 'slack' as const,
          },
          openCommitments.map((c: any) => ({
            id: c.id,
            title: c.title,
            description: c.description || '',
          }))
        )

        if (matches.length === 0) return { matches: 0 }

        const now = new Date().toISOString()
        let autoCompleted = 0
        let markedLikely = 0

        for (const match of matches) {
          const { data: existing } = await supabase
            .from('commitments')
            .select('metadata, creator_id')
            .eq('id', match.commitmentId)
            .single()

          const existingMeta = (existing?.metadata as Record<string, unknown>) || {}

          if (match.confidence >= 0.7) {
            await supabase
              .from('commitments')
              .update({
                status: 'completed',
                completed_at: now,
                updated_at: now,
                metadata: {
                  ...existingMeta,
                  autoCompleted: true,
                  completionEvidence: match.evidence,
                  completionConfidence: match.confidence,
                  completionSource: 'slack',
                  completionDetectedAt: now,
                },
              })
              .eq('id', match.commitmentId)
              .eq('team_id', teamId)

            if (existing?.creator_id) {
              await supabase.from('activities').insert({
                team_id: teamId,
                user_id: existing.creator_id,
                commitment_id: match.commitmentId,
                action: 'completed',
                metadata: {
                  autoCompleted: true,
                  evidence: match.evidence,
                  confidence: match.confidence,
                  source: 'Auto-completed: detected from slack message',
                },
              })
            }
            autoCompleted++
          } else if (match.confidence >= 0.5) {
            await supabase
              .from('commitments')
              .update({
                status: 'likely_complete',
                updated_at: now,
                metadata: {
                  ...existingMeta,
                  completionEvidence: match.evidence,
                  completionConfidence: match.confidence,
                  completionSource: 'slack',
                  completionDetectedAt: now,
                },
              })
              .eq('id', match.commitmentId)
              .eq('team_id', teamId)
            markedLikely++
          }
        }

        return { matches: matches.length, autoCompleted, markedLikely }
      } catch (err) {
        console.error('Completion detection in process-slack-message failed:', err)
        return { matches: 0 }
      }
    })

    return {
      success: true,
      commitments: successCount,
      waitingRoom: waitingRoomResults?.inserted || 0,
      completions: completionResult,
    }
  }
)
