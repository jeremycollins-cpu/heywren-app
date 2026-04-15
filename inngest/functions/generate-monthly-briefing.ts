// inngest/functions/generate-monthly-briefing.ts
// Orchestrates monthly briefing generation end-to-end.
//
// Triggered by `briefing/monthly.generate` event with payload:
//   { briefingId, userId, teamId, periodStart }
//
// Steps:
//   1. Mark briefing as 'aggregating' and pull data signals.
//   2. Mark as 'extracting' and process any pending uploads (extract + summarize).
//   3. Mark as 'synthesizing' and call the AI synthesis tool.
//   4. Replace existing sections with the new ones.
//   5. Mark as 'ready'. Log AI usage. On any failure, mark as 'failed'.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { aggregateMonthlyData, monthlyPeriodFor } from '@/lib/monthly-briefing/aggregate-data'
import { extractFile } from '@/lib/monthly-briefing/extract-file'
import { summarizeUploadedContext } from '@/lib/ai/summarize-uploaded-context'
import { generateMonthlyBriefing } from '@/lib/ai/generate-monthly-briefing'
import { logAiUsage } from '@/lib/ai/persist-usage'
import type { AggregatedDataSnapshot, BriefingUpload } from '@/lib/monthly-briefing/types'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

interface GeneratePayload {
  briefingId: string
  userId: string
  teamId: string
  periodStart: string // YYYY-MM-DD
  userNotes?: string | null
}

export const generateMonthlyBriefingJob = inngest.createFunction(
  { id: 'generate-monthly-briefing', retries: 1 },
  { event: 'briefing/monthly.generate' },
  async ({ event, step }) => {
    const { briefingId, userId, teamId, periodStart, userNotes } = event.data as GeneratePayload
    const supabase = getAdminClient()

    // Status helper
    const setStatus = async (status: string, detail?: string, error?: string) => {
      await supabase
        .from('monthly_briefings')
        .update({ status, status_detail: detail || null, error_message: error || null })
        .eq('id', briefingId)
    }

    try {
      // ── Step 1: aggregate data ──
      const { snapshot, uploads } = await step.run('aggregate', async () => {
        await setStatus('aggregating', 'Pulling signals from emails, chats, calendar, and meetings…')

        const period = monthlyPeriodFor(new Date(periodStart + 'T00:00:00Z'))

        // Pull existing uploads so the snapshot reflects what's already extracted.
        const { data: uploadRows } = await supabase
          .from('briefing_uploads')
          .select('id, file_name, file_path, mime_type, file_kind, size_bytes, extraction_status, extracted_text, extracted_summary')
          .eq('briefing_id', briefingId)

        const uploads: BriefingUpload[] = (uploadRows as unknown as BriefingUpload[]) || []

        const snapshot = await aggregateMonthlyData(supabase as any, {
          userId,
          teamId,
          period,
          uploads: uploads.map(u => ({
            file_name: u.file_name,
            file_kind: u.file_kind,
            extracted_summary: u.extracted_summary,
          })),
          userNotes,
        })

        return { snapshot, uploads }
      })

      // ── Step 2: process pending uploads (extract + summarize) ──
      const updatedUploads = await step.run('process-uploads', async () => {
        if (!uploads.length) return uploads

        await setStatus('extracting', `Extracting ${uploads.length} uploaded file(s)…`)

        const result: BriefingUpload[] = []
        for (const upload of uploads) {
          if (upload.extraction_status === 'ready' && upload.extracted_summary) {
            result.push(upload)
            continue
          }
          if (upload.extraction_status === 'skipped') {
            result.push(upload)
            continue
          }

          try {
            // Download file from storage
            const { data: fileBlob, error: dlErr } = await supabase.storage
              .from('briefing-context')
              .download(upload.file_path)
            if (dlErr || !fileBlob) throw new Error(dlErr?.message || 'download failed')

            const arrayBuffer = await fileBlob.arrayBuffer()
            const buffer = Buffer.from(arrayBuffer)

            const extraction = await extractFile(buffer, upload.file_name, upload.mime_type)

            let summary: string | null = null
            if (extraction.text) {
              summary = await summarizeUploadedContext({
                fileName: upload.file_name,
                fileKind: upload.file_kind,
                extractedText: extraction.text,
              })
            }

            const status = extraction.text ? (summary ? 'ready' : 'failed') : 'skipped'
            const error = extraction.text && !summary ? 'AI summarization returned no result.' : extraction.warning || null

            await supabase
              .from('briefing_uploads')
              .update({
                extraction_status: status,
                extracted_text: extraction.text,
                extracted_summary: summary,
                extraction_error: error,
                processed_at: new Date().toISOString(),
              })
              .eq('id', upload.id)

            result.push({ ...upload, extraction_status: status as any, extracted_text: extraction.text, extracted_summary: summary })
          } catch (err) {
            const message = (err as Error).message || 'extraction failed'
            await supabase
              .from('briefing_uploads')
              .update({
                extraction_status: 'failed',
                extraction_error: message,
                processed_at: new Date().toISOString(),
              })
              .eq('id', upload.id)
            result.push({ ...upload, extraction_status: 'failed', extraction_error: message })
          }
        }
        return result
      })

      // Refresh snapshot's uploaded_context with the freshly-summarized uploads.
      const refreshedSnapshot: AggregatedDataSnapshot = {
        ...snapshot,
        uploaded_context: updatedUploads
          .filter(u => u.extracted_summary)
          .map(u => ({
            file_name: u.file_name,
            file_kind: u.file_kind,
            summary: u.extracted_summary as string,
          })),
      }

      // ── Step 3: synthesize ──
      const synth = await step.run('synthesize', async () => {
        await setStatus('synthesizing', 'Composing the briefing…')
        return generateMonthlyBriefing(refreshedSnapshot)
      })

      if (!synth) {
        await setStatus('failed', null as any, 'AI synthesis returned no result.')
        await logAiUsage(supabase, { module: 'generate-monthly-briefing', trigger: 'briefing/monthly.generate', teamId, userId, itemsProcessed: 0, metadata: { briefingId, outcome: 'synthesis-failed' } })
        return { ok: false, reason: 'synthesis-failed' }
      }

      // ── Step 4: persist sections (replace any non-pinned, non-edited ones) ──
      await step.run('persist-sections', async () => {
        // Keep user-pinned + user-edited sections; replace the rest.
        const { data: existing } = await supabase
          .from('briefing_sections')
          .select('id, pinned, user_edited')
          .eq('briefing_id', briefingId)

        const protectedIds = (existing || [])
          .filter(s => s.pinned || s.user_edited)
          .map(s => s.id)

        if (existing && existing.length) {
          const toDelete = (existing || [])
            .filter(s => !s.pinned && !s.user_edited)
            .map(s => s.id)
          if (toDelete.length) {
            await supabase.from('briefing_sections').delete().in('id', toDelete)
          }
        }

        // Compute starting order_index after protected sections
        const baseOrder = protectedIds.length

        const rows = synth.sections.map((s, idx) => ({
          briefing_id: briefingId,
          section_type: s.section_type,
          title: s.title,
          summary: s.summary,
          bullets: s.bullets,
          metadata: {},
          order_index: baseOrder + idx,
          pinned: false,
          user_edited: false,
        }))
        if (rows.length) {
          await supabase.from('briefing_sections').insert(rows)
        }

        await supabase
          .from('monthly_briefings')
          .update({
            title: synth.title,
            subtitle: synth.subtitle,
            data_snapshot: refreshedSnapshot as any,
            generated_at: new Date().toISOString(),
          })
          .eq('id', briefingId)
      })

      await setStatus('ready', null as any)

      // ── Step 5: log usage ──
      await logAiUsage(supabase, {
        module: 'generate-monthly-briefing',
        trigger: 'briefing/monthly.generate',
        teamId,
        userId,
        itemsProcessed: synth.sections.length,
        metadata: { briefingId, uploads_processed: updatedUploads.length },
      })

      return { ok: true, sections: synth.sections.length }
    } catch (err) {
      const message = (err as Error).message || 'unknown error'
      console.error('[generate-monthly-briefing] failed:', message)
      await setStatus('failed', null as any, message)
      await logAiUsage(supabase, {
        module: 'generate-monthly-briefing',
        trigger: 'briefing/monthly.generate',
        teamId,
        userId,
        metadata: { briefingId, outcome: 'error', error: message },
      })
      return { ok: false, reason: message }
    }
  },
)
