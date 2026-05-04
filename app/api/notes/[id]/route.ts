// app/api/notes/[id]/route.ts
// Fetch, edit, or delete a single note (with its images).

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data: note, error } = await admin
    .from('notes')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (error || !note) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 })
  }

  const { data: images } = await admin
    .from('note_images')
    .select('id, storage_path, original_name, mime_type, size_bytes, position, transcription, created_at')
    .eq('note_id', params.id)
    .order('position', { ascending: true })

  // Sign each image URL so the page can render it directly.
  const imagesWithUrls = await Promise.all((images || []).map(async img => {
    const { data: signed } = await admin
      .storage
      .from('note-images')
      .createSignedUrl(img.storage_path, 3600)
    return { ...img, signed_url: signed?.signedUrl || null }
  }))

  return NextResponse.json({ note, images: imagesWithUrls })
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const body = await request.json()

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.title === 'string') updates.title = body.title.trim() || null
  if (typeof body.body === 'string') updates.body = body.body
  if (typeof body.summary === 'string') updates.summary = body.summary
  if ('topic_id' in body) updates.topic_id = body.topic_id || null
  if (typeof body.note_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.note_date)) {
    updates.note_date = body.note_date
  }

  const { data: note, error } = await admin
    .from('notes')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error || !note) {
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
  return NextResponse.json({ note })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()

  // Find storage paths first so we can clean the bucket after the cascade delete.
  const { data: images } = await admin
    .from('note_images')
    .select('storage_path')
    .eq('note_id', params.id)
    .eq('user_id', user.id)

  const { error } = await admin
    .from('notes')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }

  if (images && images.length > 0) {
    const paths = images.map(i => i.storage_path)
    await admin.storage.from('note-images').remove(paths)
  }

  return NextResponse.json({ success: true })
}
