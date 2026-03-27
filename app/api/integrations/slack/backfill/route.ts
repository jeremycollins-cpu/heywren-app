import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'
import { detectCommitmentsBatch, getDetectionStats, type UserContext } from '@/lib/ai/detect-commitments'
import { scoreRelevance, RELEVANCE_THRESHOLD } from '@/lib/slack/relevance'

// Process max 500 messages per request to stay within 300s timeout
const MAX_MESSAGES_PER_RUN = 500
const TIME_BUDGET_MS = 250000 // Stop at 250s, leaving 50s buffer

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function slackGet(url: string, token: string, maxRetries: number = 2): Promise<any> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
    })
    const data = await res.json()

    if (data.ok) return data

    if (data.error === 'ratelimited') {
      const retryAfter = parseInt(res.headers.get('Retry-After') || '3')
      console.log('Rate limited, waiting ' + retryAfter + 's (attempt ' + (attempt + 1) + ')')
      await sleep(retryAfter * 1000)
      continue
    }

    return data
  }

  return { ok: false, error: 'ratelimited_after_retries' }
}

async function slackPost(url: string, token: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

export async function POST(request: NextRequest) {
  const supabase = getAdminClient()
  const startTime = Date.now()

  let userId: string
  let daysBack: number = 30
  let channelId: string | null = null

  try {
    const body = await request.json()
    userId = body.userId
    daysBack = body.daysBack || 30
    channelId = body.channelId || null

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Get user's team
  let teamId: string | null = null
  const { data: members } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)

  if (members && members.length > 0) {
    teamId = members[0].team_id
  }

  if (!teamId) {
    return NextResponse.json({ error: 'No team found for user' }, { status: 400 })
  }

  // Get the Slack access token for this user
  const { data: integration } = await supabase
    .from('integrations')
    .select('access_token, config')
    .eq('team_id', teamId)
    .eq('user_id', userId)
    .eq('provider', 'slack')
    .single()

  if (!integration || !integration.access_token) {
    return NextResponse.json({ error: 'Slack not connected or missing access token' }, { status: 400 })
  }

  const slackToken = integration.access_token

  // Resolve the user's identity for AI context and relevance filtering
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('display_name, slack_user_id')
    .eq('id', userId)
    .single()
  const userSlackId: string | null = userProfile?.slack_user_id || null
  const userContext: UserContext | undefined = userProfile?.display_name
    ? { userName: userProfile.display_name, slackUserId: userSlackId }
    : undefined

  // Test the token
  const authTest = await slackGet('https://slack.com/api/auth.test', slackToken, 0)
  if (!authTest.ok) {
    return NextResponse.json({
      error: 'Slack token invalid: ' + authTest.error + '. Please reconnect Slack.',
    }, { status: 401 })
  }

  // Auto-populate slack_user_id for team members missing it (non-blocking)
  autoPopulateSlackUserIds(supabase, slackToken, teamId).catch(err =>
    console.error('Failed to auto-populate Slack user IDs during backfill:', err)
  )

  // ================================================================
  // PHASE 1: Re-process previously stored but unprocessed messages
  // This is the FAST path — no Slack API calls needed, just AI
  // ================================================================
  const { data: unprocessed, count: unprocessedCount } = await supabase
    .from('slack_messages')
    .select('id, message_ts, message_text, channel_id, user_id', { count: 'exact' })
    .eq('team_id', teamId)
    .eq('processed', false)
    .limit(MAX_MESSAGES_PER_RUN)

  let totalCommitments = 0
  let processedMessages = 0
  let totalSkippedLowRelevance = 0
  const channelMemberCounts = new Map<string, number>()

  if (unprocessed && unprocessed.length > 0) {
    console.log('Processing ' + unprocessed.length + ' unprocessed Slack messages (of ' + unprocessedCount + ' total)')

    const batch: Array<{ id: string; text: string; dbId: string; authorSlackId: string; channelId: string; messageTs: string }> = []
    for (const msg of unprocessed) {
      if (msg.message_text && msg.message_text.length >= 15) {
        batch.push({ id: msg.message_ts, text: msg.message_text, dbId: msg.id, authorSlackId: msg.user_id || 'unknown', channelId: msg.channel_id, messageTs: msg.message_ts })
      } else {
        // Mark short messages as processed with 0 commitments
        await supabase
          .from('slack_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', msg.id)
        processedMessages++
      }
    }

    // Process in chunks of 25 (for batch AI)
    for (let i = 0; i < batch.length; i += 25) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break

      const chunk = batch.slice(i, i + 25)
      try {
        const batchInput = chunk.map((b) => ({ id: b.id, text: b.text }))
        const batchResults = await detectCommitmentsBatch(batchInput, userContext)

        // Pre-fetch channel member counts for this chunk in parallel
        const uncachedChannels = [...new Set(chunk.map(c => c.channelId).filter(ch => !channelMemberCounts.has(ch)))]
        await Promise.all(uncachedChannels.map(async (chId) => {
          try {
            const chInfo = await slackGet(
              `https://slack.com/api/conversations.info?channel=${chId}`,
              slackToken, 1
            )
            if (chInfo.ok && chInfo.channel?.num_members != null) {
              channelMemberCounts.set(chId, chInfo.channel.num_members)
            }
          } catch { /* Non-fatal */ }
        }))

        const commitmentRows: any[] = []

        for (const item of chunk) {
          const commitments = batchResults.get(item.id) || []

          const rel = scoreRelevance({
            messageAuthorSlackId: item.authorSlackId,
            channelId: item.channelId,
            messageText: item.text,
            targetUserSlackId: userSlackId,
            channelMemberCount: channelMemberCounts.get(item.channelId),
          })

          if (rel.score < RELEVANCE_THRESHOLD) {
            totalSkippedLowRelevance++
            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: 0 })
              .eq('id', item.dbId)
            processedMessages++
            continue
          }

          const outbound = commitments.filter(c => c.direction !== 'inbound')
          const inbound = commitments.filter(c => c.direction === 'inbound')

          for (const commitment of outbound) {
            commitmentRows.push({
              team_id: teamId,
              creator_id: userId,
              title: commitment.title || 'Untitled commitment',
              description: commitment.description || null,
              status: 'open',
              priority_score: commitment.priority === 'high' ? 0.9 : commitment.priority === 'medium' ? 0.5 : 0.2,
              source: 'slack',
              source_ref: item.dbId,
              metadata: {
                urgency: commitment.urgency || null,
                tone: commitment.tone || null,
                commitmentType: commitment.commitmentType || null,
                stakeholders: commitment.stakeholders || null,
                originalQuote: commitment.originalQuote || null,
                channelName: commitment.channelOrThread || null,
                confidence: commitment.confidence,
                assigneeName: commitment.assignee || null,
                relevanceScore: rel.score,
                relevanceReason: rel.reason,
              },
            })
          }

          // Route inbound commitments to Waiting Room
          for (const commitment of inbound) {
            const permalink = item.channelId && item.messageTs
              ? `https://slack.com/archives/${item.channelId}/p${item.messageTs.replace('.', '')}`
              : null
            await supabase.from('awaiting_replies').upsert({
              team_id: teamId,
              user_id: userId,
              source: 'slack',
              source_message_id: item.messageTs || item.dbId,
              permalink,
              channel_id: item.channelId || null,
              to_recipients: commitment.promiserName || 'Unknown',
              to_name: commitment.promiserName || 'Someone',
              subject: commitment.title,
              body_preview: (commitment.originalQuote || commitment.description || '').slice(0, 500),
              sent_at: new Date().toISOString(),
              urgency: commitment.urgency === 'critical' ? 'critical' : commitment.urgency === 'high' ? 'high' : 'medium',
              category: 'follow_up',
              wait_reason: commitment.promiserName
                ? `${commitment.promiserName} promised: ${commitment.title}`
                : `Someone promised: ${commitment.title}`,
              days_waiting: 0,
              status: 'waiting',
            }, { onConflict: 'team_id,source_message_id' })
          }

          processedMessages++
        }

        // Batch insert all outbound commitments from this chunk
        let slackCommitInsertOk = true
        if (commitmentRows.length > 0) {
          const { error: commitErr } = await supabase.from('commitments').insert(commitmentRows)
          if (commitErr) {
            console.error('BATCH COMMITMENT INSERT FAILED:', commitErr.message, commitErr.details, commitErr.hint, 'Code:', commitErr.code, 'Row sample:', JSON.stringify(commitmentRows[0]))
            slackCommitInsertOk = false
          } else {
            totalCommitments += commitmentRows.length
          }
        }

        // Only mark messages as processed if commitment inserts succeeded
        if (slackCommitInsertOk) {
          for (const item of chunk) {
            const commitments = batchResults.get(item.id) || []
            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: commitments.length })
              .eq('id', item.dbId)
          }
        }
      } catch (batchErr) {
        console.error('Batch AI error:', (batchErr as Error).message)
      }
    }

    // If we still have unprocessed messages, return early and tell the user to sync again
    const remainingUnprocessed = (unprocessedCount || 0) - processedMessages
    if (remainingUnprocessed > 0) {
      const aiStats = getDetectionStats()
      return NextResponse.json({
        success: true,
        summary: {
          channels_processed: 0,
          total_channels: 0,
          messages_scanned: processedMessages,
          commitments_detected: totalCommitments,
      skipped_low_relevance: totalSkippedLowRelevance,
          remaining_unprocessed: remainingUnprocessed,
          ai_stats: {
            skipped_by_keyword_filter: aiStats.tier1_filtered,
            skipped_by_haiku_triage: aiStats.tier2_filtered,
            fully_analyzed_by_sonnet: aiStats.tier3_analyzed,
            errors: aiStats.errors,
          },
          duration_seconds: Math.round((Date.now() - startTime) / 1000),
          errors: ['More messages to process. Click sync again to continue. (' + remainingUnprocessed + ' remaining)'],
        },
      })
    }
  }

  // ================================================================
  // PHASE 2: Fetch NEW messages from Slack (only if Phase 1 is done)
  // ================================================================
  if (Date.now() - startTime > TIME_BUDGET_MS) {
    const aiStats = getDetectionStats()
    return NextResponse.json({
      success: true,
      summary: {
        channels_processed: 0,
        messages_scanned: processedMessages,
        commitments_detected: totalCommitments,
      skipped_low_relevance: totalSkippedLowRelevance,
        ai_stats: {
          skipped_by_keyword_filter: aiStats.tier1_filtered,
          skipped_by_haiku_triage: aiStats.tier2_filtered,
          fully_analyzed_by_sonnet: aiStats.tier3_analyzed,
          errors: aiStats.errors,
        },
        duration_seconds: Math.round((Date.now() - startTime) / 1000),
        errors: ['Time budget used processing backlog. Click sync again to fetch new messages.'],
      },
    })
  }

  const oldestTimestamp = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000)

  let channels: Array<{ id: string; name: string; type: string }> = []
  let joinedCount = 0
  const joinErrors: string[] = []

  if (channelId) {
    channels = [{ id: channelId, name: channelId, type: 'channel' }]
  } else {
    const publicData = await slackGet(
      'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200',
      slackToken
    )

    if (publicData.ok) {
      for (const ch of (publicData.channels || [])) {
        if (!ch.is_member) {
          const joinData = await slackPost(
            'https://slack.com/api/conversations.join',
            slackToken,
            { channel: ch.id }
          )
          if (joinData.ok) {
            joinedCount++
          } else if (joinData.error === 'missing_scope') {
            joinErrors.push('Missing channels:join scope. Reconnect Slack with updated permissions.')
            break
          }
          await sleep(1200)
        }
        channels.push({ id: ch.id, name: ch.name, type: 'channel' })
      }
    }

    const privateData = await slackGet(
      'https://slack.com/api/conversations.list?types=private_channel&exclude_archived=true&limit=200',
      slackToken
    )
    if (privateData.ok) {
      for (const ch of (privateData.channels || []).filter((c: any) => c.is_member)) {
        channels.push({ id: ch.id, name: ch.name, type: 'private' })
      }
    }

    const dmData = await slackGet(
      'https://slack.com/api/conversations.list?types=im&limit=200',
      slackToken
    )
    if (dmData.ok) {
      for (const dm of (dmData.channels || [])) {
        channels.push({ id: dm.id, name: 'DM-' + (dm.user || dm.id), type: 'dm' })
      }
    }

    // Group DMs (multi-party IMs) — where a lot of important commitments happen
    const mpimData = await slackGet(
      'https://slack.com/api/conversations.list?types=mpim&limit=200',
      slackToken
    )
    if (mpimData.ok) {
      for (const mpim of (mpimData.channels || [])) {
        channels.push({ id: mpim.id, name: mpim.name || 'Group-DM-' + mpim.id, type: 'mpim' })
      }
    }
  }

  if (channels.length === 0) {
    return NextResponse.json({ error: 'No channels found.' }, { status: 400 })
  }

  console.log('Scanning ' + channels.length + ' conversations. Auto-joined: ' + joinedCount)

  let totalMessages = 0
  let totalNewMessages = 0
  let processedChannels = 0
  const errors: string[] = [...joinErrors]

  for (const channel of channels) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      errors.push('Processed ' + processedChannels + '/' + channels.length + ' channels. Click sync again to continue.')
      break
    }

    // Skip if we've hit the message limit for this run
    if (totalNewMessages >= MAX_MESSAGES_PER_RUN) {
      errors.push('Reached ' + MAX_MESSAGES_PER_RUN + ' new messages. Click sync again to continue.')
      break
    }

    processedChannels++
    let messageCursor: string | undefined

    // Fetch channel member count once per channel for relevance scoring
    if (!channelMemberCounts.has(channel.id)) {
      try {
        const chInfo = await slackGet(
          `https://slack.com/api/conversations.info?channel=${channel.id}`,
          slackToken, 1
        )
        if (chInfo.ok && chInfo.channel?.num_members != null) {
          channelMemberCounts.set(channel.id, chInfo.channel.num_members)
        }
      } catch {
        // Non-fatal
      }
    }
    const channelMemberCount = channelMemberCounts.get(channel.id)

    try {
      do {
        if (Date.now() - startTime > TIME_BUDGET_MS) break
        if (totalNewMessages >= MAX_MESSAGES_PER_RUN) break

        const historyParams = new URLSearchParams({
          channel: channel.id,
          oldest: oldestTimestamp.toString(),
          limit: '50',
          inclusive: 'true',
        })
        if (messageCursor) historyParams.append('cursor', messageCursor)

        const historyData = await slackGet(
          'https://slack.com/api/conversations.history?' + historyParams.toString(),
          slackToken
        )

        if (!historyData.ok) {
          errors.push('#' + channel.name + ': ' + historyData.error)
          break
        }

        const messages = (historyData.messages || []).filter(
          (msg: any) => msg.type === 'message' && !msg.bot_id && !msg.subtype && msg.text && msg.text.length >= 15
        )

        const batch: Array<{ id: string; text: string; dbId: string; authorSlackId: string; channelId: string; messageTs: string }> = []

        for (const msg of messages) {
          totalMessages++

          const { data: existing } = await supabase
            .from('slack_messages')
            .select('id, processed')
            .eq('team_id', teamId)
            .eq('message_ts', msg.ts)
            .maybeSingle()

          if (existing && existing.processed) continue

          let dbId: string

          if (existing && !existing.processed) {
            dbId = existing.id
          } else {
            const { data: messageData, error: msgErr } = await supabase
              .from('slack_messages')
              .insert({
                team_id: teamId,
                channel_id: channel.id,
                user_id: msg.user || 'unknown',
                message_text: msg.text,
                message_ts: msg.ts,
                thread_ts: msg.thread_ts || null,
                processed: false,
              })
              .select()
              .single()

            if (msgErr) {
              console.error('Failed to store:', msgErr.message)
              continue
            }
            dbId = messageData.id
          }

          totalNewMessages++
          batch.push({ id: msg.ts, text: msg.text, dbId, authorSlackId: msg.user || 'unknown', channelId: channel.id, messageTs: msg.ts })
        }

        // Process batch through AI
        if (batch.length > 0) {
          try {
            const batchInput = batch.map((b) => ({ id: b.id, text: b.text }))
            const batchResults = await detectCommitmentsBatch(batchInput, userContext)

            for (const item of batch) {
              const commitments = batchResults.get(item.id) || []

              // Score relevance for this message
              const rel = scoreRelevance({
                messageAuthorSlackId: item.authorSlackId || 'unknown',
                channelId: channel.id,
                messageText: item.text,
                targetUserSlackId: userSlackId,
                channelMemberCount,
              })

              if (rel.score < RELEVANCE_THRESHOLD) {
                totalSkippedLowRelevance++
                await supabase
                  .from('slack_messages')
                  .update({ processed: true, commitments_found: 0 })
                  .eq('id', item.dbId)
                continue
              }

              const outbound2 = commitments.filter(c => c.direction !== 'inbound')
              const inbound2 = commitments.filter(c => c.direction === 'inbound')
              let itemInsertFailed = false

              for (const commitment of outbound2) {
                const { error: commitErr } = await supabase.from('commitments').insert({
                  team_id: teamId,
                  creator_id: userId,
                  title: commitment.title || 'Untitled commitment',
                  description: commitment.description || null,
                  status: 'open',
                  priority_score: commitment.priority === 'high' ? 0.9 : commitment.priority === 'medium' ? 0.5 : 0.2,
                  source: 'slack',
                  source_ref: item.dbId,
                  metadata: {
                    urgency: commitment.urgency || null,
                    tone: commitment.tone || null,
                    commitmentType: commitment.commitmentType || null,
                    stakeholders: commitment.stakeholders || null,
                    originalQuote: commitment.originalQuote || null,
                    channelName: commitment.channelOrThread || null,
                    confidence: commitment.confidence,
                    assigneeName: commitment.assignee || null,
                    relevanceScore: rel.score,
                    relevanceReason: rel.reason,
                  },
                })
                if (commitErr) {
                  console.error('COMMITMENT INSERT FAILED:', JSON.stringify({
                    message: commitErr.message, details: commitErr.details,
                    hint: commitErr.hint, code: commitErr.code,
                  }))
                  itemInsertFailed = true
                } else {
                  totalCommitments++
                }
              }

              // Route inbound commitments to Waiting Room
              for (const commitment of inbound2) {
                const permalink = item.channelId && item.messageTs
                  ? `https://slack.com/archives/${item.channelId}/p${item.messageTs.replace('.', '')}`
                  : null
                await supabase.from('awaiting_replies').upsert({
                  team_id: teamId,
                  user_id: userId,
                  source: 'slack',
                  source_message_id: item.messageTs || item.dbId,
                  permalink,
                  channel_id: item.channelId || null,
                  to_recipients: commitment.promiserName || 'Unknown',
                  to_name: commitment.promiserName || 'Someone',
                  subject: commitment.title,
                  body_preview: (commitment.originalQuote || commitment.description || '').slice(0, 500),
                  sent_at: new Date().toISOString(),
                  urgency: commitment.urgency === 'critical' ? 'critical' : commitment.urgency === 'high' ? 'high' : 'medium',
                  category: 'follow_up',
                  wait_reason: commitment.promiserName
                    ? `${commitment.promiserName} promised: ${commitment.title}`
                    : `Someone promised: ${commitment.title}`,
                  days_waiting: 0,
                  status: 'waiting',
                }, { onConflict: 'team_id,source_message_id' })
              }

              if (!itemInsertFailed) {
                await supabase
                  .from('slack_messages')
                  .update({ processed: true, commitments_found: commitments.length })
                  .eq('id', item.dbId)
              }
            }
          } catch (batchErr) {
            console.error('Batch AI error:', (batchErr as Error).message)
            errors.push('AI error: ' + (batchErr as Error).message)
          }
        }

        messageCursor = historyData.response_metadata?.next_cursor || undefined
        await sleep(1200)
      } while (messageCursor)
    } catch (channelErr) {
      errors.push('#' + channel.name + ': ' + (channelErr as Error).message)
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  const aiStats = getDetectionStats()

  console.log('BACKFILL DONE: ' + totalMessages + ' total msgs, ' + totalNewMessages + ' new, ' +
    totalCommitments + ' commitments, duration: ' + duration + 's, ' +
    'Tier1: ' + aiStats.tier1_filtered + ', Tier2: ' + aiStats.tier2_filtered +
    ', Tier3: ' + aiStats.tier3_analyzed + ', errors: ' + aiStats.errors)

  return NextResponse.json({
    success: true,
    summary: {
      channels_processed: processedChannels,
      total_channels: channels.length,
      messages_scanned: totalMessages + processedMessages,
      new_messages_processed: totalNewMessages,
      commitments_detected: totalCommitments,
      skipped_low_relevance: totalSkippedLowRelevance,
      ai_stats: {
        skipped_by_keyword_filter: aiStats.tier1_filtered,
        skipped_by_haiku_triage: aiStats.tier2_filtered,
        fully_analyzed_by_sonnet: aiStats.tier3_analyzed,
        errors: aiStats.errors,
      },
      channels_joined: joinedCount,
      duration_seconds: duration,
      errors: errors.length > 0 ? errors : undefined,
    },
  })
}

/**
 * Fetch all Slack workspace members and match them to HeyWren profiles by email.
 * Sets slack_user_id on any profile that doesn't already have one.
 */
async function autoPopulateSlackUserIds(
  supabase: ReturnType<typeof getAdminClient>,
  accessToken: string,
  teamId: string
) {
  const slack = new WebClient(accessToken)

  const { data: teamMembers } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)

  if (!teamMembers || teamMembers.length === 0) return

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, slack_user_id')
    .in('id', teamMembers.map(m => m.user_id))

  if (!profiles) return

  const unmapped = profiles.filter(p => !p.slack_user_id && p.email)
  if (unmapped.length === 0) return

  const emailToProfile = new Map(
    unmapped.map(p => [p.email!.toLowerCase(), p.id])
  )

  let cursor: string | undefined
  let matched = 0
  do {
    const result = await slack.users.list({ cursor, limit: 200 })
    for (const member of result.members || []) {
      if (member.deleted || member.is_bot || member.id === 'USLACKBOT') continue
      const email = member.profile?.email?.toLowerCase()
      if (!email) continue
      const profileId = emailToProfile.get(email)
      if (profileId) {
        await supabase.from('profiles').update({ slack_user_id: member.id }).eq('id', profileId)
        matched++
        emailToProfile.delete(email)
        console.log(`Auto-mapped Slack user ${member.id} (${email}) → profile ${profileId}`)
      }
    }
    cursor = result.response_metadata?.next_cursor || undefined
  } while (cursor && emailToProfile.size > 0)

  if (matched > 0) console.log(`Auto-populated slack_user_id for ${matched} team members`)
}
