// app/api/notes/[id]/images/[imageId]/route.ts
// Per-image operations: delete, or fetch a fresh signed download URL for the
// "download original" button.

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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; imageId: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()
  const { data: img } = await admin
    .from('note_images')
    .select('storage_path, original_name, mime_type')
    .eq('id', params.imageId)
    .eq('note_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!img) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)
  const download = searchParams.get('download') === '1'

  const { data: signed, error } = await admin
    .storage
    .from('note-images')
    .createSignedUrl(img.storage_path, 300, download
      ? { download: img.original_name || 'note-image' }
      : undefined)

  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Failed to sign URL' }, { status: 500 })
  }

  return NextResponse.json({
    signed_url: signed.signedUrl,
    original_name: img.original_name,
    mime_type: img.mime_type,
  })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; imageId: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getAdminClient()

  const { data: img } = await admin
    .from('note_images')
    .select('storage_path')
    .eq('id', params.imageId)
    .eq('note_id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!img) return NextResponse.json({ error: 'Image not found' }, { status: 404 })

  await admin.from('note_images').delete().eq('id', params.imageId)
  await admin.storage.from('note-images').remove([img.storage_path])

  return NextResponse.json({ success: true })
}
