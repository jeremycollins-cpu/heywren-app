// app/(dashboard)/api/briefing-summary/route.ts
// Generates an AI meeting prep summary by searching recent emails and Slack
// messages involving the meeting attendees, then producing a concise briefing.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { subject, attendees, bodyPreview } = body as {
    subject: string
    attendees: Array<{ name: string; email: string }>
    bodyPreview: string | null
  }

  if (!subject || !attendees) {
    return NextResponse.json({ error: 'Missing subject or attendees' }, { status: 400 })
  }

  const admin = getAdminClient()

  // Get teamId
  const { data: profile } = await admin
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  const teamId = profile?.current_team_id
  if (!teamId) return NextResponse.json({ error: 'No team' }, { status: 400 })

  // Extract attendee emails and domains for searching
  const attendeeEmails = attendees.map(a => a.email.toLowerCase()).filter(Boolean)
  const externalDomains = [...new Set(
    attendeeEmails
      .map(e => e.split('@')[1])
      .filter(d => d && !d.includes('routeware'))
  )]
  const attendeeNames = attendees.map(a => a.name).filter(Boolean)

  // Search recent emails involving these attendees (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  let relevantEmails: Array<{ subject: string; from_name: string; from_email: string; body_preview: string; received_at: string }> = []

  if (attendeeEmails.length > 0) {
    // Search by sender email matching any attendee
    const { data: emails } = await admin
      .from('outlook_messages')
      .select('subject, from_name, from_email, body_preview, received_at')
      .eq('team_id', teamId)
      .gte('received_at', thirtyDaysAgo)
      .order('received_at', { ascending: false })
      .limit(500)

    if (emails) {
      relevantEmails = emails.filter(e => {
        const fromEmail = (e.from_email || '').toLowerCase()
        const fromDomain = fromEmail.split('@')[1]
        // Match if the sender is an attendee or from an attendee's company
        return attendeeEmails.includes(fromEmail) ||
          (externalDomains.length > 0 && externalDomains.includes(fromDomain))
      }).slice(0, 20)
    }
  }

  // Search recent Slack messages mentioning attendee names or company
  let relevantSlackMessages: Array<{ message_text: string; channel_id: string }> = []

  const searchTerms = [
    ...attendeeNames.map(n => n.split(' ')[0]).filter(n => n.length > 3),
    ...externalDomains.map(d => d.split('.')[0]).filter(d => d.length > 3),
  ]

  if (searchTerms.length > 0) {
    const { data: slackMsgs } = await admin
      .from('slack_messages')
      .select('message_text, channel_id')
      .eq('team_id', teamId)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(500)

    if (slackMsgs) {
      relevantSlackMessages = slackMsgs.filter(m => {
        const text = (m.message_text || '').toLowerCase()
        return searchTerms.some(term => text.includes(term.toLowerCase()))
      }).slice(0, 15)
    }
  }

  // Build context for AI
  const emailContext = relevantEmails.length > 0
    ? relevantEmails.map(e =>
        `[${new Date(e.received_at).toLocaleDateString()}] From: ${e.from_name} <${e.from_email}>\nSubject: ${e.subject}\n${e.body_preview?.slice(0, 200) || ''}`
      ).join('\n\n')
    : 'No recent email threads found with these attendees.'

  const slackContext = relevantSlackMessages.length > 0
    ? relevantSlackMessages.map(m => m.message_text?.slice(0, 200)).join('\n---\n')
    : 'No recent Slack messages found mentioning these attendees.'

  // Generate AI summary
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `You generate concise meeting prep summaries. Given a meeting title, attendees, and recent email/Slack context, produce a brief that helps someone prepare in 30 seconds.

Return ONLY valid JSON:
{
  "summary": "2-3 sentence executive summary of what this meeting is likely about and what to expect, based on the context",
  "keyTopics": ["topic 1", "topic 2", "topic 3"],
  "recentContext": ["One-line summary of a relevant recent email or conversation", "Another relevant item"],
  "suggestedPrep": "One sentence on what to prepare or review before the meeting"
}

Rules:
- If there's rich email/Slack context, use it to infer what the meeting is about
- If context is sparse, base the summary on the meeting title and attendee roles/companies
- Keep everything concise — this is a quick-glance briefing
- keyTopics should be 2-4 items max
- recentContext should highlight the 2-3 most important recent interactions`,
      messages: [{
        role: 'user',
        content: `Meeting: ${subject}
Attendees: ${attendees.map(a => `${a.name} (${a.email})`).join(', ')}
${bodyPreview ? `Meeting description: ${bodyPreview.slice(0, 300)}` : ''}

Recent emails with attendees:
${emailContext}

Recent Slack messages mentioning attendees/company:
${slackContext}`,
      }],
    })

    const content = message.content[0]
    if (content.type === 'text') {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        return NextResponse.json({
          summary: parsed.summary || null,
          keyTopics: parsed.keyTopics || [],
          recentContext: parsed.recentContext || [],
          suggestedPrep: parsed.suggestedPrep || null,
          emailCount: relevantEmails.length,
          slackCount: relevantSlackMessages.length,
        })
      }
    }

    return NextResponse.json({
      summary: null,
      keyTopics: [],
      recentContext: [],
      suggestedPrep: null,
      emailCount: relevantEmails.length,
      slackCount: relevantSlackMessages.length,
    })
  } catch (err) {
    console.error('Briefing summary generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
