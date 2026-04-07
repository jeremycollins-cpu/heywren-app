import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { getWeekStart, getPreviousWeekStart } from '@/lib/team/calculate-scores'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Sends a weekly BI digest to managers (dept_manager and org_admin) via Slack DM.
 * Runs every Monday at 8 AM UTC — after scores are calculated at 6 AM.
 * Contains only metrics — no content/text from commitments or emails.
 */
export const managerWeeklyDigest = inngest.createFunction(
  { id: 'manager-weekly-digest' },
  { cron: '0 8 * * 1' }, // Monday 8 AM UTC
  async ({ step }) => {
    const supabase = getAdminClient()

    const thisMonday = getWeekStart()
    const prevMonday = getPreviousWeekStart(thisMonday)
    const twoWeeksAgo = getPreviousWeekStart(prevMonday)

    // Get all organizations
    const orgs = await step.run('fetch-orgs', async () => {
      const { data } = await supabase
        .from('organizations')
        .select('id, name')
      return data || []
    })

    let digestsSent = 0

    for (const org of orgs) {
      await step.run(`digest-${org.id}`, async () => {
        // Find managers (org_admin + dept_manager) who should receive digests
        const { data: managers } = await supabase
          .from('organization_members')
          .select('user_id, role, department_id, team_id')
          .eq('organization_id', org.id)
          .in('role', ['org_admin', 'dept_manager'])

        if (!managers || managers.length === 0) return

        // Check notification preferences
        const managerIds = managers.map(m => m.user_id)
        const { data: prefs } = await supabase
          .from('notification_preferences')
          .select('user_id, weekly_digest')
          .eq('organization_id', org.id)
          .in('user_id', managerIds)

        const prefsMap = new Map((prefs || []).map(p => [p.user_id, p]))

        // Get this week's scores
        const { data: thisWeekScores } = await supabase
          .from('weekly_scores')
          .select('user_id, department_id, team_id, total_points, commitments_completed, commitments_overdue, response_rate, on_time_rate')
          .eq('organization_id', org.id)
          .eq('week_start', prevMonday)

        // Get last week's scores for comparison
        const { data: lastWeekScores } = await supabase
          .from('weekly_scores')
          .select('user_id, total_points, commitments_completed')
          .eq('organization_id', org.id)
          .eq('week_start', twoWeeksAgo)

        // Get member scores for streak info
        const { data: memberScores } = await supabase
          .from('member_scores')
          .select('user_id, current_streak, org_rank')
          .eq('organization_id', org.id)
          .order('total_points', { ascending: false })

        // Get new achievements this week
        const { data: newAchievements } = await supabase
          .from('member_achievements')
          .select('user_id, achievement_id')
          .eq('organization_id', org.id)
          .eq('week_earned', prevMonday)

        // Get Slack integration for the org's teams
        const teamIds = [...new Set(managers.map(m => m.team_id))]
        const { data: integrations } = await supabase
          .from('integrations')
          .select('team_id, access_token, config')
          .in('team_id', teamIds)
          .eq('provider', 'slack')

        if (!integrations || integrations.length === 0) return

        // Get profiles for top performers
        const allUserIds = [...new Set((thisWeekScores || []).map(s => s.user_id))]
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, display_name, email')
          .in('id', allUserIds)

        const nameMap = new Map((profiles || []).map(p => [p.id, p.display_name || p.email?.split('@')[0] || 'Unknown']))

        // Calculate aggregate metrics
        const scores = thisWeekScores || []
        const prevScores = lastWeekScores || []

        for (const manager of managers) {
          // Check if digest is enabled
          const pref = prefsMap.get(manager.user_id)
          if (pref && pref.weekly_digest === false) continue

          // Scope scores based on role
          const scopedScores = manager.role === 'org_admin'
            ? scores
            : scores.filter(s => s.department_id === manager.department_id)

          const scopedPrevScores = manager.role === 'org_admin'
            ? prevScores
            : prevScores.filter(s => {
                const thisWeekEntry = scores.find(ts => ts.user_id === s.user_id)
                return thisWeekEntry?.department_id === manager.department_id
              })

          if (scopedScores.length === 0) continue

          // Aggregates
          const totalPoints = scopedScores.reduce((s, sc) => s + (sc.total_points || 0), 0)
          const prevTotalPoints = scopedPrevScores.reduce((s, sc) => s + (sc.total_points || 0), 0)
          const pointsDelta = prevTotalPoints > 0
            ? Math.round((totalPoints - prevTotalPoints) / prevTotalPoints * 100)
            : 0

          const totalCompleted = scopedScores.reduce((s, sc) => s + (sc.commitments_completed || 0), 0)
          const totalOverdue = scopedScores.reduce((s, sc) => s + (sc.commitments_overdue || 0), 0)
          const avgResponseRate = scopedScores.length > 0
            ? Math.round(scopedScores.reduce((s, sc) => s + (sc.response_rate || 0), 0) / scopedScores.length)
            : 0
          const avgOnTimeRate = scopedScores.length > 0
            ? Math.round(scopedScores.reduce((s, sc) => s + (sc.on_time_rate || 0), 0) / scopedScores.length)
            : 0

          // Streaks
          const streakMembers = (memberScores || []).filter(ms => {
            if (manager.role === 'org_admin') return ms.current_streak >= 2
            const inScope = scopedScores.some(ss => ss.user_id === ms.user_id)
            return inScope && ms.current_streak >= 2
          }).length

          // Top 3 performers
          const top3 = [...scopedScores]
            .sort((a, b) => (b.total_points || 0) - (a.total_points || 0))
            .slice(0, 3)

          // Build Slack message blocks
          const blocks = [
            {
              type: 'header',
              text: { type: 'plain_text', text: `Weekly Digest — ${org.name}` },
            },
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `Week of ${prevMonday} · ${scopedScores.length} members` },
              ],
            },
            { type: 'divider' },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Total Points*\n${totalPoints.toLocaleString()} ${pointsDelta !== 0 ? `(${pointsDelta > 0 ? '+' : ''}${pointsDelta}%)` : ''}` },
                { type: 'mrkdwn', text: `*Completed*\n${totalCompleted} items` },
                { type: 'mrkdwn', text: `*Overdue*\n${totalOverdue} items` },
                { type: 'mrkdwn', text: `*Response Rate*\n${avgResponseRate}%` },
                { type: 'mrkdwn', text: `*On-Time Rate*\n${avgOnTimeRate}%` },
                { type: 'mrkdwn', text: `*Active Streaks*\n${streakMembers} members` },
              ],
            },
            { type: 'divider' },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*Top Performers*\n' + top3.map((t, i) =>
                  `${i === 0 ? ':first_place_medal:' : i === 1 ? ':second_place_medal:' : ':third_place_medal:'} ${nameMap.get(t.user_id) || 'Unknown'} — ${t.total_points} pts`
                ).join('\n'),
              },
            },
          ]

          if ((newAchievements || []).length > 0) {
            blocks.push({ type: 'divider' } as any)
            blocks.push({
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: `:trophy: ${newAchievements!.length} new achievement${newAchievements!.length !== 1 ? 's' : ''} earned this week` },
              ],
            } as any)
          }

          blocks.push({
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'View Dashboard' },
                url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'}/team-dashboard`,
              },
            ],
          } as any)

          // Find the Slack token for this manager's team
          const integration = integrations.find(i => i.team_id === manager.team_id)
          if (!integration?.access_token) continue

          // Look up manager's Slack user ID
          const { data: managerProfile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', manager.user_id)
            .single()

          if (!managerProfile?.email) continue

          try {
            // Use the team's Slack token to find the user and DM them
            const { WebClient } = await import('@slack/web-api')
            const slack = new WebClient(integration.access_token)

            const userLookup = await slack.users.lookupByEmail({ email: managerProfile.email })
            if (!userLookup.user?.id) continue

            const dm = await slack.conversations.open({ users: userLookup.user.id })
            if (!dm.channel?.id) continue

            await slack.chat.postMessage({
              channel: dm.channel.id,
              text: `Weekly Digest for ${org.name}: ${totalPoints} points earned, ${totalCompleted} completed, ${avgResponseRate}% response rate`,
              blocks,
            })

            digestsSent++
          } catch (err) {
            console.error(`[manager-digest] Failed to send to ${managerProfile.email}:`, err)
          }
        }
      })
    }

    return { digestsSent, organizationsProcessed: orgs.length }
  }
)
