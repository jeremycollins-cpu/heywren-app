import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { buildAchievementEmail, buildStreakEmail } from '@/lib/email/templates/achievement'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/** Streak milestones that trigger a celebration email. */
const STREAK_MILESTONES = new Set([4, 8, 12, 24, 52])

/**
 * Sends achievement/milestone celebration emails.
 * Triggered by the weekly scores calculation when new achievements are awarded.
 * Runs Monday at 9 AM UTC — after scores (6 AM) and recaps (8 AM).
 */
export const emailAchievement = inngest.createFunction(
  { id: 'email-achievement' },
  { cron: '0 9 * * 1' }, // Monday 9 AM UTC
  async ({ step }) => {
    const supabase = getAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.com'

    // Get the week that was just scored
    const now = new Date()
    const dayOfWeek = now.getUTCDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const thisMonday = new Date(now)
    thisMonday.setUTCDate(thisMonday.getUTCDate() + mondayOffset)
    thisMonday.setUTCHours(0, 0, 0, 0)
    const prevMonday = new Date(thisMonday)
    prevMonday.setUTCDate(prevMonday.getUTCDate() - 7)
    const prevMondayStr = prevMonday.toISOString().split('T')[0]

    // Find achievements earned this week
    const newAchievements = await step.run('fetch-new-achievements', async () => {
      const { data } = await supabase
        .from('member_achievements')
        .select('user_id, achievement_id')
        .eq('week_earned', prevMondayStr)

      if (!data || data.length === 0) return []

      // Get achievement details
      const achIds = [...new Set(data.map(a => a.achievement_id))]
      const { data: achDetails } = await supabase
        .from('achievements')
        .select('id, name, description, tier, category, threshold')
        .in('id', achIds)

      const achMap = new Map((achDetails || []).map(a => [a.id, a]))

      return data.map(a => ({
        userId: a.user_id,
        achievement: achMap.get(a.achievement_id),
      })).filter(a => a.achievement != null)
    })

    // Find streak milestones
    const streakMilestones = await step.run('fetch-streak-milestones', async () => {
      const { data } = await supabase
        .from('member_scores')
        .select('user_id, current_streak')

      return (data || []).filter(ms => STREAK_MILESTONES.has(ms.current_streak))
    })

    // Get all user IDs that need emails
    const allUserIds = [
      ...new Set([
        ...newAchievements.map(a => a.userId),
        ...streakMilestones.map(s => s.user_id),
      ])
    ]

    if (allUserIds.length === 0) {
      return { success: true, emailsSent: 0, reason: 'no achievements or milestones' }
    }

    // Check preferences
    const prefs = await step.run('fetch-prefs', async () => {
      const { data } = await supabase
        .from('notification_preferences')
        .select('user_id, email_achievements')
        .in('user_id', allUserIds)

      return new Map((data || []).map(p => [p.user_id, p]))
    })

    // Fetch profiles
    const profiles = await step.run('fetch-profiles', async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', allUserIds)

      return new Map((data || []).map(p => [p.id, p]))
    })

    let emailsSent = 0

    // Send achievement emails
    for (const { userId, achievement } of newAchievements) {
      if (!achievement) continue
      const pref = prefs.get(userId)
      if (pref?.email_achievements === false) continue
      const profile = profiles.get(userId)
      if (!profile?.email) continue

      await step.run(`ach-email-${userId}-${achievement.id}`, async () => {
        // Find the next achievement in the same category
        const { data: nextAch } = await supabase
          .from('achievements')
          .select('name, threshold')
          .eq('category', achievement.category)
          .gt('threshold', achievement.threshold)
          .order('threshold', { ascending: true })
          .limit(1)
          .maybeSingle()

        const { subject, html } = buildAchievementEmail({
          userName: profile.full_name?.split(' ')[0] || 'there',
          achievementName: achievement.name,
          achievementDescription: achievement.description || '',
          tier: achievement.tier as 'bronze' | 'silver' | 'gold' | 'platinum',
          reason: `You earned this by reaching ${achievement.threshold} in ${achievement.category}.`,
          nextAchievement: nextAch
            ? { name: nextAch.name, progress: achievement.threshold, target: nextAch.threshold }
            : null,
          dashboardUrl: appUrl,
          unsubscribeUrl: `${appUrl}/settings?tab=notifications`,
        })

        const result = await sendEmail({
          to: profile.email,
          subject,
          html,
          emailType: 'achievement',
          userId,
          idempotencyKey: `achievement_${userId}_${achievement.id}_${prevMondayStr}`,
        })

        if (result.success) emailsSent++
      })
    }

    // Send streak milestone emails
    for (const ms of streakMilestones) {
      const pref = prefs.get(ms.user_id)
      if (pref?.email_achievements === false) continue
      const profile = profiles.get(ms.user_id)
      if (!profile?.email) continue

      await step.run(`streak-email-${ms.user_id}`, async () => {
        const { subject, html } = buildStreakEmail({
          userName: profile.full_name?.split(' ')[0] || 'there',
          streakWeeks: ms.current_streak,
          dashboardUrl: appUrl,
          unsubscribeUrl: `${appUrl}/settings?tab=notifications`,
        })

        const result = await sendEmail({
          to: profile.email,
          subject,
          html,
          emailType: 'streak_milestone',
          userId: ms.user_id,
          idempotencyKey: `streak_${ms.user_id}_${ms.current_streak}_${prevMondayStr}`,
        })

        if (result.success) emailsSent++
      })
    }

    return { success: true, emailsSent }
  }
)
