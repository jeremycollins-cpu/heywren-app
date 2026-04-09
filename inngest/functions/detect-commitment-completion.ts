// inngest/functions/detect-commitment-completion.ts
// Auto-resolves commitments when follow-up messages indicate they've been completed.
// Triggered by slack/message.received and outlook/message.synced events.
// High confidence (>=0.7) -> auto-complete. Medium (0.5-0.7) -> likely_complete for user confirm.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCompletions, CompletionMatch } from '@/lib/ai/detect-completion'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const detectCommitmentCompletion = inngest.createFunction(
  {
    id: 'detect-commitment-completion',
    retries: 2,
    concurrency: { limit: 5 },
  },
  [
    { event: 'slack/message.received' },
    { event: 'outlook/message.synced' },
  ],
  async ({ event, step }) => {
    const supabase = getAdminClient()

    const isSlack = event.name === 'slack/message.received'
    const source: 'slack' | 'email' = isSlack ? 'slack' : 'email'

    const messageText: string = isSlack ? event.data.text : event.data.body || event.data.text || ''
    const authorIdentifier: string = isSlack ? event.data.user_id : event.data.sender_email || event.data.from || ''
    const slackTeamId: string | undefined = isSlack ? event.data.team_id : undefined
    const threadContext: string | undefined = event.data.thread_context || undefined

    // Skip empty/short messages
    if (!messageText || messageText.trim().length < 10) {
      return { success: true, matches: 0, reason: 'Message too short' }
    }

    // ── Step 1: Resolve the HeyWren team ID ──
    const teamId = await step.run('resolve-team', async () => {
      if (isSlack && slackTeamId) {
        const { data } = await supabase
          .from('integrations')
          .select('team_id')
          .eq('provider', 'slack')
          .filter('config->>slack_team_id', 'eq', slackTeamId)
          .limit(1)
          .maybeSingle()
        return data?.team_id || null
      }

      // For Outlook events, team_id is typically provided directly
      if (event.data.team_id) {
        return event.data.team_id
      }

      return null
    })

    if (!teamId) {
      return { success: false, error: 'No matching team found' }
    }

    // ── Step 2: Fetch open commitments for this team (limit 50 most recent) ──
    const openCommitments = await step.run('fetch-open-commitments', async () => {
      const { data, error } = await supabase
        .from('commitments')
        .select('id, title, description, assignee_id, metadata')
        .eq('team_id', teamId)
        .in('status', ['open', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        console.error('Failed to fetch open commitments:', error)
        return []
      }

      return (data || []).map((c: any) => ({
        id: c.id,
        title: c.title,
        description: c.description || '',
        assigneeEmail: c.metadata?.assigneeEmail || undefined,
      }))
    })

    if (openCommitments.length === 0) {
      return { success: true, matches: 0, reason: 'No open commitments' }
    }

    // ── Step 3: Run completion detection ──
    const matches = await step.run('detect-completions', async () => {
      try {
        return await detectCompletions(
          {
            text: messageText,
            author: authorIdentifier,
            source,
            threadContext,
          },
          openCommitments
        )
      } catch (err) {
        console.error('Completion detection failed:', err)
        return []
      }
    })

    if (matches.length === 0) {
      return { success: true, matches: 0 }
    }

    // ── Step 4: Process matches by confidence level ──
    const highConfidence = matches.filter((m: CompletionMatch) => m.confidence >= 0.7)
    const mediumConfidence = matches.filter((m: CompletionMatch) => m.confidence >= 0.5 && m.confidence < 0.7)

    // ── Step 5: Auto-complete high-confidence matches ──
    const autoCompleted = await step.run('auto-complete', async () => {
      if (highConfidence.length === 0) return 0

      const now = new Date().toISOString()
      let completed = 0

      for (const match of highConfidence) {
        const { error } = await supabase
          .from('commitments')
          .update({
            status: 'completed',
            completed_at: now,
            updated_at: now,
            // metadata updated separately below
          })
          .eq('id', match.commitmentId)
          .eq('team_id', teamId)

        if (error) {
          console.error(`Failed to auto-complete commitment ${match.commitmentId}:`, error)
          continue
        }

        // Update metadata with completion evidence
        const { data: existing } = await supabase
          .from('commitments')
          .select('metadata, creator_id')
          .eq('id', match.commitmentId)
          .single()

        const existingMeta = (existing?.metadata as Record<string, unknown>) || {}
        await supabase
          .from('commitments')
          .update({
            status: 'completed',
            completed_at: now,
            updated_at: now,
            metadata: {
              ...existingMeta,
              autoCompleted: true,
              completionEvidence: match.evidence,
              completionConfidence: match.confidence,
              completionSource: source,
              completionDetectedAt: now,
            },
          })
          .eq('id', match.commitmentId)

        // Add activity record + notify user
        if (existing?.creator_id) {
          await supabase.from('activities').insert({
            team_id: teamId,
            user_id: existing.creator_id,
            commitment_id: match.commitmentId,
            action: 'completed',
            metadata: {
              autoCompleted: true,
              evidence: match.evidence,
              confidence: match.confidence,
              source: `Auto-completed: detected from ${source} message`,
            },
          })

          // Get the commitment title for the notification
          const { data: commitData } = await supabase
            .from('commitments')
            .select('title')
            .eq('id', match.commitmentId)
            .single()

          await supabase.from('notifications').insert({
            user_id: existing.creator_id,
            team_id: teamId,
            type: 'auto_complete',
            title: `Auto-closed: ${commitData?.title || 'Commitment'}`,
            body: `Wren detected this was completed from a ${source === 'slack' ? 'Slack message' : 'follow-up email'}. Evidence: "${match.evidence}"`,
            link: '/commitments',
            read: false,
          })
        }

        completed++
      }

      return completed
    })

    // ── Step 6: Mark medium-confidence as likely_complete ──
    const markedLikely = await step.run('mark-likely-complete', async () => {
      if (mediumConfidence.length === 0) return 0

      const now = new Date().toISOString()
      let marked = 0

      for (const match of mediumConfidence) {
        const { data: existing } = await supabase
          .from('commitments')
          .select('metadata')
          .eq('id', match.commitmentId)
          .single()

        const existingMeta = (existing?.metadata as Record<string, unknown>) || {}

        const { error } = await supabase
          .from('commitments')
          .update({
            status: 'likely_complete',
            updated_at: now,
            metadata: {
              ...existingMeta,
              completionEvidence: match.evidence,
              completionConfidence: match.confidence,
              completionSource: source,
              completionDetectedAt: now,
            },
          })
          .eq('id', match.commitmentId)
          .eq('team_id', teamId)

        if (error) {
          console.error(`Failed to mark commitment ${match.commitmentId} as likely_complete:`, error)
          continue
        }

        marked++
      }

      return marked
    })

    console.log(
      `Commitment completion detection: ${autoCompleted} auto-completed, ${markedLikely} marked likely_complete`
    )

    return {
      success: true,
      matches: matches.length,
      autoCompleted,
      markedLikely,
    }
  }
)
