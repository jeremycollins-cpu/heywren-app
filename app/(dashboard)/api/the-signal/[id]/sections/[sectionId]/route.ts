// app/(dashboard)/api/monthly-briefing/[id]/sections/[sectionId]/route.ts
// PATCH — user edits a section directly.
//          body: { title?, summary?, bullets?, pinned?, order_index? }
//          Sets user_edited=true so future regenerations preserve it.
// DELETE — remove a section.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import type { BriefingBullet } from '@/lib/monthly-briefing/types'

interface PatchBody {
  title?: string
  summary?: string
  bullets?: BriefingBullet[]
  pinned?: boolean
  order_index?: number
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sectionId: string } },
) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as PatchBody

  // Ownership check via the briefing
  const { data: section } = await supabase
    .from('briefing_sections')
    .select('id, briefing_id')
    .eq('id', params.sectionId)
    .maybeSingle()
  if (!section || section.briefing_id !== params.id) {
    return NextResponse.json({ error: 'Section not found' }, { status: 404 })
  }

  const { data: briefing } = await supabase
    .from('monthly_briefings')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!briefing) return NextResponse.json({ error: 'Briefing not found' }, { status: 404 })

  const update: Record<string, unknown> = { user_edited: true }
  if (body.title !== undefined) update.title = body.title
  if (body.summary !== undefined) update.summary = body.summary
  if (body.bullets !== undefined) update.bullets = body.bullets
  if (body.pinned !== undefined) update.pinned = body.pinned
  if (body.order_index !== undefined) update.order_index = body.order_index

  const { data, error } = await supabase
    .from('briefing_sections')
    .update(update)
    .eq('id', params.sectionId)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ section: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; sectionId: string } },
) {
  const supabase = await createSessionClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: briefing } = await supabase
    .from('monthly_briefings')
    .select('id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!briefing) return NextResponse.json({ error: 'Briefing not found' }, { status: 404 })

  const { error } = await supabase
    .from('briefing_sections')
    .delete()
    .eq('id', params.sectionId)
    .eq('briefing_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
