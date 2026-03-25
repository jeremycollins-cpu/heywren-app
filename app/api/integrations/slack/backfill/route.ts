import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectCommitmentsBatch, getDetectionStats } from '@/lib/ai/detect-commitments'

// Process max 100 messages per request to stay within 300s timeout
const MAX_MESSAGES_PER_RUN = 100
const TIME_BUDGET_MS = 240000 // Stop at 240s, leaving 60s buffer

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

  // Get the Slack access token
  const { data: integration } = await supabase
    .from('integrations')
    .select('access_token, config')
    .eq('team_id', teamId)
    .eq('provider', 'slack')
    .single()

  if (!integration || !integration.access_token) {
    return NextResponse.json({ error: 'Slack not connected or missing access token' }, { status: 400 })
  }

  const slackToken = integration.access_token

  // Test the token
  const authTest = await slackGet('https://slack.com/api/auth.test', slackToken, 0)
  if (!authTest.ok) {
    return NextResponse.json({
      error: 'Slack token invalid: ' + authTest.error + '. Please reconnect Slack.',
    }, { status: 401 })
  }

  // ================================================================
  // PHASE 1: Re-process previously stored but unprocessed messages
  // This is the FAST path — no Slack API calls needed, just AI
  // ================================================================
  const { data: unprocessed, count: unprocessedCount } = await supabase
    .from('slack_messages')
    .select('id, message_ts, message_text, channel_id', { count: 'exact' })
    .eq('team_id', teamId)
    .eq('processed', false)
    .limit(MAX_MESSAGES_PER_RUN)

  let totalCommitments = 0
  let processedMessages = 0

  if (unprocessed && unprocessed.length > 0) {
    console.log('Processing ' + unprocessed.length + ' unprocessed Slack messages (of ' + unprocessedCount + ' total)')

    const batch: Array<{ id: string; text: string; dbId: string }> = []
    for (const msg of unprocessed) {
      if (msg.message_text && msg.message_text.length >= 15) {
        batch.push({ id: msg.message_ts, text: msg.message_text, dbId: msg.id })
      } else {
        // Mark short messages as processed with 0 commitments
        await supabase
          .from('slack_messages')
          .update({ processed: true, commitments_found: 0 })
          .eq('id', msg.id)
        processedMessages++
      }
    }

    // Process in chunks of 15 (for batch AI)
    for (let i = 0; i < batch.length; i += 15) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break

      const chunk = batch.slice(i, i + 15)
      try {
        const batchInput = chunk.map((b) => ({ id: b.id, text: b.text }))
        const batchResults = await detectCommitmentsBatch(batchInput)

        for (const item of chunk) {
          const commitments = batchResults.get(item.id) || []

          for (const commitment of commitments) {
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
              },
            })
            if (commitErr) {
              console.error('COMMITMENT INSERT FAILED:', JSON.stringify({
                message: commitErr.message, details: commitErr.details,
                hint: commitErr.hint, code: commitErr.code,
              }))
            } else {
              totalCommitments++
            }
          }

          await supabase
            .from('slack_messages')
            .update({ processed: true, commitments_found: commitments.length })
            .eq('id', item.dbId)
          processedMessages++
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

        const batch: Array<{ id: string; text: string; dbId: string }> = []

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
          batch.push({ id: msg.ts, text: msg.text, dbId })
        }

        // Process batch through AI
        if (batch.length > 0) {
          try {
            const batchInput = batch.map((b) => ({ id: b.id, text: b.text }))
            const batchResults = await detectCommitmentsBatch(batchInput)

            for (const item of batch) {
              const commitments = batchResults.get(item.id) || []

              for (const commitment of commitments) {
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
                  },
                })
                if (commitErr) {
                  console.error('COMMITMENT INSERT FAILED:', JSON.stringify({
                    message: commitErr.message, details: commitErr.details,
                    hint: commitErr.hint, code: commitErr.code,
                  }))
                } else {
                  totalCommitments++
                }
              }

              await supabase
                .from('slack_messages')
                .update({ processed: true, commitments_found: commitments.length })
                .eq('id', item.dbId)
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
