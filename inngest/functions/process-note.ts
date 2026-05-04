// inngest/functions/process-note.ts
// Background processor for the Notes feature.
//
// Trigger: `note/process.requested` event with { note_id }
//
// Steps:
//   1. Fetch the note + its unprocessed images
//   2. Download each image from Supabase storage and base64-encode it
//   3. Run Claude vision extraction (title, transcription, summary, candidates)
//   4. Suggest a topic from the user's existing topic tree
//   5. Persist results — update note row, mark images processed
//
// Re-firing this event for the same note (e.g. user added more images later)
// re-runs extraction over ALL images for that note and overwrites the extracted
// fields with the merged result.

import { inngest } from '../client'
import { createClient } from '@supabase/supabase-js'
import { extractNoteFromImages, type NoteImageInput } from '@/lib/ai/extract-note-from-images'
import { suggestNoteTopic, type ExistingTopic } from '@/lib/ai/suggest-note-topic'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const processNote = inngest.createFunction(
  {
    id: 'process-note',
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: 'note/process.requested' },
  async ({ event, step }) => {
    const supabase = getAdminClient()
    const noteId = event.data.note_id as string

    if (!noteId) {
      return { success: false, error: 'Missing note_id' }
    }

    // ── 1. Fetch note + images ──
    const fetched = await step.run('fetch-note', async () => {
      const { data: note } = await supabase
        .from('notes')
        .select('id, user_id, team_id, status')
        .eq('id', noteId)
        .single()

      if (!note) return null

      const { data: images } = await supabase
        .from('note_images')
        .select('id, storage_path, mime_type, position')
        .eq('note_id', noteId)
        .order('position', { ascending: true })

      return { note, images: images || [] }
    })

    if (!fetched || !fetched.note) {
      return { success: false, error: 'Note not found' }
    }

    if (fetched.images.length === 0) {
      await supabase
        .from('notes')
        .update({ status: 'failed', failure_reason: 'No images attached' })
        .eq('id', noteId)
      return { success: false, error: 'No images' }
    }

    // ── 2. Download + base64-encode images ──
    const imageInputs = await step.run('download-images', async () => {
      const inputs: NoteImageInput[] = []
      for (const img of fetched.images) {
        const { data, error } = await supabase
          .storage
          .from('note-images')
          .download(img.storage_path)
        if (error || !data) {
          console.error('[process-note] failed to download', img.storage_path, error)
          continue
        }
        const buffer = Buffer.from(await data.arrayBuffer())
        inputs.push({
          position: img.position,
          mediaType: img.mime_type || 'image/jpeg',
          base64: buffer.toString('base64'),
        })
      }
      return inputs
    })

    if (imageInputs.length === 0) {
      await supabase
        .from('notes')
        .update({ status: 'failed', failure_reason: 'Could not download any images' })
        .eq('id', noteId)
      return { success: false, error: 'Image download failed' }
    }

    // ── 3. Vision extraction ──
    // Note: we don't wrap this in step.run() because the result contains very
    // large strings (full transcription) that Inngest would persist between
    // attempts. Retries re-do the AI call, which is acceptable.
    const extracted = await extractNoteFromImages(imageInputs)

    if (!extracted) {
      await supabase
        .from('notes')
        .update({ status: 'failed', failure_reason: 'AI extraction returned no result' })
        .eq('id', noteId)
      return { success: false, error: 'Extraction failed' }
    }

    // ── 4. Topic suggestion ──
    const topicSuggestion = await step.run('suggest-topic', async () => {
      const { data: topics } = await supabase
        .from('note_topics')
        .select('id, name, parent_id')
        .eq('team_id', fetched.note.team_id)

      const existing: ExistingTopic[] = (topics || []).map(t => ({
        id: t.id,
        name: t.name,
        parent_id: t.parent_id,
      }))

      const suggestion = await suggestNoteTopic({
        noteTitle: extracted.title,
        noteSummary: extracted.summary,
        existingTopics: existing,
      })
      return suggestion
    })

    // ── 5. Persist ──
    await step.run('persist-results', async () => {
      // Resolve topic_id: prefer matched existing topic; otherwise create the
      // suggested new topic so the user sees it pre-selected. They can change it.
      let topicId: string | null = null
      if (topicSuggestion?.existingTopicId) {
        topicId = topicSuggestion.existingTopicId
      } else if (topicSuggestion?.newTopicName) {
        const { data: newTopic } = await supabase
          .from('note_topics')
          .insert({
            user_id: fetched.note.user_id,
            team_id: fetched.note.team_id,
            parent_id: topicSuggestion.newTopicParentId,
            name: topicSuggestion.newTopicName,
          })
          .select('id')
          .single()
        topicId = newTopic?.id || null
      }

      const body = [extracted.summary, '', '---', '', extracted.transcription]
        .filter(Boolean)
        .join('\n')

      await supabase
        .from('notes')
        .update({
          title: extracted.title,
          summary: extracted.summary,
          transcription: extracted.transcription,
          body,
          topic_id: topicId,
          status: 'ready',
          failure_reason: null,
          extracted_actions: {
            todos: extracted.candidateTodos.map(title => ({
              title,
              accepted: false,
              dismissed: false,
            })),
            commitments: extracted.candidateCommitments.map(title => ({
              title,
              accepted: false,
              dismissed: false,
            })),
          },
        })
        .eq('id', noteId)

      // Per-image transcription writeback.
      for (const perImg of extracted.perImage) {
        const target = fetched.images.find(i => i.position === perImg.position)
        if (target) {
          await supabase
            .from('note_images')
            .update({ transcription: perImg.transcription, processed: true })
            .eq('id', target.id)
        }
      }

      // Mark any unmatched images processed too so we don't re-try them
      // forever if the model dropped one.
      await supabase
        .from('note_images')
        .update({ processed: true })
        .eq('note_id', noteId)
        .eq('processed', false)
    })

    return {
      success: true,
      noteId,
      images: imageInputs.length,
      todos: extracted.candidateTodos.length,
      commitments: extracted.candidateCommitments.length,
    }
  }
)
