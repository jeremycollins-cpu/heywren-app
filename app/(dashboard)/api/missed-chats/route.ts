import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

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
    .in('status', ['pending', 'snoozed'])
    .order('sent_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Sort with custom urgency order
  const urgencyOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const sorted = (missedChats || []).sort((a: { urgency: string; sent_at: string }, b: { urgency: string; sent_at: string }) => {
    const urgDiff = (urgencyOrder[a.urgency] ?? 4) - (urgencyOrder[b.urgency] ?? 4)
    if (urgDiff !== 0) return urgDiff
    return new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
  })

  return NextResponse.json({ missedChats: sorted })
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

  // Get the Slack integration to find the authenticated user's Slack ID
  const { data: integration } = await adminDb
    .from('integrations')
    .select('config')
    .eq('team_id', teamId)
    .eq('provider', 'slack')
    .maybeSingle()

  if (!integration) {
    return NextResponse.json({ error: 'Slack not connected. Please connect Slack first.' }, { status: 400 })
  }

  // Look for the user's Slack user ID in the integration config
  const slackUserId = integration.config?.authed_user_id || integration.config?.bot_user_id || null

  // Scan window: last 14 days
  const scanWindow = new Date(Date.now() - 14 * 86400000).toISOString()

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

  // Find messages that mention the user but where the user never replied in the thread
  // A "mention" is: message contains @user or the user's name, AND was sent by someone else
  const mentionedMessages: typeof messages = []
  const threadReplies = new Set<string>()

  // First pass: collect all thread_ts where the user has replied
  for (const msg of messages) {
    if (msg.user_id === slackUserId && msg.thread_ts) {
      threadReplies.add(msg.thread_ts)
    }
    // Also count if user replied in the same channel as a parent message
    if (msg.user_id === slackUserId) {
      threadReplies.add(msg.message_ts)
    }
  }

  // Second pass: find messages mentioning the user where they never responded
  for (const msg of messages) {
    if (msg.user_id === slackUserId) continue // Skip own messages

    const text = msg.message_text || ''
    const isMention = slackUserId
      ? text.includes(`<@${slackUserId}>`)
      : false

    if (!isMention) continue

    // Check if user has responded in this thread
    const threadKey = msg.thread_ts || msg.message_ts
    if (threadReplies.has(threadKey)) continue

    mentionedMessages.push(msg)
  }

  // Get existing missed_chats to avoid duplicates
  const { data: existing } = await adminDb
    .from('missed_chats')
    .select('message_ts')
    .eq('team_id', teamId)

  const existingTs = new Set((existing || []).map((e: { message_ts: string }) => e.message_ts))

  // Insert new missed chats
  let insertedCount = 0
  const toInsert = mentionedMessages
    .filter(msg => !existingTs.has(msg.message_ts))
    .map(msg => {
      const text = msg.message_text || ''
      // Simple urgency heuristic
      let urgency: 'critical' | 'high' | 'medium' | 'low' = 'medium'
      const hasQuestion = /\?|can you|could you|would you|please|need|asap|urgent/i.test(text)
      const hasDeadline = /today|tomorrow|eod|end of day|by \w+day|this week/i.test(text)
      if (hasDeadline && hasQuestion) urgency = 'critical'
      else if (hasDeadline || /urgent|asap|critical/i.test(text)) urgency = 'high'
      else if (hasQuestion) urgency = 'medium'
      else urgency = 'low'

      // Extract question summary
      let questionSummary: string | null = null
      const sentences = text.split(/[.!?\n]+/).filter((s: string) => s.trim().length > 5)
      const questionSentence = sentences.find((s: string) => s.includes('?'))
      if (questionSentence) {
        questionSummary = questionSentence.trim().replace(/<@[A-Z0-9]+>/g, '@user')
      } else if (hasQuestion) {
        questionSummary = text.slice(0, 200).replace(/<@[A-Z0-9]+>/g, '@user').trim()
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
        message_text: text,
        message_ts: msg.message_ts,
        thread_ts: msg.thread_ts || null,
        sent_at: msg.created_at,
        urgency,
        reason: hasQuestion ? 'Contains a direct question or request' : 'You were mentioned but haven\'t responded',
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
    mentions_found: mentionedMessages.length,
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

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
