import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectCommitmentsBatch, getDetectionStats } from '@/lib/ai/detect-commitments'

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
  const oldestTimestamp = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000)

  // Test the token
  const authTest = await slackGet('https://slack.com/api/auth.test', slackToken, 0)
  console.log('Slack auth.test:', JSON.stringify(authTest))
  if (!authTest.ok) {
    return NextResponse.json({
      error: 'Slack token invalid: ' + authTest.error + '. Please reconnect Slack.',
    }, { status: 401 })
  }

  let channels: Array<{ id: string; name: string; type: string }> = []
  let joinedCount = 0
  const joinErrors: string[] = []

  if (channelId) {
    channels = [{ id: channelId, name: channelId, type: 'channel' }]
  } else {
    // Get public channels + auto-join
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

    // Get private channels
    const privateData = await slackGet(
      'https://slack.com/api/conversations.list?types=private_channel&exclude_archived=true&limit=200',
      slackToken
    )
    if (privateData.ok) {
      for (const ch of (privateData.channels || []).filter((c: any) => c.is_member)) {
        channels.push({ id: ch.id, name: ch.name, type: 'private' })
      }
    }

    // Get DMs
    const dmData = await slackGet(
      'https://slack.com/api/conversations.list?types=im&limit=200',
      slackToken
    )
    if (dmData.ok) {
      for (const dm of (dmData.channels || [])) {
        channels.push({ id: dm.id, name: 'DM-' + (dm.user || dm.id), type: 'dm' })
      }
    }
  }

  if (channels.length === 0) {
    return NextResponse.json({ error: 'No channels found.' }, { status: 400 })
  }

  console.log('Scanning ' + channels.length + ' conversations. Auto-joined: ' + joinedCount)

  let totalMessages = 0
  let totalCommitments = 0
  let processedChannels = 0
  const errors: string[] = [...joinErrors]
  const startTime = Date.now()

  for (const channel of channels) {
    if (Date.now() - startTime > 250000) {
      errors.push('Time limit reached at ' + processedChannels + '/' + channels.length + ' channels.')
      break
    }

    processedChannels++
    let messageCursor: string | undefined

    try {
      do {
        if (Date.now() - startTime > 250000) break

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

        // Collect batch of new messages for this page
        const batch: Array<{ id: string; text: string; dbId: string }> = []

        for (const msg of messages) {
          totalMessages++

          // Skip already processed
          const { data: existing } = await supabase
            .from('slack_messages')
            .select('id')
            .eq('team_id', teamId)
            .eq('message_ts', msg.ts)
            .maybeSingle()

          if (existing) continue

          // Store the message
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

          batch.push({ id: msg.ts, text: msg.text, dbId: messageData.id })
        }

        // Process batch through the 3-tier AI pipeline
        if (batch.length > 0) {
          try {
            const batchInput = batch.map((b) => ({ id: b.id, text: b.text }))
            const batchResults = await detectCommitmentsBatch(batchInput)

            for (const item of batch) {
              const commitments = batchResults.get(item.id) || []

              if (commitments.length > 0) {
                for (const commitment of commitments) {
                  const { error: commitErr } = await supabase.from('commitments').insert({
                    team_id: teamId,
                    creator_id: null,
                    title: commitment.title,
                    description: commitment.description,
                    status: 'pending',
                    priority_score: commitment.confidence,
                    source: 'slack',
                    source_message_id: item.dbId,
                    due_date: commitment.dueDate || null,
                  })
                  if (!commitErr) totalCommitments++
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

  console.log('BACKFILL DONE: ' + totalMessages + ' msgs, ' + totalCommitments + ' commitments, ' +
    'Tier1 filtered: ' + aiStats.tier1_filtered + ', Tier2 filtered: ' + aiStats.tier2_filtered +
    ', Tier3 analyzed: ' + aiStats.tier3_analyzed + ', errors: ' + aiStats.errors)

  return NextResponse.json({
    success: true,
    summary: {
      channels_processed: processedChannels,
      total_channels: channels.length,
      messages_scanned: totalMessages,
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
