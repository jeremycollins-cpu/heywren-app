// app/(dashboard)/api/monthly-briefing/[id]/route.ts
// GET    — full briefing (envelope + sections + uploads + recent messages)
// DELETE — remove a briefing entirely

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: briefing, error } = await supabase
    .from('monthly_briefings')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!briefing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: sections }, { data: uploads }, { data: messages }] = await Promise.all([
    supabase
      .from('briefing_sections')
      .select('*')
      .eq('briefing_id', params.id)
      .order('order_index', { ascending: true }),
    supabase
      .from('briefing_uploads')
      .select('id, file_name, mime_type, file_kind, size_bytes, extraction_status, extracted_summary, extraction_error, uploaded_at, processed_at')
      .eq('briefing_id', params.id)
      .order('uploaded_at', { ascending: true }),
    supabase
      .from('briefing_messages')
      .select('*')
      .eq('briefing_id', params.id)
      .order('created_at', { ascending: true })
      .limit(200),
  ])

  return NextResponse.json({
    briefing,
    sections: sections || [],
    uploads: uploads || [],
    messages: messages || [],
  })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('monthly_briefings')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
