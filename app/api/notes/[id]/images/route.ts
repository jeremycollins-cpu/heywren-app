// app/api/notes/[id]/images/route.ts
// Append more images to an existing note. Re-fires processing so the AI
// extraction merges the new images with the existing ones.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { inngest } from '@/inngest/client'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGES_PER_NOTE = 30

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()

  // Verify the note belongs to this user.
  const { data: note } = await admin
    .from('notes')
    .select('id, user_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()
  if (!note) return NextResponse.json({ error: 'Note not found' }, { status: 404 })

  const formData = await request.formData()
  const files = formData.getAll('images').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'No images provided' }, { status: 400 })
  }
  for (const f of files) {
    if (!ALLOWED_MIME.has(f.type)) {
      return NextResponse.json({ error: `Unsupported image type: ${f.type}` }, { status: 400 })
    }
    if (f.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `Image too large (max 10 MB): ${f.name}` }, { status: 400 })
    }
  }

  // Determine next position.
  const { data: existing } = await admin
    .from('note_images')
    .select('position')
    .eq('note_id', note.id)
    .order('position', { ascending: false })
    .limit(1)
    .single()

  const totalCount = (existing?.position ?? -1) + 1 + files.length
  if (totalCount > MAX_IMAGES_PER_NOTE) {
    return NextResponse.json({ error: `Max ${MAX_IMAGES_PER_NOTE} images per note` }, { status: 400 })
  }

  let nextPosition = (existing?.position ?? -1) + 1
  const uploaded: string[] = []
  for (const file of files) {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${user.id}/${note.id}/${Date.now()}-${nextPosition}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadErr } = await admin
      .storage
      .from('note-images')
      .upload(path, buffer, { contentType: file.type, upsert: false })

    if (uploadErr) {
      console.error('[notes.add-images] upload failed:', uploadErr)
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
        position: nextPosition,
      })
      .select('id')
      .single()

    if (img) uploaded.push(img.id)
    nextPosition++
  }

  // Mark note back to processing and re-fire extraction.
  await admin
    .from('notes')
    .update({ status: 'processing' })
    .eq('id', note.id)

  await inngest.send({
    name: 'note/process.requested',
    data: { note_id: note.id },
  })

  return NextResponse.json({ added: uploaded.length })
}
