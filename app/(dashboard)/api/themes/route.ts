import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { generateThemes } from '@/lib/ai/generate-themes'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSessionClient()
    const { data: userData } = await supabase.auth.getUser()
    if (!userData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = userData.user.id
    const admin = getAdminClient()

    const { data: profile } = await admin
      .from('profiles')
      .select('current_team_id, email, full_name, display_name, slack_user_id')
      .eq('id', userId)
      .single()

    if (!profile?.current_team_id) {
      return NextResponse.json({ error: 'No team found' }, { status: 400 })
    }

    const teamId = profile.current_team_id
    const userEmail = profile.email?.toLowerCase() || ''
    const userName = profile.full_name || profile.display_name || profile.email?.split('@')[0] || 'User'
    const slackUserId = profile.slack_user_id

    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    // Fetch all data sources in parallel
    const [commitments, emails, calendar, slack] = await Promise.all([
      // Commitments for this user
      admin
        .from('commitments')
        .select('title, status, source, source_ref, created_at, metadata')
        .eq('team_id', teamId)
        .or(`creator_id.eq.${userId},assignee_id.eq.${userId}`)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50),

      // Emails sent/received by this user
      admin
        .from('outlook_messages')
        .select('subject, from_name, from_email, to_recipients, received_at')
        .eq('team_id', teamId)
        .or(`from_email.eq.${userEmail},to_recipients.ilike.%${userEmail}%`)
        .gte('received_at', sevenDaysAgo)
        .order('received_at', { ascending: false })
        .limit(60),

      // Calendar events
      admin
        .from('outlook_calendar_events')
        .select('subject, organizer_email, start_time, attendees')
        .eq('team_id', teamId)
        .or(`organizer_email.eq.${userEmail},attendees::text.ilike.%${userEmail}%`)
        .gte('start_time', sevenDaysAgo)
        .order('start_time', { ascending: false })
        .limit(40),

      // Slack messages
      slackUserId
        ? admin
            .from('slack_messages')
            .select('channel_id, message_text, created_at')
            .eq('team_id', teamId)
            .eq('user_id', slackUserId)
            .gte('created_at', sevenDaysAgo)
            .order('created_at', { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [] }),
    ])

    const commitmentData = commitments.data || []
    const emailData = emails.data || []
    const calendarData = calendar.data || []
    const slackData = slack.data || []

    // If there's not enough data, return empty
    if (commitmentData.length + emailData.length + calendarData.length + slackData.length < 5) {
      return NextResponse.json({
        themes: [],
        headline: '',
        periodLabel: '',
        generatedAt: new Date().toISOString(),
        insufficient: true,
      })
    }

    const themes = await generateThemes({
      userName,
      commitments: commitmentData.map(c => ({
        title: c.title,
        status: c.status,
        source: c.source,
        created_at: c.created_at,
        metadata: c.metadata,
      })),
      recentEmails: emailData.map(e => ({
        subject: e.subject || '(no subject)',
        from_name: e.from_name || e.from_email || 'Unknown',
        to_recipients: e.to_recipients || '',
        received_at: e.received_at,
      })),
      calendarEvents: calendarData.map(e => ({
        subject: e.subject || '(no subject)',
        organizer_email: e.organizer_email || '',
        start_time: e.start_time,
        attendees_count: Array.isArray(e.attendees) ? e.attendees.length : 0,
      })),
      slackMessages: slackData.map(m => ({
        channel_name: m.channel_id || 'unknown',
        message_preview: (m.message_text || '').slice(0, 150),
        created_at: m.created_at,
      })),
    })

    return NextResponse.json(themes)
  } catch (err: any) {
    console.error('Themes generation error:', err)
    return NextResponse.json({ error: err.message || 'Failed to generate themes' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
