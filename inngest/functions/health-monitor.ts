// inngest/functions/health-monitor.ts
// Proactive health monitor — runs every hour.
// Checks for expired tokens, stuck jobs, data integrity issues.
// Logs problems to system_errors so the admin dashboard surfaces them.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { reportError } from '@/lib/monitoring/report-error'
import { sendProactiveAlert } from '@/lib/notifications/send-proactive-alert'

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

      // Emails belonging to an integration that's been flagged for reauth are
      // expected to be stuck — the user has already been notified and will only
      // unblock by reconnecting. Counting them here just produces duplicate
      // alerts for a problem we already surface via the reauth notification.
      const { data: blockedIntegrations } = await supabase
        .from('integrations')
        .select('user_id, team_id')
        .eq('provider', 'outlook')
        .eq('config->>reauth_required', 'true')

      const blockedUserIds = Array.from(
        new Set((blockedIntegrations || []).map(i => i.user_id).filter(Boolean))
      ) as string[]

      let outlookQuery = supabase
        .from('outlook_messages')
        .select('id', { count: 'exact', head: true })
        .eq('processed', false)
        .lt('created_at', oneHourAgo)

      if (blockedUserIds.length > 0) {
        outlookQuery = outlookQuery.not('user_id', 'in', `(${blockedUserIds.join(',')})`)
      }

      const [slackRes, outlookRes] = await Promise.all([
        supabase
          .from('slack_messages')
          .select('id', { count: 'exact', head: true })
          .eq('processed', false)
          .lt('created_at', oneHourAgo),
        outlookQuery,
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

    // ── 4. Check for stalled commitment detection ──
    // If emails ARE flowing in but no commitments have been created in 3+ days,
    // detection is silently broken. This is the exact failure mode we want to
    // catch before the user notices.
    await step.run('check-stalled-commitment-detection', async () => {
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

      // Find users whose emails synced in last 24h
      const { data: activeUsers } = await supabase
        .from('outlook_messages')
        .select('user_id')
        .gte('received_at', oneDayAgo)
        .not('user_id', 'is', null)
        .limit(1000)

      const activeUserIds = Array.from(new Set((activeUsers || []).map(r => r.user_id).filter(Boolean))) as string[]
      if (activeUserIds.length === 0) {
        checks.push('Commitment detection: 0 active users to check')
        return
      }

      // Resolve each active user's organization (and team, for the alert payload).
      // organization_id is the stable key — see migration 019. team_id can drift.
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, organization_id, current_team_id')
        .in('id', activeUserIds)

      let stalled = 0
      for (const p of profiles || []) {
        const userId = p.id
        const organizationId = p.organization_id
        const teamId = p.current_team_id
        if (!organizationId) continue

        const { count: recentCount } = await supabase
          .from('commitments')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', organizationId)
          .gte('created_at', threeDaysAgo)

        if ((recentCount || 0) === 0) {
          // Double-check: do they actually have ANY commitments ever? Skip brand-new users.
          const { count: totalCount } = await supabase
            .from('commitments')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId)

          if ((totalCount || 0) < 5) continue // new user, nothing to flag

          stalled++
          await reportError({
            source: 'health-monitor',
            message: `No commitments detected in 3+ days despite active email sync — detection pipeline may be broken`,
            severity: 'critical',
            userId,
            teamId,
            errorKey: `stalled_commitment_detection:${userId}`,
            details: { totalCommitments: totalCount, organizationId },
          })

          // Alert the user so they don't quietly think "nothing to do this week"
          if (teamId) {
            try {
              await sendProactiveAlert({
                teamId,
                userId,
                notificationType: 'anomaly',
                title: 'Commitment detection may be broken',
                body: 'Emails are flowing into Wren but no new commitments have been created in 3+ days. Check System Health for details.',
                link: '/settings/system-health',
                slackText:
                  '*:warning: Commitment detection may be broken*\n> Wren is receiving your emails but hasn\'t created any commitments in 3+ days. Visit System Health for details.',
                idempotencyKey: `stalled-commitments-${userId}-${new Date(now).toISOString().slice(0, 10)}`,
              })
            } catch {
              // best-effort
            }
          }
        }
      }

      checks.push(`Commitment detection: ${stalled} users stalled`)
    })

    // ── 5. Cleanup old errors (> 30 days) ──
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
