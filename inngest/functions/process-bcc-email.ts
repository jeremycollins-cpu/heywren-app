// inngest/functions/process-bcc-email.ts
// Handles emails BCC'd to wren@heywren.ai — detects commitments and records
// the mention so it appears on the Wren Mentions page.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments, calculatePriorityScore } from '@/lib/ai/detect-commitments'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const processBccEmail = inngest.createFunction(
  {
    id: 'process-bcc-email',
    name: 'Process BCC Email to Wren',
    retries: 2,
  },
  { event: 'email/bcc.received' },
  async ({ event, step }) => {
    const { userId, teamId, senderEmail, senderName, subject, bodyText, snippet, receivedAt } = event.data
    const supabase = getAdminClient()

    // ── Step 1: Detect commitments from the email body ──
    const detected = await step.run('detect-commitments', async () => {
      try {
        // Combine subject + body for better context
        const text = `Subject: ${subject}\n\n${bodyText}`
        const commitments = await detectCommitments(text)
        return commitments || []
      } catch (err) {
        console.error('BCC email commitment detection failed:', err)
        return []
      }
    })

    // ── Step 2: Store commitments ──
    const stored = await step.run('store-commitments', async () => {
      if (detected.length === 0) return []

      const results = await Promise.all(
        detected.map(async (commitment) => {
          const metadata: Record<string, unknown> = {
            bccTrigger: true,
            senderEmail,
          }
          if (commitment.urgency) metadata.urgency = commitment.urgency
          if (commitment.tone) metadata.tone = commitment.tone
          if (commitment.commitmentType) metadata.commitmentType = commitment.commitmentType
          if (commitment.stakeholders?.length) metadata.stakeholders = commitment.stakeholders
          if (commitment.originalQuote) metadata.originalQuote = commitment.originalQuote

          const { data, error } = await supabase
            .from('commitments')
            .insert({
              team_id: teamId,
              creator_id: userId,
              title: commitment.title,
              description: commitment.description || null,
              status: 'open',
              priority_score: calculatePriorityScore(commitment),
              source: 'outlook', // BCC emails are still email-sourced
              metadata,
            })
            .select('id, title')
            .single()

          if (error) {
            console.error('Failed to insert BCC commitment:', error.message)
            return null
          }
          return data
        })
      )

      return results.filter(Boolean)
    })

    // ── Step 3: Record in wren_mentions ──
    await step.run('record-mention', async () => {
      const { error } = await supabase
        .from('wren_mentions')
        .insert({
          team_id: teamId,
          user_id: userId,
          channel: 'email',
          source_title: subject,
          source_snippet: snippet || null,
          participant_name: senderName,
          commitments_extracted: stored.length,
          created_at: receivedAt || new Date().toISOString(),
        })

      if (error) {
        console.error('Failed to record BCC wren mention:', error.message)
      }
    })

    console.log(`BCC email processed: "${subject}" from ${senderEmail} — ${stored.length} commitments`)

    return {
      success: true,
      commitments: stored.length,
      subject,
    }
  }
)
