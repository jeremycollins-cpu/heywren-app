import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { buildNudgeEmail } from '@/lib/email/templates/nudge'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Email fallback nudge for overdue commitments.
 * Runs at 10 AM weekdays — 1 hour after Slack nudges.
 *
 * Sends email to users who:
 * - Have overdue commitments
 * - Either have no Slack integration OR received a Slack nudge yesterday
 *   but didn't act on it (commitment still overdue)
 * - Haven't received an email nudge today
 */
export const emailNudgeFallback = inngest.createFunction(
  { id: 'email-nudge-fallback' },
  { cron: '0 10 * * 1-5' }, // 10 AM weekdays
  async ({ step }) => {
    const supabase = getAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.com'
    const now = new Date()

    const todayStart = new Date(now)
    todayStart.setUTCHours(0, 0, 0, 0)

    // Find users with overdue commitments
    const overdueRaw = await step.run('fetch-overdue-by-user', async () => {
      const { data } = await supabase
        .from('commitments')
        .select('assignee_id, due_date')
        .eq('status', 'overdue')
        .is('deleted_at', null)
        .not('assignee_id', 'is', null)

      return data || []
    })

    const overdueByUser = new Map<string, { count: number; oldestDueDays: number }>()
    for (const c of overdueRaw) {
      const existing = overdueByUser.get(c.assignee_id)
      const dueDays = c.due_date
        ? Math.floor((now.getTime() - new Date(c.due_date).getTime()) / (1000 * 60 * 60 * 24))
        : 1

      if (!existing) {
        overdueByUser.set(c.assignee_id, { count: 1, oldestDueDays: dueDays })
      } else {
        existing.count++
        existing.oldestDueDays = Math.max(existing.oldestDueDays, dueDays)
      }
    }

    if (overdueByUser.size === 0) {
      return { success: true, emailsSent: 0, reason: 'no overdue commitments' }
    }

    const userIds = [...overdueByUser.keys()]

    // Check which users already received an email nudge today
    const alreadySentData = await step.run('check-today-sends', async () => {
      const { data } = await supabase
        .from('email_sends')
        .select('user_id')
        .eq('email_type', 'nudge')
        .eq('status', 'sent')
        .gte('created_at', todayStart.toISOString())
        .in('user_id', userIds)

      return data || []
    })
    const alreadySent = new Set(alreadySentData.map(d => d.user_id))

    // Check email preferences
    const prefsData = await step.run('fetch-email-prefs', async () => {
      const { data } = await supabase
        .from('notification_preferences')
        .select('user_id, email_nudges')
        .in('user_id', userIds)

      return data || []
    })
    const prefs = new Map(prefsData.map(p => [p.user_id, p]))

    // Fetch profiles
    const profilesData = await step.run('fetch-profiles', async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', userIds)

      return data || []
    })
    const profiles = new Map(profilesData.map(p => [p.id, p]))

    let emailsSent = 0

    for (const [userId, overdue] of overdueByUser) {
      if (alreadySent.has(userId)) continue

      const pref = prefs.get(userId)
      if (pref?.email_nudges === false) continue

      const profile = profiles.get(userId)
      if (!profile?.email) continue

      await step.run(`nudge-email-${userId}`, async () => {
        const { subject, html } = buildNudgeEmail({
          userName: profile.full_name?.split(' ')[0] || 'there',
          overdueCount: overdue.count,
          oldestOverdueDays: overdue.oldestDueDays,
          dashboardUrl: `${appUrl}/commitments?status=overdue`,
          unsubscribeUrl: `${appUrl}/settings?tab=notifications`,
        })

        const result = await sendEmail({
          to: profile.email,
          subject,
          html,
          emailType: 'nudge',
          userId,
          idempotencyKey: `nudge_${userId}_${todayStart.toISOString().split('T')[0]}`,
        })

        if (result.success) emailsSent++
      })
    }

    return { success: true, emailsSent }
  }
)
