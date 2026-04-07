import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email/send'
import { buildReengagementEmail } from '@/lib/email/templates/reengagement'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Re-engagement email for users who haven't been active in 7+ days.
 * Runs daily at 11 AM UTC.
 *
 * "Active" = logged in (profile updated_at), completed a commitment,
 * or responded to a missed email/chat.
 *
 * Sends at most one re-engagement email per user per 14-day period
 * to avoid being spammy.
 */
export const emailReengagement = inngest.createFunction(
  { id: 'email-reengagement' },
  { cron: '0 11 * * *' }, // 11 AM daily
  async ({ step }) => {
    const supabase = getAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.heywren.com'
    const now = new Date()

    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    // Find users who haven't been active in 7+ days
    // Use profile updated_at as a proxy for last login
    const inactiveUsers = await step.run('find-inactive-users', async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name, updated_at')
        .lt('updated_at', sevenDaysAgo.toISOString())
        .gt('updated_at', new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString()) // Not older than 60 days

      return data || []
    })

    if (inactiveUsers.length === 0) {
      return { success: true, emailsSent: 0, reason: 'no inactive users' }
    }

    const userIds = inactiveUsers.map(u => u.id)

    // Check who already received a re-engagement email in the last 14 days
    const recentlySent = await step.run('check-recent-sends', async () => {
      const { data } = await supabase
        .from('email_sends')
        .select('user_id')
        .eq('email_type', 'reengagement')
        .eq('status', 'sent')
        .gte('created_at', fourteenDaysAgo.toISOString())
        .in('user_id', userIds)

      return new Set((data || []).map(d => d.user_id))
    })

    // Check preferences
    const prefs = await step.run('fetch-prefs', async () => {
      const { data } = await supabase
        .from('notification_preferences')
        .select('user_id, email_reengagement')
        .in('user_id', userIds)

      return new Map((data || []).map(p => [p.user_id, p]))
    })

    // Filter to eligible users
    const eligible = inactiveUsers.filter(u => {
      if (recentlySent.has(u.id)) return false
      const pref = prefs.get(u.id)
      if (pref?.email_reengagement === false) return false
      return true
    })

    if (eligible.length === 0) {
      return { success: true, emailsSent: 0, reason: 'no eligible users after filtering' }
    }

    // Batch fetch activity data for eligible users
    const eligibleIds = eligible.map(u => u.id)

    const activityData = await step.run('fetch-activity-data', async () => {
      // Commitments detected while away
      const { data: newCommitments } = await supabase
        .from('commitments')
        .select('assignee_id')
        .in('assignee_id', eligibleIds)
        .gte('created_at', sevenDaysAgo.toISOString())

      const commitmentCounts = new Map<string, number>()
      for (const c of newCommitments || []) {
        commitmentCounts.set(c.assignee_id, (commitmentCounts.get(c.assignee_id) || 0) + 1)
      }

      // Overdue items
      const { data: overdue } = await supabase
        .from('commitments')
        .select('assignee_id')
        .in('assignee_id', eligibleIds)
        .eq('status', 'overdue')
        .is('deleted_at', null)

      const overdueCounts = new Map<string, number>()
      for (const c of overdue || []) {
        overdueCounts.set(c.assignee_id, (overdueCounts.get(c.assignee_id) || 0) + 1)
      }

      // Missed emails
      const { data: missedEmails } = await supabase
        .from('missed_emails')
        .select('user_id')
        .in('user_id', eligibleIds)
        .eq('status', 'pending')

      const missedCounts = new Map<string, number>()
      for (const e of missedEmails || []) {
        missedCounts.set(e.user_id, (missedCounts.get(e.user_id) || 0) + 1)
      }

      return { commitmentCounts, overdueCounts, missedCounts }
    })

    let emailsSent = 0

    for (const user of eligible) {
      await step.run(`reengage-${user.id}`, async () => {
        const daysSinceLastActive = Math.floor(
          (now.getTime() - new Date(user.updated_at).getTime()) / (1000 * 60 * 60 * 24)
        )

        const { subject, html } = buildReengagementEmail({
          userName: user.full_name?.split(' ')[0] || 'there',
          daysSinceLastActive,
          commitmentsDetected: activityData.commitmentCounts.get(user.id) || 0,
          overdueCount: activityData.overdueCounts.get(user.id) || 0,
          missedEmailCount: activityData.missedCounts.get(user.id) || 0,
          dashboardUrl: `${appUrl}/dashboard`,
          settingsUrl: `${appUrl}/settings?tab=notifications`,
          unsubscribeUrl: `${appUrl}/settings?tab=notifications`,
        })

        const result = await sendEmail({
          to: user.email,
          subject,
          html,
          emailType: 'reengagement',
          userId: user.id,
          idempotencyKey: `reengage_${user.id}_${now.toISOString().split('T')[0]}`,
        })

        if (result.success) emailsSent++
      })
    }

    return { success: true, emailsSent, eligibleUsers: eligible.length }
  }
)
