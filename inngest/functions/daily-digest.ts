import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Posts a daily digest to each team's Slack channel at 8 AM.
 * Shows team-level stats only (counts, no commitment content).
 */
export const dailyDigest = inngest.createFunction(
  { id: 'daily-digest' },
  { cron: '0 8 * * *' }, // 8 AM daily
  async ({ step }) => {
    const supabase = getAdminClient()

    // -- 1. Get all teams with their Slack integration ----------------------
    const teams = await step.run('fetch-teams-with-slack', async () => {
      const { data: allTeams } = await supabase
        .from('teams')
        .select('id, name, organization_id')

      if (!allTeams || allTeams.length === 0) return []

      const teamIds = allTeams.map(t => t.id)

      const { data: integrations } = await supabase
        .from('integrations')
        .select('team_id, access_token, config')
        .in('team_id', teamIds)
        .eq('provider', 'slack')

      // With per-user integrations, pick one Slack bot token per team
      const integrationMap = new Map<string, typeof integrations extends (infer T)[] | null ? T : never>()
      for (const i of integrations || []) {
        if (!integrationMap.has(i.team_id)) integrationMap.set(i.team_id, i)
      }

      return allTeams
        .filter(t => integrationMap.has(t.id))
        .map(t => ({
          ...t,
          integration: integrationMap.get(t.id)!,
        }))
    })

    if (teams.length === 0) {
      return { success: true, digestsSent: 0, reason: 'no teams with Slack integration' }
    }

    let digestsSent = 0
    let digestsFailed = 0
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.com'

    const now = new Date()

    // Start of current week (Monday)
    const dayOfWeek = now.getUTCDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const weekStart = new Date(now)
    weekStart.setUTCDate(weekStart.getUTCDate() + mondayOffset)
    weekStart.setUTCHours(0, 0, 0, 0)

    for (const team of teams) {
      await step.run(`digest-${team.id}`, async () => {
        try {
          // -- 2. Calculate team-level stats --------------------------------
          const statsResult = await calculateTeamStats(supabase, team.id, weekStart.toISOString())

          const responseRate = statsResult.totalMissed > 0
            ? Math.round((statsResult.resolvedMissed / statsResult.totalMissed) * 100)
            : 100

          // -- 3. Find the right Slack channel ------------------------------
          const slack = new WebClient(team.integration.access_token)
          const channelId = await resolveDigestChannel(slack, team.integration.config)

          if (!channelId) {
            console.warn(`[daily-digest] No Slack channel found for team ${team.name}`)
            return
          }

          // -- 4. Build and send Block Kit message --------------------------
          const dayName = now.toLocaleDateString('en-US', { weekday: 'long' })
          const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

          const blocks = [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: `Daily Digest \u2014 ${dayName}, ${dateStr}`,
                emoji: true,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `Here's how *${team.name}* is tracking this week:`,
              },
            },
            {
              type: 'divider',
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Completed This Week*\n${statsResult.completedThisWeek}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Overdue*\n${statsResult.overdue}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*New This Week*\n${statsResult.newThisWeek}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Response Rate*\n${responseRate}%`,
                },
              ],
            },
            {
              type: 'divider',
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${statsResult.totalActive} active ${statsResult.totalActive === 1 ? 'item' : 'items'}* across the team.`,
              },
              accessory: {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Open Dashboard',
                  emoji: true,
                },
                url: `${appUrl}/dashboard`,
                action_id: 'open_dashboard',
                style: 'primary',
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'Sent by HeyWren \u00b7 Daily digest at 8 AM',
                },
              ],
            },
          ]

          const fallbackText = `Daily Digest for ${team.name}: ${statsResult.completedThisWeek} completed, ${statsResult.overdue} overdue, ${statsResult.newThisWeek} new this week.`

          await slack.chat.postMessage({
            channel: channelId,
            text: fallbackText,
            blocks,
            unfurl_links: false,
          })

          digestsSent++
        } catch (err) {
          console.error(`[daily-digest] Failed for team ${team.name}:`, err)
          digestsFailed++
        }
      })
    }

    return { success: true, digestsSent, digestsFailed }
  }
)

/**
 * Calculates team-level commitment stats for the digest.
 */
async function calculateTeamStats(
  supabase: ReturnType<typeof getAdminClient>,
  teamId: string,
  weekStartIso: string
) {
  const [allActiveRes, completedRes, overdueRes, newRes, totalMissedRes, resolvedMissedRes] =
    await Promise.all([
      supabase
        .from('commitments')
        .select('id')
        .eq('team_id', teamId)
        .in('status', ['pending', 'in_progress'])
        .is('deleted_at', null),
      supabase
        .from('commitments')
        .select('id')
        .eq('team_id', teamId)
        .eq('status', 'completed')
        .gte('completed_at', weekStartIso),
      supabase
        .from('commitments')
        .select('id')
        .eq('team_id', teamId)
        .eq('status', 'overdue')
        .is('deleted_at', null),
      supabase
        .from('commitments')
        .select('id')
        .eq('team_id', teamId)
        .gte('created_at', weekStartIso)
        .is('deleted_at', null),
      supabase
        .from('missed_emails')
        .select('id')
        .eq('team_id', teamId)
        .gte('created_at', weekStartIso),
      supabase
        .from('missed_emails')
        .select('id')
        .eq('team_id', teamId)
        .in('status', ['replied', 'dismissed'])
        .gte('updated_at', weekStartIso),
    ])

  return {
    totalActive: allActiveRes.data?.length ?? 0,
    completedThisWeek: completedRes.data?.length ?? 0,
    overdue: overdueRes.data?.length ?? 0,
    newThisWeek: newRes.data?.length ?? 0,
    totalMissed: totalMissedRes.data?.length ?? 0,
    resolvedMissed: resolvedMissedRes.data?.length ?? 0,
  }
}

/**
 * Finds the best Slack channel for posting the digest.
 * Priority: config.digest_channel > #general > first available channel.
 */
async function resolveDigestChannel(
  slack: WebClient,
  config: Record<string, any> | null
): Promise<string | null> {
  // 0. If digest is explicitly disabled, skip
  if (config?.digest_enabled === false) {
    return null
  }

  // 1. Check integration config for an explicit channel
  if (config?.digest_channel) {
    return config.digest_channel
  }

  try {
    // 2. Try to find #general
    const listResult = await slack.conversations.list({
      types: 'public_channel',
      limit: 200,
      exclude_archived: true,
    })

    const channels = listResult.channels || []

    const general = channels.find(
      ch => ch.name === 'general' && ch.is_member
    )
    if (general?.id) return general.id

    // 3. Fall back to the first channel the bot is a member of
    const botChannel = channels.find(ch => ch.is_member)
    if (botChannel?.id) return botChannel.id

    // 4. If not a member of any channel yet, try joining #general
    const generalAny = channels.find(ch => ch.name === 'general')
    if (generalAny?.id) {
      try {
        await slack.conversations.join({ channel: generalAny.id })
        return generalAny.id
      } catch {
        // Bot may not have permission to join
      }
    }

    return null
  } catch (err) {
    console.error('[daily-digest] Failed to list Slack channels:', err)
    return null
  }
}
