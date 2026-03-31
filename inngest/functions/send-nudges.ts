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
 * Sends Slack DM nudges for overdue/stale commitments.
 * Runs at 9 AM on weekdays.
 *
 * Groups overdue items per assignee per team, then sends a single DM
 * per person with a count summary (no commitment content is exposed).
 */
export const sendNudges = inngest.createFunction(
  { id: 'send-nudges' },
  { cron: '0 9 * * 1-5' }, // 9 AM weekdays
  async ({ step }) => {
    const supabase = getAdminClient()

    // -- 1. Fetch overdue/stale commitments that haven't been nudged today --
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const nudgeableStatuses = ['overdue', 'pending']

    const commitments = await step.run('fetch-nudgeable-commitments', async () => {
      const { data, error } = await supabase
        .from('commitments')
        .select('id, team_id, assignee_id, status, due_date')
        .in('status', nudgeableStatuses)
        .is('deleted_at', null)
        .not('assignee_id', 'is', null)
        .order('due_date', { ascending: true })

      if (error) throw error
      return data || []
    })

    if (!commitments || commitments.length === 0) {
      return { success: true, nudgesSent: 0, reason: 'no nudgeable commitments' }
    }

    // Filter to truly overdue items (due_date in the past) or stale pending
    // items (pending for more than 3 days with no recent nudge)
    const now = new Date()

    const overdueItems = commitments.filter(c => {
      if (c.status === 'overdue') return true
      if (c.status === 'pending' && c.due_date && new Date(c.due_date) < now) return true
      return false
    })

    if (overdueItems.length === 0) {
      return { success: true, nudgesSent: 0, reason: 'no overdue items' }
    }

    // -- 2. Check which commitments were already nudged today ----------------
    const commitmentIds = overdueItems.map(c => c.id)

    // Return an array (not a Set) so it serializes correctly across Inngest steps
    const alreadyNudgedIds = await step.run('check-recent-nudges', async () => {
      const { data } = await supabase
        .from('nudges')
        .select('commitment_id')
        .in('commitment_id', commitmentIds)
        .gte('sent_at', todayStart.toISOString())
        .eq('status', 'sent')

      return (data || []).map(n => n.commitment_id)
    })

    const alreadyNudgedSet = new Set(alreadyNudgedIds)
    const itemsToNudge = overdueItems.filter(c => !alreadyNudgedSet.has(c.id))

    if (itemsToNudge.length === 0) {
      return { success: true, nudgesSent: 0, reason: 'all already nudged today' }
    }

    // -- 3. Group by team + assignee for batched DMs -------------------------
    const grouped = new Map<string, { teamId: string; assigneeId: string; commitmentIds: string[]; overdueCount: number }>()

    for (const item of itemsToNudge) {
      const key = `${item.team_id}:${item.assignee_id}`
      if (!grouped.has(key)) {
        grouped.set(key, {
          teamId: item.team_id,
          assigneeId: item.assignee_id,
          commitmentIds: [],
          overdueCount: 0,
        })
      }
      const group = grouped.get(key)!
      group.commitmentIds.push(item.id)
      group.overdueCount++
    }

    // -- 4. Fetch Slack integrations for all relevant teams ------------------
    const teamIds = [...new Set(itemsToNudge.map(c => c.team_id))]

    const slackIntegrationsRaw = await step.run('fetch-slack-integrations', async () => {
      const { data } = await supabase
        .from('integrations')
        .select('team_id, access_token, config')
        .in('team_id', teamIds)
        .eq('provider', 'slack')

      return data || []
    })

    const slackIntegrations = new Map(slackIntegrationsRaw.map(i => [i.team_id, i]))

    // -- 5. Resolve assignee emails to Slack user IDs ------------------------
    const assigneeIds = [...new Set(itemsToNudge.map(c => c.assignee_id))]

    const assigneeProfilesRaw = await step.run('fetch-assignee-profiles', async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', assigneeIds)

      return data || []
    })

    const assigneeProfiles = new Map(assigneeProfilesRaw.map(p => [p.id, p]))

    // -- 6. Send DMs ---------------------------------------------------------
    let nudgesSent = 0
    let nudgesFailed = 0
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.com'

    for (const [, group] of grouped) {
      const integration = slackIntegrations.get(group.teamId)
      if (!integration?.access_token) continue

      // Check if nudges are disabled for this team
      const integrationConfig = (integration.config as Record<string, unknown>) || {}
      if (integrationConfig.nudges_enabled === false) continue

      const profile = assigneeProfiles.get(group.assigneeId)
      if (!profile?.email) continue

      await step.run(`send-nudge-${group.teamId}-${group.assigneeId}`, async () => {
        const slack = new WebClient(integration.access_token)

        try {
          // Resolve email to Slack user ID
          const lookupResult = await slack.users.lookupByEmail({ email: profile.email })
          const slackUserId = lookupResult.user?.id

          if (!slackUserId) {
            console.warn(`[send-nudges] Could not resolve Slack user for ${profile.email}`)
            return
          }

          // Open a DM conversation
          const dmResult = await slack.conversations.open({ users: slackUserId })
          const channelId = dmResult.channel?.id

          if (!channelId) {
            console.warn(`[send-nudges] Could not open DM for ${slackUserId}`)
            return
          }

          // Build Block Kit message -- counts only, no commitment content
          const itemLabel = group.overdueCount === 1 ? 'item' : 'items'
          const greeting = getGreeting()

          const blocks = [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `${greeting} You have *${group.overdueCount} overdue ${itemLabel}* that could use your attention.`,
              },
            },
            {
              type: 'divider',
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `Take a moment to review and update your commitments. Your team is counting on you!`,
              },
              accessory: {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View in HeyWren',
                  emoji: true,
                },
                url: `${appUrl}/dashboard?filter=overdue`,
                action_id: 'view_overdue',
                style: 'primary',
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'Sent by HeyWren \u00b7 You can manage notification preferences in your settings.',
                },
              ],
            },
          ]

          const fallbackText = `${greeting} You have ${group.overdueCount} overdue ${itemLabel} in HeyWren.`

          await slack.chat.postMessage({
            channel: channelId,
            text: fallbackText,
            blocks,
          })

          // Record nudges in the database
          const nudgeRows = group.commitmentIds.map(commitmentId => ({
            commitment_id: commitmentId,
            user_id: group.assigneeId,
            message: fallbackText,
            channel: 'slack' as const,
            status: 'sent' as const,
            sent_at: new Date().toISOString(),
          }))

          const { error: nudgeError } = await supabase
            .from('nudges')
            .insert(nudgeRows)

          if (nudgeError) {
            console.error('[send-nudges] Failed to record nudges:', nudgeError)
          }

          nudgesSent += group.overdueCount
        } catch (err) {
          console.error(`[send-nudges] Failed to send nudge to ${profile.email}:`, err)
          nudgesFailed += group.overdueCount

          // Record failed nudges
          const failedRows = group.commitmentIds.map(commitmentId => ({
            commitment_id: commitmentId,
            user_id: group.assigneeId,
            message: `Nudge delivery failed`,
            channel: 'slack' as const,
            status: 'failed' as const,
            sent_at: new Date().toISOString(),
          }))

          try { await supabase.from('nudges').insert(failedRows) } catch {}
        }
      })
    }

    return { success: true, nudgesSent, nudgesFailed }
  }
)

/** Returns a time-appropriate greeting. */
function getGreeting(): string {
  const hour = new Date().getUTCHours()
  if (hour < 12) return 'Good morning!'
  if (hour < 17) return 'Good afternoon!'
  return 'Hey there!'
}
