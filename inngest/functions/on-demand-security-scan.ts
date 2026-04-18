// inngest/functions/on-demand-security-scan.ts
// Wires the user-facing "Scan Now" button to a fresh sync → scan chain.
//
// The scheduled scanEmailThreats function reads from the cached
// outlook_messages table, which is only refreshed by sync-outlook's cron
// (6/10/14/18 PT). If a phishing email arrives between syncs and the user
// clicks "Scan Now", the scanner can't find it — it isn't in the cache yet.
// This function syncs the user's inbox first, then triggers the threat
// scan against the fresh data.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { syncTeamOutlook } from './sync-outlook'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const onDemandSecurityScan = inngest.createFunction(
  { id: 'on-demand-security-scan', retries: 1, concurrency: { limit: 5 } },
  { event: 'security/scan-now' },
  async ({ event, step }) => {
    const userId = (event as any)?.data?.userId
    const daysBack = (event as any)?.data?.daysBack || 7
    if (!userId) return { success: false, error: 'missing userId' }

    // 1. Fresh-sync this user's inbox so the threat scanner sees recent emails.
    //    Pulls a bit further back than the threat-scan window so we don't miss
    //    edge cases where sync's dedup cursor leaves a gap.
    const syncResult = await step.run('sync-user-inbox', async () => {
      const supabase = getAdminClient()
      const { data: integration } = await supabase
        .from('integrations')
        .select('id, team_id, user_id, access_token, refresh_token, config')
        .eq('provider', 'outlook')
        .eq('user_id', userId)
        .single()
      if (!integration) return { skipped: 'no-integration' }
      return await syncTeamOutlook(
        supabase,
        integration.team_id,
        integration.user_id,
        integration,
        { daysBack: Math.max(daysBack, 7) }
      )
    })

    // 2. Fire the threat scan against the newly synced cache.
    await step.sendEvent('trigger-threat-scan', {
      name: 'security/scan-threats',
      data: { userId, daysBack },
    })

    return { success: true, sync: syncResult }
  }
)
