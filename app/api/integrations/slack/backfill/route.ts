import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments } from '@/lib/ai/detect-commitments'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Rate limit helper — Slack allows ~1 request per second for history
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function POST(request: NextRequest) {
  const supabase = getAdminClient()

  // Authenticate the request — must include userId in body
  let userId: string
  let daysBack: number = 90

  try {
    const body = await request.json()
    userId = body.userId
    daysBack = body.daysBack || 90

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

  // Get the Slack access token from integrations
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

  // Step 1: Get all channels the bot is a member of
  let channels: Array<{ id: string; name: string }> = []
  let channelCursor: string | undefined

  do {
    const params = new URLSearchParams({
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
    })
    if (channelCursor) {
      params.append('cursor', channelCursor)
    }

    const channelRes = await fetch('https://slack.com/api/conversations.list?' + params.toString(), {
      headers: { Authorization: 'Bearer ' + slackToken },
    })
    const channelData = await channelRes.json()

    if (!channelData.ok) {
      console.error('Slack conversations.list error:', channelData.error)
      return NextResponse.json({ error: 'Failed to list Slack channels: ' + channelData.error }, { status: 500 })
    }

    // Only include channels where the bot is a member
    const memberChannels = (channelData.channels || []).filter((ch: any) => ch.is_member)
    channels = channels.concat(memberChannels.map((ch: any) => ({ id: ch.id, name: ch.name })))
    channelCursor = channelData.response_metadata?.next_cursor || undefined

    await sleep(500)
  } while (channelCursor)

  if (channels.length === 0) {
    return NextResponse.json({
      error: 'The HeyWren bot is not a member of any channels. Invite it to channels first with /invite @HeyWren',
    }, { status: 400 })
  }

  let totalMessages = 0
  let totalCommitments = 0
  let processedChannels = 0
  const errors: string[] = []

  // Step 2: For each channel, fetch message history
  for (const channel of channels) {
    processedChannels++
    let messageCursor: string | undefined

    try {
      do {
        const historyParams = new URLSearchParams({
          channel: channel.id,
          oldest: oldestTimestamp.toString(),
          limit: '100',
          inclusive: 'true',
        })
        if (messageCursor) {
          historyParams.append('cursor', messageCursor)
        }

        const historyRes = await fetch('https://slack.com/api/conversations.history?' + historyParams.toString(), {
          headers: { Authorization: 'Bearer ' + slackToken },
        })
        const historyData = await historyRes.json()

        if (!historyData.ok) {
          console.error('Slack history error for #' + channel.name + ':', historyData.error)
          errors.push('Channel #' + channel.name + ': ' + historyData.error)
          break
        }

        const messages = (historyData.messages || []).filter(
          (msg: any) => msg.type === 'message' && !msg.bot_id && !msg.subtype && msg.text
        )

        // Step 3: Process each message
        for (const msg of messages) {
          totalMessages++

          // Skip very short messages (unlikely to contain commitments)
          if (msg.text.length < 15) continue

          // Check if we already processed this message
          const { data: existing } = await supabase
            .from('slack_messages')
            .select('id')
            .eq('team_id', teamId)
            .eq('message_ts', msg.ts)
            .single()

          if (existing) continue // Already processed

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

          // Detect commitments using Claude
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

                if (!commitErr) {
                  totalCommitments++
                }
              }
            }

            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: commitments?.length || 0 })
              .eq('id', messageData.id)
          } catch (aiErr) {
            console.error('AI detection failed for message:', (aiErr as Error).message)
            await supabase
              .from('slack_messages')
              .update({ processed: true, commitments_found: 0 })
              .eq('id', messageData.id)
          }

          // Rate limit — avoid hammering Claude API
          await sleep(300)
        }

        messageCursor = historyData.response_metadata?.next_cursor || undefined

        // Rate limit Slack API
        await sleep(1000)
      } while (messageCursor)
    } catch (channelErr) {
      console.error('Error processing channel #' + channel.name + ':', channelErr)
      errors.push('Channel #' + channel.name + ': ' + (channelErr as Error).message)
    }
  }

  return NextResponse.json({
    success: true,
    summary: {
      channels_processed: processedChannels,
      total_channels: channels.length,
      messages_scanned: totalMessages,
      commitments_detected: totalCommitments,
      errors: errors.length > 0 ? errors : undefined,
    },
  })
}
