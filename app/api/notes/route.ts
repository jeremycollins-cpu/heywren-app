// app/api/notes/route.ts
// Notes index — list, search, and create.
//
// POST creates a note row, uploads the supplied images to the `note-images`
// storage bucket, and fires `note/process.requested` so the Inngest pipeline
// runs OCR + summarization + topic suggestion in the background.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_IMAGES_PER_NOTE = 30
const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const { searchParams } = new URL(request.url)
  const topicId = searchParams.get('topic_id')
  const status = searchParams.get('status')

  let query = admin
    .from('notes')
    .select('id, title, summary, status, topic_id, note_date, created_at, updated_at')
    .eq('user_id', user.id)
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(500)

  if (topicId === 'none') {
    query = query.is('topic_id', null)
  } else if (topicId) {
    query = query.eq('topic_id', topicId)
  }
  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
  }
  return NextResponse.json({ notes: data || [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = getAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('current_team_id')
    .eq('id', user.id)
    .single()

  const teamId = profile?.current_team_id
  if (!teamId) {
    return NextResponse.json({ error: 'No team found' }, { status: 400 })
  }

  const formData = await request.formData()
  const files = formData.getAll('images').filter((f): f is File => f instanceof File)
  const noteDate = (formData.get('note_date') as string | null) || null
  const topicId = (formData.get('topic_id') as string | null) || null

  if (files.length === 0) {
    return NextResponse.json({ error: 'At least one image is required' }, { status: 400 })
  }
  if (files.length > MAX_IMAGES_PER_NOTE) {
    return NextResponse.json({ error: `Max ${MAX_IMAGES_PER_NOTE} images per note` }, { status: 400 })
  }
  for (const f of files) {
    if (!ALLOWED_MIME.has(f.type)) {
      return NextResponse.json({ error: `Unsupported image type: ${f.type}` }, { status: 400 })
    }
    if (f.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `Image too large (max 10 MB): ${f.name}` }, { status: 400 })
    }
  }

  // Create the note row first so we have an id for the storage path.
  const { data: note, error: noteErr } = await admin
    .from('notes')
    .insert({
      user_id: user.id,
      team_id: teamId,
      topic_id: topicId,
      status: 'processing',
      note_date: noteDate || new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single()

  if (noteErr || !note) {
    console.error('[notes.create] insert failed:', noteErr)
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }

  // Upload images and create note_images rows.
  const uploaded: Array<{ id: string; path: string }> = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${user.id}/${note.id}/${Date.now()}-${i}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await admin
      .storage
      .from('note-images')
      .upload(path, buffer, { contentType: file.type, upsert: false })

    if (uploadErr) {
      console.error('[notes.create] upload failed:', uploadErr)
      continue
    }

    const { data: img } = await admin
      .from('note_images')
      .insert({
        note_id: note.id,
        user_id: user.id,
        storage_path: path,
        original_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        position: i,
      })
      .select('id')
      .single()

    if (img) uploaded.push({ id: img.id, path })
  }

  if (uploaded.length === 0) {
    await admin.from('notes').delete().eq('id', note.id)
    return NextResponse.json({ error: 'Failed to upload images' }, { status: 500 })
  }

  await inngest.send({
    name: 'note/process.requested',
    data: { note_id: note.id },
  })

  return NextResponse.json({ note: { id: note.id, status: 'processing' } })
}
