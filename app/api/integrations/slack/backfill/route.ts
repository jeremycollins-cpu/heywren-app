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

async function slackFetch(url: string, token: string, maxRetries: number = 2): Promise<any> {
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

    return data // Return non-rate-limit errors immediately
  }

  return { ok: false, error: 'ratelimited_after_retries' }
}

export async function POST(request: NextRequest) {
  const supabase = getAdminClient()

  let userId: string
  let daysBack: number = 30
  let channelId: string | null = null // Optional: sync a specific channel

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

  // Get channels to process — includes public channels, private channels, and DMs
  let channels: Array<{ id: string; name: string; type: string }> = []

  if (channelId) {
    channels = [{ id: channelId, name: channelId, type: 'channel' }]
  } else {
    // Step A: Get ALL public channels (not just ones bot is in)
    const publicParams = new URLSearchParams({
      types: 'public_channel',
      exclude_archived: 'true',
      limit: '200',
    })

    const publicData = await slackFetch(
      'https://slack.com/api/conversations.list?' + publicParams.toString(),
      slackToken
    )

    if (publicData.ok) {
      const publicChannels = publicData.channels || []

      // Auto-join public channels the bot is not yet in
      for (const ch of publicChannels) {
        if (!ch.is_member) {
          const joinResult = await slackFetch(
            'https://slack.com/api/conversations.join',
            slackToken,
            1
          )
          // We need POST for join, so use fetch directly
          const joinRes = await fetch('https://slack.com/api/conversations.join', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer ' + slackToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ channel: ch.id }),
          })
          const joinData = await joinRes.json()
          if (joinData.ok) {
            console.log('Auto-joined #' + ch.name)
          }
          await sleep(1200)
        }
        channels.push({ id: ch.id, name: ch.name, type: 'channel' })
      }
    }

    // Step B: Get private channels bot is already in
    const privateParams = new URLSearchParams({
      types: 'private_channel',
      exclude_archived: 'true',
      limit: '200',
    })

    const privateData = await slackFetch(
      'https://slack.com/api/conversations.list?' + privateParams.toString(),
      slackToken
    )

    if (privateData.ok) {
      const privateChannels = (privateData.channels || []).filter((ch: any) => ch.is_member)
      for (const ch of privateChannels) {
        channels.push({ id: ch.id, name: ch.name, type: 'private' })
      }
    }

    // Step C: Get DM conversations
    const dmParams = new URLSearchParams({
      types: 'im',
      limit: '200',
    })

    const dmData = await slackFetch(
      'https://slack.com/api/conversations.list?' + dmParams.toString(),
      slackToken
    )

    if (dmData.ok) {
      const dms = dmData.channels || []
      for (const dm of dms) {
        channels.push({ id: dm.id, name: 'DM-' + (dm.user || dm.id), type: 'dm' })
      }
    }
  }

  if (channels.length === 0) {
    return NextResponse.json({
      error: 'Could not find any channels or DMs to scan. Check that the Slack integration has the right permissions.',
    }, { status: 400 })
  }

  console.log('Found ' + channels.length + ' conversations to scan (' +
    channels.filter(c => c.type === 'channel').length + ' public, ' +
    channels.filter(c => c.type === 'private').length + ' private, ' +
    channels.filter(c => c.type === 'dm').length + ' DMs)'
  )

  let totalMessages = 0
  let totalCommitments = 0
  let processedChannels = 0
  const errors: string[] = []
  const startTime = Date.now()

  for (const channel of channels) {
    // Safety: stop if we're approaching the 300s timeout (leave 30s buffer)
    if (Date.now() - startTime > 250000) {
      errors.push('Stopped early due to time limit. Processed ' + processedChannels + ' of ' + channels.length + ' channels.')
      break
    }

    processedChannels++
    let messageCursor: string | undefined
    let channelMessageCount = 0

    try {
      do {
        // Time check inside the loop too
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

        const historyData = await slackFetch(
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
          // Time check per message
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

          // Detect commitments
          try {
            const commitments = await detectCommitments(msg.text)

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
            console.error('AI detection failed:', (aiErr as Error).message)
            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: 0 })
              .eq('id', messageData.id)
          }

          // Small delay between Claude calls
          await sleep(200)
        }

        messageCursor = historyData.response_metadata?.next_cursor || undefined
        await sleep(1200)
      } while (messageCursor)
    } catch (channelErr) {
      errors.push('#' + channel.name + ': ' + (channelErr as Error).message)
    }

    console.log('Channel #' + channel.name + ': scanned ' + channelMessageCount + ' messages')
  }

  const duration = Math.round((Date.now() - startTime) / 1000)

  return NextResponse.json({
    success: true,
    summary: {
      channels_processed: processedChannels,
      total_channels: channels.length,
      messages_scanned: totalMessages,
      commitments_detected: totalCommitments,
      duration_seconds: duration,
      errors: errors.length > 0 ? errors : undefined,
    },
  })
}
