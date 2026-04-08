// app/(dashboard)/api/chat/route.ts
// "Hey Wren" chat API — conversational AI assistant grounded in user's real data.
//
// Cost strategy:
// - Preloads user context (commitments, missed items, etc.) into the system prompt
// - Uses Haiku for fast, cheap responses on most queries
// - The rich context makes even the smallest model feel deeply personalized

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { messages, context: clientContext } = await request.json() as {
      messages: ChatMessage[]
      context?: string
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: 'No messages' }, { status: 400 })
    }

    // Get user profile + team
    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id, display_name, email, company, job_title')
      .eq('id', userData.user.id)
      .single()

    const teamId = profile?.current_team_id
    if (!teamId) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const userName = profile?.display_name ||
      userData.user.user_metadata?.full_name ||
      userData.user.email?.split('@')[0] || 'there'
    const firstName = userName.split(' ')[0]

    // Fetch user's data context in parallel (scoped to this user)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

    const [commitmentsRes, missedEmailsRes, awaitingRes, missedChatsRes] = await Promise.all([
      admin.from('commitments')
        .select('id, title, description, status, source, metadata, created_at')
        .eq('team_id', teamId)
        .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50),
      admin.from('missed_emails')
        .select('from_name, subject, urgency, category, status, received_at')
        .eq('team_id', teamId)
        .eq('user_id', userData.user.id)
        .in('status', ['pending', 'snoozed'])
        .order('received_at', { ascending: false })
        .limit(20),
      admin.from('awaiting_replies')
        .select('to_name, subject, urgency, category, wait_reason, days_waiting, status')
        .eq('team_id', teamId)
        .eq('user_id', userData.user.id)
        .in('status', ['waiting', 'snoozed'])
        .order('sent_at', { ascending: true })
        .limit(20),
      admin.from('missed_chats')
        .select('sender_name, channel_name, question_summary, urgency, status')
        .eq('team_id', teamId)
        .eq('user_id', userData.user.id)
        .in('status', ['pending', 'snoozed'])
        .limit(15),
    ])

    const commitments = commitmentsRes.data || []
    const missedEmails = missedEmailsRes.data || []
    const awaitingReplies = awaitingRes.data || []
    const missedChats = missedChatsRes.data || []

    // Build context summary
    const activeCommitments = commitments.filter(c => c.status === 'open' || c.status === 'pending')
    const overdueCommitments = commitments.filter(c => {
      const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
      return (c.status === 'open' || c.status === 'pending') && age > 7
    })
    const completedCommitments = commitments.filter(c => c.status === 'completed')

    const contextBlock = buildContextBlock({
      firstName,
      jobTitle: profile?.job_title,
      company: profile?.company,
      activeCommitments,
      overdueCommitments,
      completedCommitments,
      missedEmails,
      awaitingReplies,
      missedChats,
    })

    const systemPrompt = `You are Wren, ${firstName}'s AI follow-through assistant inside the HeyWren platform. You are warm, concise, and action-oriented. You speak like a trusted chief of staff — aware of everything going on, ready with answers, never wasting time.

PERSONALITY:
- Address ${firstName} by name occasionally (not every message)
- Be direct and specific — reference actual items, names, and dates from the context below
- Keep responses SHORT (2-4 sentences for simple questions, up to a paragraph for analysis)
- Use bullet points for lists. Never use headers or markdown formatting.
- When you don't have enough data, say so honestly rather than making things up
- Suggest concrete next actions when appropriate
- You can be slightly playful but always professional

${contextBlock}

TODAY: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}

CAPABILITIES:
- Summarize what needs attention today/this week
- Identify who needs a response and what's overdue
- Help prioritize competing commitments
- Draft follow-up messages or nudges
- Analyze communication patterns and relationships
- Prep for meetings by pulling relevant commitments/context
- Answer questions about the user's tracked data

ACTIONS — use these JSON tags when the user requests an action. The system will execute them automatically.

1. CREATE TASKS: When the user asks to add a task, reminder, or commitment:
  [CREATE_TASK]{"title":"the task title","urgency":"high|medium|low"}[/CREATE_TASK]
  Examples: "remind me to...", "add a task to...", "don't let me forget to..."

2. SNOOZE EMAILS: When the user asks to snooze missed emails:
  [SNOOZE_EMAILS]{"scope":"all_medium"|"all"|"email_id","days":3}[/SNOOZE_EMAILS]
  Examples: "snooze all medium-priority emails for 3 days", "snooze all missed emails until Friday"

3. GENERATE DRAFTS: When the user asks to draft follow-ups:
  [GENERATE_DRAFTS]{"scope":"all_overdue"|"commitment_title"}[/GENERATE_DRAFTS]
  Examples: "draft follow-ups for all overdue items", "draft a nudge for the Q3 budget commitment"

4. DISMISS STALE: When the user asks to clean up old items:
  [DISMISS_STALE]{"older_than_days":14,"type":"commitments"|"emails"}[/DISMISS_STALE]
  Examples: "dismiss all emails older than 2 weeks", "drop stale commitments"

After each action tag, follow with a brief confirmation message. You can combine multiple actions if the user asks for several things.

When suggesting actions, be specific: "Reply to Sarah's email about the Q2 budget" not "Follow up on emails."`

    // Use Haiku for speed and cost — the rich context makes it powerful
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    })

    let assistantMessage = response.content[0]?.type === 'text'
      ? response.content[0].text
      : 'Sorry, I couldn\'t generate a response.'

    // Detect and execute CREATE_TASK commands
    let createdTask = null
    const taskMatch = assistantMessage.match(/\[CREATE_TASK\](.*?)\[\/CREATE_TASK\]/)
    if (taskMatch) {
      try {
        const taskData = JSON.parse(taskMatch[1])
        const { error: taskErr, data: newTask } = await admin
          .from('commitments')
          .insert({
            team_id: teamId,
            creator_id: userData.user.id,
            assignee_id: userData.user.id,
            title: taskData.title,
            status: 'open',
            source: 'manual',
            priority_score: taskData.urgency === 'high' ? 90 : taskData.urgency === 'low' ? 30 : 60,
            metadata: {
              urgency: taskData.urgency || 'medium',
              commitmentType: 'deliverable',
              createdVia: 'wren_chat',
            },
          })
          .select('id, title')
          .single()

        if (!taskErr && newTask) {
          createdTask = newTask
        }
      } catch { /* task creation failed silently */ }

      // Remove the tag from the displayed message
      assistantMessage = assistantMessage.replace(/\[CREATE_TASK\].*?\[\/CREATE_TASK\]\n?/, '').trim()
    }

    // ── Execute SNOOZE_EMAILS commands ──
    let snoozedCount = 0
    const snoozeMatch = assistantMessage.match(/\[SNOOZE_EMAILS\](.*?)\[\/SNOOZE_EMAILS\]/)
    if (snoozeMatch) {
      try {
        const snoozeData = JSON.parse(snoozeMatch[1])
        const days = snoozeData.days || 3
        const snoozedUntil = new Date(Date.now() + days * 86400000).toISOString()

        let query = admin.from('missed_emails')
          .update({ status: 'snoozed', snoozed_until: snoozedUntil })
          .eq('team_id', teamId)
          .eq('user_id', userData.user.id)
          .eq('status', 'pending')

        if (snoozeData.scope === 'all_medium') {
          query = query.eq('urgency', 'medium')
        }
        // 'all' scope applies to all pending emails (no additional filter)

        const { data: snoozedRows } = await query.select('id')
        snoozedCount = snoozedRows?.length || 0
      } catch { /* snooze failed silently */ }
      assistantMessage = assistantMessage.replace(/\[SNOOZE_EMAILS\].*?\[\/SNOOZE_EMAILS\]\n?/, '').trim()
    }

    // ── Execute GENERATE_DRAFTS commands ──
    let draftsTriggered = false
    const draftMatch = assistantMessage.match(/\[GENERATE_DRAFTS\](.*?)\[\/GENERATE_DRAFTS\]/)
    if (draftMatch) {
      try {
        // Trigger draft generation via the existing API
        await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/drafts/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userData.user.id }),
        })
        draftsTriggered = true
      } catch { /* draft generation failed silently */ }
      assistantMessage = assistantMessage.replace(/\[GENERATE_DRAFTS\].*?\[\/GENERATE_DRAFTS\]\n?/, '').trim()
    }

    // ── Execute DISMISS_STALE commands ──
    let dismissedCount = 0
    const dismissMatch = assistantMessage.match(/\[DISMISS_STALE\](.*?)\[\/DISMISS_STALE\]/)
    if (dismissMatch) {
      try {
        const dismissData = JSON.parse(dismissMatch[1])
        const olderThan = dismissData.older_than_days || 14
        const cutoff = new Date(Date.now() - olderThan * 86400000).toISOString()

        if (dismissData.type === 'emails') {
          const { data: dismissedRows } = await admin.from('missed_emails')
            .update({ status: 'dismissed' })
            .eq('team_id', teamId)
            .eq('user_id', userData.user.id)
            .eq('status', 'pending')
            .lt('received_at', cutoff)
            .select('id')
          dismissedCount = dismissedRows?.length || 0
        } else {
          const { data: droppedRows } = await admin.from('commitments')
            .update({ status: 'dropped' })
            .eq('team_id', teamId)
            .or(`creator_id.eq.${userData.user.id},assignee_id.eq.${userData.user.id}`)
            .eq('status', 'open')
            .lt('created_at', cutoff)
            .select('id')
          dismissedCount = droppedRows?.length || 0
        }
      } catch { /* dismiss failed silently */ }
      assistantMessage = assistantMessage.replace(/\[DISMISS_STALE\].*?\[\/DISMISS_STALE\]\n?/, '').trim()
    }

    return NextResponse.json({
      message: assistantMessage,
      createdTask,
      actions: {
        snoozedCount,
        draftsTriggered,
        dismissedCount,
      },
      usage: {
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
      },
    })
  } catch (err: any) {
    console.error('Chat error:', err)
    return NextResponse.json({ error: err.message || 'Chat failed' }, { status: 500 })
  }
}

function buildContextBlock(data: {
  firstName: string
  jobTitle?: string
  company?: string
  activeCommitments: any[]
  overdueCommitments: any[]
  completedCommitments: any[]
  missedEmails: any[]
  awaitingReplies: any[]
  missedChats: any[]
}): string {
  const lines: string[] = ['CURRENT DATA CONTEXT:']

  if (data.jobTitle || data.company) {
    lines.push(`Role: ${data.jobTitle || 'Unknown'} at ${data.company || 'their company'}`)
  }

  // Commitment summary
  lines.push(`\nCOMMITMENTS (last 30 days): ${data.activeCommitments.length} active, ${data.overdueCommitments.length} overdue, ${data.completedCommitments.length} completed`)

  if (data.overdueCommitments.length > 0) {
    lines.push('\nOVERDUE ITEMS (need attention):')
    for (const c of data.overdueCommitments.slice(0, 10)) {
      const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
      const assignee = c.metadata?.assigneeName ? ` → ${c.metadata.assigneeName}` : ''
      lines.push(`- "${c.title}"${assignee} (${age}d old, from ${c.source || 'unknown'})`)
    }
  }

  if (data.activeCommitments.length > 0) {
    lines.push('\nACTIVE COMMITMENTS:')
    for (const c of data.activeCommitments.slice(0, 15)) {
      const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
      const assignee = c.metadata?.assigneeName ? ` → ${c.metadata.assigneeName}` : ''
      lines.push(`- "${c.title}"${assignee} (${age}d, ${c.source || 'unknown'})`)
    }
  }

  // Missed emails
  if (data.missedEmails.length > 0) {
    lines.push(`\nMISSED EMAILS (${data.missedEmails.length} pending):`)
    for (const e of data.missedEmails.slice(0, 10)) {
      lines.push(`- From ${e.from_name}: "${e.subject}" (${e.urgency} urgency, ${e.category})`)
    }
  }

  // Awaiting replies
  if (data.awaitingReplies.length > 0) {
    lines.push(`\nWAITING FOR REPLY (${data.awaitingReplies.length} items):`)
    for (const a of data.awaitingReplies.slice(0, 10)) {
      lines.push(`- To ${a.to_name}: "${a.subject}" — ${a.wait_reason} (${a.days_waiting}d waiting, ${a.urgency})`)
    }
  }

  // Missed chats
  if (data.missedChats.length > 0) {
    lines.push(`\nMISSED SLACK MESSAGES (${data.missedChats.length} pending):`)
    for (const m of data.missedChats.slice(0, 8)) {
      lines.push(`- ${m.sender_name} in #${m.channel_name}: ${m.question_summary || 'message needs attention'} (${m.urgency})`)
    }
  }

  if (data.activeCommitments.length === 0 && data.missedEmails.length === 0 && data.awaitingReplies.length === 0) {
    lines.push('\nNo tracked items found yet. The user may need to connect integrations or run a sync first.')
  }

  return lines.join('\n')
}

export const dynamic = 'force-dynamic'
