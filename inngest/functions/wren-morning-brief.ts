// inngest/functions/wren-morning-brief.ts
// Sends a personalized morning briefing via Slack DM to each user.
// Combines: overdue commitments, today's meetings, missed emails, ready drafts.
// Runs at 8:30 AM PT weekdays — after sync-outlook (6 AM) and scan-missed-emails (6:30 AM).

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'
import { sendEmail } from '@/lib/email/send'
import { buildMorningBriefEmail } from '@/lib/email/templates/morning-brief'

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

    // Get all users with morning_brief enabled — Slack users get DM, others get email
    const users = await step.run('fetch-users', async () => {
      const { data: integrations } = await supabase
        .from('integrations')
        .select('team_id, user_id, access_token, config, provider')
        .in('provider', ['slack', 'outlook'])

      if (!integrations) return []

      // Build lookup maps per user
      const slackTokenByTeam = new Map<string, string>()
      const slackUserIdByUser = new Map<string, string>()
      const teamByUser = new Map<string, string>()
      for (const i of integrations) {
        teamByUser.set(i.user_id, i.team_id)
        if (i.provider === 'slack') {
          if (!slackTokenByTeam.has(i.team_id)) slackTokenByTeam.set(i.team_id, i.access_token)
          if (i.config?.slack_user_id) slackUserIdByUser.set(i.user_id, i.config.slack_user_id)
        }
      }

      // Get all profiles with at least one integration
      const userIds = [...new Set(integrations.map(i => i.user_id))]
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, display_name, email, current_team_id, wren_preferences')
        .in('id', userIds)

      return (profiles || [])
        .filter(p => {
          const prefs = (p.wren_preferences || {}) as Record<string, any>
          return prefs.morning_brief !== false && p.current_team_id
        })
        .map(p => ({
          userId: p.id,
          firstName: (p.display_name || 'there').split(' ')[0],
          teamId: p.current_team_id,
          email: p.email || null,
          slackToken: slackTokenByTeam.get(p.current_team_id) || null,
          slackUserId: slackUserIdByUser.get(p.id) || null,
          tone: ((p.wren_preferences || {}) as Record<string, any>).tone || 'balanced',
        }))
        .filter(u => u.teamId)
    })

    let slackSent = 0
    let emailSent = 0
    let errors = 0

    for (const user of users) {
      await step.run(`brief-${user.userId}`, async () => {
        try {
          const today = new Date()
          const todayStart = new Date(today)
          todayStart.setHours(0, 0, 0, 0)
          const todayEnd = new Date(today)
          todayEnd.setHours(23, 59, 59, 999)

          const todayStr = today.toISOString().split('T')[0]

          const [overdueRes, missedRes, missedChatsRes, draftsRes, meetingsRes, conflictsRes, threatsRes, waitingRes] = await Promise.all([
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
            supabase.from('missed_chats')
              .select('from_name, body_preview, urgency')
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
            supabase.from('calendar_conflicts')
              .select('description, severity, conflict_type')
              .eq('team_id', user.teamId)
              .eq('user_id', user.userId)
              .eq('status', 'unresolved')
              .eq('conflict_date', todayStr)
              .limit(5),
            supabase.from('email_threat_alerts')
              .select('subject, threat_level, threat_type, from_email')
              .eq('team_id', user.teamId)
              .eq('user_id', user.userId)
              .eq('status', 'unreviewed')
              .limit(3),
            supabase.from('awaiting_replies')
              .select('id')
              .eq('team_id', user.teamId)
              .eq('user_id', user.userId)
              .eq('status', 'waiting'),
          ])

          const overdue = overdueRes.data || []
          const missed = missedRes.data || []
          const missedChats = missedChatsRes.data || []
          const drafts = draftsRes.data || []
          const meetings = meetingsRes.data || []
          const calConflicts = conflictsRes.data || []
          const threats = threatsRes.data || []
          const waitingRoom = waitingRes.data || []

          // Skip if nothing to report
          if (overdue.length === 0 && missed.length === 0 && missedChats.length === 0 && drafts.length === 0 && meetings.length === 0 && calConflicts.length === 0 && threats.length === 0 && waitingRoom.length === 0) {
            return
          }

          // Build tone-appropriate greeting
          const greeting = user.tone === 'encouraging'
            ? `Good morning, ${user.firstName}! Here's your day at a glance.`
            : user.tone === 'direct'
              ? `Morning, ${user.firstName}. Here's what needs your attention.`
              : `Good morning, ${user.firstName}. Here's your briefing for today.`

          const stale = overdue.filter(c => {
            const age = Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000)
            return age > 7
          })

          // ── Slack DM (if connected) ──
          if (user.slackToken && user.slackUserId) {
            const sections: string[] = []

            if (calConflicts.length > 0) {
              const critical = calConflicts.filter(c => c.severity === 'critical')
              if (critical.length > 0) {
                sections.push(`*:warning: ${critical.length} calendar conflict${critical.length !== 1 ? 's' : ''} today:*\n${critical.map(c => `  ${c.description}`).join('\n')}`)
              } else {
                sections.push(`*${calConflicts.length} calendar warning${calConflicts.length !== 1 ? 's' : ''} today* — check Calendar Protection.`)
              }
            }

            if (threats.length > 0) {
              sections.push(`*:rotating_light: ${threats.length} suspicious email${threats.length !== 1 ? 's' : ''} detected:*\n${threats.map(t => `  "${t.subject}" from ${t.from_email} (${t.threat_level})`).join('\n')}\nReview in Security Alerts before interacting.`)
            }

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

            if (missedChats.length > 0) {
              sections.push(`*${missedChats.length} Slack message${missedChats.length !== 1 ? 's' : ''} need a reply:*\n${missedChats.slice(0, 3).map(c => `  ${c.from_name}: "${(c.body_preview || '').slice(0, 60)}"`).join('\n')}`)
            }

            if (stale.length > 0) {
              sections.push(`*${stale.length} overdue commitment${stale.length !== 1 ? 's' : ''}:*\n${stale.slice(0, 3).map(c => `  "${c.title}"`).join('\n')}`)
            }

            if (drafts.length > 0) {
              sections.push(`*${drafts.length} draft${drafts.length !== 1 ? 's' : ''}* ready to review and send.`)
            }

            if (waitingRoom.length > 0) {
              sections.push(`*${waitingRoom.length} sent email${waitingRoom.length !== 1 ? 's' : ''}* still waiting for a reply.`)
            }

            const blocks = [
              { type: 'section', text: { type: 'mrkdwn', text: greeting } },
              { type: 'divider' },
              ...sections.map(s => ({ type: 'section', text: { type: 'mrkdwn', text: s } })),
              { type: 'divider' },
              {
                type: 'actions',
                elements: [
                  { type: 'button', text: { type: 'plain_text', text: 'Open Dashboard', emoji: true }, url: appUrl, action_id: 'open_dashboard', style: 'primary' },
                  ...(missed.length > 0 ? [{ type: 'button', text: { type: 'plain_text', text: 'Review Emails', emoji: true }, url: `${appUrl}/missed-emails`, action_id: 'open_missed_emails' }] : []),
                  ...(drafts.length > 0 ? [{ type: 'button', text: { type: 'plain_text', text: 'Review Drafts', emoji: true }, url: `${appUrl}/draft-queue`, action_id: 'open_drafts' }] : []),
                ],
              },
              { type: 'context', elements: [{ type: 'mrkdwn', text: 'Wren Morning Brief \u00b7 Manage in Settings' }] },
            ]

            try {
              const slack = new WebClient(user.slackToken)
              const { channel } = await slack.conversations.open({ users: user.slackUserId })
              if (channel?.id) {
                await slack.chat.postMessage({ channel: channel.id, text: `${greeting} ${sections.join(' ')}`, blocks, unfurl_links: false })
                slackSent++
              }
            } catch (slackErr) {
              console.error(`[morning-brief] Slack failed for ${user.userId}:`, (slackErr as Error).message)
            }
          }

          // ── Email (for all users without Slack, or as supplement) ──
          if (!user.slackToken && user.email) {
            const emailData = buildMorningBriefEmail({
              userName: user.firstName,
              greeting,
              appUrl,
              unsubscribeUrl: `${appUrl}/settings?tab=notifications`,
              calendarConflicts: calConflicts.length > 0 ? calConflicts : undefined,
              threats: threats.length > 0 ? threats.map(t => ({ subject: t.subject, fromEmail: t.from_email, threatLevel: t.threat_level })) : undefined,
              meetings: meetings.length > 0 ? meetings.map(m => ({
                time: new Date(m.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                subject: m.subject,
              })) : undefined,
              missedEmails: missed.length > 0 ? missed.map(e => ({ fromName: e.from_name, subject: e.subject, urgency: e.urgency })) : undefined,
              missedChats: missedChats.length > 0 ? missedChats.map(c => ({ fromName: c.from_name, preview: (c.body_preview || '').slice(0, 80), urgency: c.urgency })) : undefined,
              overdueCommitments: stale.length > 0 ? stale : undefined,
              draftsCount: drafts.length > 0 ? drafts.length : undefined,
              waitingRoomCount: waitingRoom.length > 0 ? waitingRoom.length : undefined,
            })

            if (emailData) {
              try {
                await sendEmail({
                  to: user.email,
                  subject: emailData.subject,
                  html: emailData.html,
                  emailType: 'morning_brief',
                  userId: user.userId,
                  idempotencyKey: `morning-brief-${user.userId}-${todayStr}`,
                })
                emailSent++
              } catch (emailErr) {
                console.error(`[morning-brief] Email failed for ${user.userId}:`, (emailErr as Error).message)
              }
            }
          }
        } catch (err) {
          console.error(`[morning-brief] Failed for user ${user.userId}:`, (err as Error).message)
          errors++
        }
      })
    }

    return { slackSent, emailSent, errors, total: users.length }
  }
)
