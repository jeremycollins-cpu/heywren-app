// inngest/functions/wren-morning-brief.ts
// Sends a personalized morning briefing via Slack DM to each user.
// Combines: overdue commitments, today's meetings, missed emails, ready drafts.
// Runs at 8:30 AM PT weekdays — after sync-outlook (6 AM) and scan-missed-emails (6:30 AM).

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const wrenMorningBrief = inngest.createFunction(
  { id: 'wren-morning-brief', retries: 2, concurrency: { limit: 5 } },
  { cron: 'TZ=America/Los_Angeles 30 8 * * 1-5' }, // 8:30 AM PT weekdays
  async ({ step }) => {
    const supabase = getAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'

    // Get all users with Slack integration who have morning_brief enabled
    const users = await step.run('fetch-users', async () => {
      const { data: integrations } = await supabase
        .from('integrations')
        .select('team_id, user_id, access_token, config')
        .eq('provider', 'slack')

      if (!integrations) return []

      // Deduplicate: one Slack token per team (for DMs we need the bot token)
      const tokenByTeam = new Map<string, string>()
      for (const i of integrations) {
        if (!tokenByTeam.has(i.team_id)) tokenByTeam.set(i.team_id, i.access_token)
      }

      // Get profiles with preferences
      const userIds = [...new Set(integrations.map(i => i.user_id))]
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, current_team_id, wren_preferences')
        .in('id', userIds)

      return (profiles || [])
        .filter(p => {
          const prefs = (p.wren_preferences || {}) as Record<string, any>
          return prefs.morning_brief !== false // Default to true
        })
        .map(p => ({
          userId: p.id,
          firstName: (p.display_name || 'there').split(' ')[0],
          teamId: p.current_team_id,
          slackToken: tokenByTeam.get(p.current_team_id) || null,
          tone: ((p.wren_preferences || {}) as Record<string, any>).tone || 'balanced',
        }))
        .filter(u => u.slackToken && u.teamId)
    })

    let sent = 0
    let errors = 0

    for (const user of users) {
      await step.run(`brief-${user.userId}`, async () => {
        try {
          const today = new Date()
          const todayStart = new Date(today)
          todayStart.setHours(0, 0, 0, 0)
          const todayEnd = new Date(today)
          todayEnd.setHours(23, 59, 59, 999)

          // Fetch user's data in parallel
          const [overdueRes, missedRes, draftsRes, meetingsRes] = await Promise.all([
            supabase.from('commitments')
              .select('title, created_at, metadata')
              .eq('team_id', user.teamId)
              .or(`creator_id.eq.${user.userId},assignee_id.eq.${user.userId}`)
              .in('status', ['open', 'overdue'])
              .order('created_at', { ascending: true })
              .limit(10),
            supabase.from('missed_emails')
              .select('from_name, subject, urgency')
              .eq('team_id', user.teamId)
              .eq('user_id', user.userId)
              .eq('status', 'pending')
              .order('urgency', { ascending: true })
              .limit(5),
            supabase.from('draft_queue')
              .select('id')
              .eq('team_id', user.teamId)
              .eq('user_id', user.userId)
              .eq('status', 'ready'),
            supabase.from('outlook_calendar_events')
              .select('subject, start_time, attendee_count')
              .eq('team_id', user.teamId)
              .eq('user_id', user.userId)
              .gte('start_time', todayStart.toISOString())
              .lte('start_time', todayEnd.toISOString())
              .order('start_time', { ascending: true })
              .limit(5),
          ])

          const overdue = overdueRes.data || []
          const missed = missedRes.data || []
          const drafts = draftsRes.data || []
          const meetings = meetingsRes.data || []

          // Skip if nothing to report
          if (overdue.length === 0 && missed.length === 0 && drafts.length === 0 && meetings.length === 0) {
            return
          }

          // Build the brief
          const greeting = user.tone === 'encouraging'
            ? `Good morning, ${user.firstName}! Here's your day at a glance.`
            : user.tone === 'direct'
              ? `Morning, ${user.firstName}. Here's what needs your attention.`
              : `Good morning, ${user.firstName}. Here's your briefing for today.`

          const sections: string[] = []

          if (meetings.length > 0) {
            const meetingLines = meetings.map(m => {
              const time = new Date(m.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              return `  ${time} — ${m.subject}`
            })
            sections.push(`*Today's meetings (${meetings.length}):*\n${meetingLines.join('\n')}`)
          }

          if (missed.length > 0) {
            const critical = missed.filter(e => e.urgency === 'critical' || e.urgency === 'high')
            if (critical.length > 0) {
              sections.push(`*${critical.length} high-priority email${critical.length !== 1 ? 's' : ''} waiting:*\n${critical.slice(0, 3).map(e => `  From ${e.from_name}: "${e.subject}"`).join('\n')}`)
            } else {
              sections.push(`*${missed.length} missed email${missed.length !== 1 ? 's' : ''}* need your attention.`)
            }
          }

          const stale = overdue.filter(c => {
            const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
            return age > 7
          })
          if (stale.length > 0) {
            sections.push(`*${stale.length} overdue commitment${stale.length !== 1 ? 's' : ''}:*\n${stale.slice(0, 3).map(c => `  "${c.title}"`).join('\n')}`)
          }

          if (drafts.length > 0) {
            sections.push(`*${drafts.length} draft${drafts.length !== 1 ? 's' : ''}* ready to review and send.`)
          }

          const blocks = [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: greeting },
            },
            { type: 'divider' },
            ...sections.map(s => ({
              type: 'section',
              text: { type: 'mrkdwn', text: s },
            })),
            { type: 'divider' },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Open Dashboard', emoji: true },
                  url: appUrl,
                  action_id: 'open_dashboard',
                  style: 'primary',
                },
                ...(missed.length > 0 ? [{
                  type: 'button',
                  text: { type: 'plain_text', text: 'Review Emails', emoji: true },
                  url: `${appUrl}/missed-emails`,
                  action_id: 'open_missed_emails',
                }] : []),
                ...(drafts.length > 0 ? [{
                  type: 'button',
                  text: { type: 'plain_text', text: 'Review Drafts', emoji: true },
                  url: `${appUrl}/draft-queue`,
                  action_id: 'open_drafts',
                }] : []),
              ],
            },
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: 'Wren Morning Brief \u00b7 Manage in Settings' }],
            },
          ]

          // Send DM
          const slack = new WebClient(user.slackToken!)
          // Open DM channel with user (need their Slack user ID)
          // For now, we'll try posting to the user by their email-mapped Slack ID
          const { data: integration } = await supabase
            .from('integrations')
            .select('config')
            .eq('team_id', user.teamId)
            .eq('user_id', user.userId)
            .eq('provider', 'slack')
            .single()

          const slackUserId = integration?.config?.slack_user_id
          if (!slackUserId) return

          const { channel } = await slack.conversations.open({ users: slackUserId })
          if (!channel?.id) return

          await slack.chat.postMessage({
            channel: channel.id,
            text: `${greeting} ${sections.join(' ')}`,
            blocks,
            unfurl_links: false,
          })

          sent++
        } catch (err) {
          console.error(`[morning-brief] Failed for user ${user.userId}:`, (err as Error).message)
          errors++
        }
      })
    }

    return { sent, errors, total: users.length }
  }
)
