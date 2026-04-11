import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { buildWeeklyRecapEmail } from '@/lib/email/templates/weekly-recap'
import { getWeekStart, getPreviousWeekStart } from '@/lib/team/calculate-scores'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Sends a weekly personal recap email to every active user.
 * Runs Monday at 8 AM UTC — after weekly scores are calculated at 6 AM.
 */
export const emailWeeklyRecap = inngest.createFunction(
  { id: 'email-weekly-recap' },
  { cron: '0 8 * * 1' }, // Monday 8 AM UTC
  async ({ step }) => {
    const supabase = getAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.ai'

    const thisMonday = getWeekStart()
    const prevMonday = getPreviousWeekStart(thisMonday)
    const twoWeeksAgo = getPreviousWeekStart(prevMonday)

    // Format week label
    const weekStart = new Date(prevMonday)
    const weekEnd = new Date(weekStart)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
    const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

    // Get all users with weekly scores from last week
    const scores = await step.run('fetch-weekly-scores', async () => {
      const { data } = await supabase
        .from('weekly_scores')
        .select('user_id, team_id, total_points, commitments_completed, commitments_created, commitments_overdue, on_time_rate, response_rate, bonus_points')
        .eq('week_start', prevMonday)

      return data || []
    })

    if (scores.length === 0) {
      return { success: true, emailsSent: 0, reason: 'no weekly scores' }
    }

    // Get previous week scores for delta comparison
    const prevScoresData = await step.run('fetch-prev-scores', async () => {
      const { data } = await supabase
        .from('weekly_scores')
        .select('user_id, total_points')
        .eq('week_start', twoWeeksAgo)

      return data || []
    })
    const prevScoresMap = new Map(prevScoresData.map(s => [s.user_id, s]))

    // Get member scores for rank/streak info
    const memberScoresData = await step.run('fetch-member-scores', async () => {
      const userIds = scores.map(s => s.user_id)
      const { data } = await supabase
        .from('member_scores')
        .select('user_id, org_rank, prev_org_rank, current_streak')
        .in('user_id', userIds)

      return data || []
    })
    const memberScores = new Map(memberScoresData.map(ms => [ms.user_id, ms]))

    // Get profiles
    const profilesData = await step.run('fetch-profiles', async () => {
      const userIds = scores.map(s => s.user_id)
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds)

      return data || []
    })
    const profiles = new Map(profilesData.map(p => [p.id, p]))

    // Get overdue counts per user
    const overdueData = await step.run('fetch-overdue-counts', async () => {
      const userIds = scores.map(s => s.user_id)
      const { data } = await supabase
        .from('commitments')
        .select('assignee_id')
        .in('assignee_id', userIds)
        .eq('status', 'overdue')
        .is('deleted_at', null)

      return data || []
    })
    const overdueCounts = new Map<string, number>()
    for (const c of overdueData) {
      overdueCounts.set(c.assignee_id, (overdueCounts.get(c.assignee_id) || 0) + 1)
    }

    // Check email preferences — opt out of weekly recap?
    const prefsData = await step.run('fetch-email-prefs', async () => {
      const userIds = scores.map(s => s.user_id)
      const { data } = await supabase
        .from('notification_preferences')
        .select('user_id, email_weekly_recap')
        .in('user_id', userIds)

      return data || []
    })
    const prefs = new Map(prefsData.map(p => [p.user_id, p]))

    // Get latest achievements per user (this week only)
    const achievementsData = await step.run('fetch-achievements', async () => {
      const userIds = scores.map(s => s.user_id)
      const { data } = await supabase
        .from('member_achievements')
        .select('user_id, achievement_id')
        .in('user_id', userIds)
        .eq('week_earned', prevMonday)

      if (!data || data.length === 0) return [] as { user_id: string; name: string; tier: string }[]

      const achievementIds = [...new Set(data.map(a => a.achievement_id))]
      const { data: achDetails } = await supabase
        .from('achievements')
        .select('id, name, tier')
        .in('id', achievementIds)

      const achMap = new Map((achDetails || []).map(a => [a.id, a]))

      // Return first achievement per user as plain array
      const seen = new Set<string>()
      const result: { user_id: string; name: string; tier: string }[] = []
      for (const a of data) {
        if (!seen.has(a.user_id)) {
          const detail = achMap.get(a.achievement_id)
          if (detail) {
            seen.add(a.user_id)
            result.push({ user_id: a.user_id, name: detail.name, tier: detail.tier })
          }
        }
      }
      return result
    })
    const achievements = new Map(achievementsData.map(a => [a.user_id, { name: a.name, tier: a.tier }]))

    // Get active reminder counts per user
    const remindersData = await step.run('fetch-reminder-counts', async () => {
      const userIds = scores.map(s => s.user_id)
      const { data } = await supabase
        .from('reminders')
        .select('user_id, title')
        .in('user_id', userIds)
        .eq('status', 'active')
      return data || []
    })
    const remindersByUser = new Map<string, string[]>()
    for (const r of remindersData) {
      const list = remindersByUser.get(r.user_id) || []
      list.push(r.title)
      remindersByUser.set(r.user_id, list)
    }

    let emailsSent = 0
    let emailsSkipped = 0

    // Send emails in batches
    for (const score of scores) {
      const profile = profiles.get(score.user_id)
      if (!profile?.email) continue

      // Check opt-out
      const pref = prefs.get(score.user_id)
      if (pref?.email_weekly_recap === false) {
        emailsSkipped++
        continue
      }

      const ms = memberScores.get(score.user_id)
      const prev = prevScoresMap.get(score.user_id)
      const overdueCount = overdueCounts.get(score.user_id) || 0
      const achievement = achievements.get(score.user_id) || null

      await step.run(`send-recap-${score.user_id}`, async () => {
        const pointsDelta = prev ? score.total_points - prev.total_points : 0
        const rankDelta = ms?.prev_org_rank && ms?.org_rank
          ? ms.prev_org_rank - ms.org_rank // positive = moved up
          : null

        // Generate a simple insight
        let insight: string | null = null
        if (prev && score.total_points > prev.total_points * 1.2) {
          insight = `Your points jumped ${Math.round(((score.total_points - prev.total_points) / prev.total_points) * 100)}% compared to last week. Great momentum!`
        } else if (score.on_time_rate >= 90) {
          insight = `${score.on_time_rate}% on-time rate — you're crushing your deadlines.`
        } else if (score.commitments_completed > 0 && overdueCount === 0) {
          insight = `Zero overdue items. You're completely caught up — well done.`
        } else if (ms?.current_streak && ms.current_streak >= 4) {
          insight = `${ms.current_streak}-week streak! Consistency is your superpower.`
        }

        const userReminders = remindersByUser.get(score.user_id) || []

        const { subject, html } = buildWeeklyRecapEmail({
          userName: profile.full_name?.split(' ')[0] || 'there',
          weekLabel,
          totalPoints: score.total_points || 0,
          pointsDelta,
          rank: ms?.org_rank || null,
          rankDelta,
          streak: ms?.current_streak || 0,
          commitmentsCompleted: score.commitments_completed || 0,
          commitmentsCreated: score.commitments_created || 0,
          overdueCount,
          onTimeRate: score.on_time_rate || 0,
          responseRate: score.response_rate || 0,
          achievementEarned: achievement,
          insight,
          reminders: userReminders,
          dashboardUrl: `${appUrl}/dashboard`,
          overdueUrl: `${appUrl}/commitments?status=overdue`,
          remindersUrl: `${appUrl}/reminders`,
          unsubscribeUrl: `${appUrl}/settings?tab=notifications`,
        })

        const result = await sendEmail({
          to: profile.email,
          subject,
          html,
          emailType: 'weekly_recap',
          userId: score.user_id,
          idempotencyKey: `weekly_recap_${score.user_id}_${prevMonday}`,
        })

        if (result.success) emailsSent++
      })
    }

    return { success: true, emailsSent, emailsSkipped }
  }
)
