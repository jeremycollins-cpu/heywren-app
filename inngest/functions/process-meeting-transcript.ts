// inngest/functions/process-meeting-transcript.ts
// Processes meeting transcripts for commitments and generates AI summaries.
// Three processing steps:
//   1. "Hey Wren" triggers — explicit, high-confidence (user said the wake word)
//   2. Passive commitment detection — same 3-tier pipeline as Slack/email
//   3. AI meeting summary — structured notes (topics, decisions, open questions)

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { detectCommitments } from '@/lib/ai/detect-commitments'
import { findHeyWrenTriggers, extractHeyWrenCommitments } from '@/lib/ai/detect-hey-wren'
import { insertCommitmentIfNotDuplicate } from '@/lib/ai/dedup-commitments'
import { generateMeetingSummaryViaBatch } from '@/lib/ai/generate-meeting-summary'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Split transcript into chunks of ~500 words for processing
function chunkTranscript(text: string, maxWords: number = 500): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []

  for (let i = 0; i < words.length; i += maxWords) {
    // Overlap by 50 words to avoid cutting commitments at boundaries
    const start = Math.max(0, i - 50)
    chunks.push(words.slice(start, i + maxWords).join(' '))
  }

  return chunks
}

export const processMeetingTranscript = inngest.createFunction(
  {
    id: 'process-meeting-transcript',
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: 'meeting/transcript.ready' },
  async ({ event, step }) => {
    const supabase = getAdminClient()
    const transcriptId = event.data.transcript_id as string

    // ── Fetch the transcript ──
    const transcript = await step.run('fetch-transcript', async () => {
      const { data, error } = await supabase
        .from('meeting_transcripts')
        .select('*')
        .eq('id', transcriptId)
        .single()

      if (error || !data) {
        console.error('Failed to fetch transcript:', transcriptId, error)
        return null
      }
      return data
    })

    if (!transcript) {
      return { success: false, error: 'Transcript not found' }
    }

    // ── Mark as processing ──
    await step.run('mark-processing', async () => {
      await supabase
        .from('meeting_transcripts')
        .update({ transcript_status: 'processing' })
        .eq('id', transcriptId)
    })

    const teamId = transcript.team_id
    const userId = transcript.user_id

    // ── Step 1: Detect "Hey Wren" triggers ──
    const heyWrenResults = await step.run('detect-hey-wren', async () => {
      try {
        const triggers = findHeyWrenTriggers(
          transcript.transcript_text,
          transcript.transcript_segments || undefined
        )

        if (triggers.length === 0) {
          return { triggers: 0, commitments: [] }
        }

        console.log(`Found ${triggers.length} "Hey Wren" triggers in transcript ${transcriptId}`)
        const commitments = await extractHeyWrenCommitments(triggers)
        return { triggers: triggers.length, commitments }
      } catch (err) {
        console.error('Hey Wren detection failed:', err)
        return { triggers: 0, commitments: [] }
      }
    })

    // ── Step 2: Insert Hey Wren commitments ──
    let heyWrenCount = 0
    const heyWrenCommitmentIds: string[] = []
    if (heyWrenResults.commitments.length > 0) {
      heyWrenCount = await step.run('insert-hey-wren-commitments', async () => {
        let count = 0
        for (const commitment of heyWrenResults.commitments) {
          const metadata: Record<string, unknown> = {
            urgency: 'high',
            commitmentType: 'follow_up',
            originalQuote: commitment.originalQuote,
            heyWrenTrigger: true,
            triggeredBy: commitment.triggeredBy,
            meetingTitle: transcript.title,
          }
          if (commitment.assignee) {
            metadata.stakeholders = [{ name: commitment.assignee, role: 'assignee' }]
          }

          const id = await insertCommitmentIfNotDuplicate(supabase, {
            ...commitment,
            urgency: 'high',
            tone: 'professional',
            commitmentType: 'follow_up',
          }, {
            teamId,
            userId,
            source: 'recording',
            sourceRef: transcriptId,
            metadata,
          })

          if (id) {
            count++
            heyWrenCommitmentIds.push(id)
          }
        }
        return count
      })
    }

    // ── Step 2b: Record "Hey Wren" triggers in wren_mentions ──
    if (heyWrenResults.triggers > 0) {
      await step.run('record-hey-wren-mentions', async () => {
        await supabase.from('wren_mentions').insert({
          team_id: teamId,
          user_id: userId,
          channel: 'meeting',
          source_title: transcript.title || 'Meeting transcript',
          source_snippet: heyWrenResults.commitments[0]?.originalQuote?.slice(0, 300) || null,
          source_ref: transcriptId,
          participant_name: heyWrenResults.commitments[0]?.triggeredBy || null,
          commitments_extracted: heyWrenCount,
          created_at: transcript.created_at || new Date().toISOString(),
        })
      })
    }

    // ── Step 3: Passive commitment detection on transcript chunks ──
    const passiveResults = await step.run('detect-passive-commitments', async () => {
      const chunks = chunkTranscript(transcript.transcript_text)
      const allCommitments: Array<{ title: string; description: string; assignee?: string; dueDate?: string; priority: string; confidence: number; urgency?: string; tone?: string; commitmentType?: string; stakeholders?: Array<{ name: string; role: string }>; originalQuote?: string }> = []

      for (const chunk of chunks) {
        try {
          const detected = await detectCommitments(chunk)
          allCommitments.push(...detected)
        } catch (err) {
          console.error('Chunk detection failed:', err)
        }
      }

      return allCommitments
    })

    // ── Step 4: Insert passive commitments ──
    let passiveCount = 0
    const passiveCommitmentIds: string[] = []
    if (passiveResults.length > 0) {
      passiveCount = await step.run('insert-passive-commitments', async () => {
        let count = 0
        for (const commitment of passiveResults) {
          const metadata: Record<string, unknown> = {
            meetingTitle: transcript.title,
          }
          if (commitment.urgency) metadata.urgency = commitment.urgency
          if (commitment.tone) metadata.tone = commitment.tone
          if (commitment.commitmentType) metadata.commitmentType = commitment.commitmentType
          if (commitment.stakeholders?.length) metadata.stakeholders = commitment.stakeholders
          if (commitment.originalQuote) metadata.originalQuote = commitment.originalQuote

          const id = await insertCommitmentIfNotDuplicate(supabase, commitment as any, {
            teamId,
            userId,
            source: 'recording',
            sourceRef: transcriptId,
            metadata,
            status: 'pending_review',
          })

          if (id) {
            count++
            passiveCommitmentIds.push(id)
          }
        }
        return count
      })
    }

    // ── Step 5: Generate AI meeting summary ──
    const summaryResult = await step.run('generate-summary', async () => {
      try {
        const attendeeNames = transcript.attendees?.map((a: any) => a.name || a.email).filter(Boolean) || []
        const summary = await generateMeetingSummaryViaBatch(
          transcript.title || 'Meeting',
          transcript.transcript_text,
          attendeeNames
        )
        if (summary) {
          await supabase
            .from('meeting_transcripts')
            .update({ summary_json: summary })
            .eq('id', transcriptId)
        }
        return { generated: !!summary }
      } catch (err) {
        console.error('Summary generation failed:', err)
        return { generated: false }
      }
    })

    // ── Step 6: Mark transcript as processed ──
    const totalCommitments = heyWrenCount + passiveCount
    await step.run('mark-processed', async () => {
      await supabase
        .from('meeting_transcripts')
        .update({
          transcript_status: 'ready',
          processed: true,
          commitments_found: totalCommitments,
          hey_wren_triggers: heyWrenResults.triggers,
        })
        .eq('id', transcriptId)
    })

    // ── Step 7: Trigger follow-up draft generation ──
    const allCommitmentIds = [...heyWrenCommitmentIds, ...passiveCommitmentIds]
    if (allCommitmentIds.length > 0) {
      await step.run('trigger-followup-drafts', async () => {
        await inngest.send({
          name: 'meeting/followups.generate',
          data: {
            transcriptId,
            teamId,
            userId,
            meetingTitle: transcript.title,
            commitmentIds: allCommitmentIds,
          },
        })
      })
    }

    console.log(
      `Transcript ${transcriptId}: ${heyWrenCount} Hey Wren commitments + ${passiveCount} passive = ${totalCommitments} total`
    )

    return {
      success: true,
      transcriptId,
      heyWrenTriggers: heyWrenResults.triggers,
      heyWrenCommitments: heyWrenCount,
      passiveCommitments: passiveCount,
      totalCommitments,
      summaryGenerated: summaryResult.generated,
    }
  }
)
