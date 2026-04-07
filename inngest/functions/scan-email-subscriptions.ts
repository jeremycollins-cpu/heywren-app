// inngest/functions/scan-email-subscriptions.ts
// Daily cron that scans all users' Outlook inboxes for marketing emails
// with unsubscribe links. Core logic is in lib/email/scan-subscriptions.ts.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { scanUserSubscriptions } from '@/lib/email/scan-subscriptions'

const TIME_BUDGET_MS = 240000

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const scanEmailSubscriptions = inngest.createFunction(
  { id: 'scan-email-subscriptions' },
  { cron: 'TZ=America/Los_Angeles 0 7 * * *' },
  async ({ step }) => {
    const supabase = getAdminClient()
    const startTime = Date.now()

    const teams = await step.run('get-outlook-teams', async () => {
      const { data } = await supabase
        .from('integrations')
        .select('id, team_id')
        .eq('provider', 'outlook')
        .eq('status', 'connected')

      return (data || []).map(i => ({ teamId: i.team_id }))
    })

    const results: Array<{ teamId: string; found: number; errors: number }> = []

    for (const team of teams) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break

      const result = await step.run(`scan-team-${team.teamId}`, async () => {
        let totalFound = 0
        let totalErrors = 0

        const { data: members } = await supabase
          .from('team_members')
          .select('user_id')
          .eq('team_id', team.teamId)

        for (const member of members || []) {
          const { found, errors } = await scanUserSubscriptions(team.teamId, member.user_id)
          totalFound += found
          totalErrors += errors
        }

        return { teamId: team.teamId, found: totalFound, errors: totalErrors }
      })

      results.push(result)
    }

    const totalFound = results.reduce((s, r) => s + r.found, 0)
    const totalErrors = results.reduce((s, r) => s + r.errors, 0)
    console.log(`Subscription scan complete: ${totalFound} found, ${totalErrors} errors`)

    return { teams: results.length, totalFound, totalErrors }
  }
)
