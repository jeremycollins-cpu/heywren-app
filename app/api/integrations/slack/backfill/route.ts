import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments } from '@/lib/ai/detect-commitments'

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

  // First: test the token by calling auth.test
  const authTest = await slackGet('https://slack.com/api/auth.test', slackToken, 0)
  console.log('Slack auth.test result:', JSON.stringify(authTest))
  if (!authTest.ok) {
    return NextResponse.json({
      error: 'Slack token is invalid: ' + authTest.error + '. Please reconnect Slack.',
    }, { status: 401 })
  }
  console.log('Slack bot: ' + authTest.user + ' in team ' + authTest.team)

  let channels: Array<{ id: string; name: string; type: string }> = []
  let joinedCount = 0
  let joinFailCount = 0
  const joinErrors: string[] = []

  if (channelId) {
    channels = [{ id: channelId, name: channelId, type: 'channel' }]
  } else {
    // Step A: Get ALL public channels
    const publicParams = new URLSearchParams({
      types: 'public_channel',
      exclude_archived: 'true',
      limit: '200',
    })

    const publicData = await slackGet(
      'https://slack.com/api/conversations.list?' + publicParams.toString(),
      slackToken
    )

    if (publicData.ok) {
      const publicChannels = publicData.channels || []
      console.log('Found ' + publicChannels.length + ' public channels')

      for (const ch of publicChannels) {
        if (!ch.is_member) {
          // Auto-join using POST (conversations.join requires POST with channel ID)
          const joinData = await slackPost(
            'https://slack.com/api/conversations.join',
            slackToken,
            { channel: ch.id }
          )

          if (joinData.ok) {
            console.log('Auto-joined #' + ch.name)
            joinedCount++
          } else {
            console.log('Failed to join #' + ch.name + ': ' + joinData.error)
            joinFailCount++
            if (joinData.error === 'missing_scope') {
              joinErrors.push('Missing channels:join scope. Please reinstall the Slack app with updated permissions.')
              // Don't try more joins if scope is missing
              break
            }
          }
          await sleep(1200) // Rate limit: ~1 join per second
        }
        channels.push({ id: ch.id, name: ch.name, type: 'channel' })
      }
    } else {
      console.error('Failed to list public channels:', publicData.error)
    }

    // Step B: Get private channels bot is already in
    const privateParams = new URLSearchParams({
      types: 'private_channel',
      exclude_archived: 'true',
      limit: '200',
    })

    const privateData = await slackGet(
      'https://slack.com/api/conversations.list?' + privateParams.toString(),
      slackToken
    )

    if (privateData.ok) {
      const privateChannels = (privateData.channels || []).filter((ch: any) => ch.is_member)
      console.log('Found ' + privateChannels.length + ' private channels (member)')
      for (const ch of privateChannels) {
        channels.push({ id: ch.id, name: ch.name, type: 'private' })
      }
    }

    // Step C: Get DM conversations
    const dmParams = new URLSearchParams({
      types: 'im',
      limit: '200',
    })

    const dmData = await slackGet(
      'https://slack.com/api/conversations.list?' + dmParams.toString(),
      slackToken
    )

    if (dmData.ok) {
      const dms = dmData.channels || []
      console.log('Found ' + dms.length + ' DM conversations')
      for (const dm of dms) {
        channels.push({ id: dm.id, name: 'DM-' + (dm.user || dm.id), type: 'dm' })
      }
    }
  }

  if (channels.length === 0) {
    return NextResponse.json({
      error: 'No channels found. Check Slack permissions.',
    }, { status: 400 })
  }

  console.log('Total conversations to scan: ' + channels.length +
    ' (' + channels.filter(c => c.type === 'channel').length + ' public, ' +
    channels.filter(c => c.type === 'private').length + ' private, ' +
    channels.filter(c => c.type === 'dm').length + ' DMs). ' +
    'Auto-joined: ' + joinedCount + ', join failed: ' + joinFailCount
  )

  let totalMessages = 0
  let totalCommitments = 0
  let processedChannels = 0
  let aiSuccessCount = 0
  let aiFailCount = 0
  const errors: string[] = [...joinErrors]
  const startTime = Date.now()

  for (const channel of channels) {
    if (Date.now() - startTime > 250000) {
      errors.push('Stopped early due to time limit. Processed ' + processedChannels + '/' + channels.length + ' channels.')
      break
    }

    processedChannels++
    let messageCursor: string | undefined
    let channelMessageCount = 0

    try {
      do {
        if (Date.now() - startTime > 250000) break

        const historyParams = new URLSearchParams({
          channel: channel.id,
          oldest: oldestTimestamp.toString(),
          limit: '50',
          inclusive: 'true',
        })
        if (messageCursor) {
          historyParams.append('cursor', messageCursor)
        }

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

        for (const msg of messages) {
          if (Date.now() - startTime > 250000) break

          totalMessages++
          channelMessageCount++

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
            console.error('Failed to store message:', msgErr.message)
            continue
          }

          // Detect commitments via AI
          try {
            const commitments = await detectCommitments(msg.text)
            aiSuccessCount++

            if (commitments && commitments.length > 0) {
              for (const commitment of commitments) {
                const { error: commitErr } = await supabase.from('commitments').insert({
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

                if (!commitErr) totalCommitments++
              }
            }

            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: commitments?.length || 0 })
              .eq('id', messageData.id)
          } catch (aiErr) {
            aiFailCount++
            const errMsg = (aiErr as Error).message || 'unknown error'
            console.error('AI detection FAILED for message "' + msg.text.substring(0, 50) + '": ' + errMsg)

            // Log the first few AI failures as errors so they show in the UI
            if (aiFailCount <= 3) {
              errors.push('AI error: ' + errMsg)
            }

            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: 0 })
              .eq('id', messageData.id)
          }

          await sleep(200)
        }

        messageCursor = historyData.response_metadata?.next_cursor || undefined
        await sleep(1200)
      } while (messageCursor)
    } catch (channelErr) {
      errors.push('#' + channel.name + ': ' + (channelErr as Error).message)
    }

    console.log('#' + channel.name + ': ' + channelMessageCount + ' messages')
  }

  const duration = Math.round((Date.now() - startTime) / 1000)

  console.log('BACKFILL COMPLETE: ' + totalMessages + ' messages, ' +
    totalCommitments + ' commitments, AI success: ' + aiSuccessCount +
    ', AI fail: ' + aiFailCount + ', duration: ' + duration + 's')

  return NextResponse.json({
    success: true,
    summary: {
      channels_processed: processedChannels,
      total_channels: channels.length,
      messages_scanned: totalMessages,
      commitments_detected: totalCommitments,
      ai_calls_succeeded: aiSuccessCount,
      ai_calls_failed: aiFailCount,
      channels_joined: joinedCount,
      duration_seconds: duration,
      errors: errors.length > 0 ? errors : undefined,
    },
  })
}
