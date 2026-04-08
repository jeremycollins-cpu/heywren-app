// app/(dashboard)/api/wren-insight/route.ts
// Returns a single proactive insight from Wren for the dashboard card.
// Uses the same context model as the chat but asks for one concise observation.

import { NextResponse } from 'next/server'
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

const INSIGHT_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_insight',
  description: 'Generate a single proactive insight for the dashboard.',
  input_schema: {
    type: 'object' as const,
    properties: {
      insight: {
        type: 'string',
        description: 'A concise 1-3 sentence insight about the user\'s current state. Specific names, numbers, dates.',
      },
      action_label: {
        type: 'string',
        description: 'A short CTA button label (e.g. "Draft follow-up", "Review emails", "Clear backlog")',
      },
      action_href: {
        type: 'string',
        description: 'The page to link to (e.g. "/missed-emails", "/draft-queue", "/commitments")',
      },
      mood: {
        type: 'string',
        description: 'The overall mood: "positive" (things are going well), "attention" (some items need attention), "urgent" (things are slipping)',
      },
    },
    required: ['insight', 'action_label', 'action_href', 'mood'],
  },
}

export async function GET() {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const admin = getAdminClient()
    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id, display_name, wren_preferences')
      .eq('id', userData.user.id)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team' }, { status: 400 })
    }

    const teamId = profile.current_team_id
    const userId = userData.user.id
    const firstName = (profile.display_name || 'there').split(' ')[0]
    const prefs = (profile.wren_preferences || {}) as Record<string, any>
    const tone = prefs.tone || 'balanced'

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

    // Fetch context in parallel
    const [commitmentsRes, missedEmailsRes, draftsRes, rulesRes] = await Promise.all([
      admin.from('commitments')
        .select('id, title, status, source, created_at, metadata')
        .eq('team_id', teamId)
        .or(`creator_id.eq.${userId},assignee_id.eq.${userId}`)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(30),
      admin.from('missed_emails')
        .select('from_name, subject, urgency, status')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .limit(15),
      admin.from('draft_queue')
        .select('id, subject, status')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .eq('status', 'ready')
        .limit(10),
      admin.from('email_rules')
        .select('id')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .limit(1),
    ])

    const commitments = commitmentsRes.data || []
    const missedEmails = missedEmailsRes.data || []
    const readyDrafts = draftsRes.data || []
    const hasRules = (rulesRes.data || []).length > 0

    const active = commitments.filter(c => c.status === 'open' || c.status === 'pending')
    const overdue = active.filter(c => {
      const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
      return age > 7
    })
    const completed = commitments.filter(c => c.status === 'completed')

    const toneInstruction = tone === 'direct'
      ? 'Be blunt and direct. No fluff.'
      : tone === 'encouraging'
        ? 'Be warm and encouraging. Celebrate progress.'
        : 'Be balanced — acknowledge what\'s going well and what needs attention.'

    const contextLines = [
      `Active commitments: ${active.length}`,
      `Overdue (7+ days): ${overdue.length}`,
      `Completed (30 days): ${completed.length}`,
      `Pending missed emails: ${missedEmails.length}`,
      `Ready drafts in queue: ${readyDrafts.length}`,
      `Has email rules: ${hasRules ? 'yes' : 'no'}`,
    ]

    if (overdue.length > 0) {
      contextLines.push('Overdue items:')
      for (const c of overdue.slice(0, 5)) {
        const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
        contextLines.push(`  - "${c.title}" (${age}d old)`)
      }
    }

    if (missedEmails.length > 0) {
      contextLines.push('Top missed emails:')
      for (const e of missedEmails.slice(0, 3)) {
        contextLines.push(`  - From ${e.from_name}: "${e.subject}" (${e.urgency})`)
      }
    }

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: [{ type: 'text', text: `You are Wren, ${firstName}'s AI assistant. Generate ONE proactive insight for their dashboard. ${toneInstruction} Be specific — use names, numbers, and dates. Max 2 sentences.`, cache_control: { type: 'ephemeral' } } as any],
      tools: [INSIGHT_TOOL],
      tool_choice: { type: 'tool', name: 'generate_insight' },
      messages: [{
        role: 'user',
        content: `Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}\n\n${contextLines.join('\n')}`,
      }],
    })

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      const result = toolBlock.input as {
        insight: string
        action_label: string
        action_href: string
        mood: string
      }
      return NextResponse.json(result)
    }

    return NextResponse.json({
      insight: `You have ${active.length} active commitments and ${missedEmails.length} emails waiting.`,
      action_label: 'View dashboard',
      action_href: '/',
      mood: overdue.length > 2 ? 'urgent' : missedEmails.length > 0 ? 'attention' : 'positive',
    })
  } catch (err) {
    console.error('Wren insight error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
