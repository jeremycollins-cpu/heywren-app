import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'

// GET — Fetch pending/snoozed missed chats for current user's team
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const { data: missedChats, error } = await supabase
    .from('missed_chats')
    .select('*')
    .eq('team_id', profile.current_team_id)
    .eq('user_id', user.id)
    .in('status', ['pending', 'snoozed'])
    .order('sent_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Build a Slack user ID → display name map from team profiles
  const slackNameMap = new Map<string, string>()
  const { data: teamProfiles } = await supabase
    .from('profiles')
    .select('display_name, slack_user_id')
    .eq('current_team_id', profile.current_team_id)
    .not('slack_user_id', 'is', null)

  for (const p of teamProfiles || []) {
    if (p.slack_user_id && p.display_name) {
      slackNameMap.set(p.slack_user_id, p.display_name)
    }
  }

  // Resolve <@USERID> mentions in message_text and question_summary
  const resolveMentions = (text: string) =>
    text.replace(/<@([A-Z0-9]+)>/g, (_, uid) => `@${slackNameMap.get(uid) || 'someone'}`)

  const resolved = (missedChats || []).map((chat: any) => ({
    ...chat,
    message_text: chat.message_text ? resolveMentions(chat.message_text) : chat.message_text,
    question_summary: chat.question_summary ? resolveMentions(chat.question_summary) : chat.question_summary,
  }))

  // Sort with custom urgency order
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const sorted = resolved.sort((a: { urgency: string; sent_at: string }, b: { urgency: string; sent_at: string }) => {
    const urgDiff = (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4)
    if (urgDiff !== 0) return urgDiff
    return new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
  })

  // Count total evaluated slack messages scoped to this user:
  // Only DMs and channels where the user participated
  const adminDb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get user's slack_user_id
  const slackUserId = (await supabase
    .from('profiles')
    .select('slack_user_id')
    .eq('id', user.id)
    .single()
  ).data?.slack_user_id

  let totalEvaluated = 0
  if (slackUserId) {
    // Count DMs/group DMs (D* and G* channels) sent to the user
    const { count: dmCount } = await adminDb
      .from('slack_messages')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', profile.current_team_id)
      .or('channel_id.like.D%,channel_id.like.G%')

    // Count channel messages where the user sent or was mentioned
    const { count: channelCount } = await adminDb
      .from('slack_messages')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', profile.current_team_id)
      .not('channel_id', 'like', 'D%')
      .not('channel_id', 'like', 'G%')
      .or(`user_id.eq.${slackUserId},message_text.ilike.%<@${slackUserId}>%`)

    totalEvaluated = (dmCount || 0) + (channelCount || 0)
  }

  return NextResponse.json({ missedChats: sorted, totalEvaluated })
}

// POST — Scan Slack messages for mentions that were never replied to
export async function POST() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  if (!profile?.current_team_id) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const teamId = profile.current_team_id
  const adminDb = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get the Slack integration for this user
  const { data: integration } = await adminDb
    .from('integrations')
    .select('config, access_token')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .eq('provider', 'slack')
    .maybeSingle()

  if (!integration) {
    return NextResponse.json({ error: 'Slack not connected. Please connect Slack first.' }, { status: 400 })
  }

  // Look for the user's Slack user ID in the integration config
  let slackUserId = integration.config?.authed_user_id || null

  // Set up Slack client for resolving user/channel names
  const slackToken = integration.access_token
  const slack = slackToken ? new WebClient(slackToken) : null

  // Scan window: last 30 days
  const scanWindow = new Date(Date.now() - 30 * 86400000).toISOString()

  // Get all Slack messages in the scan window
  const { data: messages, error: msgError } = await adminDb
    .from('slack_messages')
    .select('id, channel_id, user_id, message_text, message_ts, thread_ts, created_at')
    .eq('team_id', teamId)
    .gte('created_at', scanWindow)
    .order('created_at', { ascending: false })

  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 500 })
  }

  if (!messages || messages.length === 0) {
    return NextResponse.json({ success: true, scanned: 0, missed: 0 })
  }

  // If we don't have the user's Slack ID, infer from most frequent sender
  if (!slackUserId) {
    const counts = new Map<string, number>()
    for (const m of messages) {
      if (!m.user_id || m.user_id === 'unknown' || m.user_id.startsWith('B')) continue
      counts.set(m.user_id, (counts.get(m.user_id) || 0) + 1)
    }
    let maxCount = 0
    for (const [uid, count] of counts) {
      if (count > maxCount) { maxCount = count; slackUserId = uid }
    }
  }

  // Find messages that need the user's attention:
  // 1. @mentions in channels where user never replied in the thread
  // 2. DM messages from others that user never responded to
  // 3. Group DM messages directed at the user with no response
  const missedMessages: typeof messages = []
  const threadReplies = new Set<string>()
  const channelUserReplied = new Map<string, Set<string>>() // channel_id -> set of message_ts the user replied near

  // First pass: collect all threads/channels where the user has replied
  for (const msg of messages) {
    if (msg.user_id === slackUserId) {
      if (msg.thread_ts) threadReplies.add(msg.thread_ts)
      threadReplies.add(msg.message_ts)
      // Track which channels the user has been active in (by nearby timestamps)
      if (!channelUserReplied.has(msg.channel_id)) {
        channelUserReplied.set(msg.channel_id, new Set())
      }
      channelUserReplied.get(msg.channel_id)!.add(msg.message_ts)
    }
  }

  // Identify DM and group DM channels (channel IDs starting with D = DM, G = group DM / mpim)
  const dmChannels = new Set<string>()
  for (const msg of messages) {
    const ch = msg.channel_id || ''
    if (ch.startsWith('D') || ch.startsWith('G')) {
      dmChannels.add(ch)
    }
  }

  // Second pass: find missed messages
  for (const msg of messages) {
    if (msg.user_id === slackUserId) continue // Skip own messages

    const text = msg.message_text || ''
    const threadKey = msg.thread_ts || msg.message_ts
    const isDM = dmChannels.has(msg.channel_id)

    // Check if user has responded in this thread
    if (threadReplies.has(threadKey)) continue

    // For DMs/group DMs: any message from someone else that wasn't responded to
    if (isDM) {
      // In DMs, check if user replied anywhere in the same channel within 24 hours
      const msgTime = new Date(msg.created_at).getTime()
      const userReplies = channelUserReplied.get(msg.channel_id)
      let userRepliedNearby = false
      if (userReplies) {
        // Check if any of the user's messages in this channel are after this message
        for (const replyTs of userReplies) {
          const replyTime = parseFloat(replyTs) * 1000
          if (replyTime > msgTime && replyTime - msgTime < 24 * 60 * 60 * 1000) {
            userRepliedNearby = true
            break
          }
        }
      }
      if (!userRepliedNearby) {
        // Skip very short messages in DMs (reactions, "ok", "thanks")
        if (text.trim().length >= 15) {
          missedMessages.push(msg)
        }
      }
      continue
    }

    // For channels: only catch @mentions
    const isMention = slackUserId ? text.includes(`<@${slackUserId}>`) : false
    if (isMention) {
      missedMessages.push(msg)
    }
  }

  // Get existing missed_chats to avoid duplicates — scoped to this user
  const { data: existing } = await adminDb
    .from('missed_chats')
    .select('message_ts')
    .eq('team_id', teamId)
    .eq('user_id', user.id)

  const existingTs = new Set((existing || []).map((e: { message_ts: string }) => e.message_ts))

  // Batch-resolve Slack user IDs and channel IDs to human-readable names
  const newMessages = missedMessages.filter(msg => !existingTs.has(msg.message_ts))
  const userNameCache = new Map<string, string>()
  const channelNameCache = new Map<string, string>()

  if (slack && newMessages.length > 0) {
    // Collect unique sender IDs AND mentioned user IDs from message text
    const mentionedIds = newMessages.flatMap(m => {
      const matches = (m.message_text || '').matchAll(/<@([A-Z0-9]+)>/g)
      return [...matches].map(match => match[1])
    })
    const uniqueUserIds = [...new Set([...newMessages.map(m => m.user_id).filter(Boolean), ...mentionedIds])]
    const uniqueChannelIds = [...new Set(newMessages.map(m => m.channel_id).filter(Boolean))]

    // Resolve user names in parallel (with error handling per user)
    await Promise.all(uniqueUserIds.map(async (uid) => {
      try {
        const result = await slack.users.info({ user: uid })
        const u = result.user
        const name = u?.profile?.display_name || u?.profile?.real_name || u?.real_name || u?.name
        if (name) userNameCache.set(uid, name)
      } catch (e) {
        console.warn(`Failed to resolve Slack user ${uid}:`, e)
      }
    }))

    // Resolve channel names in parallel
    await Promise.all(uniqueChannelIds.map(async (chId) => {
      try {
        const result = await slack.conversations.info({ channel: chId })
        const ch = result.channel as { name?: string; is_im?: boolean; user?: string }
        if (ch?.name) {
          channelNameCache.set(chId, ch.name)
        } else if (ch?.is_im && ch?.user) {
          // For DMs, use the other person's name
          const dmName = userNameCache.get(ch.user)
          if (dmName) channelNameCache.set(chId, `DM with ${dmName}`)
        }
      } catch (e) {
        console.warn(`Failed to resolve Slack channel ${chId}:`, e)
      }
    }))
  }

  // Insert new missed chats
  let insertedCount = 0
  const toInsert = newMessages
    .map(msg => {
      const text = msg.message_text || ''
      // Simple urgency heuristic
      let urgency: 'critical' | 'high' | 'medium' | 'low' = 'medium'
      const isDMMsg = dmChannels.has(msg.channel_id)
      const hasQuestion = /\?|can you|could you|would you|please|need|asap|urgent/i.test(text)
      const hasDeadline = /today|tomorrow|eod|end of day|by \w+day|this week/i.test(text)
      if (hasDeadline && hasQuestion) urgency = 'critical'
      else if (hasDeadline || /urgent|asap|critical/i.test(text)) urgency = 'high'
      else if (isDMMsg && hasQuestion) urgency = 'high' // DMs with questions are higher priority
      else if (hasQuestion) urgency = 'medium'
      else if (isDMMsg) urgency = 'medium' // DMs are at least medium
      else urgency = 'low'

      // Extract question summary
      let questionSummary: string | null = null
      const sentences = text.split(/[.!?\n]+/).filter((s: string) => s.trim().length > 5)
      const questionSentence = sentences.find((s: string) => s.includes('?'))
      const resolveMentions = (s: string) =>
        s.replace(/<@([A-Z0-9]+)>/g, (_, uid) => `@${userNameCache.get(uid) || 'someone'}`)

      if (questionSentence) {
        questionSummary = resolveMentions(questionSentence.trim())
      } else if (hasQuestion) {
        questionSummary = resolveMentions(text.slice(0, 200)).trim()
      }

      // Category
      let category = 'question'
      if (/review|look at|check|feedback/i.test(text)) category = 'request'
      else if (/decide|approve|sign.?off|go.?ahead/i.test(text)) category = 'decision'
      else if (/follow.?up|circling back|checking in/i.test(text)) category = 'follow_up'
      else if (/fyi|heads up|just so you know/i.test(text)) category = 'fyi'

      return {
        team_id: teamId,
        user_id: user.id,
        slack_message_id: msg.id,
        channel_id: msg.channel_id,
        sender_user_id: msg.user_id,
        sender_name: userNameCache.get(msg.user_id) || null,
        channel_name: channelNameCache.get(msg.channel_id) || null,
        message_text: resolveMentions(text),
        message_ts: msg.message_ts,
        thread_ts: msg.thread_ts || null,
        permalink: msg.channel_id && msg.message_ts
          ? `https://slack.com/archives/${msg.channel_id}/p${msg.message_ts.replace('.', '')}`
          : null,
        sent_at: msg.created_at,
        urgency,
        reason: hasQuestion ? 'Contains a direct question or request' : dmChannels.has(msg.channel_id) ? 'DM awaiting your response' : 'You were mentioned but haven\'t responded',
        question_summary: questionSummary,
        category,
        confidence: hasQuestion ? 0.85 : 0.6,
        status: 'pending',
      }
    })

  if (toInsert.length > 0) {
    const { error: insertError } = await adminDb
      .from('missed_chats')
      .upsert(toInsert, { onConflict: 'team_id,message_ts' })

    if (insertError) {
      console.error('Failed to insert missed chats:', insertError)
    } else {
      insertedCount = toInsert.length
    }
  }

  // Backfill sender_name for any existing records that are missing it
  if (slack && userNameCache.size > 0) {
    const { data: missingNames } = await adminDb
      .from('missed_chats')
      .select('id, sender_user_id')
      .eq('team_id', teamId)
      .is('sender_name', null)
      .in('status', ['pending', 'snoozed'])
      .limit(100)

    if (missingNames && missingNames.length > 0) {
      // Resolve any sender IDs not already in cache
      const uncached = [...new Set(missingNames.map((m: { sender_user_id: string }) => m.sender_user_id))]
        .filter(uid => !userNameCache.has(uid))
      await Promise.all(uncached.map(async (uid) => {
        try {
          const result = await slack.users.info({ user: uid })
          const u = result.user
          const name = u?.profile?.display_name || u?.profile?.real_name || u?.real_name || u?.name
          if (name) userNameCache.set(uid, name)
        } catch (e) { /* skip */ }
      }))

      // Update records that now have a resolved name
      for (const record of missingNames) {
        const name = userNameCache.get(record.sender_user_id)
        if (name) {
          await adminDb
            .from('missed_chats')
            .update({ sender_name: name })
            .eq('id', record.id)
        }
      }
    }
  }

  // Backfill permalink for existing records missing it
  {
    const { data: missingPermalinks } = await adminDb
      .from('missed_chats')
      .select('id, channel_id, message_ts')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .is('permalink', null)
      .in('status', ['pending', 'snoozed'])
      .not('channel_id', 'is', null)
      .not('message_ts', 'is', null)
      .limit(200)

    if (missingPermalinks && missingPermalinks.length > 0) {
      for (const row of missingPermalinks) {
        const link = `https://slack.com/archives/${row.channel_id}/p${row.message_ts.replace('.', '')}`
        await adminDb.from('missed_chats').update({ permalink: link }).eq('id', row.id)
      }
    }
  }

  // Clean up old dismissed/replied chats (>30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
  await adminDb
    .from('missed_chats')
    .delete()
    .eq('team_id', teamId)
    .in('status', ['dismissed', 'replied'])
    .lt('updated_at', thirtyDaysAgo)

  return NextResponse.json({
    success: true,
    scanned: messages.length,
    mentions_found: missedMessages.length,
    missed: insertedCount,
  })
}

// PATCH — Update status of a missed chat
export async function PATCH(request: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const { id, status, snoozed_until } = body

  if (!id || !status) {
    return NextResponse.json({ error: 'Missing id or status' }, { status: 400 })
  }

  const updateData: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }

  if (snoozed_until) {
    updateData.snoozed_until = snoozed_until
  }

  const { error } = await supabase
    .from('missed_chats')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export const dynamic = 'force-dynamic'
