// inngest/functions/health-monitor.ts
// Proactive health monitor — runs every hour.
// Checks for expired tokens, stuck jobs, data integrity issues.
// Logs problems to system_errors so the admin dashboard surfaces them.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/monitoring/report-error'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const healthMonitor = inngest.createFunction(
  { id: 'health-monitor', retries: 1 },
  { cron: '0 * * * *' },  // Every hour
  async ({ step }) => {
    const supabase = getAdminClient()
    const now = new Date()
    const checks: string[] = []

    // ── 1. Check for expired integration tokens ──
    await step.run('check-expired-tokens', async () => {
      const { data: integrations } = await supabase
        .from('integrations')
        .select('id, provider, user_id, team_id, config, refresh_token')

      let expiredCount = 0
      let missingRefreshCount = 0

      for (const int of integrations || []) {
        const expiresAt = int.config?.token_expires_at
        if (!expiresAt) continue

        const expired = new Date(expiresAt) < now
        if (expired) {
          expiredCount++

          if (!int.refresh_token) {
            missingRefreshCount++
            await reportError({
              source: 'health-monitor',
              message: `${int.provider} token expired with no refresh token — user must reconnect`,
              severity: 'critical',
              userId: int.user_id,
              teamId: int.team_id,
              errorKey: `token_expired_no_refresh:${int.provider}:${int.user_id}`,
              details: { provider: int.provider, expiresAt, integrationId: int.id },
            })
          }
        }
      }

      checks.push(`Tokens: ${expiredCount} expired, ${missingRefreshCount} unrecoverable`)
    })

    // ── 2. Check for stuck message processing ──
    await step.run('check-stuck-messages', async () => {
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

      const [slackRes, outlookRes] = await Promise.all([
        supabase
          .from('slack_messages')
          .select('id', { count: 'exact', head: true })
          .eq('processed', false)
          .lt('created_at', oneHourAgo),
        supabase
          .from('outlook_messages')
          .select('id', { count: 'exact', head: true })
          .eq('processed', false)
          .lt('created_at', oneHourAgo),
      ])

      const stuckSlack = slackRes.count || 0
      const stuckOutlook = outlookRes.count || 0

      if (stuckSlack > 20) {
        await reportError({
          source: 'health-monitor',
          message: `${stuckSlack} Slack messages stuck unprocessed for >1 hour`,
          severity: stuckSlack > 100 ? 'critical' : 'warning',
          errorKey: 'stuck_slack_messages',
          details: { count: stuckSlack },
        })
      }

      if (stuckOutlook > 20) {
        await reportError({
          source: 'health-monitor',
          message: `${stuckOutlook} Outlook emails stuck unprocessed for >1 hour`,
          severity: stuckOutlook > 100 ? 'critical' : 'warning',
          errorKey: 'stuck_outlook_messages',
          details: { count: stuckOutlook },
        })
      }

      checks.push(`Stuck: ${stuckSlack} Slack, ${stuckOutlook} Outlook`)
    })

    // ── 3. Check for orphaned profiles ──
    await step.run('check-orphaned-profiles', async () => {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .is('organization_id', null)

      if ((count || 0) > 5) {
        await reportError({
          source: 'health-monitor',
          message: `${count} profiles have no organization — onboarding may be broken`,
          severity: 'warning',
          errorKey: 'orphaned_profiles',
          details: { count },
        })
      }

      checks.push(`Orphaned profiles: ${count || 0}`)
    })

    // ── 4. Cleanup old errors (> 30 days) ──
    await step.run('cleanup-old-errors', async () => {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { error } = await supabase
        .from('system_errors')
        .delete()
        .lt('created_at', thirtyDaysAgo)

      checks.push(error ? 'Cleanup: failed' : 'Cleanup: done')
    })

    return { success: true, checks }
  }
)
