// inngest/functions/drain-outlook-backlog.ts
// Processes all unprocessed outlook_messages in the background with no per-run cap.
// Runs hourly via CRON and can also be triggered on-demand after a sync.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitmentsBatch, calculatePriorityScore, DetectedCommitment } from '@/lib/ai/detect-commitments'
import { insertCommitmentIfNotDuplicate } from './sync-outlook'

const BATCH_SIZE = 50

// Pre-AI filter: skip emails that will never contain commitments
const SKIP_SENDER_PATTERNS = [
  /noreply@/i, /no-reply@/i, /donotreply@/i, /do-not-reply@/i,
  /notifications?@/i, /alerts?@/i, /mailer-daemon@/i, /postmaster@/i,
  /bounce@/i, /news@/i, /newsletter@/i, /updates?@/i, /marketing@/i,
  /promo(tions)?@/i, /digest@/i, /automated@/i, /system@/i,
]

const SKIP_SUBJECT_PATTERNS = [
  /\bunsubscribe\b/i, /\bnewsletter\b/i, /\bdigest\b/i,
  /\b(weekly|daily|monthly) (update|summary|recap|report)\b/i,
  /\bout of office\b/i, /\bautomatic reply\b/i, /\bautoreply\b/i,
  /\bpassword reset\b/i, /\bverify your (email|account)\b/i,
  /\bPR #\d+/i, /\b\[JIRA\]/i, /\b\[GitHub\]/i,
  /\bbuild (passed|failed)\b/i, /\bpipeline (passed|failed)\b/i,
  /\bCI\/CD\b/i, /\bdeployment (succeeded|failed)\b/i,
  /\breceipt for\b/i, /\binvoice #/i, /\border confirm/i,
]

function shouldSkipEmail(fromEmail: string, subject: string): boolean {
  if (SKIP_SENDER_PATTERNS.some(p => p.test(fromEmail))) return true
  if (SKIP_SUBJECT_PATTERNS.some(p => p.test(subject))) return true
  return false
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function buildCommitmentMetadata(commitment: DetectedCommitment): Record<string, unknown> {
  const metadata: Record<string, unknown> = {}
  if (commitment.urgency) metadata.urgency = commitment.urgency
  if (commitment.tone) metadata.tone = commitment.tone
  if (commitment.commitmentType) metadata.commitmentType = commitment.commitmentType
  if (commitment.stakeholders?.length) metadata.stakeholders = commitment.stakeholders
  if (commitment.originalQuote) metadata.originalQuote = commitment.originalQuote
  return metadata
}

export const drainOutlookBacklog = inngest.createFunction(
  { id: 'drain-outlook-backlog', retries: 2 },
  [
    { cron: 'TZ=America/Los_Angeles 30 * * * *' }, // Every hour at :30
    { event: 'outlook/drain-backlog' },              // On-demand trigger
  ],
  async ({ step }) => {
    const supabase = getAdminClient()

    // Get all users with unprocessed messages
    const users = await step.run('find-users-with-backlog', async () => {
      const { data: integrations } = await supabase
        .from('integrations')
        .select('team_id, user_id')
        .eq('provider', 'outlook')

      if (!integrations?.length) return []

      const usersWithBacklog: Array<{ teamId: string; userId: string; count: number }> = []

      for (const int of integrations) {
        const { count } = await supabase
          .from('outlook_messages')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', int.team_id)
          .or(`user_id.eq.${int.user_id},user_id.is.null`)
          .eq('processed', false)

        if (count && count > 0) {
          usersWithBacklog.push({ teamId: int.team_id, userId: int.user_id, count })
        }
      }

      return usersWithBacklog
    })

    if (users.length === 0) {
      return { success: true, message: 'No backlog to process' }
    }

    console.log(`[Drain Backlog] Found ${users.length} user(s) with unprocessed messages: ${users.map(u => `${u.userId}(${u.count})`).join(', ')}`)

    const allResults: Array<{ userId: string; processed: number; commitments: number }> = []

    for (const user of users) {
      let totalProcessed = 0
      let totalCommitments = 0
      let batchNum = 0

      // Process in batches until all done (step.run per batch for reliability)
      while (true) {
        batchNum++
        const batchResult = await step.run(
          `process-${user.userId}-batch-${batchNum}`,
          async () => {
            const { data: unprocessed } = await supabase
              .from('outlook_messages')
              .select('id, message_id, from_name, from_email, to_recipients, subject, body_preview, received_at, web_link, conversation_id')
              .eq('team_id', user.teamId)
              .or(`user_id.eq.${user.userId},user_id.is.null`)
              .eq('processed', false)
              .limit(BATCH_SIZE)

            if (!unprocessed?.length) return { processed: 0, commitments: 0, remaining: false }

            let processed = 0
            let commitments = 0

            // Separate short messages (skip) from ones that need AI
            const aiBatch: Array<{ id: string; text: string; dbId: string; webLink?: string; conversationId?: string }> = []

            for (const msg of unprocessed) {
              const preview = msg.body_preview || ''
              if (preview.length < 20 || shouldSkipEmail(msg.from_email || '', msg.subject || '')) {
                await supabase
                  .from('outlook_messages')
                  .update({ processed: true, commitments_found: 0 })
                  .eq('id', msg.id)
                processed++
                continue
              }

              const messageText = [
                'From: ' + (msg.from_name || '') + ' <' + (msg.from_email || '') + '>',
                'To: ' + (msg.to_recipients || ''),
                'Subject: ' + (msg.subject || '(no subject)'),
                'Date: ' + msg.received_at,
                '',
                preview,
              ].join('\n')

              aiBatch.push({ id: msg.message_id, text: messageText, dbId: msg.id, webLink: msg.web_link || undefined, conversationId: msg.conversation_id || undefined })
            }

            // Process AI batch in chunks of 15
            for (let i = 0; i < aiBatch.length; i += 15) {
              const chunk = aiBatch.slice(i, i + 15)
              try {
                const batchInput = chunk.map(b => ({ id: b.id, text: b.text }))
                const batchResults = await detectCommitmentsBatch(batchInput)

                const processedIds: Array<{ dbId: string; count: number }> = []
                for (const item of chunk) {
                  const detected = batchResults.get(item.id) || []
                  let inserted = 0
                  for (const commitment of detected) {
                    const ok = await insertCommitmentIfNotDuplicate(supabase, commitment, {
                      teamId: user.teamId,
                      userId: user.userId,
                      sourceRef: item.dbId,
                      sourceUrl: item.webLink,
                      conversationId: item.conversationId,
                    })
                    if (ok) inserted++
                  }
                  commitments += inserted
                  processedIds.push({ dbId: item.dbId, count: inserted })
                  processed++
                }
                // Batch update: mark all processed in one query per count value
                const byCount = new Map<number, string[]>()
                for (const { dbId, count } of processedIds) {
                  const ids = byCount.get(count) || []
                  ids.push(dbId)
                  byCount.set(count, ids)
                }
                for (const [count, ids] of byCount) {
                  await supabase
                    .from('outlook_messages')
                    .update({ processed: true, commitments_found: count })
                    .in('id', ids)
                }
              } catch (err) {
                console.error(`[Drain Backlog] AI batch error for user ${user.userId}:`, (err as Error).message)
                // Batch mark as processed with 0 to avoid infinite retry
                const failedIds = chunk.map(item => item.dbId)
                await supabase
                  .from('outlook_messages')
                  .update({ processed: true, commitments_found: 0 })
                  .in('id', failedIds)
                processed += chunk.length
              }
            }

            return { processed, commitments, remaining: unprocessed.length === BATCH_SIZE }
          }
        )

        totalProcessed += batchResult.processed
        totalCommitments += batchResult.commitments

        if (!batchResult.remaining) break

        // Safety: cap at 20 batches (1000 messages) per user per run
        if (batchNum >= 20) {
          console.log(`[Drain Backlog] User ${user.userId}: hit 20-batch safety cap, will continue next run`)
          break
        }
      }

      allResults.push({ userId: user.userId, processed: totalProcessed, commitments: totalCommitments })
      console.log(`[Drain Backlog] User ${user.userId}: processed ${totalProcessed} messages, ${totalCommitments} commitments`)
    }

    return { success: true, results: allResults }
  }
)
