// app/(dashboard)/api/wren-suggestions/route.ts
// Returns a contextual suggestion from Wren for a specific page.
// Each page gets a tailored suggestion based on the user's data.

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

const SUGGESTION_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_suggestion',
  description: 'Generate a contextual suggestion for a specific page.',
  input_schema: {
    type: 'object' as const,
    properties: {
      suggestion: {
        type: 'string',
        description: 'A concise 1-2 sentence suggestion. Specific and actionable.',
      },
      action_label: {
        type: 'string',
        description: 'Short CTA label (e.g. "Organize", "Draft all", "Dismiss stale")',
      },
      action_type: {
        type: 'string',
        description: 'Action type: "link" (navigate), "dismiss" (hide suggestion), or "none" (informational)',
      },
    },
    required: ['suggestion'],
  },
}

// Page-specific context builders
async function getPageContext(
  page: string,
  admin: ReturnType<typeof getAdminClient>,
  teamId: string,
  userId: string
): Promise<string | null> {
  switch (page) {
    case 'missed-emails': {
      const { data: emails } = await admin.from('missed_emails')
        .select('from_email, urgency, status')
        .eq('team_id', teamId).eq('user_id', userId).eq('status', 'pending')
      if (!emails || emails.length === 0) return null

      // Count by sender domain
      const domainCounts: Record<string, number> = {}
      for (const e of emails) {
        const domain = e.from_email.split('@')[1] || 'unknown'
        domainCounts[domain] = (domainCounts[domain] || 0) + 1
      }
      const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

      // Check if user has email rules
      const { count } = await admin.from('email_rules')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', teamId).eq('user_id', userId)

      return `${emails.length} pending missed emails.\nTop sender domains: ${topDomains.map(([d, c]) => `${d} (${c})`).join(', ')}\nEmail rules configured: ${count || 0}\nSuggest organizing high-volume senders into folders, or point out patterns.`
    }

    case 'draft-queue': {
      const { data: drafts } = await admin.from('draft_queue')
        .select('subject, commitment_id, channel, status')
        .eq('team_id', teamId).eq('user_id', userId).eq('status', 'ready')
      if (!drafts || drafts.length === 0) return null
      return `${drafts.length} ready drafts waiting to be sent.\nSubjects: ${drafts.slice(0, 5).map(d => `"${d.subject}"`).join(', ')}\nSuggest reviewing and sending them, or mention if several are from the same meeting.`
    }

    case 'commitments': {
      const { data: commitments } = await admin.from('commitments')
        .select('title, status, created_at')
        .eq('team_id', teamId)
        .or(`creator_id.eq.${userId},assignee_id.eq.${userId}`)
        .in('status', ['open', 'overdue'])
        .order('created_at', { ascending: true })
        .limit(20)
      if (!commitments || commitments.length === 0) return null
      const stale = commitments.filter(c => {
        const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
        return age > 14
      })
      return `${commitments.length} open/overdue commitments.\n${stale.length} are older than 14 days.\nOldest: "${stale[0]?.title}" (${Math.floor((Date.now() - new Date(stale[0]?.created_at).getTime()) / 86400000)}d).\nSuggest clearing stale items or drafting nudges.`
    }

    case 'email-rules': {
      const { data: rules } = await admin.from('email_rules')
        .select('match_value, emails_moved, sync_status')
        .eq('team_id', teamId).eq('user_id', userId)
      // Also check for potential rule candidates
      const { data: emails } = await admin.from('missed_emails')
        .select('from_email')
        .eq('team_id', teamId).eq('user_id', userId).eq('status', 'pending')
      const domainCounts: Record<string, number> = {}
      for (const e of (emails || [])) {
        const domain = e.from_email.split('@')[1] || 'unknown'
        domainCounts[domain] = (domainCounts[domain] || 0) + 1
      }
      const suggestions = Object.entries(domainCounts).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1])

      return `${(rules || []).length} active rules. Total emails organized: ${(rules || []).reduce((s, r) => s + (r.emails_moved || 0), 0)}.\nHigh-volume senders without rules: ${suggestions.slice(0, 3).map(([d, c]) => `${d} (${c} emails)`).join(', ') || 'none detected'}.\nSuggest creating rules for frequent senders.`
    }

    default:
      return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const page = request.nextUrl.searchParams.get('page')
    if (!page) {
      return NextResponse.json({ error: 'Missing page parameter' }, { status: 400 })
    }

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

    const context = await getPageContext(page, admin, profile.current_team_id, userData.user.id)
    if (!context) {
      return NextResponse.json({ suggestion: null })
    }

    const firstName = (profile.display_name || 'there').split(' ')[0]
    const prefs = (profile.wren_preferences || {}) as Record<string, any>

    // Skip if user set proactivity to minimal
    if (prefs.proactivity === 'minimal') {
      return NextResponse.json({ suggestion: null })
    }

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: [{ type: 'text', text: `You are Wren, ${firstName}'s AI assistant. Generate one concise, actionable suggestion for the "${page}" page. Max 2 sentences. Be specific — use numbers and names.`, cache_control: { type: 'ephemeral' } } as any],
      tools: [SUGGESTION_TOOL],
      tool_choice: { type: 'tool', name: 'generate_suggestion' },
      messages: [{ role: 'user', content: context }],
    })

    const toolBlock = response.content.find(b => b.type === 'tool_use')
    if (toolBlock && toolBlock.type === 'tool_use') {
      return NextResponse.json(toolBlock.input)
    }

    return NextResponse.json({ suggestion: null })
  } catch (err) {
    console.error('Wren suggestions error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
