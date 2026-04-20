import { createClient } from '@supabase/supabase-js'
import { WebClient } from '@slack/web-api'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SlackIntegration {
  access_token: string
  config: Record<string, any> | null
}

/**
 * Fetches a Slack integration for a team (any user's — bot token is shared).
 * Returns null if none exists.
 */
async function getSlackIntegration(teamId: string): Promise<SlackIntegration | null> {
  const supabase = getAdminClient()
  const { data } = await supabase
    .from('integrations')
    .select('access_token, config')
    .eq('team_id', teamId)
    .eq('provider', 'slack')
    .limit(1)
    .maybeSingle()

  return data ?? null
}

/**
 * Returns true if the team's organization has the org-wide Slack alerts
 * kill switch enabled. Defensive: any lookup failure is treated as "not
 * disabled" so a transient DB issue doesn't accidentally silence alerts.
 */
async function areSlackAlertsDisabled(teamId: string): Promise<boolean> {
  const supabase = getAdminClient()
  const { data } = await supabase
    .from('teams')
    .select('organizations!inner(disable_slack_alerts)')
    .eq('id', teamId)
    .maybeSingle()

  const org = (data as any)?.organizations
  return org?.disable_slack_alerts === true
}

/**
 * Resolves the best channel for celebration posts.
 * Priority: config.celebrations_channel > first channel the bot is in.
 */
async function resolveCelebrationChannel(
  slack: WebClient,
  config: Record<string, any> | null
): Promise<string | null> {
  if (config?.celebrations_channel) {
    return config.celebrations_channel
  }

  try {
    const listResult = await slack.conversations.list({
      types: 'public_channel',
      limit: 200,
      exclude_archived: true,
    })

    const channels = listResult.channels || []

    // Prefer #general if the bot is already a member
    const general = channels.find(ch => ch.name === 'general' && ch.is_member)
    if (general?.id) return general.id

    // Fall back to first channel the bot is a member of
    const first = channels.find(ch => ch.is_member)
    if (first?.id) return first.id

    // Try joining #general as a last resort
    const generalAny = channels.find(ch => ch.name === 'general')
    if (generalAny?.id) {
      try {
        await slack.conversations.join({ channel: generalAny.id })
        return generalAny.id
      } catch {
        // Bot may lack permission
      }
    }

    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Celebration functions
// ---------------------------------------------------------------------------

/**
 * Posts a celebration when a member earns a new achievement badge.
 * Non-blocking: errors are logged but never thrown.
 */
export async function celebrateAchievement(
  teamId: string,
  data: { userName: string; achievementName: string; tier: string }
): Promise<void> {
  try {
    if (await areSlackAlertsDisabled(teamId)) return
    const integration = await getSlackIntegration(teamId)
    if (!integration) return

    const slack = new WebClient(integration.access_token)
    const channelId = await resolveCelebrationChannel(slack, integration.config)
    if (!channelId) return

    const tierEmoji: Record<string, string> = {
      bronze: ':3rd_place_medal:',
      silver: ':2nd_place_medal:',
      gold: ':1st_place_medal:',
      platinum: ':gem:',
    }
    const emoji = tierEmoji[data.tier] || ':trophy:'

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:trophy: *${data.userName}* just earned the *"${data.achievementName}"* badge! ${emoji}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${capitalize(data.tier)} tier achievement \u00b7 Congrats! :tada:`,
          },
        ],
      },
    ]

    await slack.chat.postMessage({
      channel: channelId,
      text: `\uD83C\uDFC6 ${data.userName} just earned the "${data.achievementName}" badge!`,
      blocks,
      unfurl_links: false,
    })
  } catch (err) {
    console.error('[celebrations] Failed to post achievement celebration:', err)
  }
}

/**
 * Posts a celebration when a member hits a streak milestone.
 * Non-blocking: errors are logged but never thrown.
 */
export async function celebrateStreak(
  teamId: string,
  data: { userName: string; streakWeeks: number }
): Promise<void> {
  try {
    if (await areSlackAlertsDisabled(teamId)) return
    const integration = await getSlackIntegration(teamId)
    if (!integration) return

    const slack = new WebClient(integration.access_token)
    const channelId = await resolveCelebrationChannel(slack, integration.config)
    if (!channelId) return

    const flameCount = Math.min(data.streakWeeks, 5)
    const flames = ':fire:'.repeat(flameCount)

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:fire: *${data.userName}* is on a *${data.streakWeeks}-week streak!* ${flames}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Consistently delivering week after week. Keep it up! :muscle:`,
          },
        ],
      },
    ]

    await slack.chat.postMessage({
      channel: channelId,
      text: `\uD83D\uDD25 ${data.userName} is on a ${data.streakWeeks}-week streak!`,
      blocks,
      unfurl_links: false,
    })
  } catch (err) {
    console.error('[celebrations] Failed to post streak celebration:', err)
  }
}

/**
 * Posts a celebration when a member moves up significantly on the leaderboard.
 * Non-blocking: errors are logged but never thrown.
 */
export async function celebrateLeaderboardChange(
  teamId: string,
  data: { userName: string; newRank: number; previousRank: number }
): Promise<void> {
  try {
    if (await areSlackAlertsDisabled(teamId)) return
    const integration = await getSlackIntegration(teamId)
    if (!integration) return

    const slack = new WebClient(integration.access_token)
    const channelId = await resolveCelebrationChannel(slack, integration.config)
    if (!channelId) return

    const positionsUp = data.previousRank - data.newRank

    const rankEmoji: Record<number, string> = {
      1: ':1st_place_medal:',
      2: ':2nd_place_medal:',
      3: ':3rd_place_medal:',
    }
    const emoji = rankEmoji[data.newRank] || ':chart_with_upwards_trend:'

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:bar_chart: *${data.userName}* just moved to *#${data.newRank}* on the leaderboard! ${emoji}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Up ${positionsUp} ${positionsUp === 1 ? 'position' : 'positions'} from #${data.previousRank} \u00b7 Great work! :rocket:`,
          },
        ],
      },
    ]

    await slack.chat.postMessage({
      channel: channelId,
      text: `\uD83D\uDCCA ${data.userName} just moved to #${data.newRank} on the leaderboard!`,
      blocks,
      unfurl_links: false,
    })
  } catch (err) {
    console.error('[celebrations] Failed to post leaderboard celebration:', err)
  }
}

/**
 * Posts a celebration when a team challenge is completed.
 * Non-blocking: errors are logged but never thrown.
 */
export async function celebrateChallengeCompleted(
  teamId: string,
  data: { challengeTitle: string }
): Promise<void> {
  try {
    if (await areSlackAlertsDisabled(teamId)) return
    const integration = await getSlackIntegration(teamId)
    if (!integration) return

    const slack = new WebClient(integration.access_token)
    const channelId = await resolveCelebrationChannel(slack, integration.config)
    if (!channelId) return

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:dart: Team challenge *"${data.challengeTitle}"* completed! :tada:`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `The whole team came together to make it happen. Amazing work! :clap:`,
          },
        ],
      },
    ]

    await slack.chat.postMessage({
      channel: channelId,
      text: `\uD83C\uDFAF Team challenge "${data.challengeTitle}" completed!`,
      blocks,
      unfurl_links: false,
    })
  } catch (err) {
    console.error('[celebrations] Failed to post challenge celebration:', err)
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
