// inngest/functions/apply-email-rule.ts
// Triggered when a user creates a rule with "apply to existing emails" checked.
// Searches the user's inbox for matching emails and moves them to the target folder.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import {
  getOutlookIntegration,
  moveMessage,
  searchMessagesBySender,
  searchMessagesByDomain,
} from '@/lib/outlook/graph-client'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const BATCH_SIZE = 20
const BATCH_DELAY_MS = 200 // Gentle on Graph rate limits

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const applyEmailRule = inngest.createFunction(
  { id: 'apply-email-rule', retries: 2, concurrency: { limit: 3 } },
  { event: 'email-rule/apply-existing' },
  async ({ event, step }) => {
    const { ruleId, teamId, userId, matchType, matchValue, targetFolderId } = event.data
    const supabase = getAdminClient()

    // Get integration
    const integration = await step.run('get-integration', async () => {
      return await getOutlookIntegration(teamId, userId)
    })

    if (!integration) {
      console.error(`[apply-email-rule] No Outlook integration for user ${userId}`)
      return { error: 'No integration', moved: 0 }
    }

    const ctx = {
      supabase,
      integrationId: integration.id,
      refreshToken: integration.refresh_token,
    }

    // Search for matching emails in inbox
    const searchResult = await step.run('search-matching-emails', async () => {
      if (matchType === 'from_email') {
        return await searchMessagesBySender(matchValue, integration.access_token, ctx)
      } else if (matchType === 'from_domain') {
        return await searchMessagesByDomain(matchValue, integration.access_token, ctx)
      }
      // subject_contains: no bulk search supported yet
      return { messageIds: [], token: integration.access_token }
    })

    const { messageIds } = searchResult
    let currentToken = searchResult.token

    if (messageIds.length === 0) {
      return { moved: 0, searched: matchValue }
    }

    // Move in batches
    let totalMoved = 0

    for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
      const batch = messageIds.slice(i, i + BATCH_SIZE)

      const batchResult = await step.run(`move-batch-${i}`, async () => {
        let moved = 0
        let token = currentToken

        for (const msgId of batch) {
          const result = await moveMessage(msgId, targetFolderId, token, ctx)
          token = result.token
          if (result.success) moved++
        }

        return { moved, token }
      })

      totalMoved += batchResult.moved
      currentToken = batchResult.token

      // Rate limit courtesy
      if (i + BATCH_SIZE < messageIds.length) {
        await sleep(BATCH_DELAY_MS)
      }
    }

    // Update rule stats
    await step.run('update-rule-stats', async () => {
      const now = new Date().toISOString()
      // Increment emails_moved (additive to any already moved during rule creation)
      const { data: rule } = await supabase
        .from('email_rules')
        .select('emails_moved')
        .eq('id', ruleId)
        .single()

      const currentMoved = rule?.emails_moved || 0

      await supabase
        .from('email_rules')
        .update({
          emails_moved: currentMoved + totalMoved,
          last_applied_at: now,
          updated_at: now,
        })
        .eq('id', ruleId)
    })

    return { moved: totalMoved, total: messageIds.length, matchValue }
  }
)
