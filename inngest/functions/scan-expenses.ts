import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { classifyExpenseEmailBatch, vendorDomainFromEmail } from '@/lib/ai/classify-expense-email'
import { logAiUsage } from '@/lib/ai/persist-usage'
import { startJobRun } from '@/lib/jobs/record-run'

const MAX_EMAILS_PER_RUN = 200
const TIME_BUDGET_MS = 240000   // 4 minutes
const SCAN_WINDOW_DAYS = 90      // Look back 90 days for receipts (longer than missed-emails)

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function scanTeamExpenses(
  supabase: ReturnType<typeof getAdminClient>,
  teamId: string,
  userId: string
) {
  const startTime = Date.now()
  const scanWindowAgo = new Date(Date.now() - SCAN_WINDOW_DAYS * 86400000).toISOString()

  // Pull recent outlook_messages that haven't been scanned for expense classification.
  // We deliberately scan ALL emails (no urgency filter) — receipts often come from
  // automated senders that other scanners deliberately skip.
  const { data: emails, error } = await supabase
    .from('outlook_messages')
    .select('id, message_id, from_name, from_email, subject, body_preview, received_at, web_link')
    .eq('team_id', teamId)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq('expense_scanned', false)
    .gte('received_at', scanWindowAgo)
    .order('received_at', { ascending: false })
    .limit(MAX_EMAILS_PER_RUN)

  if (error || !emails) {
    console.error(`Team ${teamId}: failed to fetch emails for expense scan:`, error?.message)
    return { success: false, error: error?.message }
  }

  if (emails.length === 0) {
    return { success: true, teamId, scanned: 0, found: 0, duration: 0 }
  }

  // Skip emails we've already classified (defensive — the expense_scanned flag
  // should handle this, but a duplicate scan window catches imported backfills).
  const messageIds = emails.map(e => e.message_id)
  const { data: existing } = await supabase
    .from('expense_emails')
    .select('message_id')
    .eq('team_id', teamId)
    .in('message_id', messageIds)

  const existingIds = new Set((existing || []).map(e => e.message_id))
  const candidates = emails.filter(e => !existingIds.has(e.message_id))

  let totalFound = 0

  // Batch in chunks of 50 — the AI helper itself fans out to 15-email Claude
  // requests inside the batch API, but we cap how much we feed in per loop so
  // failures don't waste a full 200-email batch.
  for (let i = 0; i < candidates.length; i += 50) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break
    const chunk = candidates.slice(i, i + 50)

    const batchInput = chunk.map(email => ({
      id: email.message_id,
      fromEmail: email.from_email || '',
      fromName: email.from_name || '',
      subject: email.subject || '(no subject)',
      bodyPreview: email.body_preview || '',
      receivedAt: email.received_at,
    }))

    let classifications
    try {
      classifications = await classifyExpenseEmailBatch(batchInput)
    } catch (err) {
      console.error('Expense classification error:', (err as Error).message)
      continue
    }

    if (classifications.size > 0) {
      const toUpsert: any[] = []
      for (const email of chunk) {
        const classification = classifications.get(email.message_id)
        if (!classification) continue

        toUpsert.push({
          team_id: teamId,
          user_id: userId,
          outlook_message_id: email.id,
          message_id: email.message_id,
          from_name: email.from_name,
          from_email: email.from_email,
          subject: email.subject,
          body_preview: email.body_preview,
          received_at: email.received_at,
          web_link: email.web_link,
          vendor: (classification.vendor || email.from_name || 'Unknown vendor').slice(0, 200),
          vendor_domain: vendorDomainFromEmail(email.from_email || ''),
          amount: classification.amount,
          currency: classification.currency,
          receipt_date: classification.receiptDate,
          category: classification.category,
          confidence: classification.confidence,
          status: 'pending',
        })
      }

      if (toUpsert.length > 0) {
        const { error: insertErr } = await supabase
          .from('expense_emails')
          .upsert(toUpsert, { onConflict: 'team_id,message_id' })

        if (insertErr) {
          console.error('Failed to upsert expense_emails:', insertErr.message)
        } else {
          totalFound += toUpsert.length
        }
      }
    }

    // Mark every email in the chunk as scanned (whether classified as expense
    // or not) so we don't re-process them next run.
    const dbIds = chunk.map(e => e.id)
    await supabase
      .from('outlook_messages')
      .update({ expense_scanned: true })
      .in('id', dbIds)
  }

  const duration = Math.round((Date.now() - startTime) / 1000)

  await logAiUsage(supabase, {
    module: 'classify-expense-email',
    trigger: 'scan-expenses',
    teamId,
    userId,
    itemsProcessed: candidates.length,
  })

  return {
    success: true,
    teamId,
    scanned: candidates.length,
    found: totalFound,
    duration,
  }
}

// Run 45 min after each Outlook sync (covers 6:45 AM, 10:45 AM, 2:45 PM, 6:45 PM PT).
// Also fires on demand from the Expenses page "Refresh" button.
export const scanExpenses = inngest.createFunction(
  { id: 'scan-expenses' },
  [
    { cron: 'TZ=America/Los_Angeles 45 6,10,14,18 * * *' },
    { event: 'admin/job.scan-expenses' },
    { event: 'app/scan-expenses.requested' },
  ],
  async ({ step, event }) => {
    const run = startJobRun('scan-expenses')

    // Treat the event as authoritative for the on-demand path: the API caller
    // has already resolved the requesting user's team_id, so we scope the
    // scan to that pair directly instead of trying to match by integrations.
    // user_id, which is unreliable on legacy rows (NULL or a stale id from
    // before user_id was added to the table).
    const eventTeam = event?.data?.teamId as string | undefined
    const eventUser = event?.data?.userId as string | undefined

    const integrations = await step.run('fetch-integrations', async () => {
      const supabase = getAdminClient()

      let query = supabase
        .from('integrations')
        .select('team_id, user_id')
        .eq('provider', 'outlook')

      // On-demand scans pin to the requesting user's team. Cron scans (no
      // event payload) fan out to every Outlook integration, same as the
      // scan-missed-emails pattern.
      if (eventTeam) query = query.eq('team_id', eventTeam)

      const { data, error } = await query
      if (error || !data) {
        console.error('Failed to fetch Outlook integrations:', error)
        return []
      }
      return data
    })

    run.meta({ integrations_found: integrations.length })

    if (integrations.length === 0) {
      await run.finish()
      return { success: false, error: 'No integrations found' }
    }

    const results = await Promise.all(
      integrations.map((integration) => {
        // Use the requesting user from the event when present; fall back to
        // the integration's own user_id for cron-driven scans.
        const scanUserId = eventUser || integration.user_id
        if (!scanUserId) {
          // Legacy integration row with NULL user_id and no event scope —
          // skip rather than fail, the cron will keep retrying once user_id
          // backfills land.
          return Promise.resolve({ success: false, skipped: true, teamId: integration.team_id })
        }
        return step.run(`scan-team-${integration.team_id}-${scanUserId}`, async () => {
          const supabase = getAdminClient()
          try {
            const result = await scanTeamExpenses(supabase, integration.team_id, scanUserId)
            if (result.success === false) {
              run.tally('failed')
            } else if ((result.found || 0) > 0) {
              run.tally('sent', result.found)
            } else if ((result.scanned || 0) === 0) {
              run.tally('no_data')
            } else {
              run.tally('skipped')
            }
            return result
          } catch (err) {
            run.tally('failed')
            return { success: false, teamId: integration.team_id, error: (err as Error).message }
          }
        })
      })
    )

    await run.finish()
    return { success: true, teamsScanned: results.length, results }
  }
)
