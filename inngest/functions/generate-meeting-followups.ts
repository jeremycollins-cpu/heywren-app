// inngest/functions/generate-meeting-followups.ts
// Triggered after a meeting transcript is processed. Generates follow-up
// email drafts for each commitment extracted from the meeting, then inserts
// them into the draft_queue so the user can review and send.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import {
  generateMeetingFollowUpDraftsViaBatch,
  type MeetingCommitment,
} from '@/lib/ai/generate-meeting-followups'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const generateMeetingFollowups = inngest.createFunction(
  {
    id: 'generate-meeting-followups',
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: 'meeting/followups.generate' },
  async ({ event, step }) => {
    const {
      transcriptId,
      teamId,
      userId,
      meetingTitle,
      commitmentIds,
    } = event.data as {
      transcriptId: string
      teamId: string
      userId: string
      meetingTitle: string
      commitmentIds: string[]
    }

    if (!commitmentIds || commitmentIds.length === 0) {
      return { success: true, draftsGenerated: 0, reason: 'No commitments' }
    }

    const supabase = getAdminClient()

    // ── Fetch the commitments with full metadata ──
    const commitments = await step.run('fetch-commitments', async () => {
      const { data } = await supabase
        .from('commitments')
        .select('id, title, description, due_date, metadata')
        .in('id', commitmentIds)

      return data || []
    })

    if (commitments.length === 0) {
      return { success: true, draftsGenerated: 0, reason: 'Commitments not found' }
    }

    // ── Check which commitments already have drafts ──
    const existingDraftCommitmentIds = await step.run('check-existing-drafts', async () => {
      const { data } = await supabase
        .from('draft_queue')
        .select('commitment_id')
        .eq('team_id', teamId)
        .in('commitment_id', commitmentIds)

      return (data || []).map(d => d.commitment_id)
    })

    const newCommitments = commitments.filter(
      c => !existingDraftCommitmentIds.includes(c.id)
    )

    if (newCommitments.length === 0) {
      return { success: true, draftsGenerated: 0, reason: 'Drafts already exist' }
    }

    // ── Build meeting commitment objects for the AI ──
    const meetingCommitments: MeetingCommitment[] = newCommitments.map(c => {
      const meta = (c.metadata || {}) as Record<string, any>
      // Find assignee from stakeholders
      const assignee = meta.stakeholders?.find(
        (s: any) => s.role === 'assignee'
      )?.name || null

      return {
        title: c.title,
        description: c.description,
        dueDate: c.due_date,
        assignee,
        urgency: meta.urgency,
        commitmentType: meta.commitmentType,
        originalQuote: meta.originalQuote,
        stakeholders: meta.stakeholders,
      }
    })

    // ── Generate follow-up drafts via AI ──
    const drafts = await step.run('generate-drafts', async () => {
      return await generateMeetingFollowUpDraftsViaBatch(meetingTitle, meetingCommitments)
    })

    if (drafts.length === 0) {
      return { success: true, draftsGenerated: 0, reason: 'AI returned no drafts' }
    }

    // ── Insert drafts into draft_queue ──
    const insertCount = await step.run('insert-drafts', async () => {
      let count = 0

      for (const draft of drafts) {
        // Map the draft back to its commitment
        const commitment = newCommitments[draft.commitmentIndex]
        if (!commitment) continue

        const meta = (commitment.metadata || {}) as Record<string, any>
        const recipientName = draft.suggestedRecipient
          || meta.stakeholders?.find((s: any) => s.role === 'assignee')?.name
          || null

        const { error } = await supabase.from('draft_queue').insert({
          team_id: teamId,
          commitment_id: commitment.id,
          user_id: userId,
          recipient_name: recipientName,
          channel: 'email',
          subject: draft.subject,
          body: draft.body,
          status: 'ready',
        })

        if (error) {
          console.error(
            `[meeting-followups] Failed to insert draft for commitment ${commitment.id}:`,
            error.message
          )
        } else {
          count++
        }
      }

      return count
    })

    console.log(
      `[meeting-followups] Transcript ${transcriptId}: generated ${insertCount} follow-up drafts from ${newCommitments.length} commitments`
    )

    return {
      success: true,
      transcriptId,
      draftsGenerated: insertCount,
      totalCommitments: newCommitments.length,
    }
  }
)
