// app/(dashboard)/api/monthly-briefing/[id]/upload/route.ts
// POST — upload a context file (PDF/PPTX/XLSX/etc.) for a briefing.
//        Stores the file in storage, creates a briefing_uploads row,
//        and dispatches a single-file extraction (re-using the generation
//        pipeline with no synthesis). For simplicity we just kick the
//        whole generation job — it will pick up the new upload.
//
// DELETE /api/monthly-briefing/:id/upload?uploadId=… — remove an upload.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { resolveTeamId } from '@/lib/team/resolve-team'
import { classifyFileKind } from '@/lib/monthly-briefing/extract-file'

const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB
const MAX_FILES_PER_BRIEFING = 12

function getAdminClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const teamId = await resolveTeamId(supabase, user.id)
  if (!teamId) return NextResponse.json({ error: 'No team found' }, { status: 400 })

  const { data: briefing } = await supabase
    .from('monthly_briefings')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!briefing) return NextResponse.json({ error: 'Briefing not found' }, { status: 404 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MB limit.` }, { status: 413 })
  }

  // Enforce per-briefing file count
  const admin = getAdminClient()
  const { count } = await admin
    .from('briefing_uploads')
    .select('id', { count: 'exact', head: true })
    .eq('briefing_id', params.id)
  if ((count || 0) >= MAX_FILES_PER_BRIEFING) {
    return NextResponse.json({ error: `You can upload at most ${MAX_FILES_PER_BRIEFING} files per briefing.` }, { status: 400 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200)
  const objectKey = `${user.id}/${params.id}/${Date.now()}-${safeName}`
  const fileKind = classifyFileKind(file.name, file.type)

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const { error: uploadErr } = await admin.storage
    .from('briefing-context')
    .upload(objectKey, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const { data: row, error: insertErr } = await admin
    .from('briefing_uploads')
    .insert({
      briefing_id: params.id,
      team_id: teamId,
      user_id: user.id,
      file_name: file.name,
      file_path: objectKey,
      mime_type: file.type || null,
      file_kind: fileKind,
      size_bytes: file.size,
      extraction_status: 'pending',
    })
    .select('id, file_name, file_kind, extraction_status, uploaded_at')
    .single()

  if (insertErr || !row) {
    // best-effort cleanup
    await admin.storage.from('briefing-context').remove([objectKey])
    return NextResponse.json({ error: insertErr?.message || 'failed to record upload' }, { status: 500 })
  }

  return NextResponse.json({ upload: row })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const uploadId = url.searchParams.get('uploadId')
  if (!uploadId) return NextResponse.json({ error: 'Missing uploadId' }, { status: 400 })

  const { data: upload } = await supabase
    .from('briefing_uploads')
    .select('id, file_path, briefing_id')
    .eq('id', uploadId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!upload || upload.briefing_id !== params.id) {
    return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
  }

  const admin = getAdminClient()
  await admin.storage.from('briefing-context').remove([upload.file_path])
  await admin.from('briefing_uploads').delete().eq('id', uploadId)
  return NextResponse.json({ success: true })
}
