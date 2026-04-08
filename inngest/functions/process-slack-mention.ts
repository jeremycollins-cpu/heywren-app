// inngest/functions/process-slack-mention.ts
// Handles @HeyWren mentions — fetches thread context, detects commitments,
// stores them in the database, and replies in Slack with confirmation.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments, calculatePriorityScore } from '@/lib/ai/detect-commitments'
import { detectCompletions } from '@/lib/ai/detect-completion'

// ─── Admin Supabase client (bypasses RLS) ───────────────────────────────────

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ─── Slack API helper ───────────────────────────────────────────────────────

async function slackApi(
  method: string,
  params: Record<string, string>,
  token: string
) {
  const url = new URL(`https://slack.com/api/${method}`)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!data.ok) {
    console.error(`Slack API ${method} failed:`, data.error)
  }
  return data
}

// ─── Get bot token for a workspace ──────────────────────────────────────────

async function getBotToken(
  supabase: ReturnType<typeof getAdminClient>,
  slackTeamId: string
): Promise<{ token: string; teamId: string; connectedBy: string | null } | null> {
  const { data: integration, error } = await supabase
    .from('integrations')
    .select('team_id, access_token, config')
    .eq('provider', 'slack')
    .filter('config->>slack_team_id', 'eq', slackTeamId)
    .limit(1)
    .maybeSingle()

  if (error || !integration) {
    console.error('No Slack integration found for team:', slackTeamId, error)
    return null
  }

  return {
    token: integration.access_token,
    teamId: integration.team_id,
    connectedBy: integration.config?.connected_by || null,
  }
}

// ─── Fetch thread context (if mention is in a thread) ───────────────────────

async function fetchThreadContext(
  token: string,
  channelId: string,
  threadTs: string
): Promise<string[]> {
  try {
    const result = await slackApi(
      'conversations.replies',
      { channel: channelId, ts: threadTs, limit: '20' },
      token
    )

    if (!result.ok || !result.messages) return []

    // Return message texts, excluding bot messages
    return result.messages
      .filter((m: any) => !m.bot_id && m.text && m.text.trim().length > 0)
      .map((m: any) => m.text)
  } catch (err) {
    console.error('Failed to fetch thread context:', err)
    return []
  }
}

// ─── Format commitment confirmation for Slack ───────────────────────────────

function formatConfirmation(commitments: Array<{ title: string; description?: string }>): string {
  if (commitments.length === 0) {
    return "I looked at this conversation but didn't find any clear commitments or action items. Try tagging me after someone makes a specific promise or agrees to do something!"
  }

  if (commitments.length === 1) {
    const c = commitments[0]
    let msg = `:white_check_mark: *Got it! Commitment tracked:*\n> ${c.title}`
    if (c.description) {
      msg += `\n_${c.description}_`
    }
    msg += '\n\nI\'ll keep an eye on this. Check your <https://app.heywren.ai/commitments|HeyWren dashboard> for details.'
    return msg
  }

  let msg = `:white_check_mark: *Got it! ${commitments.length} commitments tracked:*\n`
  commitments.forEach((c, i) => {
    msg += `> ${i + 1}. ${c.title}\n`
  })
  msg += '\nI\'ll keep an eye on these. Check your <https://app.heywren.ai/commitments|HeyWren dashboard> for details.'
  return msg
}

// ─── Main Inngest Function ──────────────────────────────────────────────────

export const processSlackMention = inngest.createFunction(
  {
    id: 'process-slack-mention',
    retries: 2,
    concurrency: { limit: 5 }, // Don't overload the AI pipeline
  },
  { event: 'slack/mention.received' },
  async ({ event, step }) => {
    const supabase = getAdminClient()
    const { team_id: slackTeamId, channel_id, user_id, text, ts, thread_ts } =
      event.data

    // ── Step 1: Look up the HeyWren team and get the bot token ──
    const integration = await step.run('lookup-team', async () => {
      return getBotToken(supabase, slackTeamId)
    })

    if (!integration) {
      return {
        success: false,
        error: `No HeyWren team found for Slack workspace ${slackTeamId}`,
      }
    }

    const { token, teamId, connectedBy } = integration

    // ── Touch integration updated_at so sync health doesn't show as stale ──
    await step.run('touch-integration', async () => {
      await supabase
        .from('integrations')
        .update({ updated_at: new Date().toISOString() })
        .eq('team_id', teamId)
        .eq('provider', 'slack')
    })

    // ── Step 2: Gather context ──
    // If in a thread, fetch the full thread for context
    // If standalone, just use the mention message itself
    const contextMessages = await step.run('gather-context', async () => {
      // Strip the @HeyWren mention from the text for cleaner analysis
      const cleanText = text
        .replace(/<@[A-Z0-9]+>/g, '') // Remove all @mentions (Slack format: <@U12345>)
        .trim()

      if (thread_ts) {
        // Fetch all messages in the thread for full context
        const threadMessages = await fetchThreadContext(
          token,
          channel_id,
          thread_ts
        )
        // If thread fetch failed, fall back to just the mention message
        if (threadMessages.length === 0) {
          return [cleanText]
        }
        return threadMessages
      }

      return [cleanText]
    })

    // Skip if there's nothing to analyze
    const combinedText = contextMessages.join('\n\n')
    if (combinedText.trim().length < 10) {
      // Reply to let the user know
      await step.run('reply-no-content', async () => {
        await slackApi(
          'chat.postMessage',
          {
            channel: channel_id,
            thread_ts: thread_ts || ts, // Reply in thread
            text: "Hmm, I didn't find enough context to work with. Try tagging me in a conversation where someone makes a commitment or agrees to an action item!",
          },
          token
        )
      })
      return { success: true, commitments: 0 }
    }

    // ── Step 3: Store the message in slack_messages ──
    const messageRecord = await step.run('store-message', async () => {
      const { data, error } = await supabase
        .from('slack_messages')
        .insert({
          team_id: teamId,
          channel_id,
          user_id,
          message_text: text,
          message_ts: ts,
          thread_ts: thread_ts || null,
          processed: false,
        })
        .select('id')
        .single()

      if (error) {
        console.error('Failed to store slack message:', error)
        return null
      }
      return data
    })

    // ── Step 4: Detect commitments using AI ──
    const detected = await step.run('detect-commitments', async () => {
      try {
        const commitments = await detectCommitments(combinedText)
        return commitments || []
      } catch (err) {
        console.error('AI commitment detection failed:', err)
        return []
      }
    })

    // ── Step 5: Store commitments in the database ──
    const stored = await step.run('store-commitments', async () => {
      if (detected.length === 0) return []

      // Map the Slack user who tagged @HeyWren to their HeyWren user ID
      // This ensures commitments appear under the correct user's dashboard
      let creatorId: string | null = null

      // First: look up the Slack user_id in profiles.slack_user_id
      if (user_id) {
        const { data: slackProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('slack_user_id', user_id)
          .maybeSingle()
        if (slackProfile) {
          creatorId = slackProfile.id
          console.log(`Mapped Slack user ${user_id} → HeyWren user ${creatorId}`)
        }
      }

      // Second: fall back to the person who connected Slack
      if (!creatorId) {
        creatorId = connectedBy
        if (creatorId) {
          console.log(`Slack user ${user_id} not mapped, falling back to connectedBy: ${creatorId}`)
        }
      }

      // Third: fall back to team owner
      if (!creatorId) {
        const { data: team } = await supabase
          .from('teams')
          .select('owner_id')
          .eq('id', teamId)
          .single()
        creatorId = team?.owner_id || null
      }

      // Last resort: any team member
      if (!creatorId) {
        const { data: member } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', teamId)
          .limit(1)
          .single()
        creatorId = member?.user_id || null
      }

      if (!creatorId) {
        console.error('Cannot find any user to use as creator_id for team:', teamId)
        return []
      }

      // Build Slack permalink for deep linking
      const slackPermalink = channel_id && ts
        ? `https://slack.com/archives/${channel_id}/p${ts.replace('.', '')}`
        : null

      const results = await Promise.all(
        detected.map(async (commitment) => {
          const metadata: Record<string, unknown> = {}
          if (commitment.urgency) metadata.urgency = commitment.urgency
          if (commitment.tone) metadata.tone = commitment.tone
          if (commitment.commitmentType) metadata.commitmentType = commitment.commitmentType
          if (commitment.stakeholders?.length) metadata.stakeholders = commitment.stakeholders
          if (commitment.originalQuote) metadata.originalQuote = commitment.originalQuote

          // Full insert with correct columns and enum values
          const { data, error } = await supabase
            .from('commitments')
            .insert({
              team_id: teamId,
              creator_id: creatorId,
              title: commitment.title,
              description: commitment.description || null,
              status: 'open', // NOT 'pending' — matches commitment_status enum
              priority_score: calculatePriorityScore(commitment),
              source: 'slack', // matches commitment_source enum
              source_ref: messageRecord?.id || ts, // NOT 'source_message_id'
              source_url: slackPermalink,
              category: commitment.commitmentType || null,
              metadata,
            })
            .select('id, title')
            .single()

          if (error) {
            console.error('Failed to insert commitment:', JSON.stringify({
              error: error.message,
              code: error.code,
              details: error.details,
              title: commitment.title,
            }))
            return null
          }
          return data
        })
      )

      return results.filter(Boolean)
    })

    // ── Step 6: Update the slack_messages record ──
    if (messageRecord) {
      await step.run('mark-processed', async () => {
        await supabase
          .from('slack_messages')
          .update({
            processed: true,
            commitments_found: stored.length,
          })
          .eq('id', messageRecord.id)
      })
    }

    // ── Step 6b: Record in wren_mentions ──
    await step.run('record-wren-mention', async () => {
      // Resolve Slack user → HeyWren user
      let mentionUserId: string | null = null
      if (user_id) {
        const { data: slackProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('slack_user_id', user_id)
          .maybeSingle()
        mentionUserId = slackProfile?.id || null
      }
      if (!mentionUserId) mentionUserId = connectedBy

      if (mentionUserId) {
        const permalink = channel_id && ts
          ? `https://slack.com/archives/${channel_id}/p${ts.replace('.', '')}`
          : null

        await supabase.from('wren_mentions').insert({
          team_id: teamId,
          user_id: mentionUserId,
          channel: 'slack',
          source_title: `#${channel_id}`,
          source_snippet: text?.slice(0, 300) || null,
          source_url: permalink,
          participant_name: null, // Slack user names aren't available in the event payload
          commitments_extracted: stored.length,
          created_at: new Date().toISOString(),
        })
      }
    })

    // ── Step 7: Reply in Slack with confirmation ──
    await step.run('reply-in-slack', async () => {
      const confirmationText = formatConfirmation(
        detected.map((c) => ({ title: c.title, description: c.description }))
      )

      await slackApi(
        'chat.postMessage',
        {
          channel: channel_id,
          thread_ts: thread_ts || ts, // Always reply in thread
          text: confirmationText,
        },
        token
      )
    })

    // ── Step 8: Detect completions of existing commitments ──
    const completionResult = await step.run('detect-completions', async () => {
      try {
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
            text: combinedText,
            author: user_id,
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
                  source: 'Auto-completed: detected from slack mention',
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
        console.error('Completion detection in process-slack-mention failed:', err)
        return { matches: 0 }
      }
    })

    return {
      success: true,
      commitments: stored.length,
      detected: detected.length,
      completions: completionResult,
    }
  }
)
